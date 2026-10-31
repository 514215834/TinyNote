/**
 * 剪藏扩展后台（F-901，MV3 Service Worker，module）：
 * - 右键菜单「剪藏到 TinyNote」→ 打开 clipper 页（自动正文模式剪藏来源标签页）
 * - `tinynote-fetch-image` 消息：以扩展身份抓取图片字节（host_permissions 授权下无 CORS 限制，
 *   内容脚本/扩展页受页面 CORS 约束抓不到的 CDN 图在此兜底）
 *
 * zip 装配与下载在扩展页侧完成（SW 无 URL.createObjectURL，blob 下载需要页面上下文）。
 */

const IMAGE_MAX_BYTES = 10 * 1024 * 1024 // 与应用侧附件上限一致（超限回落外链，导入时口径一致）

interface FetchImageOk {
  ok: true
  mime: string
  /** 字节的 base64（消息通道按 JSON 序列化，不传 ArrayBuffer） */
  base64: string
}
interface FetchImageErr {
  ok: false
  reason: 'too-large' | 'fetch-failed'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function fetchImage(url: string): Promise<FetchImageOk | FetchImageErr> {
  try {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return { ok: false, reason: 'fetch-failed' }
    const mime = (response.headers.get('content-type') ?? 'image/png').split(';')[0]?.trim() ?? 'image/png'
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > IMAGE_MAX_BYTES) return { ok: false, reason: 'too-large' }
    return { ok: true, mime, base64: bytesToBase64(new Uint8Array(buffer)) }
  } catch {
    return { ok: false, reason: 'fetch-failed' }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'tinynote-clip',
    title: '剪藏到 TinyNote',
    contexts: ['page', 'selection'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'tinynote-clip' || tab?.id === undefined) return
  chrome.tabs.create({
    url: chrome.runtime.getURL(`clipper/clipper.html?tab=${tab.id}`),
    active: true,
  })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as { type?: string; url?: string } | null
  if (request?.type !== 'tinynote-fetch-image' || typeof request.url !== 'string') return
  fetchImage(request.url).then(sendResponse)
  return true // 异步应答
})

export {}
