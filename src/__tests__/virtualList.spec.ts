import { describe, expect, it } from 'vitest'
import { ESTIMATED_ROW_HEIGHT, VIRTUALIZE_THRESHOLD, shouldVirtualize } from '@/features/notes/virtualList'

describe('列表虚拟化开关（F-604）', () => {
  it('阈值之下普通渲染，之上虚拟滚动（边界：恰好等于阈值仍不启用）', () => {
    expect(shouldVirtualize(0)).toBe(false)
    expect(shouldVirtualize(100)).toBe(false)
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD)).toBe(false)
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD + 1)).toBe(true)
  })

  it('阈值可注入便于测试', () => {
    expect(shouldVirtualize(50, 50)).toBe(false)
    expect(shouldVirtualize(51, 50)).toBe(true)
  })

  it('估算行高为正数', () => {
    expect(ESTIMATED_ROW_HEIGHT).toBeGreaterThan(0)
  })
})
