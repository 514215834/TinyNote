import { base64ToBytes, bytesToBase64 } from '@/lib/utils/base64'
import { SYNC_FORMAT_ENCRYPTED } from './sync'

/**
 * 同步载荷加密（F-503）：Web Crypto AES-GCM，密码经 PBKDF2-HMAC-SHA256 派生密钥。
 * 加密后 Gist 内只存不可读的信封 JSON；每次加密换随机盐与 IV，同密码不同轮次密文不同。
 */

export const PBKDF2_ITERATIONS = 600_000 // OWASP 2023 对 PBKDF2-HMAC-SHA256 的推荐量级

/** 加密信封：Gist 内 tinynote-sync.json 的内容形态 */
export interface EncryptedEnvelope {
  format: typeof SYNC_FORMAT_ENCRYPTED
  v: number
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export function isEncryptedEnvelope(raw: unknown): raw is EncryptedEnvelope {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as EncryptedEnvelope).format === SYNC_FORMAT_ENCRYPTED
  )
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error('当前环境不支持 Web Crypto，无法使用同步加密')
  return c.subtle
}

async function deriveKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const material = new TextEncoder().encode(password)
  const baseKey = await subtle().importKey('raw', material, 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

/** 明文 JSON → 信封 JSON 字符串 */
export async function encryptSyncPayload(password: string, plaintext: string): Promise<string> {
  if (password === '') throw new Error('已开启加密但未设置密码')
  const salt = new Uint8Array(16)
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(salt)
  globalThis.crypto.getRandomValues(iv)
  const key = await deriveKey(password, salt, ['encrypt'])
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  const envelope: EncryptedEnvelope = {
    format: SYNC_FORMAT_ENCRYPTED,
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(envelope)
}

/** 信封 JSON 字符串 → 明文 JSON 字符串；密码错误/数据损坏抛 SyncDecryptError */
export async function decryptSyncPayload(password: string, envelopeJson: string): Promise<string> {
  let envelope: unknown
  try {
    envelope = JSON.parse(envelopeJson)
  } catch {
    throw new SyncDecryptError('同步数据不是合法的加密信封')
  }
  if (!isEncryptedEnvelope(envelope)) throw new SyncDecryptError('同步数据不是合法的加密信封')
  if (envelope.kdf !== 'PBKDF2-SHA256' || typeof envelope.iterations !== 'number') {
    throw new SyncDecryptError('加密参数不受支持，请升级应用')
  }
  try {
    const key = await deriveKey(password, base64ToBytes(envelope.salt), ['decrypt'])
    const plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) as BufferSource },
      key,
      base64ToBytes(envelope.ciphertext) as BufferSource,
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new SyncDecryptError('解密失败：密码错误或同步数据已损坏')
  }
}

export class SyncDecryptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncDecryptError'
  }
}
