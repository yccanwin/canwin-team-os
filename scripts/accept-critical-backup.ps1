<#
.SYNOPSIS
验收 FAST-1 CSV，保存原始 JSON，并下载 canwin-media 公共文件生成 SHA256 清单。

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\accept-critical-backup.ps1 `
  -CsvPath .\backup\fast-1.csv `
  -OutputDirectory .\backup\accepted-20260713

.NOTES
默认固定基线：finance_records=29、achievements=29、photos=1、canwin-media=30。
脚本只发起公开文件 GET，不上传、不删除、不修改任何远端数据，下载失败不重试。
#>

#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CsvPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [ValidateRange(0, 2147483647)]
  [int]$ExpectedFinanceRows = 29,

  [ValidateRange(0, 2147483647)]
  [int]$ExpectedAchievementRows = 29,

  [ValidateRange(0, 2147483647)]
  [int]$ExpectedPhotoRows = 1,

  [ValidateRange(0, 2147483647)]
  [int]$ExpectedMediaRows = 30,

  [ValidateRange(1, 600)]
  [int]$DownloadTimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedFormat = 'canwin-critical-data-backup'
$ExpectedFormatVersion = 1
$ExpectedProjectRef = 'agygfhmkazcbqaqwmljb'
$PublicMediaBaseUrl = "https://$ExpectedProjectRef.supabase.co/storage/v1/object/public/canwin-media"

function Stop-Acceptance {
  param([Parameter(Mandatory = $true)][string]$Message)
  throw [System.InvalidOperationException]::new($Message)
}

function Get-RequiredPropertyValue {
  param(
    [Parameter(Mandatory = $true)]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Context
  )

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    Stop-Acceptance "$Context 缺少属性：$Name"
  }
  return $property.Value
}

function Get-ValidatedDataset {
  param(
    [Parameter(Mandatory = $true)]$Datasets,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$ExpectedCount
  )

  $dataset = Get-RequiredPropertyValue -Object $Datasets -Name $Name -Context 'datasets'
  $declaredCount = [long](Get-RequiredPropertyValue -Object $dataset -Name 'count' -Context $Name)
  $rows = @(Get-RequiredPropertyValue -Object $dataset -Name 'rows' -Context $Name)

  if ($declaredCount -ne $ExpectedCount) {
    Stop-Acceptance "$Name 声明 count=$declaredCount，固定基线应为 $ExpectedCount"
  }
  if ($rows.Count -ne $ExpectedCount) {
    Stop-Acceptance "$Name 实际 rows=$($rows.Count)，固定基线应为 $ExpectedCount"
  }
  return [pscustomobject]@{ Name = $Name; Count = $declaredCount; Rows = $rows }
}

function Get-SafeMediaTarget {
  param(
    [Parameter(Mandatory = $true)][string]$ObjectName,
    [Parameter(Mandatory = $true)][string]$MediaRoot
  )

  if ([string]::IsNullOrWhiteSpace($ObjectName) -or
      $ObjectName.StartsWith('/') -or
      $ObjectName.EndsWith('/') -or
      $ObjectName.Contains('//') -or
      $ObjectName.Contains('\')) {
    Stop-Acceptance "非法媒体对象路径：$ObjectName"
  }

  $segments = @($ObjectName -split '/')
  $invalidChars = [System.IO.Path]::GetInvalidFileNameChars()
  foreach ($segment in $segments) {
    if ([string]::IsNullOrWhiteSpace($segment) -or $segment -eq '.' -or $segment -eq '..' -or
        $segment.IndexOfAny($invalidChars) -ge 0) {
      Stop-Acceptance "媒体对象路径包含非法段：$ObjectName"
    }
  }

  $relativePath = [string]::Join([System.IO.Path]::DirectorySeparatorChar, $segments)
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $MediaRoot $relativePath))
  $rootPrefix = $MediaRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $targetPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Acceptance "媒体对象路径越界：$ObjectName"
  }

  $encodedSegments = @($segments | ForEach-Object { [System.Uri]::EscapeDataString($_) })
  return [pscustomobject]@{
    Name = $ObjectName
    TargetPath = $targetPath
    Url = "$PublicMediaBaseUrl/$($encodedSegments -join '/')"
  }
}

try {
  $resolvedCsvPath = (Resolve-Path -LiteralPath $CsvPath -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolvedCsvPath -PathType Leaf)) {
    Stop-Acceptance "CSV 文件不存在：$CsvPath"
  }

  $csvText = Get-Content -LiteralPath $resolvedCsvPath -Raw -Encoding UTF8
  $csvRows = @($csvText | ConvertFrom-Csv)
  if ($csvRows.Count -ne 1) {
    Stop-Acceptance "FAST-1 CSV 必须恰好包含一条数据记录，当前为 $($csvRows.Count)"
  }

  $rawJson = [string](Get-RequiredPropertyValue -Object $csvRows[0] -Name 'backup_package' -Context 'FAST-1 CSV')
  if ([string]::IsNullOrWhiteSpace($rawJson)) {
    Stop-Acceptance 'backup_package 为空'
  }
  $package = $rawJson | ConvertFrom-Json

  $format = [string](Get-RequiredPropertyValue -Object $package -Name 'format' -Context 'backup_package')
  $formatVersion = [int](Get-RequiredPropertyValue -Object $package -Name 'format_version' -Context 'backup_package')
  $projectRef = [string](Get-RequiredPropertyValue -Object $package -Name 'project_ref' -Context 'backup_package')
  if ($format -ne $ExpectedFormat -or $formatVersion -ne $ExpectedFormatVersion) {
    Stop-Acceptance "备份格式不匹配：format=$format，format_version=$formatVersion"
  }
  if ($projectRef -ne $ExpectedProjectRef) {
    Stop-Acceptance "项目 ref 不匹配：$projectRef"
  }

  $datasets = Get-RequiredPropertyValue -Object $package -Name 'datasets' -Context 'backup_package'
  $null = Get-ValidatedDataset -Datasets $datasets -Name 'public.finance_records' -ExpectedCount $ExpectedFinanceRows
  $null = Get-ValidatedDataset -Datasets $datasets -Name 'public.achievements' -ExpectedCount $ExpectedAchievementRows
  $null = Get-ValidatedDataset -Datasets $datasets -Name 'public.photos' -ExpectedCount $ExpectedPhotoRows
  $mediaDataset = Get-ValidatedDataset -Datasets $datasets -Name 'storage.objects:canwin-media' -ExpectedCount $ExpectedMediaRows

  $outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
  if (Test-Path -LiteralPath $outputPath) {
    if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
      Stop-Acceptance "目标不是目录：$outputPath"
    }
    if (@(Get-ChildItem -LiteralPath $outputPath -Force).Count -ne 0) {
      Stop-Acceptance "目标目录必须为空，避免覆盖既有备份：$outputPath"
    }
  } else {
    $null = New-Item -ItemType Directory -Path $outputPath
  }

  $mediaRoot = [System.IO.Path]::GetFullPath((Join-Path $outputPath 'canwin-media'))
  $seenNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $downloadPlan = @()
  foreach ($mediaRow in $mediaDataset.Rows) {
    $objectName = [string](Get-RequiredPropertyValue -Object $mediaRow -Name 'name' -Context 'media row')
    if (-not $seenNames.Add($objectName)) {
      Stop-Acceptance "媒体对象路径重复或仅大小写不同：$objectName"
    }
    $downloadPlan += Get-SafeMediaTarget -ObjectName $objectName -MediaRoot $mediaRoot
  }

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $jsonPath = Join-Path $outputPath 'critical-backup.json'
  [System.IO.File]::WriteAllText($jsonPath, $rawJson, $utf8NoBom)
  $null = New-Item -ItemType Directory -Path $mediaRoot

  Add-Type -AssemblyName System.Net.Http
  $httpClient = [System.Net.Http.HttpClient]::new()
  $httpClient.Timeout = [TimeSpan]::FromSeconds($DownloadTimeoutSeconds)
  $manifestRows = @()
  try {
    foreach ($item in $downloadPlan) {
      $parentDirectory = [System.IO.Path]::GetDirectoryName($item.TargetPath)
      if (-not (Test-Path -LiteralPath $parentDirectory)) {
        $null = New-Item -ItemType Directory -Path $parentDirectory
      }

      $partialPath = "$($item.TargetPath).partial"
      try {
        $response = $httpClient.GetAsync(
          $item.Url,
          [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
        ).GetAwaiter().GetResult()
        try {
          if (-not $response.IsSuccessStatusCode) {
            Stop-Acceptance "下载失败 HTTP $([int]$response.StatusCode)：$($item.Name)"
          }
          $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
          try {
            $outputStream = [System.IO.File]::Open($partialPath, [System.IO.FileMode]::CreateNew)
            try {
              $inputStream.CopyTo($outputStream)
            } finally {
              $outputStream.Dispose()
            }
          } finally {
            $inputStream.Dispose()
          }
        } finally {
          $response.Dispose()
        }
        [System.IO.File]::Move($partialPath, $item.TargetPath)
      } catch {
        if (Test-Path -LiteralPath $partialPath) {
          Remove-Item -LiteralPath $partialPath -Force
        }
        throw
      }

      $fileInfo = Get-Item -LiteralPath $item.TargetPath
      $sha256 = (Get-FileHash -LiteralPath $item.TargetPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $manifestRows += [pscustomobject]@{
        name = $item.Name
        sha256 = $sha256
        bytes = $fileInfo.Length
        public_url = $item.Url
      }
    }
  } finally {
    $httpClient.Dispose()
  }

  $manifestPath = Join-Path $outputPath 'canwin-media-sha256.csv'
  $manifestCsv = @($manifestRows | ConvertTo-Csv -NoTypeInformation)
  [System.IO.File]::WriteAllLines($manifestPath, $manifestCsv, $utf8NoBom)

  [Console]::WriteLine("PASS critical backup accepted: $outputPath")
  [Console]::WriteLine("JSON: $jsonPath")
  [Console]::WriteLine("Media files: $($manifestRows.Count); manifest: $manifestPath")
  exit 0
} catch {
  [Console]::Error.WriteLine("STOP critical backup rejected: $($_.Exception.Message)")
  exit 1
}
