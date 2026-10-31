/**
 * 剪藏包解析（F-902 应用侧）：识别并解析剪藏扩展的产物 zip
 * （manifest.json + note.md + assets/，格式契约见 extension/src/clip.ts——
 * 两侧共用同一模块，格式变更天然同步）。
 *
 * 嗅探按内容判定（manifest.format === 'tinynote-clip'），任何解析失败一律
 * 返回 null 交回常规导入管线——坏包不进剪藏弹窗，行为可预期。
 */

import { strFromU8, unzipSync, type Unzipped } from 'fflate'
import { parseClipManifest, type ClipManifest } from '../../../extension/src/clip'
import { mimeByName } from '../import/importService'

export type { ClipManifest }

/** zip 内单个资源条目（path 供三键重链匹配，name 为落库附件名） */
export interface ClipAssetEntry {
  path: string
  name: string
  mime: string
  bytes: Uint8Array
}

/** 一个完整可导入的剪藏包 */
export interface ClipPackage {
  manifest: ClipManifest
  markdown: string
  assets: ClipAssetEntry[]
  /** 产物内容指纹（zip 字节 SHA-256，F-903 防重用） */
  fingerprint: string
}

/** 产物内容指纹（F-903）：zip 全字节 SHA-256 hex。fflate zipSync 确定性输出，同一产物字节恒定 */
export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 嗅探并解析剪藏包：非 zip / 非 tinynote-clip 产物 / 结构缺失 → null。
 * 通过嗅探即返回完整包（避免二次解压）。
 */
export async function sniffClipZip(file: File): Promise<ClipPackage | null> {
  if (!/\.zip$/i.test(file.name)) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  let entries: Unzipped
  try {
    entries = unzipSync(bytes)
  } catch {
    return null
  }
  const rawManifest = entries['manifest.json']
  if (rawManifest === undefined) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(rawManifest))
  } catch {
    return null
  }
  const manifest = parseClipManifest(parsed)
  if (manifest === null) return null
  const rawMarkdown = entries['note.md']
  if (rawMarkdown === undefined) return null

  const assets: ClipAssetEntry[] = []
  for (const path of Object.keys(entries)) {
    if (path.endsWith('/') || path === 'manifest.json' || path === 'note.md') continue
    assets.push({
      path,
      name: path.split('/').pop() ?? path,
      mime: mimeByName(path) ?? 'application/octet-stream',
      bytes: entries[path]!,
    })
  }
  return { manifest, markdown: strFromU8(rawMarkdown), assets, fingerprint: await fingerprintBytes(bytes) }
}
