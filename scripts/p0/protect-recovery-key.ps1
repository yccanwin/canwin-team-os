param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plainText = [Console]::In.ReadToEnd().Trim()
$plainBytes = [Convert]::FromBase64String($plainText)
$protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
$parent = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
[IO.Directory]::CreateDirectory($parent) | Out-Null
[IO.File]::WriteAllBytes($Path, $protectedBytes)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule(
  $identity,
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.AccessControlType]::Allow
)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $Path -AclObject $acl
