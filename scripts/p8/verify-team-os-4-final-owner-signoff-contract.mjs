import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p8/team-os-4-final-owner-signoff-contract.json'), 'utf8'))

const expectedIds = [
  'real-business-acceptance',
  'entry-cutover',
  'legacy-3-controlled-archive',
  'rollback-package',
  'clean-source-package',
  'migration-tool-package',
  'release-metadata-and-signatures',
  'handover-guide',
]
const allowedStatuses = new Set(['pending', 'accepted', 'rejected'])
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.product, 'CanWin Team OS 4.0')
assert.equal(contract.phase, 'P8-final-owner-signoff')
assert.equal(contract.signoffAuthority, 'client-owner')
assert.ok(Array.isArray(contract.signoffs))
assert.deepEqual(contract.signoffs.map((item) => item.id), expectedIds)

for (const item of contract.signoffs) {
  assert.equal(typeof item.title, 'string')
  assert.ok(item.title.trim().length > 0)
  assert.ok(Array.isArray(item.requiredEvidence) && item.requiredEvidence.length > 0)
  assert.ok(item.requiredEvidence.every((entry) => typeof entry === 'string' && entry.trim().length > 0))
  assert.ok(allowedStatuses.has(item.status))
  assert.equal(typeof item.accepted, 'boolean')
  assert.ok(Array.isArray(item.evidence))

  if (item.status === 'accepted') {
    assert.equal(item.accepted, true, `${item.id}: accepted status requires accepted=true`)
    assert.equal(item.evidence.length, item.requiredEvidence.length, `${item.id}: every requirement needs separate evidence`)
    const evidencedRequirements = item.evidence.map((entry) => {
      assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry))
      assert.deepEqual(Object.keys(entry).sort(), ['artifact', 'requirement'])
      assert.equal(typeof entry.requirement, 'string')
      assert.equal(typeof entry.artifact, 'string')
      assert.ok(entry.artifact.trim().length > 0)
      return entry.requirement
    })
    assert.deepEqual(evidencedRequirements, item.requiredEvidence, `${item.id}: evidence must cover every requirement in order`)
    assert.equal(typeof item.acceptedBy, 'string')
    assert.ok(item.acceptedBy.trim().length > 0)
    assert.equal(typeof item.acceptedAt, 'string')
    assert.ok(ISO_TIME.test(item.acceptedAt) && Number.isFinite(Date.parse(item.acceptedAt)))
  } else {
    assert.equal(item.accepted, false, `${item.id}: non-accepted status requires accepted=false`)
    assert.equal(item.acceptedBy, null)
    assert.equal(item.acceptedAt, null)
  }
}

const everyIndependentSignoffAccepted = contract.signoffs.every((item) => item.status === 'accepted' && item.accepted)
assert.equal(contract.allIndependentSignoffsAccepted, everyIndependentSignoffAccepted)
assert.equal(contract.ownerFinalAcceptance, everyIndependentSignoffAccepted)
assert.equal(contract.progress100, everyIndependentSignoffAccepted)
assert.equal(contract.status, everyIndependentSignoffAccepted ? 'accepted' : 'pending')

if (contract.signoffs.some((item) => item.status === 'pending')) {
  assert.equal(contract.progress100, false, 'any pending signoff keeps progress100=false')
}

console.log(`Team OS 4.0 final owner signoff contract is valid; independent=${contract.signoffs.filter((item) => item.accepted).length}/${contract.signoffs.length}; progress100=${contract.progress100}`)
