import { describe, expect, it } from 'vitest'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/time'

const NOW = 1_700_000_000_000

describe('formatRelativeTime（F-104）', () => {
  it('1 分钟内显示「刚刚」', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('刚刚')
  })

  it('1 小时内显示分钟', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前')
  })

  it('1 天内显示小时', () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前')
  })

  it('1–2 天之间显示「昨天」', () => {
    expect(formatRelativeTime(NOW - 30 * 3_600_000, NOW)).toBe('昨天')
  })

  it('更早显示具体日期', () => {
    expect(formatRelativeTime(NOW - 5 * 86_400_000, NOW)).toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/)
  })
})

// formatDateTime（F-207）：输出依赖宿主时区与 ICU，只做年份与 24 小时制的宽松断言
describe('formatDateTime', () => {
  it('包含年份且采用 24 小时制（不出现上/下午标记）', () => {
    const text = formatDateTime(NOW)
    expect(text).toContain('2023')
    expect(text).not.toMatch(/(上午|下午|AM|PM)/i)
  })
})
