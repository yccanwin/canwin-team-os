export function createSupabaseAcceptanceAdapter(client) {
  let contextPromise
  const context = () => contextPromise ??= (async () => {
    const { data: companies, error: companyError } = await client.from('companies').select('id')
    if (companyError) throw companyError
    if (companies.length !== 1) throw new Error('expected exactly one initialized company')
    const companyId = companies[0].id
    const { data: roles, error: roleError } = await client
      .from('primary_roles').select('id,role_key').eq('company_id', companyId)
    if (roleError) throw roleError
    const roleIds = Object.fromEntries(roles.map((role) => [role.role_key, role.id]))
    for (const key of ['sales', 'implementation', 'operations', 'finance', 'admin']) {
      if (!roleIds[key]) throw new Error(`missing primary role ${key}`)
    }
    const { data: capabilities, error: capabilityError } = await client
      .from('capabilities').select('id,capability_key').eq('company_id', companyId)
      .in('capability_key', ['warehouse', 'supervisor'])
    if (capabilityError) throw capabilityError
    const capabilityIds = Object.fromEntries(capabilities.map((item) => [item.capability_key, item.id]))
    if (!capabilityIds.warehouse || !capabilityIds.supervisor) throw new Error('missing acceptance capability')
    return { companyId, roleIds, capabilityIds }
  })()

  return {
    async preflightAcceptance({ projectRef }) {
      const { data, error } = await client.rpc('preflight_g1_acceptance_v1', {
        p_target_project_ref: projectRef,
      })
      if (error || data?.status !== 'ready') throw error ?? new Error('G1 database preflight is not ready')
      let page = 1
      const perPage = 1000
      while (true) {
        const result = await client.auth.admin.listUsers({ page, perPage })
        if (result.error) throw result.error
        const users = result.data?.users ?? []
        if (users.some((user) => user.app_metadata?.system === 'team-os-4-acceptance')) {
          throw new Error('an earlier G1 acceptance identity still exists')
        }
        if (users.length < perPage) break
        page += 1
      }
      return { status: 'ready' }
    },
    async createAuthUser({ email, password, runId, identityKey }) {
      const { data, error } = await client.auth.admin.createUser({
        email, password, email_confirm: true,
        app_metadata: {
          system: 'team-os-4-acceptance',
          run_id: runId,
          identity_key: identityKey,
          acceptance_state: 'provisioning',
        },
      })
      if (error) throw error
      if (!data.user?.id) throw new Error('createUser returned no id')
      return { id: data.user.id }
    },
    async createProfile({ userId, primaryRole, capability }) {
      const { companyId, roleIds, capabilityIds } = await context()
      const { data: profile, error } = await client.from('profiles').insert({
        id: userId, company_id: companyId, primary_role_id: roleIds[primaryRole],
        display_name: `G1 ACCEPTANCE ${primaryRole}`, is_active: true,
      }).select('id,is_active').single()
      if (error) throw error
      if (profile?.id !== userId || profile?.is_active !== true) {
        await client.from('profiles').delete().eq('id', userId)
        throw new Error('active profile verification failed')
      }
      if (capability !== null) {
        const { error: overlayError } = await client.from('profile_capabilities').insert({
          profile_id: userId, capability_id: capabilityIds[capability], company_id: companyId, granted_by: userId,
        })
        if (overlayError) {
          await client.from('profiles').delete().eq('id', userId)
          throw overlayError
        }
      }
      return { status: 'active' }
    },
    async createRunFixtures({ runId, projectRef, accounts }) {
      const byKey = Object.fromEntries(accounts.map((account) => [account.key, account.id]))
      const { data, error } = await client.rpc('create_g1_acceptance_run_v1', {
        p_run_id: runId,
        p_target_project_ref: projectRef,
        p_sales_profile_id: byKey.sales,
        p_implementation_profile_id: byKey.implementation,
        p_operations_profile_id: byKey.operations,
        p_finance_profile_id: byKey.finance,
        p_admin_profile_id: byKey.admin_supervisor,
      })
      if (error || data?.status !== 'prepared') throw error ?? new Error('G1 fixture creation did not prepare the run')
      return data
    },
    async cleanupRunDatabase({ runId }) {
      const { data, error } = await client.rpc('cleanup_g1_acceptance_run_v1', {
        p_run_id: runId,
      })
      if (error || !['confirmed-cleaned', 'not-found'].includes(data?.status)) {
        throw error ?? new Error('G1 database cleanup did not complete')
      }
      return data
    },
    async retainRun({ runId, projectRef, codeCommit, runtimeEvidence, accounts }) {
      for (const account of accounts) {
        const { error } = await client.auth.admin.updateUserById(account.id, {
          app_metadata: {
            system: 'team-os-4-acceptance',
            run_id: runId,
            identity_key: account.key,
            acceptance_state: 'retained',
          },
        })
        if (error) throw error
      }
      const { data, error } = await client.rpc('retain_g1_acceptance_run_v1', {
        p_run_id: runId,
        p_target_project_ref: projectRef,
        p_application_commit: codeCommit,
        p_runtime_evidence: runtimeEvidence,
        p_runtime_evidence_sha256: runtimeEvidence.evidence_sha256,
      })
      if (error || data?.status !== 'retained') throw error ?? new Error('G1 run retention did not complete')
      return { status: 'retained' }
    },
    async deleteAcceptanceProfile({ id, runId, identityKey }) {
      const auth = await client.auth.admin.getUserById(id)
      if (auth.error) throw auth.error
      const metadata = auth.data?.user?.app_metadata
      if (metadata?.system !== 'team-os-4-acceptance'
        || metadata?.run_id !== runId || metadata?.identity_key !== identityKey) {
        throw new Error('refusing to delete an identity outside the current acceptance run')
      }
      const existing = await client.from('profiles').select('id,display_name').eq('id', id).maybeSingle()
      if (existing.error) throw existing.error
      if (!existing.data) return { status: 'absent' }
      if (!String(existing.data.display_name).startsWith('G1 ACCEPTANCE ')) {
        throw new Error('refusing to delete a non-acceptance profile')
      }
      const capabilityResult = await client.from('profile_capabilities').delete().eq('profile_id', id)
      if (capabilityResult.error) throw capabilityResult.error
      const profileResult = await client.from('profiles').delete().eq('id', id).select('id')
      if (profileResult.error || profileResult.data?.length !== 1) {
        throw profileResult.error ?? new Error('acceptance profile delete was not confirmed')
      }
      return { status: 'deleted' }
    },
    async quarantineAccounts({ runId, accounts }) {
      const ids = accounts.map((account) => account.id)
      const profileResult = await client.from('profiles').update({ is_active: false }).in('id', ids).select('id')
      const profileDisabledIds = profileResult.error ? [] : (profileResult.data ?? []).map((item) => item.id)
      const authBannedIds = []
      for (const account of accounts) {
        const { error } = await client.auth.admin.updateUserById(account.id, {
          ban_duration: '876000h',
          app_metadata: {
            system: 'team-os-4-acceptance',
            run_id: runId,
            identity_key: account.key,
            acceptance_state: 'quarantined',
          },
        })
        if (!error) authBannedIds.push(account.id)
      }
      return {
        status: profileResult.error || authBannedIds.length !== accounts.length
          ? 'quarantine-incomplete'
          : 'quarantined',
        profileDisabledIds,
        authBannedIds,
      }
    },
    async deleteAuthUser(id) {
      const { error } = await client.auth.admin.deleteUser(id, false)
      if (error) throw error
    },
  }
}
