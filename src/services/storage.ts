import { CANWIN_TEAM_ID } from '@/config/team'
import { supabase } from '@/lib/supabase'

const MEDIA_BUCKET = 'canwin-media'
const MEDIA_REFERENCE_PREFIX = `${MEDIA_BUCKET}:`

function isDataUrl(value?: string): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

function managedMediaPath(value?: string): string | undefined {
  if (!value) return undefined
  if (value.startsWith(MEDIA_REFERENCE_PREFIX)) {
    return value.slice(MEDIA_REFERENCE_PREFIX.length)
  }

  try {
    const url = new URL(value)
    const markers = [
      `/storage/v1/object/public/${MEDIA_BUCKET}/`,
      `/storage/v1/object/sign/${MEDIA_BUCKET}/`,
    ]
    const marker = markers.find((candidate) => url.pathname.includes(candidate))
    if (!marker) return undefined
    return decodeURIComponent(url.pathname.split(marker)[1] || '') || undefined
  } catch {
    return undefined
  }
}

function mediaReference(path: string): string {
  return `${MEDIA_REFERENCE_PREFIX}${path}`
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string; extension: string } {
  const [header, payload] = dataUrl.split(',')
  const contentType = header.match(/^data:(.*?);base64$/)?.[1] || 'application/octet-stream'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  const extension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'
  return {
    blob: new Blob([bytes], { type: contentType }),
    contentType,
    extension,
  }
}

export async function resolveMediaUrl(value: string | undefined, folder: string): Promise<string | undefined> {
  if (!value) return value
  const existingPath = managedMediaPath(value)
  if (existingPath) return mediaReference(existingPath)
  if (!isDataUrl(value)) return value

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!userData.user) throw new Error('鏈櫥褰曪紝鏃犳硶涓婁紶鍥剧墖')

  const { blob, contentType, extension } = dataUrlToBlob(value)
  const path = `${CANWIN_TEAM_ID}/${folder}/${userData.user.id}/${crypto.randomUUID()}.${extension}`

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType, upsert: false })

  if (error) throw new Error(error.message)

  return mediaReference(path)
}

export async function resolveStoredMediaUrl(value: string | undefined): Promise<string | undefined> {
  const path = managedMediaPath(value)
  if (!path) return value
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600)
  if (error) {
    console.warn('[storage] Failed to create a signed media URL; using the stored reference.', {
      path,
      message: error.message,
    })
    return value
  }
  return data.signedUrl
}

export async function removeManagedMedia(value: string | undefined): Promise<void> {
  const path = managedMediaPath(value)
  if (!path) return

  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path])
  if (error) throw new Error(error.message)
}

export async function resolveStoredMediaUrls(values: string[] | undefined): Promise<string[] | undefined> {
  if (!values) return values
  return Promise.all(values.map((value) => resolveStoredMediaUrl(value).then((url) => url || value)))
}

export async function resolveMediaUrls(values: string[] | undefined, folder: string): Promise<string[] | undefined> {
  if (!values) return values
  return Promise.all(values.map((value) => resolveMediaUrl(value, folder).then((url) => url || value)))
}

export type StorageAttachment = {
  name: string
  url: string
  size: number
  type: string
}

export async function resolveStorageAttachments<T extends StorageAttachment>(
  attachments: T[] | undefined,
  folder: string
): Promise<T[] | undefined> {
  if (!attachments) return attachments
  return Promise.all(
    attachments.map(async (attachment) => ({
      ...attachment,
      url: (await resolveMediaUrl(attachment.url, folder)) || attachment.url,
    }))
  )
}

export async function resolveStoredAttachments<T extends StorageAttachment>(
  attachments: T[] | undefined
): Promise<T[] | undefined> {
  if (!attachments) return attachments
  return Promise.all(
    attachments.map(async (attachment) => ({
      ...attachment,
      url: (await resolveStoredMediaUrl(attachment.url)) || attachment.url,
    }))
  )
}

