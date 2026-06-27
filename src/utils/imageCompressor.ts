/**
 * CanWin Team OS — 图片压缩工具
 *
 * 使用 Canvas 在前端压缩图片，返回 base64 字符串。
 * 压缩策略：等比缩放至最大边长 800px，然后逐步降低 JPEG quality 直到满足文件大小限制。
 */

/**
 * 压缩图片文件，返回 base64 字符串
 *
 * @param file      原始图片文件
 * @param maxSizeKB 目标最大文件大小（KB），默认 200KB
 * @returns base64 字符串
 */
export function compressImage(
  file: File,
  maxSizeKB: number = 200
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // 计算缩放后的尺寸（最大边长 800px）
        const MAX_SIDE = 800
        let { width, height } = img

        if (width > MAX_SIDE || height > MAX_SIDE) {
          if (width > height) {
            height = Math.round((height / width) * MAX_SIDE)
            width = MAX_SIDE
          } else {
            width = Math.round((width / height) * MAX_SIDE)
            height = MAX_SIDE
          }
        }

        // 创建 canvas 绘制
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas context unavailable'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)

        // 循环降低 quality 直至满足大小限制
        const maxBytes = maxSizeKB * 1024
        const compress = (quality: number): void => {
          const base64 = canvas.toDataURL('image/jpeg', quality)
          if (base64.length <= maxBytes || quality <= 0.3) {
            resolve(base64)
          } else {
            compress(Math.round((quality - 0.1) * 10) / 10)
          }
        }

        compress(0.8)
      }

      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }

    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

// ============================================================
// V2：相册/成就馆专用压缩（两步压缩策略）
// ============================================================

/**
 * 压缩图片文件（针对相册/成就馆场景），返回 base64 字符串
 *
 * 压缩策略：
 *   - 第一轮：最大边长 800px，质量 0.7，目标 ≤300KB
 *   - 如仍超 300KB → 第二轮更激进压缩（目标 150KB）
 *
 * @param file 原始图片文件
 * @returns base64 字符串
 */
export async function compressPhoto(file: File): Promise<string> {
  // 第一轮：最大边长 800px，质量 0.7，目标 ≤300KB
  let base64 = await compressImage(file, 300)

  // 如果仍超过 300KB，第二轮降低
  if (base64.length > 300 * 1024) {
    return await compressImage(file, 150) // 更激进压缩
  }

  return base64
}
