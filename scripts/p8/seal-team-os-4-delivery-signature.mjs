import { createHash, createPublicKey, sign, verify } from 'node:crypto'
import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HASH = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const VERSION = /^4\.0\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SAFE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9._/-]+$/
const ARTIFACT_KINDS = new Set([
  'team-os-4-clean-installation-package',
  'team-os-4-application-source-package',
  'team-os-4-domain-source-package',
  'team-os-4-platform-source-package',
  'separate-offline-one-shot-migration-tool',
])

function usage() {
  throw new Error('usage: sign --manifest <MANIFEST.sha256> --private-key <external.pem> --output <new.signature.json> | verify --manifest <MANIFEST.sha256> --signature <signature.json> --public-key <public.pem>')
}

function parseArguments(argv) {
  const mode = argv[0]
  if (mode !== 'sign' && mode !== 'verify') usage()
  const values = new Map()
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value || values.has(name)) usage()
    values.set(name, value)
  }
  const expected = mode === 'sign'
    ? ['--manifest', '--private-key', '--output']
    : ['--manifest', '--signature', '--public-key']
  if (values.size !== expected.length || expected.some((name) => !values.has(name))) usage()
  return { mode, values }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

function inside(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`)
}

function parseManifest(text) {
  if (!text.endsWith('\n') || text.includes('\r')) throw new Error('manifest must use canonical LF lines')
  const entries = []
  const paths = new Set()
  for (const line of text.slice(0, -1).split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/.exec(line)
    if (!match || !SAFE_PATH.test(match[2])) throw new Error('manifest contains an invalid entry')
    if (match[2] === 'MANIFEST.sha256') throw new Error('manifest must not hash itself')
    if (paths.has(match[2])) throw new Error('manifest contains a duplicate path')
    paths.add(match[2])
    entries.push({ sha256: match[1], path: match[2] })
  }
  if (!entries.length) throw new Error('manifest is empty')
  for (const required of ['VERSION', 'LICENSE', 'NOTICE', 'DELIVERY.json']) {
    if (!paths.has(required)) throw new Error(`manifest is missing ${required}`)
  }
  return entries
}

async function collectPackageFiles(root, directory = root) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('delivery package contains a symbolic link')
    if (entry.isDirectory()) paths.push(...await collectPackageFiles(root, absolute))
    else if (entry.isFile()) paths.push(relative(root, absolute).split(sep).join('/'))
    else throw new Error('delivery package contains an unsupported filesystem entry')
  }
  return paths
}

async function inspectSealedInput(manifestPath) {
  if (manifestPath.split(sep).at(-1) !== 'MANIFEST.sha256') throw new Error('input manifest must be named MANIFEST.sha256')
  const packageRoot = dirname(manifestPath)
  const manifestBytes = await readFile(manifestPath)
  const manifestText = manifestBytes.toString('utf8')
  const entries = parseManifest(manifestText)
  const actualPaths = (await collectPackageFiles(packageRoot)).sort()
  const expectedPaths = [...entries.map((entry) => entry.path), 'MANIFEST.sha256'].sort()
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error('package files do not exactly match the scanned manifest')

  for (const entry of entries) {
    const absolute = resolve(packageRoot, entry.path)
    if (!inside(packageRoot, absolute)) throw new Error('manifest file escapes package root')
    if (sha256(await readFile(absolute)) !== entry.sha256) throw new Error(`package digest mismatch: ${entry.path}`)
  }

  const delivery = JSON.parse(await readFile(resolve(packageRoot, 'DELIVERY.json'), 'utf8'))
  if (!delivery || typeof delivery !== 'object' || delivery.schemaVersion !== 1) throw new Error('DELIVERY.json identity is invalid')
  if (delivery.product !== 'CanWin Team OS 4.0') throw new Error('DELIVERY.json product is invalid')
  if (!ARTIFACT_KINDS.has(delivery.artifactKind)) throw new Error('DELIVERY.json artifactKind is invalid')
  if (!VERSION.test(delivery.version) || !COMMIT.test(delivery.code_commit)) throw new Error('DELIVERY.json version or commit is invalid')
  if (!Number.isFinite(Date.parse(delivery.built_at))) throw new Error('DELIVERY.json build time is invalid')
  if (delivery.license_file !== 'LICENSE' || delivery.notice_file !== 'NOTICE') throw new Error('DELIVERY.json legal inventory is invalid')
  if (delivery.contains_exported_business_data !== false || delivery.contains_credentials !== false) {
    throw new Error('DELIVERY.json does not assert a clean artifact')
  }
  const versionText = (await readFile(resolve(packageRoot, 'VERSION'), 'utf8')).trim()
  if (versionText !== delivery.version) throw new Error('VERSION does not match DELIVERY.json')

  const payload = {
    schemaVersion: 1,
    product: 'CanWin Team OS 4.0',
    artifactKind: delivery.artifactKind,
    version: delivery.version,
    codeCommit: delivery.code_commit,
    manifestSha256: sha256(manifestBytes),
  }
  return { packageRoot, payload }
}

const { mode, values } = parseArguments(process.argv.slice(2))
const manifestPath = resolve(values.get('--manifest'))
const { packageRoot, payload } = await inspectSealedInput(manifestPath)

if (mode === 'sign') {
  const privateKeyPath = resolve(values.get('--private-key'))
  const outputPath = resolve(values.get('--output'))
  if (inside(packageRoot, privateKeyPath) || inside(repoRoot, privateKeyPath)) throw new Error('private key must be external to the package and repository')
  if (inside(packageRoot, outputPath)) throw new Error('signature evidence must remain outside the sealed package')
  try {
    await access(outputPath)
    throw new Error('signature evidence output already exists')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const privateKeyPem = await readFile(privateKeyPath, 'utf8')
  const publicKey = createPublicKey(privateKeyPem)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('only Ed25519 signing keys are allowed')
  const signature = sign(null, Buffer.from(canonical(payload)), privateKeyPem)
  const evidence = {
    ...payload,
    signatureAlgorithm: 'ed25519',
    signerPublicKeySha256: sha256(publicKey.export({ type: 'spki', format: 'der' })),
    signatureBase64: signature.toString('base64'),
  }
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: 'sealed', artifactKind: payload.artifactKind, version: payload.version, codeCommit: payload.codeCommit, manifestSha256: payload.manifestSha256 }))
} else {
  const signaturePath = resolve(values.get('--signature'))
  const publicKeyPath = resolve(values.get('--public-key'))
  const evidence = JSON.parse(await readFile(signaturePath, 'utf8'))
  const publicKeyPem = await readFile(publicKeyPath, 'utf8')
  const publicKey = createPublicKey(publicKeyPem)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('only Ed25519 verification keys are allowed')
  const expectedKeys = [...Object.keys(payload), 'signatureAlgorithm', 'signerPublicKeySha256', 'signatureBase64'].sort()
  if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(expectedKeys)) throw new Error('signature evidence fields are invalid')
  for (const [key, value] of Object.entries(payload)) if (evidence[key] !== value) throw new Error(`signature evidence ${key} mismatch`)
  if (evidence.signatureAlgorithm !== 'ed25519' || !HASH.test(evidence.signerPublicKeySha256)) throw new Error('signature evidence algorithm or key fingerprint is invalid')
  if (evidence.signerPublicKeySha256 !== sha256(publicKey.export({ type: 'spki', format: 'der' }))) throw new Error('verification key fingerprint mismatch')
  if (!/^[A-Za-z0-9+/]{86}==$/.test(evidence.signatureBase64)) throw new Error('signature is not canonical Ed25519 base64')
  const signature = Buffer.from(evidence.signatureBase64, 'base64')
  if (signature.byteLength !== 64 || !verify(null, Buffer.from(canonical(payload)), publicKey, signature)) throw new Error('delivery signature verification failed')
  console.log(JSON.stringify({ status: 'verified', artifactKind: payload.artifactKind, version: payload.version, codeCommit: payload.codeCommit, manifestSha256: payload.manifestSha256 }))
}
