/**
 * 存储持久化（F-405）：local-first 的风险对策之一——浏览器在磁盘吃紧时可能
 * 清理「未持久化」站点的 IndexedDB（隐私模式尤甚）。启动时申请持久化可显著降低概率。
 * 全部 API 做特性检测，不支持的环境静默降级为 null（UI 隐藏对应信息）。
 */

export interface StorageSummary {
  usage: number
  quota: number
  persisted: boolean
}

/** 申请持久化存储；环境不支持时返回 null（不视为失败） */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null
  try {
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

/** 读取当前用量与持久化状态；环境不支持时返回 null */
export async function readStorageSummary(): Promise<StorageSummary | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ])
    if (estimate.usage === undefined || estimate.quota === undefined) return null
    return { usage: estimate.usage, quota: estimate.quota, persisted }
  } catch {
    return null
  }
}

/** 人类可读体积：B / KB / MB / GB，一位小数（1KB = 1024B） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit++
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(1)} ${units[unit]}`
}
