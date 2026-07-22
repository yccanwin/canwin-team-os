import { randomBytes } from 'node:crypto'

export const ACCEPTANCE_IDENTITIES = Object.freeze([
  { key: 'sales', primaryRole: 'sales', capability: null },
  { key: 'implementation', primaryRole: 'implementation', capability: null },
  { key: 'operations', primaryRole: 'operations', capability: null },
  { key: 'finance', primaryRole: 'finance', capability: null },
  { key: 'admin_supervisor', primaryRole: 'admin', capability: 'supervisor' },
])

const makePassword = () => randomBytes(32).toString('base64url') + 'Aa1!'

export async function provisionAcceptanceAccounts({ adapter, emailFor, runAcceptance }) {
  const created = []
  try {
    for (const identity of ACCEPTANCE_IDENTITIES) {
      const password = makePassword()
      const email = emailFor(identity.key)
      const user = await adapter.createAuthUser({ email, password })
      created.push({ ...identity, id: user.id, email, password, profileCreated: false })
      await adapter.createProfile({
        userId: user.id,
        primaryRole: identity.primaryRole,
        capability: identity.capability,
      })
      created.at(-1).profileCreated = true
    }

    await runAcceptance(created.map((item) => ({
      key: item.key,
      id: item.id,
      email: item.email,
      password: item.password,
    })))
    return { status: 'sealed-not-deleted', created: created.length }
  } catch (error) {
    for (const item of [...created].reverse()) {
      if (item.profileCreated) await adapter.deleteProfile(item.id)
      await adapter.deleteAuthUser(item.id)
    }
    throw new Error('acceptance account provisioning failed; this batch was removed', { cause: error })
  } finally {
    for (const item of created) item.password = undefined
  }
}
