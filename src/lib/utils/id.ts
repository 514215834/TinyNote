/**
 * 生成 UUID v7（ADR-003）：48 位毫秒时间戳前缀 + 随机位，
 * 主键近似按时间有序，利于索引排序与未来多端同步合并。
 * 形如 `0192e3f5-7a1b-8c2d-9e4f-a5b6c7d8e9f0`。
 */
export function createId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const view = new DataView(bytes.buffer)
  const now = Date.now()
  view.setUint16(0, Math.floor(now / 2 ** 32)) // 时间戳高 16 位（字节 0–1）
  view.setUint32(2, now % 2 ** 32) // 时间戳低 32 位（字节 2–5）
  bytes[6] = (bytes[6] & 0x0f) | 0x70 // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
