import { describe, expect, it } from 'vitest'
import { formatBytes, readStorageSummary, requestPersistentStorage } from '@/features/pwa/storage'

describe('formatBytes（F-405 存储用量展示）', () => {
  it('按 B / KB / MB / GB 进位并保留一位小数（1024 进制）', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB')
  })
})

describe('存储 API 降级（F-405：不支持的环境静默返回 null）', () => {
  it('happy-dom 未实现 storage API 时，读取与申请都不抛错', async () => {
    // happy-dom 的 navigator.storage 可能未实现或部分实现，这里只验证不抛错且类型收敛
    const summary = await readStorageSummary()
    if (summary !== null) {
      expect(typeof summary.usage).toBe('number')
      expect(typeof summary.quota).toBe('number')
      expect(typeof summary.persisted).toBe('boolean')
    }
    const persisted = await requestPersistentStorage()
    expect(persisted === null || typeof persisted === 'boolean').toBe(true)
  })
})
