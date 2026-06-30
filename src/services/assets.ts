import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Asset } from '@/types'

type AssetRow = {
  id: string
  name: string
  category: Asset['category'] | null
  description: string | null
  purchase_date: string | null
  amount: number | null
  status: Asset['currentStatus']
  image_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type AssetMeta = Pick<Asset, 'description' | 'images' | 'location'>

const ASSET_SELECT =
  'id, name, category, description, purchase_date, amount, status, image_url, created_by, created_at, updated_at'

function parseMeta(description: string | null): Partial<AssetMeta> {
  if (!description) return {}
  try {
    const parsed = JSON.parse(description) as Partial<AssetMeta>
    return parsed && typeof parsed === 'object' ? parsed : { description }
  } catch {
    return { description }
  }
}

function rowToAsset(row: AssetRow): Asset {
  const meta = parseMeta(row.description)
  const images = meta.images ?? (row.image_url ? [row.image_url] : [])

  return {
    id: row.id,
    name: row.name,
    category: row.category ?? 'other',
    purchaseDate: row.purchase_date || '',
    amount: Number(row.amount ?? 0),
    currentStatus: row.status,
    description: meta.description,
    images,
    location: meta.location,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assetToRow(asset: Omit<Asset, 'id' | 'createdAt'> | Partial<Asset>) {
  const meta = {
    description: asset.description,
    images: asset.images ?? [],
    location: asset.location,
  }

  return {
    name: asset.name,
    category: asset.category,
    purchase_date: asset.purchaseDate,
    amount: asset.amount,
    status: asset.currentStatus,
    image_url: asset.images?.[0],
    description:
      asset.description !== undefined ||
      asset.images !== undefined ||
      asset.location !== undefined
        ? JSON.stringify(meta)
        : undefined,
  }
}

export async function loadAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select(ASSET_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('purchase_date', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToAsset(row as AssetRow))
}

export async function createAssetRecord(asset: Omit<Asset, 'id' | 'createdAt'>): Promise<Asset> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('assets')
    .insert({
      ...assetToRow(asset),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select(ASSET_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToAsset(data as AssetRow)
}

export async function updateAssetRecord(id: string, updates: Partial<Asset>): Promise<Asset> {
  const { data: existing, error: existingError } = await supabase
    .from('assets')
    .select('description')
    .eq('id', id)
    .single()
  if (existingError) throw new Error(existingError.message)

  const previous = parseMeta(existing.description)
  const { data, error } = await supabase
    .from('assets')
    .update(assetToRow({ ...previous, ...updates }))
    .eq('id', id)
    .select(ASSET_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToAsset(data as AssetRow)
}

export async function deleteAssetRecord(id: string): Promise<void> {
  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
