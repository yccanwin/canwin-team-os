import assert from 'node:assert/strict'
import { canOpenWorkspace, workspacePath, type AuthenticatedWorkspace } from './access.ts'

const sales: AuthenticatedWorkspace = {
  userId: 'user-1',
  companyId: 'company-1',
  companyName: 'Greenfield',
  displayName: 'Sales User',
  primaryRole: 'sales',
}

assert.equal(workspacePath('sales'), '/workspace/sales')
assert.equal(canOpenWorkspace(sales, 'sales'), true)
assert.equal(canOpenWorkspace(sales, 'finance'), false)
assert.equal(canOpenWorkspace(sales, 'admin'), false)
assert.equal(canOpenWorkspace(sales, 'unknown'), false)

const admin = { ...sales, primaryRole: 'admin' as const }
assert.equal(canOpenWorkspace(admin, 'admin'), true)
assert.equal(canOpenWorkspace(admin, 'sales'), false)

console.log('TEAM_OS_4_ACCESS_OK assertions=7')
