import { SYNC_FORMAT, type SyncFile } from './sync'

/**
 * GitHub Gist REST 客户端（F-501）：全部同步数据存放在一个 secret Gist 的单一文件里。
 * 用户自备具备 gist 权限的 PAT（仅存本机 localStorage，架构文档 §8 隐私口径）；
 * 首次同步自动创建私有 Gist，之后走 PATCH 增量更新同一文件。
 */

export const GIST_FILENAME = 'tinynote-sync.json'
const GIST_API = 'https://api.github.com/gists'
const REQUEST_TIMEOUT_MS = 20_000

/** Gist 请求失败：message 面向用户，status 保留原始 HTTP 状态码（0 = 网络/未知） */
export class GistError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
  ) {
    super(message)
    this.name = 'GistError'
  }
}

function authHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function request(pat: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...authHeaders(pat), ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new GistError('连接 GitHub 超时，请检查网络后重试')
    }
    throw new GistError('无法连接 GitHub，请检查网络后重试')
  }
  if (response.status === 401 || response.status === 403) {
    throw new GistError('GitHub 拒绝了访问：请确认令牌有效且具备 gist 权限', response.status)
  }
  if (response.status === 404) {
    throw new GistError('找不到同步 Gist（可能已被删除，或令牌无权访问）', 404)
  }
  if (!response.ok) {
    throw new GistError(`GitHub 请求失败（HTTP ${response.status}）`, response.status)
  }
  return response
}

/**
 * 读取同步 Gist 的载荷原文。返回 null 表示 Gist 存在但还没有 tinynote-sync.json
 * （例如用户自建了空 Gist）——视为空远端，本地将整体上行。
 */
export async function fetchSyncGist(pat: string, gistId: string): Promise<string | null> {
  const response = await request(pat, `${GIST_API}/${encodeURIComponent(gistId)}`, { method: 'GET' })
  const body = (await response.json()) as {
    files?: Record<string, { content?: string | null } | undefined>
  }
  const file = body.files?.[GIST_FILENAME]
  const content = file?.content
  return typeof content === 'string' && content !== '' ? content : null
}

/** 首次同步：创建私有 Gist，返回 gist id */
export async function createSyncGist(pat: string, payloadJson: string): Promise<string> {
  const response = await request(pat, GIST_API, {
    method: 'POST',
    body: JSON.stringify({
      description: 'TinyNote 同步数据（勿手动编辑）',
      public: false,
      files: { [GIST_FILENAME]: { content: payloadJson } },
    }),
  })
  const body = (await response.json()) as { id?: unknown }
  if (typeof body.id !== 'string' || body.id === '') throw new GistError('GitHub 返回的 Gist id 无效')
  return body.id
}

/** 后续同步：更新已有 Gist 中的载荷文件 */
export async function updateSyncGist(pat: string, gistId: string, payloadJson: string): Promise<void> {
  await request(pat, `${GIST_API}/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: payloadJson } },
    }),
  })
}

/** 供 UI 展示的 Gist 只读地址（不包含 PAT） */
export function gistWebUrl(gistId: string): string {
  return `https://gist.github.com/${gistId}`
}

/** 类型收窄用的小工具：判断解析出的对象是否为明文同步载荷（加密信封见 isEncryptedEnvelope） */
export function isSyncFile(raw: unknown): raw is SyncFile {
  return typeof raw === 'object' && raw !== null && (raw as SyncFile).format === SYNC_FORMAT
}
