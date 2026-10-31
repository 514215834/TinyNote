/**
 * 剪藏编排（F-901，popup 与 clipper 页共用）：
 * 注入提取 → html→md（复用应用侧 F-802 内核）→ 抓取图片落 assets/ →
 * 重链 → zip 装配 → chrome.downloads 下载。
 *
 * 图片抓取分两路：data: 内嵌图本地解码；http(s) 经 background 抓取
 * （扩展页受页面 CORS 约束，background 在 host_permissions 下无此限制）。
 * 抓取失败的图片保留原外链——导入应用后作为远程图展示（与 F-801 未命中资源口径一致）。
 */

import { htmlToMarkdown } from '../../src/features/import/htmlToMarkdown'
import {
  buildClipZip,
  clipZipName,
  collectImageUrls,
  extByMime,
  relinkImages,
  sanitizeAssetName,
  type ClipImage,
  type ClipManifest,
  type ClipMode,
} from './clip'
import type { ExtractResponse } from './content/extract'

/** 下载目录中的产物文件名（orchestrator 返回给 UI 展示） */
export interface ClipOutcome {
  filename: string
  /** 正文 markdown 字符数（状态展示用） */
  chars: number
  images: number
}

export type ClipProgress =
  | { step: 'extract' }
  | { step: 'convert' }
  | { step: 'images'; done: number; total: number }
  | { step: 'package' }
  | { step: 'done'; outcome: ClipOutcome }

async function extractFromTab(tabId: number, mode: ClipMode): Promise<ExtractResponse> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/extract.js'] })
  const response = (await chrome.tabs.sendMessage(tabId, { type: 'tinynote-extract', mode })) as
    | ExtractResponse
    | undefined
  if (response === undefined) {
    return { ok: false, code: 'unknown', message: '页面无响应（受保护页或扩展页不可剪藏）' }
  }
  return response
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(url)
  if (match === null) return null
  const mime = match[1] ?? 'application/octet-stream'
  const payload = match[3] ?? ''
  try {
    return match[2] !== undefined
      ? { mime, bytes: base64ToBytes(payload) }
      : { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) }
  } catch {
    return null
  }
}

async function fetchViaBackground(url: string): Promise<{ ok: true; mime: string; bytes: Uint8Array } | { ok: false }> {
  const response = (await chrome.runtime.sendMessage({ type: 'tinynote-fetch-image', url })) as
    | { ok: true; mime: string; base64: string }
    | { ok: false; reason: string }
    | undefined
  if (response === undefined || response.ok !== true) return { ok: false }
  return { ok: true, mime: response.mime, bytes: base64ToBytes(response.base64) }
}

/** 单次剪藏全流程。进度经 onProgress 上报（UI 文案由扩展统一中文口径，见 CHANGELOG 范围外）。 */
export async function runClip(tabId: number, mode: ClipMode, onProgress: (progress: ClipProgress) => void): Promise<ClipOutcome> {
  onProgress({ step: 'extract' })
  const extracted = await extractFromTab(tabId, mode)
  if (extracted.ok !== true) {
    throw new Error(
      extracted.code === 'no-selection' ? '当前页面没有选中文本' : `提取失败：${extracted.message}`,
    )
  }

  onProgress({ step: 'convert' })
  let markdown = (await htmlToMarkdown(extracted.payload.html)).trim()
  if (markdown === '') {
    throw new Error('页面正文为空，未产生剪藏内容')
  }

  // 图片抓取落 assets/（并发抓取，失败保留外链）
  const urls = collectImageUrls(markdown)
  const resolveMap = new Map<string, string>()
  const images: ClipImage[] = []
  let done = 0
  await Promise.all(
    urls.map(async (url, index) => {
      const fetched: { ok: boolean; mime?: string; bytes?: Uint8Array } = url.startsWith('data:')
        ? toLocal(decodeDataUrl(url))
        : await fetchViaBackground(url)
      done += 1
      onProgress({ step: 'images', done, total: urls.length })
      if (fetched.ok !== true || fetched.mime === undefined || fetched.bytes === undefined) return
      const name = sanitizeAssetName(
        url.startsWith('data:') ? '' : new URL(url).pathname,
        extByMime(fetched.mime),
      )
      const path = `assets/${index + 1}-${name}`
      resolveMap.set(url, path)
      images.push({ path, name, mime: fetched.mime, bytes: fetched.bytes })
    }),
  )
  if (resolveMap.size > 0) {
    markdown = relinkImages(markdown, (url) => resolveMap.get(url) ?? null)
  }

  onProgress({ step: 'package' })
  const manifest: ClipManifest = {
    format: 'tinynote-clip',
    schemaVersion: 1,
    url: extracted.payload.url,
    siteName: extracted.payload.siteName,
    title: extracted.payload.title,
    mode,
    clippedAt: new Date().toISOString(),
  }
  const zip = buildClipZip(manifest, markdown, images)
  const filename = clipZipName()
  const blob = new Blob([zip as BlobPart], { type: 'application/zip' })
  const objectUrl = URL.createObjectURL(blob)
  try {
    await chrome.downloads.download({ url: objectUrl, filename, saveAs: false })
  } finally {
    // 下载启动后即可释放（Chrome 已接管句柄）；延时避免竞态
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  }
  const outcome: ClipOutcome = { filename, chars: markdown.length, images: images.length }
  onProgress({ step: 'done', outcome })
  return outcome
}

function toLocal(decoded: { mime: string; bytes: Uint8Array } | null): { ok: true; mime: string; bytes: Uint8Array } | { ok: false } {
  return decoded === null ? { ok: false } : { ok: true, mime: decoded.mime, bytes: decoded.bytes }
}
