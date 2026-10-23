// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createId } from '@/lib/utils/id'

describe('createId（UUID v7，ADR-003）', () => {
  it('符合 UUID 8-4-4-4-12 格式', () => {
    expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('version 位为 7，variant 位为 10xx', () => {
    const id = createId()
    expect(id[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })

  it('时间前缀有序：相隔至少 1ms 生成的 id 字典序更大', async () => {
    // 同一毫秒内的两次生成不保证字典序（无单调计数器），应用内排序走 updatedAt，不依赖 id
    const a = createId()
    await new Promise((resolve) => setTimeout(resolve, 2))
    const b = createId()
    expect(b > a).toBe(true)
  })

  it('不重复', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId()))
    expect(ids.size).toBe(1000)
  })
})
