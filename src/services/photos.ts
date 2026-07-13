import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Photo } from '@/types'
import { resolveMediaUrl } from '@/services/storage'

type PhotoRow = {
  id: string
  title: string | null
  image_url: string
  album: string | null
  uploaded_by: string | null
  taken_at: string | null
  description: string | null
  created_at: string
}

type PhotoMeta = Pick<Photo, 'description' | 'location' | 'participants'>

const PHOTO_SELECT = 'id, title, image_url, album, uploaded_by, taken_at, description, created_at'

function parseYearMonth(dateStr: string): { year: number; month: number } {
  const [year, month] = dateStr.split('-').map(Number)
  return { year, month }
}

function parseMeta(description: string | null): Partial<PhotoMeta> {
  if (!description) return {}
  try {
    const parsed = JSON.parse(description) as Partial<PhotoMeta>
    return parsed && typeof parsed === 'object' ? parsed : { description }
  } catch {
    return { description }
  }
}

function rowToPhoto(row: PhotoRow): Photo {
  const date = (row.taken_at || row.created_at).slice(0, 10)
  const { year, month } = parseYearMonth(date)
  const meta = parseMeta(row.description)

  return {
    id: row.id,
    url: row.image_url,
    title: row.title || undefined,
    date,
    location: meta.location,
    description: meta.description,
    participants: meta.participants ?? [],
    uploadedBy: row.uploaded_by || '',
    uploadedAt: row.created_at,
    year,
    month,
  }
}

function photoToRow(photo: Omit<Photo, 'id' | 'uploadedAt' | 'year' | 'month'> | Partial<Photo>) {
  const meta = {
    description: photo.description,
    location: photo.location,
    participants: photo.participants ?? [],
  }

  return {
    title: photo.title,
    image_url: photo.url,
    taken_at: photo.date ? `${photo.date}T00:00:00` : undefined,
    description:
      photo.description !== undefined ||
      photo.location !== undefined ||
      photo.participants !== undefined
        ? JSON.stringify(meta)
        : undefined,
  }
}

export async function loadPhotos(): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select(PHOTO_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('taken_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToPhoto(row as PhotoRow))
}

export async function createPhotoRecord(
  photo: Omit<Photo, 'id' | 'uploadedAt' | 'year' | 'month'>
): Promise<Photo> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('photos')
    .insert({
      ...photoToRow({
        ...photo,
        url: (await resolveMediaUrl(photo.url, 'photos')) || photo.url,
      }),
      team_id: CANWIN_TEAM_ID,
      uploaded_by: userData.user.id,
    })
    .select(PHOTO_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToPhoto(data as PhotoRow)
}

export async function updatePhotoRecord(id: string, updates: Partial<Photo>): Promise<Photo> {
  const { data: existing, error: existingError } = await supabase
    .from('photos')
    .select('description')
    .eq('id', id)
    .single()
  if (existingError) throw new Error(existingError.message)

  const previous = parseMeta(existing.description)
  const storedUpdates = {
    ...updates,
    ...(updates.url !== undefined
      ? { url: (await resolveMediaUrl(updates.url, 'photos')) || updates.url }
      : {}),
  }
  const { data, error } = await supabase
    .from('photos')
    .update(photoToRow({ ...previous, ...storedUpdates }))
    .eq('id', id)
    .select(PHOTO_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToPhoto(data as PhotoRow)
}

export async function deletePhotoRecord(id: string): Promise<void> {
  const { error } = await supabase.from('photos').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
