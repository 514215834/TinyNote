import { describe, expect, it } from 'vitest'
import { base64ToBlob, base64ToBytes, blobToBase64, bytesToBase64 } from '@/lib/utils/base64'

describe('base64 互转（F-501 同步载荷）', () => {
  it('字节往返一致（含空数组与大数组）', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array([]))

    const bytes = new Uint8Array(0x8000 * 2 + 7) // 跨三个分块边界
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('二进制安全：非 UTF-8 字节序列往返不变', () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0xfe, 0x80, 0x01, 0xc3, 0x28])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('Blob 往返保留类型与字节', async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3, 250, 251])], { type: 'image/png' })
    const restored = base64ToBlob(await blobToBase64(blob), 'image/png')
    expect(restored.type).toBe('image/png')
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 250, 251]))
  })
})
