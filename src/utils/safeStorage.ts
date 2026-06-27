/**
 * 安全 localStorage 封装 — 所有 Zustand persist store 共用
 * 防止 localStorage 满、损坏、或权限问题导致整个应用崩溃
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const safeStorage: any = {
  getItem: (name: string) => {
    try {
      const value = localStorage.getItem(name)
      if (!value) return null
      // 验证是否为合法 JSON，防止损坏数据导致 Zustand JSON.parse 崩溃
      JSON.parse(value)
      return value
    } catch {
      // JSON 损坏或 localStorage 不可用 → 返回 null，Zustand 使用初始状态
      console.warn(`[safeStorage] ${name} 数据损坏，已重置为初始状态`)
      try { localStorage.removeItem(name) } catch { /* 清理失败也不影响 */ }
      return null
    }
  },

  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // 存储满或不可用 — 静默失败，不影响当前会话
      console.warn(`[safeStorage] 写入 ${name} 失败，数据仅在当前会话中保留`)
    }
  },

  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // 静默失败
    }
  },
}
