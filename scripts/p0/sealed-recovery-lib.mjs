import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { runExternal, runPsql, runSupabaseJson } from './temporary-db-access.mjs'

const encryptionMagic = Buffer.from('CW4ENC01', 'ascii')
const powershellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const forbiddenSecretPatterns = [
  /sb_secret_[A-Za-z0-9_-]{8,}/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{8,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
  /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i,
]

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  )
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function parseJson(label, text) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(label + ' did not return valid JSON')
  }
}

export function assertNoSecretLiterals(label, text) {
  for (const pattern of forbiddenSecretPatterns) {
    if (pattern.test(String(text))) throw new Error(label + ' contains a forbidden secret literal')
  }
}

export function createProtectedKey({ repoRoot, keyPath }) {
  if (existsSync(keyPath)) throw new Error('recovery key path already exists')
  const key = randomBytes(32)
  runExternal({
    commandPath: powershellPath,
    args: [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repoRoot, 'scripts', 'p0', 'protect-recovery-key.ps1'),
      '-Path', resolve(keyPath),
    ],
    input: key.toString('base64'),
  })
  if (!existsSync(keyPath) || statSync(keyPath).size < 32) {
    throw new Error('DPAPI recovery key was not persisted')
  }
  return key
}

export function readProtectedKey({ repoRoot, keyPath }) {
  const result = runExternal({
    commandPath: powershellPath,
    args: [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repoRoot, 'scripts', 'p0', 'unprotect-recovery-key.ps1'),
      '-Path', resolve(keyPath),
    ],
  })
  const key = Buffer.from(result.stdout.trim(), 'base64')
  if (key.length !== 32) throw new Error('DPAPI recovery key has invalid length')
  return key
}

export function encryptBuffer(plaintext, key) {
  if (!Buffer.isBuffer(plaintext)) plaintext = Buffer.from(plaintext)
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AES key must be 32 bytes')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([encryptionMagic, iv, tag, ciphertext])
}

export function decryptBuffer(encrypted, key) {
  if (!Buffer.isBuffer(encrypted)) encrypted = Buffer.from(encrypted)
  if (encrypted.length < encryptionMagic.length + 12 + 16) throw new Error('encrypted artifact is truncated')
  if (!encrypted.subarray(0, encryptionMagic.length).equals(encryptionMagic)) {
    throw new Error('encrypted artifact magic is invalid')
  }
  const ivStart = encryptionMagic.length
  const tagStart = ivStart + 12
  const dataStart = tagStart + 16
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(ivStart, tagStart))
  decipher.setAuthTag(encrypted.subarray(tagStart, dataStart))
  return Buffer.concat([decipher.update(encrypted.subarray(dataStart)), decipher.final()])
}

export function writeEncryptedArtifact({
  packageDirectory,
  relativePath,
  plaintext,
  key,
  keyReference,
  contentType,
  format,
  tool,
  toolVersion,
  createdAt = new Date().toISOString(),
}) {
  if (relativePath.includes('..') || relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error('artifact path must be relative and contained')
  }
  const encrypted = encryptBuffer(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext), key)
  const outputPath = resolve(packageDirectory, relativePath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, encrypted, { flag: 'wx' })
  return {
    status: 'completed',
    path: relativePath.replaceAll('\\', '/'),
    sha256: sha256(encrypted),
    bytes: encrypted.length,
    contentType,
    format,
    tool,
    toolVersion,
    createdAt,
    encrypted: true,
    encryptionKeyReference: keyReference,
  }
}

export function readEncryptedArtifact({ packageDirectory, artifact, key }) {
  const artifactPath = resolve(packageDirectory, artifact.path)
  const contained = relative(packageDirectory, artifactPath)
  if (!contained || contained.startsWith('..') || contained.startsWith(sep)) {
    throw new Error('artifact path escapes package directory')
  }
  const encrypted = readFileSync(artifactPath)
  if (sha256(encrypted) !== artifact.sha256) throw new Error('artifact SHA256 mismatch: ' + artifact.path)
  return decryptBuffer(encrypted, key)
}

export function packDirectory(root, { rejectEnvironmentFiles = true } = {}) {
  const absoluteRoot = resolve(root)
  if (!existsSync(absoluteRoot)) throw new Error('directory is missing: ' + basename(absoluteRoot))
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const path = relative(absoluteRoot, fullPath).replaceAll('\\', '/')
      if (rejectEnvironmentFiles && /(^|\/)\.env(?:\.|$)/i.test(path)) {
        throw new Error('environment value file is excluded from archive: ' + path)
      }
      const bytes = readFileSync(fullPath)
      files.push({ path, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') })
    }
  }
  walk(absoluteRoot)
  return { schemaVersion: 1, root: basename(absoluteRoot), files }
}

export function unpackDirectoryBundle(bundle, targetRoot) {
  if (bundle?.schemaVersion !== 1 || !Array.isArray(bundle.files)) throw new Error('directory bundle is invalid')
  for (const item of bundle.files) {
    if (typeof item.path !== 'string' || item.path.includes('..') || /^[A-Za-z]:/.test(item.path)) {
      throw new Error('directory bundle contains unsafe path')
    }
    const bytes = Buffer.from(item.base64, 'base64')
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error('directory bundle hash mismatch')
    const output = resolve(targetRoot, item.path)
    const contained = relative(resolve(targetRoot), output)
    if (!contained || contained.startsWith('..') || contained.startsWith(sep)) throw new Error('bundle path escapes target')
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, bytes, { flag: 'wx' })
  }
}

export function findServerKey(keys) {
  if (!Array.isArray(keys)) return null
  const candidates = []
  for (const item of keys) {
    if (!item || typeof item !== 'object') continue
    const label = String(item.name ?? item.type ?? item.role ?? '').toLowerCase()
    for (const field of ['api_key', 'key', 'value']) {
      const value = item[field]
      if (typeof value !== 'string') continue
      if (value.startsWith('sb_secret_')) candidates.unshift(value)
      else if (label.includes('service_role') || label === 'service') candidates.push(value)
    }
  }
  return candidates[0] ?? null
}

export function getServerKey({ cliPath, projectRef }) {
  const keys = runSupabaseJson({
    cliPath,
    args: ['projects', 'api-keys', '--project-ref', projectRef, '--reveal'],
  })
  const key = findServerKey(keys)
  if (!key) throw new Error('no server-side API key is available for the requested project')
  return key
}

export function createServerClient(projectRef, serverKey) {
  return createClient(`https://${projectRef}.supabase.co`, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function collectStorageArchive(client) {
  const bucketsResult = await client.storage.listBuckets()
  if (bucketsResult.error) throw new Error('cannot list Storage buckets')
  const buckets = (bucketsResult.data ?? []).map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    public: Boolean(bucket.public),
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
    avifAutodetection: bucket.avif_autodetection ?? false,
  })).sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const objects = []
  async function walk(bucketId, prefix = '') {
    let offset = 0
    while (true) {
      const result = await client.storage.from(bucketId).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (result.error) throw new Error('cannot list Storage objects')
      const items = result.data ?? []
      for (const item of items) {
        const path = prefix ? `${prefix}/${item.name}` : item.name
        if (item.id === null) {
          await walk(bucketId, path)
          continue
        }
        const downloaded = await client.storage.from(bucketId).download(path)
        if (downloaded.error) throw new Error('cannot download Storage object')
        const bytes = Buffer.from(await downloaded.data.arrayBuffer())
        objects.push({
          bucketId,
          path,
          bytes: bytes.length,
          sha256: sha256(bytes),
          contentType: item.metadata?.mimetype ?? item.metadata?.contentType ?? 'application/octet-stream',
          cacheControl: item.metadata?.cacheControl ?? null,
          ownerId: item.owner_id ?? item.owner ?? null,
          createdAt: item.created_at ?? null,
          updatedAt: item.updated_at ?? null,
          lastAccessedAt: item.last_accessed_at ?? null,
          metadata: item.metadata ?? null,
          userMetadata: item.user_metadata ?? null,
          base64: bytes.toString('base64'),
        })
      }
      if (items.length < 100) break
      offset += items.length
    }
  }
  for (const bucket of buckets) await walk(bucket.id)
  objects.sort((a, b) => `${a.bucketId}/${a.path}`.localeCompare(`${b.bucketId}/${b.path}`, 'en'))
  return { schemaVersion: 1, buckets, objects }
}

export function storageSummary(archive) {
  return {
    buckets: archive.buckets.length,
    objects: archive.objects.length,
    bytes: archive.objects.reduce((total, item) => total + item.bytes, 0),
    aggregateSha256: sha256(archive.objects.map((item) => (
      `${item.bucketId}/${item.path}|${item.bytes}|${item.sha256}`
    )).join('\n')),
  }
}

export async function restoreStorageArchive(client, archive) {
  for (const bucket of archive.buckets) {
    const result = await client.storage.createBucket(bucket.id, {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit ?? undefined,
      allowedMimeTypes: bucket.allowedMimeTypes ?? undefined,
      avifAutodetection: bucket.avifAutodetection,
    })
    if (result.error) throw new Error('cannot create target Storage bucket')
  }
  for (const item of archive.objects) {
    const bytes = Buffer.from(item.base64, 'base64')
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error('Storage archive hash mismatch')
    const result = await client.storage.from(item.bucketId).upload(item.path, bytes, {
      upsert: false,
      contentType: item.contentType,
      cacheControl: item.cacheControl ?? undefined,
    })
    if (result.error) throw new Error('cannot upload target Storage object')
  }
}

export async function verifyStorageArchive(client, expectedArchive) {
  const actual = await collectStorageArchive(client)
  const expected = storageSummary(expectedArchive)
  const summary = storageSummary(actual)
  if (expected.buckets !== summary.buckets || expected.objects !== summary.objects ||
      expected.bytes !== summary.bytes || expected.aggregateSha256 !== summary.aggregateSha256) {
    throw new Error('target Storage reconciliation failed')
  }
  return summary
}

export function getReconciliation({ psqlPath, pgEnvironment, sql }) {
  const result = parseJson('sealed reconciliation', runPsql({
    psqlPath,
    pgEnvironment,
    sql,
    timeout: 180000,
  }))
  return { value: result, canonical: canonicalJson(result), sha256: sha256(canonicalJson(result)) }
}

export function getStoragePolicySql({ psqlPath, pgEnvironment }) {
  const sql = `
select coalesce(string_agg(
  format('create policy %I on %I.%I as %s for %s to %s%s%s;',
    p.polname,n.nspname,c.relname,
    case when p.polpermissive then 'permissive' else 'restrictive' end,
    case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
    (select string_agg(case when role_oid=0 then 'public' else quote_ident(r.rolname) end,', ' order by role_oid)
      from unnest(p.polroles) as roles(role_oid) left join pg_catalog.pg_roles r on r.oid=roles.role_oid),
    case when p.polqual is null then '' else E'\\nusing ('||pg_get_expr(p.polqual,p.polrelid)||')' end,
    case when p.polwithcheck is null then '' else E'\\nwith check ('||pg_get_expr(p.polwithcheck,p.polrelid)||')' end
  ),E'\\n\\n' order by n.nspname,c.relname,p.polname
),'-- no custom auth or storage policies')
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid=p.polrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('auth','storage');`
  return runPsql({ psqlPath, pgEnvironment, sql }) + '\n'
}

function collectManagedTriggers({ psqlPath, pgEnvironment }) {
  const sql = `
select coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,
  'table',c.relname,
  'trigger',t.tgname,
  'functionSchema',pn.nspname,
  'functionName',p.proname,
  'definition',pg_get_triggerdef(t.oid,false),
  'functionMd5',md5(pg_get_functiondef(p.oid))
) order by n.nspname,c.relname,t.tgname),'[]'::jsonb)::text
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
join pg_catalog.pg_proc p on p.oid=t.tgfoid
join pg_catalog.pg_namespace pn on pn.oid=p.pronamespace
where not t.tgisinternal and n.nspname in ('auth','storage');`
  return parseJson('managed trigger inventory', runPsql({ psqlPath, pgEnvironment, sql }))
}

export function getManagedSchemaCustomizationSql({ psqlPath, sourcePgEnvironment, targetPgEnvironment }) {
  const source = collectManagedTriggers({ psqlPath, pgEnvironment: sourcePgEnvironment })
  const target = collectManagedTriggers({ psqlPath, pgEnvironment: targetPgEnvironment })
  const key = (item) => `${item.schema}.${item.table}.${item.trigger}`
  const sourceByKey = new Map(source.map((item) => [key(item), item]))
  const targetByKey = new Map(target.map((item) => [key(item), item]))
  const sourceOnly = source.filter((item) => !targetByKey.has(key(item)))
  const targetOnly = target.filter((item) => !sourceByKey.has(key(item)))
  const changed = source.filter((item) => {
    const other = targetByKey.get(key(item))
    return other && (item.definition !== other.definition || item.functionMd5 !== other.functionMd5)
  })
  if (targetOnly.length !== 0 || changed.length !== 0) {
    throw new Error('managed Auth or Storage trigger baseline changed')
  }
  if (sourceOnly.length !== 1 || key(sourceOnly[0]) !== 'auth.users.on_auth_user_created' ||
      sourceOnly[0].functionSchema !== 'public' || sourceOnly[0].functionName !== 'handle_new_user') {
    throw new Error('authorized Auth trigger customization is not the only managed trigger difference')
  }
  const policySql = getStoragePolicySql({ psqlPath, pgEnvironment: sourcePgEnvironment })
  const triggerSql = sourceOnly.map((item) => item.definition + ';').join('\n\n')
  return {
    sql: policySql + '\n' + triggerSql + '\n',
    triggerDiff: { sourceCount: source.length, targetCount: target.length, sourceOnly, targetOnly, changed },
  }
}

export function quoteSqlLiteral(value) {
  if (value === null || value === undefined) return 'null'
  return "'" + String(value).replaceAll("'", "''") + "'"
}

export function quoteSqlUtf8Literal(value) {
  const hex = Buffer.from(String(value), 'utf8').toString('hex')
  return `convert_from(decode('${hex}','hex'),'UTF8')`
}
