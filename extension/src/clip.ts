/**
 * 剪藏产物装配（F-901）：纯函数，不触碰浏览器 API——
 * 产物 = `tinynote-clip-<时间戳>.zip`（manifest.json + note.md + assets/），
 * 应用侧（F-902）按 manifest 的 format 字段识别后走剪藏导入管线。
 *
 * 本模块被扩展与应用两侧复用：扩展装配产物、应用侧 E2E 生成 fixture——
 * 文件通道（zip）是扩展与应用之间唯一的契约，格式变更必须两侧同步。
 */

import { strToU8, zipSync } from 'fflate'

/** 产物格式标识（manifest.format），应用侧据此把 zip 路由进剪藏导入 */
export const CLIP_FORMAT = 'tinynote-clip'

/** 产物格式版本：结构破坏性变更时递增，应用侧拒绝更高版本 */
export const CLIP_SCHEMA_VERSION = 1

/** 剪藏模式：整页 / 正文（Readability 提取）/ 选区 */
export type ClipMode = 'full' | 'article' | 'selection'

export interface ClipManifest {
  format: typeof CLIP_FORMAT
  schemaVersion: typeof CLIP_SCHEMA_VERSION
  /** 来源页 URL（剪藏时的页面地址） */
  url: string
  /** 站点名（og:site_name 或主机名），可为空串 */
  siteName: string
  /** 剪藏标题（扩展提取，应用侧导入弹窗可修正） */
  title: string
  mode: ClipMode
  /** 剪藏时间（ISO 8601） */
  clippedAt: string
}

export interface ClipImage {
  /** zip 内相对路径（assets/<name>），markdown 引用已重链为该路径 */
  path: string
  name: string
  mime: string
  bytes: Uint8Array
}

/** manifest.json 合法性校验（应用侧 sniff 与扩展自检共用）：非法返回 null */
export function parseClipManifest(input: unknown): ClipManifest | null {
  if (typeof input !== 'object' || input === null) return null
  const candidate = input as Record<string, unknown>
  if (candidate.format !== CLIP_FORMAT) return null
  if (candidate.schemaVersion !== CLIP_SCHEMA_VERSION) return null
  if (typeof candidate.url !== 'string') return null
  if (typeof candidate.siteName !== 'string') return null
  if (typeof candidate.title !== 'string') return null
  if (candidate.mode !== 'full' && candidate.mode !== 'article' && candidate.mode !== 'selection') return null
  if (typeof candidate.clippedAt !== 'string') return null
  return {
    format: CLIP_FORMAT,
    schemaVersion: CLIP_SCHEMA_VERSION,
    url: candidate.url,
    siteName: candidate.siteName,
    title: candidate.title,
    mode: candidate.mode,
    clippedAt: candidate.clippedAt,
  }
}

/** 产物文件名：tinynote-clip-20261031-1530.zip（本地时间，无冒号——Windows 下载目录友好） */
export function clipZipName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `tinynote-clip-${stamp}.zip`
}

const ASSET_NAME_UNSAFE = /[^\w.\-]+/g

/** 资源文件名净化：URL basename / data URL 无文件名 → 扩展名 + 序号由调用方提供 */
export function sanitizeAssetName(raw: string, fallbackExt: string): string {
  const base = raw.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(ASSET_NAME_UNSAFE, '_').replace(/^_+|_+$/g, '').slice(-64)
  const ext = dot > 0 && /\.[a-z0-9]{1,8}$/i.test(base.slice(dot)) ? base.slice(dot + 1) : fallbackExt
  return `${stem !== '' ? stem : 'image'}.${ext}`
}

/** mime → 扩展名（采集图片命名用；未识别回落 bin） */
export function extByMime(mime: string): string {
  const sub = mime.split('/')[1]?.split(';')[0]?.toLowerCase() ?? ''
  const mapped: Record<string, string> = {
    jpeg: 'jpg',
    svg: 'svg',
    'svg+xml': 'svg',
    avif: 'avif',
  }
  if (sub === '') return 'bin'
  return mapped[sub] ?? (sub.replace(/[^a-z0-9]/gi, '') || 'bin')
}

/**
 * 收集 markdown 中的远程图片引用（http(s) 绝对地址与 data: 内嵌图），
 * 供装配阶段抓取字节落 assets/ 后重链。其余（相对路径等）不参与。
 */
export function collectImageUrls(markdown: string): string[] {
  const urls: string[] = []
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^()\s]+)\)/g)) {
    const href = match[1] ?? ''
    if (/^https?:\/\//i.test(href) || /^data:image\//i.test(href)) urls.push(href)
  }
  return [...new Set(urls)]
}

/** 重链 markdown 图片引用：resolve 返回资源路径（命中）或 null（保留原文，如抓取失败） */
export function relinkImages(markdown: string, resolve: (url: string) => string | null): string {
  if (!markdown.includes('](')) return markdown
  return markdown.replace(/(!\[[^\]]*\]\()([^()\s]+)(\))/g, (full, head: string, href: string, tail: string) => {
    const replacement = resolve(href)
    if (replacement === null) return full
    return `${head}${replacement}${tail}`
  })
}

/** 装配产物 zip：manifest.json + note.md + assets/（images 为抓取完成的字节） */
export function buildClipZip(manifest: ClipManifest, markdown: string, images: ClipImage[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'note.md': strToU8(markdown),
  }
  for (const image of images) {
    files[image.path.replace(/^assets\//, 'assets/')] = image.bytes
  }
  return zipSync(files)
}
