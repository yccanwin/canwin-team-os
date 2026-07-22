import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'project-ref-contract.json')

function decodeJwtPayload(value) {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('legacy key must be a three-part JWT')
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('legacy key payload is not valid JSON')
  }
}

function validateUrl(value, expectedRef) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('VITE_SUPABASE_URL is not a valid URL')
  }
  const expectedHost = `${expectedRef}.supabase.co`
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== expectedHost ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Supabase URL must be exactly https://${expectedHost}`)
  }
}

function validateKey(value, expectedRef, expectedKeySha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedKeySha256 ?? '')) {
    throw new Error('frontend key requires a registered SHA256 fingerprint')
  }
  const actualFingerprint = createHash('sha256').update(value).digest('hex')
  if (actualFingerprint !== expectedKeySha256) {
    throw new Error('frontend key fingerprint does not match the selected environment')
  }
  if (value.startsWith('sb_secret_')) throw new Error('secret key is forbidden in a frontend build')

  if (value.startsWith('sb_publishable_')) {
    return 'publishable'
  }

  const payload = decodeJwtPayload(value)
  if (payload.role !== 'anon') throw new Error('frontend legacy key role must be anon')
  if (payload.ref !== expectedRef) throw new Error('frontend legacy key ref does not match the selected environment')
  if (payload.iss !== 'supabase') throw new Error('frontend legacy key issuer must be supabase')
  return 'legacy-anon'
}

export function validateBuildTarget(input, contract) {
  const target = input.target
  if (target !== 'production' && target !== 'test-preview') {
    throw new Error('CANWIN_BUILD_TARGET must be production or test-preview')
  }

  const expectedRef = target === 'production'
    ? contract.productionProjectRef
    : contract.testProjectRef
  const expectedKey = target === 'production'
    ? contract.productionFrontendKey
    : contract.testFrontendKey
  if (!/^[a-z0-9]{20}$/.test(expectedRef ?? '')) {
    throw new Error(`no valid project ref is registered for ${target}`)
  }
  if (target === 'test-preview' && contract.previewBuildAllowed !== true) {
    throw new Error('test preview is blocked until isolated restore validation passes')
  }
  if (input.expectedRef !== expectedRef) {
    throw new Error('VITE_EXPECTED_SUPABASE_PROJECT_REF does not match the selected environment')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedKey?.sha256 ?? '')) {
    throw new Error('no frontend key fingerprint is registered for the selected environment')
  }
  if (!input.url) throw new Error('VITE_SUPABASE_URL is required')
  if (!input.key) throw new Error('VITE_SUPABASE_ANON_KEY is required')

  validateUrl(input.url, expectedRef)
  const keyType = validateKey(input.key, expectedRef, expectedKey.sha256)
  if (keyType !== expectedKey.type) {
    throw new Error('frontend key type does not match the versioned project contract')
  }
  return { target, expectedRef, keyType }
}

function validateArtifactTexts(texts, target, contract, enforcePreviewAllowed = true) {
  if (target !== 'production' && target !== 'test-preview') {
    throw new Error('CANWIN_BUILD_TARGET must be production or test-preview')
  }
  if (enforcePreviewAllowed && target === 'test-preview' && contract.previewBuildAllowed !== true) {
    throw new Error('test preview artifact is blocked until isolated restore validation passes')
  }
  const expectedRef = target === 'production'
    ? contract.productionProjectRef
    : contract.testProjectRef
  const forbiddenRef = target === 'production'
    ? contract.testProjectRef
    : contract.productionProjectRef
  const combined = texts.join('\n')
  if (!combined.includes(expectedRef)) throw new Error('artifact does not contain the selected project ref')
  if (combined.includes(forbiddenRef)) throw new Error('artifact contains the opposite environment project ref')
  const forbidden = [
    /sb_secret_[A-Za-z0-9_-]{8,}/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
  ]
  if (forbidden.some((pattern) => pattern.test(combined))) {
    throw new Error('artifact contains a forbidden server credential marker')
  }
  const jwtCandidates = combined.match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) ?? []
  for (const candidate of jwtCandidates) {
    try {
      const payload = decodeJwtPayload(candidate)
      if (payload.iss !== 'supabase') continue
      if (payload.role !== 'anon' || payload.ref !== expectedRef) {
        throw new Error('artifact contains a Supabase JWT for the wrong role or project')
      }
    } catch (error) {
      if (error.message === 'artifact contains a Supabase JWT for the wrong role or project') throw error
    }
  }
}

function scanArtifactDirectory(directory, target, contract, enforcePreviewAllowed = true) {
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error('artifact must not contain symbolic links')
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(directory)
  if (files.length === 0) throw new Error('artifact directory is empty')

  const sorted = files.sort((a, b) => a.localeCompare(b, 'en'))
  const texts = []
  const fileHashes = []
  for (const file of sorted) {
    const contents = readFileSync(file)
    texts.push(contents.toString('utf8'))
    fileHashes.push(
      relative(directory, file).replaceAll('\\', '/') + ':' +
        createHash('sha256').update(contents).digest('hex'),
    )
  }
  validateArtifactTexts(texts, target, contract, enforcePreviewAllowed)
  return {
    files: sorted.length,
    sha256: createHash('sha256').update(fileHashes.join('\n')).digest('hex'),
  }
}

function fakeLegacyKey(role, ref, issuer = 'supabase') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: issuer, ref, role })).toString('base64url')
  return `${header}.${payload}.signature`
}

function runSelfTest(contract) {
  const tests = [
    ['production legacy anon passes', true, {
      target: 'production',
      expectedRef: contract.productionProjectRef,
      url: `https://${contract.productionProjectRef}.supabase.co`,
      key: fakeLegacyKey('anon', contract.productionProjectRef),
    }, contract],
    ['enabled test preview legacy anon passes', true, {
      target: 'test-preview',
      expectedRef: contract.testProjectRef,
      url: `https://${contract.testProjectRef}.supabase.co`,
      key: fakeLegacyKey('anon', contract.testProjectRef),
    }, { ...contract, previewBuildAllowed: true }],
    ['disabled test preview fails', false, {
      target: 'test-preview',
      expectedRef: contract.testProjectRef,
      url: `https://${contract.testProjectRef}.supabase.co`,
      key: fakeLegacyKey('anon', contract.testProjectRef),
    }, contract],
    ['production URL with test key fails', false, {
      target: 'production',
      expectedRef: contract.productionProjectRef,
      url: `https://${contract.productionProjectRef}.supabase.co`,
      key: fakeLegacyKey('anon', contract.testProjectRef),
    }, contract],
    ['test URL with production key fails', false, {
      target: 'test-preview',
      expectedRef: contract.testProjectRef,
      url: `https://${contract.testProjectRef}.supabase.co`,
      key: fakeLegacyKey('anon', contract.productionProjectRef),
    }, { ...contract, previewBuildAllowed: true }],
    ['service role fails', false, {
      target: 'production',
      expectedRef: contract.productionProjectRef,
      url: `https://${contract.productionProjectRef}.supabase.co`,
      key: fakeLegacyKey('service_role', contract.productionProjectRef),
    }, contract],
    ['secret key fails', false, {
      target: 'production',
      expectedRef: contract.productionProjectRef,
      url: `https://${contract.productionProjectRef}.supabase.co`,
      key: 'sb_secret_forbidden-test-value',
    }, contract],
    ['unknown ref URL fails', false, {
      target: 'production',
      expectedRef: contract.productionProjectRef,
      url: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
      key: fakeLegacyKey('anon', contract.productionProjectRef),
    }, contract],
    ['missing target fails', false, {
      url: `https://${contract.productionProjectRef}.supabase.co`,
      expectedRef: contract.productionProjectRef,
      key: fakeLegacyKey('anon', contract.productionProjectRef),
    }, contract],
    ['publishable key with matching fingerprint passes', true, (() => {
      const key = 'sb_publishable_public-test-value'
      return {
        target: 'production',
        expectedRef: contract.productionProjectRef,
        url: `https://${contract.productionProjectRef}.supabase.co`,
        key,
      }
    })(), contract],
    ['frontend key not registered in versioned contract fails', false, {
      target: 'production',
      expectedRef: contract.productionProjectRef,
      url: `https://${contract.productionProjectRef}.supabase.co`,
      key: 'sb_publishable_public-test-value',
      preserveContract: true,
    }, contract],
  ]

  let passed = 0
  for (const [label, shouldPass, input, testContract] of tests) {
    let didPass = true
    try {
      const keyType = input.key?.startsWith('sb_publishable_') ? 'publishable' : 'legacy-anon'
      const keyField = input.target === 'test-preview' ? 'testFrontendKey' : 'productionFrontendKey'
      const candidateContract = input.key && !input.preserveContract
        ? { ...testContract, [keyField]: { type: keyType, sha256: createHash('sha256').update(input.key).digest('hex') } }
        : testContract
      validateBuildTarget(input, candidateContract)
    } catch {
      didPass = false
    }
    if (didPass === shouldPass) passed += 1
    else console.error('[p0:build-target] FAIL ' + label)
  }
  const artifactTests = [
    ['production artifact passes', true, [`url=${contract.productionProjectRef}`], 'production', contract, true],
    ['production artifact containing test ref fails', false, [
      `prod=${contract.productionProjectRef};test=${contract.testProjectRef}`,
    ], 'production', contract, true],
    ['enabled test artifact passes', true, [`url=${contract.testProjectRef}`], 'test-preview', {
      ...contract, previewBuildAllowed: true,
    }, true],
    ['disabled test artifact formal scan fails', false, [`url=${contract.testProjectRef}`], 'test-preview', contract, true],
    ['disabled test artifact compile-only scan passes', true, [`url=${contract.testProjectRef}`], 'test-preview', contract, false],
    ['test artifact containing production ref fails', false, [
      `test=${contract.testProjectRef};prod=${contract.productionProjectRef}`,
    ], 'test-preview', { ...contract, previewBuildAllowed: true }, true],
    ['artifact containing secret marker fails', false, [
      `url=${contract.productionProjectRef};key=sb_secret_forbidden-test-value`,
    ], 'production', contract, true],
    ['artifact containing service-role JWT fails', false, [
      `url=${contract.productionProjectRef};key=${fakeLegacyKey('service_role', contract.productionProjectRef)}`,
    ], 'production', contract, true],
    ['artifact missing expected ref fails', false, ['no project configured'], 'production', contract, true],
  ]
  for (const [label, shouldPass, texts, target, artifactContract, enforcePreviewAllowed] of artifactTests) {
    let didPass = true
    try {
      validateArtifactTexts(texts, target, artifactContract, enforcePreviewAllowed)
    } catch {
      didPass = false
    }
    tests.push([label, shouldPass])
    if (didPass === shouldPass) passed += 1
    else console.error('[p0:build-target] FAIL ' + label)
  }
  console.log(
    '[p0:build-target] selftest discovered=' + tests.length +
      ' run=' + tests.length + ' passed=' + passed +
      ' failed=' + (tests.length - passed) + ' skipped=0',
  )
  if (passed !== tests.length) process.exit(1)
}

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
if (process.argv.includes('--self-test')) {
  runSelfTest(contract)
} else if (process.argv.includes('--artifact') || process.argv.includes('--artifact-compile-only')) {
  try {
    const target = process.env.CANWIN_BUILD_TARGET?.trim()
    if (target !== 'production' && target !== 'test-preview') {
      throw new Error('CANWIN_BUILD_TARGET must be production or test-preview')
    }
    const formalArtifact = process.argv.includes('--artifact')
    const artifactFlag = formalArtifact ? '--artifact' : '--artifact-compile-only'
    const artifactArgIndex = process.argv.indexOf(artifactFlag) + 1
    const artifactPath = process.argv[artifactArgIndex]
    if (!artifactPath) throw new Error('--artifact requires a directory')
    if (formalArtifact) {
      validateBuildTarget({
        target,
        expectedRef: process.env.VITE_EXPECTED_SUPABASE_PROJECT_REF?.trim(),
        url: process.env.VITE_SUPABASE_URL?.trim(),
        key: process.env.VITE_SUPABASE_ANON_KEY?.trim(),
      }, contract)
    }
    const result = scanArtifactDirectory(resolve(repoRoot, artifactPath), target, contract, formalArtifact)
    console.log(
      '[p0:build-artifact] OK target=' + target +
        ' files=' + result.files + ' sha256=' + result.sha256,
    )
  } catch (error) {
    console.error('[p0:build-artifact] BLOCKED ' + error.message)
    process.exit(1)
  }
} else {
  try {
    const result = validateBuildTarget({
      target: process.env.CANWIN_BUILD_TARGET?.trim(),
      expectedRef: process.env.VITE_EXPECTED_SUPABASE_PROJECT_REF?.trim(),
      url: process.env.VITE_SUPABASE_URL?.trim(),
      key: process.env.VITE_SUPABASE_ANON_KEY?.trim(),
    }, contract)
    console.log(
      '[p0:build-target] OK target=' + result.target +
        ' project_ref=' + result.expectedRef + ' key_type=' + result.keyType,
    )
  } catch (error) {
    console.error('[p0:build-target] BLOCKED ' + error.message)
    process.exit(1)
  }
}
