const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 相对时间展示：列表用；now 可注入，便于单测 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 2 * DAY) return '昨天'
  return new Date(timestamp).toLocaleDateString('zh-CN')
}
