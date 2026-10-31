/**
 * 剪藏提取（F-901，content script，经 chrome.scripting.executeScript 注入）：
 * 收到 popup/clipper 页的 `tinynote-extract` 消息后，按模式提取页面并同步应答——
 * - full：整个文档（净化 script/style 等非正文元素）
 * - article：@mozilla/readability 正文提取（失败回落整页）
 * - selection：当前选区（无选区报错 no-selection）
 *
 * 产物为**净化并绝对化后的 HTML 片段**：img/a 的相对地址改写为绝对地址、
 * srcset 移除（turndown 只认 src）、script/style/iframe 等剥除——
 * html→md 转换在扩展页侧复用应用内核 htmlToMarkdown（F-802）完成。
 *
 * 重复注入防御：executeScript 每次剪藏都会注入本文件，监听器只注册一次。
 */

import { Readability } from '@mozilla/readability'
import type { ClipMode } from '../clip'

/** 提取结果（扩展页侧继续转换为 Markdown） */
export interface ExtractPayload {
  title: string
  siteName: string
  url: string
  html: string
}

/** 可预置的错误码（popup 侧映射为文案） */
export type ExtractErrorCode = 'no-selection' | 'empty-extract'

export interface ExtractOk {
  ok: true
  payload: ExtractPayload
}
export interface ExtractErr {
  ok: false
  code: ExtractErrorCode | 'unknown'
  message: string
}
export type ExtractResponse = ExtractOk | ExtractErr

/** 剪藏无关元素：turndown 会把其文本内容当正文带出，先剥除 */
const STRIP_SELECTOR = 'script, style, noscript, iframe, template, link, meta, button, input, select, textarea, video, audio, svg'

/** 元数据标题：og:title 优先，回落 <title> */
function pageTitle(doc: Document): string {
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content.trim() ?? ''
  if (og !== '') return og
  return (doc.title ?? '').trim()
}

function siteNameOf(doc: Document): string {
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content.trim() ?? ''
  if (og !== '') return og
  return location.hostname
}

/** 片段净化 + 地址绝对化（克隆到 detached 文档处理，不动原页 DOM） */
function absolutizeFragment(html: string, base: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const element of [...doc.body.querySelectorAll(STRIP_SELECTOR)]) element.remove()
  for (const img of [...doc.body.querySelectorAll('img')]) {
    img.removeAttribute('srcset')
    img.removeAttribute('loading')
    const src = img.getAttribute('src')
    if (src === null || src === '') {
      img.remove()
      continue
    }
    try {
      img.setAttribute('src', new URL(src, base).href)
    } catch {
      img.remove()
    }
  }
  for (const anchor of [...doc.body.querySelectorAll('a[href]')]) {
    const href = anchor.getAttribute('href') ?? ''
    try {
      anchor.setAttribute('href', new URL(href, base).href)
    } catch {
      /* 非法地址保留原文 */
    }
  }
  return doc.body.innerHTML
}

/** 整页提取 */
function extractFull(base: string): ExtractPayload {
  return {
    title: pageTitle(document),
    siteName: siteNameOf(document),
    url: base,
    html: absolutizeFragment(document.body.innerHTML, base),
  }
}

/** 正文提取（Readability；失败回落整页） */
function extractArticle(base: string): ExtractPayload {
  // Readability 会改写传入的 Document：用重解析的克隆跑，不影响原页
  const parsed = new DOMParser().parseFromString(document.documentElement.outerHTML, 'text/html')
  let article: ReturnType<Readability['parse']> = null
  try {
    article = new Readability(parsed).parse()
  } catch {
    article = null
  }
  if (article === null || (article.content ?? '').trim() === '') {
    return extractFull(base)
  }
  return {
    title: (article.title ?? '').trim() !== '' ? article.title!.trim() : pageTitle(document),
    siteName: (article.siteName ?? '').trim() !== '' ? article.siteName!.trim() : siteNameOf(document),
    url: base,
    html: absolutizeFragment(article.content ?? '', base),
  }
}

/** 选区提取（无选区抛错码） */
function extractSelection(base: string): ExtractPayload {
  const selection = window.getSelection()
  const fragment =
    selection !== null && selection.rangeCount > 0
      ? (() => {
          const holder = document.createElement('div')
          for (let i = 0; i < selection.rangeCount; i++) holder.appendChild(selection.getRangeAt(i)!.cloneContents())
          return holder.innerHTML
        })()
      : ''
  if (fragment.trim() === '') {
    const error = new Error('no-selection') as Error & { code: ExtractErrorCode }
    error.code = 'no-selection'
    throw error
  }
  return {
    title: pageTitle(document),
    siteName: siteNameOf(document),
    url: base,
    html: absolutizeFragment(fragment, base),
  }
}

export function extractPage(mode: ClipMode): ExtractPayload {
  const base = location.href
  if (mode === 'selection') return extractSelection(base)
  if (mode === 'article') return extractArticle(base)
  return extractFull(base)
}

function errorResponse(error: unknown): ExtractErr {
  const code = (error as { code?: string })?.code
  if (code === 'no-selection' || code === 'empty-extract') {
    return { ok: false, code, message: error instanceof Error ? error.message : String(error) }
  }
  return { ok: false, code: 'unknown', message: error instanceof Error ? error.message : String(error) }
}

// 监听器只注册一次（重复注入防御）
const host = window as typeof window & { __tinynoteExtractInstalled?: boolean }
if (host.__tinynoteExtractInstalled !== true) {
  host.__tinynoteExtractInstalled = true
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = message as { type?: string; mode?: ClipMode } | null
    if (request?.type !== 'tinynote-extract') return
    try {
      sendResponse({ ok: true, payload: extractPage(request.mode ?? 'article') } satisfies ExtractOk)
    } catch (error) {
      sendResponse(errorResponse(error))
    }
  })
}

export {}
