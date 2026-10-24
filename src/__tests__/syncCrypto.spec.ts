// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  PBKDF2_ITERATIONS,
  SyncDecryptError,
  decryptSyncPayload,
  encryptSyncPayload,
  isEncryptedEnvelope,
} from '@/features/sync/syncCrypto'

describe('同步载荷加密（F-503）', () => {
  const plaintext = JSON.stringify({ format: 'tinynote-sync', notes: ['笔记内容', '中文 🔐'] })

  it('加解密往返；信封结构合规且每次盐/IV 随机', async () => {
    const envelopeJson = await encryptSyncPayload('密码123', plaintext)
    const envelope = JSON.parse(envelopeJson)
    expect(isEncryptedEnvelope(envelope)).toBe(true)
    expect(envelope.iterations).toBe(PBKDF2_ITERATIONS)
    expect(envelope.kdf).toBe('PBKDF2-SHA256')
    // 明文不落在信封任何字段
    expect(envelopeJson).not.toContain('笔记内容')

    expect(await decryptSyncPayload('密码123', envelopeJson)).toBe(plaintext)

    const again = JSON.parse(await encryptSyncPayload('密码123', plaintext))
    expect(again.salt).not.toBe(envelope.salt)
    expect(again.ciphertext).not.toBe(envelope.ciphertext)
  })

  it('错误密码 → SyncDecryptError（友好提示）', async () => {
    const envelopeJson = await encryptSyncPayload('正确密码', plaintext)
    await expect(decryptSyncPayload('错误密码', envelopeJson)).rejects.toThrow(SyncDecryptError)
    await expect(decryptSyncPayload('错误密码', envelopeJson)).rejects.toThrow('解密失败')
  })

  it('密文被篡改 / 非信封结构 / 非 JSON → SyncDecryptError', async () => {
    const envelopeJson = await encryptSyncPayload('pw', plaintext)
    const tampered = JSON.parse(envelopeJson)
    tampered.ciphertext = tampered.ciphertext.slice(0, -4) + 'AAAA'
    await expect(decryptSyncPayload('pw', JSON.stringify(tampered))).rejects.toThrow(SyncDecryptError)
    await expect(decryptSyncPayload('pw', '{"format":"other"}')).rejects.toThrow(SyncDecryptError)
    await expect(decryptSyncPayload('pw', 'not-json')).rejects.toThrow(SyncDecryptError)
  })

  it('空密码加密被拒绝', async () => {
    await expect(encryptSyncPayload('', plaintext)).rejects.toThrow('未设置密码')
  })
})
