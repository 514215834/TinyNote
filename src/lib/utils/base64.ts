/**
 * Base64 与二进制互转（F-501 同步载荷需要把附件 Blob 编为文本存入 Gist）。
 * 分块转换避免大文件时 String.fromCharCode 展开参数栈溢出。
 */

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

export function base64ToBlob(base64: string, mime: string): Blob {
  return new Blob([base64ToBytes(base64)], { type: mime })
}
