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
    const { data: supervisor, error: capabilityError } = await client
      .from('capabilities').select('id').eq('company_id', companyId)
      .eq('capability_key', 'supervisor').single()
    if (capabilityError) throw capabilityError
    return { companyId, roleIds, supervisorId: supervisor.id }
  })()

  return {
    async createAuthUser({ email, password }) {
      const { data, error } = await client.auth.admin.createUser({
        email, password, email_confirm: true, app_metadata: { system: 'team-os-4-acceptance' },
      })
      if (error) throw error
      if (!data.user?.id) throw new Error('createUser returned no id')
      return { id: data.user.id }
    },
    async createProfile({ userId, primaryRole, capability }) {
      const { companyId, roleIds, supervisorId } = await context()
      const { data: profile, error } = await client.from('profiles').insert({
        id: userId, company_id: companyId, primary_role_id: roleIds[primaryRole],
        display_name: `G1 ${primaryRole}`, is_active: true,
      }).select('id,is_active').single()
      if (error) throw error
      if (profile?.id !== userId || profile?.is_active !== true) {
        await client.from('profiles').delete().eq('id', userId)
        throw new Error('active profile verification failed')
      }
      if (capability === 'supervisor') {
        const { error: overlayError } = await client.from('profile_capabilities').insert({
          profile_id: userId, capability_id: supervisorId, company_id: companyId, granted_by: userId,
        })
        if (overlayError) {
          await client.from('profiles').delete().eq('id', userId)
          throw overlayError
        }
      }
      return { status: 'active' }
    },
    async deleteProfile(id) {
      await client.from('profile_capabilities').delete().eq('profile_id', id)
      const { error } = await client.from('profiles').delete().eq('id', id)
      if (error) throw error
    },
    async deleteAuthUser(id) {
      const { error } = await client.auth.admin.deleteUser(id, false)
      if (error) throw error
    },
  }
}
