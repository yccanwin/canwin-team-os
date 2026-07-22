const PROJECT_REF = /^[a-z0-9]{20}$/

export function validateBootstrapInput(input, { requireCredentials = true } = {}) {
  if (!PROJECT_REF.test(input.targetProjectRef ?? '')) throw new Error('invalid target project ref')
  const expectedUrl = `https://${input.targetProjectRef}.supabase.co`
  if (input.supabaseUrl !== expectedUrl) throw new Error('Supabase URL does not match target project ref')
  if (!input.companyName?.trim()) throw new Error('company name is required')
  if (!/^[a-z][a-z0-9_-]{2,62}$/.test(input.companyStableKey ?? '')) throw new Error('company stable key is invalid')
  if (!input.adminEmail?.trim()) throw new Error('admin email is required')
  if (!input.adminDisplayName?.trim()) throw new Error('admin display name is required')
  if (!input.actorLabel?.trim()) throw new Error('actor label is required')
  if (!input.bootstrapVersion?.trim()) throw new Error('bootstrap version is required')
  if (requireCredentials && !input.adminTemporaryPassword) throw new Error('temporary administrator password is required')
}

export async function runBootstrap({ input, adapter, dryRun = false }) {
  validateBootstrapInput(input, { requireCredentials: !dryRun })
  if (dryRun) return { status: 'dry-run-valid', remoteCalls: 0 }

  let userId = null
  try {
    const created = await adapter.createAdminUser({
      email: input.adminEmail,
      password: input.adminTemporaryPassword,
    })
    userId = created.id
  } catch (error) {
    throw new Error('Auth administrator creation failed; stopped before database bootstrap', { cause: error })
  }

  try {
    return await adapter.bootstrapDatabase({
      p_company_name: input.companyName,
      p_company_stable_key: input.companyStableKey,
      p_admin_user_id: userId,
      p_admin_email: input.adminEmail,
      p_admin_display_name: input.adminDisplayName,
      p_target_project_ref: input.targetProjectRef,
      p_access_url: input.supabaseUrl,
      p_actor_label: input.actorLabel,
      p_bootstrap_version: input.bootstrapVersion,
    })
  } catch (databaseError) {
    try {
      await adapter.deleteAdminUser(userId)
    } catch (cleanupError) {
      throw new AggregateError(
        [databaseError, cleanupError],
        'Database bootstrap failed and Auth compensation deletion also failed; stopped without retry',
      )
    }
    throw new Error('Database bootstrap failed; the newly created Auth user was deleted; stopped without retry', {
      cause: databaseError,
    })
  }
}
