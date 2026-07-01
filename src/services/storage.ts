import { CANWIN_TEAM_ID } from '@/config/team'
import { supabase } from '@/lib/supabase'

const MEDIA_BUCKET = 'canwin-media'

function isDataUrl(value?: string): value is string {
  return typeof value === 'string' && value.startsWith('data:')
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
  if (!value || !isDataUrl(value)) return value

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!userData.user) throw new Error('未登录，无法上传图片')

  const { blob, contentType, extension } = dataUrlToBlob(value)
  const path = `${CANWIN_TEAM_ID}/${folder}/${userData.user.id}/${crypto.randomUUID()}.${extension}`

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType, upsert: false })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)
  return data.publicUrl
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
