import type { PrimaryRole } from '../../../../packages/team-os-4-domain/src/index'

export interface AuthenticatedWorkspace {
  readonly userId: string
  readonly companyId: string
  readonly companyName: string
  readonly displayName: string
  readonly primaryRole: PrimaryRole
}

export function workspacePath(role: PrimaryRole): string {
  return `/workspace/${role}`
}

export function canOpenWorkspace(user: AuthenticatedWorkspace, requestedRole: string): boolean {
  return user.primaryRole === requestedRole
}
