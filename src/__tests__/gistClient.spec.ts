import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GIST_FILENAME,
  createSyncGist,
  fetchSyncGist,
  gistWebUrl,
  updateSyncGist,
} from '@/features/sync/gistClient'

/** 构造 fetch stub：记录调用并按 URL/方法返回响应 */
function stubFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const target = typeof url === 'string' ? url : url.toString()
    calls.push({ url: target, init })
    const { status, body } = handler(target, init)
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gist REST 客户端（F-501）', () => {
  it('fetchSyncGist 返回 tinynote-sync.json 内容，带鉴权头', async () => {
    const calls = stubFetch(() => ({
      status: 200,
      body: { files: { [GIST_FILENAME]: { content: '{"format":"tinynote-sync"}' } } },
    }))
    const content = await fetchSyncGist('pat-1', 'gist123')
    expect(content).toBe('{"format":"tinynote-sync"}')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('Authorization')).toBe('Bearer pat-1')
    expect(headers.get('Accept')).toBe('application/vnd.github+json')
    expect(calls[0].url).toContain('/gists/gist123')
  })

  it('Gist 存在但没有同步文件 / 内容为空 → null（视为空远端）', async () => {
    stubFetch(() => ({ status: 200, body: { files: { 'other.txt': { content: 'hi' } } } }))
    expect(await fetchSyncGist('pat', 'g')).toBeNull()

    stubFetch(() => ({ status: 200, body: { files: { [GIST_FILENAME]: { content: '' } } } }))
    expect(await fetchSyncGist('pat', 'g')).toBeNull()
  })

  it('404 → GistError（找不到 Gist）', async () => {
    stubFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
    await expect(fetchSyncGist('pat', 'g')).rejects.toMatchObject({
      name: 'GistError',
      status: 404,
    })
  })

  it('401/403 → 令牌相关提示', async () => {
    stubFetch(() => ({ status: 401, body: { message: 'Bad credentials' } }))
    await expect(fetchSyncGist('bad', 'g')).rejects.toThrow('令牌')
  })

  it('网络失败 → 可读的连接错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchSyncGist('pat', 'g')).rejects.toThrow('无法连接 GitHub')
  })

  it('createSyncGist 创建私有 Gist 并返回 id', async () => {
    const calls = stubFetch((url, init) => {
      expect(url).toBe('https://api.github.com/gists')
      const body = JSON.parse(String(init.body))
      expect(body.public).toBe(false)
      expect(body.files[GIST_FILENAME].content).toBe('payload')
      return { status: 201, body: { id: 'new-gist' } }
    })
    const id = await createSyncGist('pat', 'payload')
    expect(id).toBe('new-gist')
    expect(calls).toHaveLength(1)
  })

  it('updateSyncGist PATCH 同名文件', async () => {
    const calls = stubFetch((url, init) => {
      expect(url).toContain('/gists/gist9')
      expect(init.method).toBe('PATCH')
      const body = JSON.parse(String(init.body))
      expect(body.files[GIST_FILENAME].content).toBe('v2')
      return { status: 200, body: { id: 'gist9' } }
    })
    await updateSyncGist('pat', 'gist9', 'v2')
    expect(calls).toHaveLength(1)
  })

  it('gistWebUrl 拼接只读地址', () => {
    expect(gistWebUrl('abc')).toBe('https://gist.github.com/abc')
  })
})
