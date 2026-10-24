import { localeTag, t } from '@/lib/i18n'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 相对时间展示：列表用（F-601 随界面语言切换）；now 可注入，便于单测 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp
  if (diff < MINUTE) return t('time.justNow')
  if (diff < HOUR) return t('time.minutesAgo', { n: Math.floor(diff / MINUTE) })
  if (diff < DAY) return t('time.hoursAgo', { n: Math.floor(diff / HOUR) })
  if (diff < 2 * DAY) return t('time.yesterday')
  return new Date(timestamp).toLocaleDateString(localeTag())
}

/** 完整时间展示：统计栏（F-207）与回收站删除时间用 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(localeTag(), { hour12: false })
}
