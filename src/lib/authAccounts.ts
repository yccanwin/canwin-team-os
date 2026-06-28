import type { User } from '@/types'
import { mockUsers } from '@/data/mockData'
import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'

const AUTH_TABLE_NAME = 'canwin-auth-users'
const DEFAULT_PASSWORD = 'canwin2026'

export type AuthAccount = {
  userId: string
  username: string
  passwordHash: string
  salt: string
  createdAt: string
  updatedAt?: string
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256(`${salt}:${password}`)
}

function createSalt(userId: string): string {
  return `canwin:${userId}`
}

async function createDefaultAccounts(): Promise<AuthAccount[]> {
  return Promise.all(
    mockUsers.map(async (user) => {
      const salt = createSalt(user.id)
      return {
        userId: user.id,
        username: user.name,
        salt,
        passwordHash: await hashPassword(DEFAULT_PASSWORD, salt),
        createdAt: new Date().toISOString(),
      }
    })
  )
}

async function saveAccounts(accounts: AuthAccount[]): Promise<void> {
  const { error } = await supabase.from('team_data').upsert(
    {
      team_id: CANWIN_TEAM_ID,
      table_name: AUTH_TABLE_NAME,
      data: { accounts },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'team_id, table_name' }
  )

  if (error) throw new Error(error.message)
}

export async function loadAuthAccounts(): Promise<AuthAccount[]> {
  const { data, error } = await supabase
    .from('team_data')
    .select('data')
    .eq('team_id', CANWIN_TEAM_ID)
    .eq('table_name', AUTH_TABLE_NAME)
    .maybeSingle()

  if (error) throw new Error(error.message)

  const accounts = (data?.data as { accounts?: AuthAccount[] } | null)?.accounts
  if (accounts && accounts.length > 0) return accounts

  const defaultAccounts = await createDefaultAccounts()
  await saveAccounts(defaultAccounts)
  return defaultAccounts
}

export async function verifyLogin(
  username: string,
  password: string,
  users: User[]
): Promise<User | null> {
  const accounts = await loadAuthAccounts()
  const normalizedUsername = username.trim()
  const account = accounts.find((item) => item.username === normalizedUsername)
  if (!account) return null

  const passwordHash = await hashPassword(password, account.salt)
  if (passwordHash !== account.passwordHash) return null

  return users.find((user) => user.id === account.userId) ?? null
}

export const DEFAULT_LOGIN_PASSWORD = DEFAULT_PASSWORD
