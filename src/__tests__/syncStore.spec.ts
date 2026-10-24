import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/lib/db/db'
import { backupPort } from '@/lib/db/repositories/backupPort'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { settingsRepository } from '@/lib/db/repositories/settingsRepository'
import { useNotesStore } from '@/features/notes/stores/notes'
import { buildSyncFile, type SyncLibrary } from '@/features/sync/sync'
import { SYNC_BASELINE_KEY, useSyncStore } from '@/features/sync/stores/sync'
import type { Note } from '@/types'

/** Gist 客户端打桩：进程内记录上行载荷，fetchResult 模拟远端内容 */
const gist = vi.hoisted(() => ({
  created: [] as string[],
  updated: [] as string[],
  fetchResult: null as string | null,
  fetchError: null as Error | null,
  reset(): void {
    this.created = []
    this.updated = []
    this.fetchResult = null
    this.fetchError = null
  },
}))
vi.mock('@/features/sync/gistClient', () => ({
  fetchSyncGist: async () => {
    if (gist.fetchError) throw gist.fetchError
    return gist.fetchResult
  },
  createSyncGist: async (_pat: string, content: string) => {
    gist.created.push(content)
    return 'gist-1'
  },
  updateSyncGist: async (_pat: string, _gistId: string, content: string) => {
    gist.updated.push(content)
  },
  gistWebUrl: (id: string) => `https://gist.github.com/${id}`,
}))

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `标题-${id}`,
    content: `内容-${id}`,
    folderId: null,
    tags: [],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

async function seedNotes(notes: Note[]): Promise<void> {
  for (const note of notes) {
    // saveWithContent 会按传入正文重算 excerpt，占位值不落库
    await noteRepository.saveWithContent({ ...note, tags: [...note.tags], excerpt: '' }, note.content)
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  gist.reset()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('syncStore：首轮同步（F-501）', () => {
  it('无 Gist 时自动创建，上传全量库并写入基线', async () => {
    await seedNotes([makeNote('n1'), makeNote('n2', { updatedAt: 200 })])
    const sync = useSyncStore()
    sync.pat = ' test-pat '
    sync.deviceName = '设备A'

    const stats = await sync.syncNow()
    expect(stats).toMatchObject({ uploaded: 2, downloaded: 0, conflicts: 0 })
    expect(sync.status).toBe('ok')
    expect(sync.gistId).toBe('gist-1')

    // 上行载荷即本地全量库
    expect(gist.created).toHaveLength(1)
    const uploaded = JSON.parse(gist.created[0])
    expect(uploaded.notes.map((n: Note) => n.id).sort()).toEqual(['n1', 'n2'])
    expect(uploaded.deviceName).toBe('设备A')

    // 基线入库：同一状态再同步应零动作
    const baseline = await settingsRepository.get<Record<string, unknown>>(SYNC_BASELINE_KEY)
    expect(Object.keys(baseline?.notes ?? {}).sort()).toEqual(['n1', 'n2'])

    gist.fetchResult = gist.created[0]
    const second = await sync.syncNow()
    expect(second).toMatchObject({ uploaded: 0, downloaded: 0 })
    expect(gist.updated).toHaveLength(1)
  })

  it('未配置 PAT → error 状态，不发起任何请求', async () => {
    const sync = useSyncStore()
    expect(await sync.syncNow()).toBeNull()
    expect(sync.status).toBe('error')
    expect(sync.errorMessage).toContain('未配置')
    expect(gist.created).toHaveLength(0)
  })

  it('远端拉取失败 → error 状态与可读信息，本地数据不动', async () => {
    await seedNotes([makeNote('n1')])
    const sync = useSyncStore()
    sync.pat = 'pat'
    sync.gistId = 'gist-1'
    gist.fetchError = new Error('找不到同步 Gist（可能已被删除，或令牌无权访问）')

    expect(await sync.syncNow()).toBeNull()
    expect(sync.status).toBe('error')
    expect(sync.errorMessage).toContain('找不到同步 Gist')
    expect((await noteRepository.listActive()).map((n) => n.id)).toEqual(['n1'])
    expect(await settingsRepository.get(SYNC_BASELINE_KEY)).toBeUndefined()
  })
})

describe('syncStore：增量同步与冲突（F-502）', () => {
  it('远端新笔记落地本地库并刷新列表', async () => {
    await seedNotes([makeNote('n1')])
    const notesStore = useNotesStore()
    await notesStore.init()

    const sync = useSyncStore()
    sync.pat = 'pat'
    await sync.syncNow()

    // 模拟另一设备推了新笔记与改名
    const remoteLib: SyncLibrary = {
      folders: [],
      notes: [makeNote('n1'), makeNote('remote1', { updatedAt: 3_000, title: '来自B' })],
      attachments: [],
    }
    gist.fetchResult = JSON.stringify(await buildSyncFile(remoteLib, { id: 'db', name: '设备B' }, 4_000))

    const stats = await sync.syncNow()
    expect(stats).toMatchObject({ downloaded: 1, uploaded: 0 })
    expect((await noteRepository.listActive()).map((n) => n.id).sort()).toEqual(['n1', 'remote1'])
    // 视图刷新后列表可见
    expect(notesStore.notes.map((n) => n.id)).toContain('remote1')
  })

  it('双侧同改一篇 → 本地较新胜出，远端版本保留为冲突副本', async () => {
    await seedNotes([makeNote('n1')])
    const sync = useSyncStore()
    sync.pat = 'pat'
    await sync.syncNow() // 建立基线

    // 本机修改（较新）
    await seedNotes([makeNote('n1', { content: '本机新内容', updatedAt: Date.now() + 10_000 })])
    // 远端为另一设备的旧改动
    const remoteLib: SyncLibrary = {
      folders: [],
      notes: [makeNote('n1', { content: '远端改动', updatedAt: 2_000 })],
      attachments: [],
    }
    gist.fetchResult = JSON.stringify(await buildSyncFile(remoteLib, { id: 'db', name: '设备B' }, 4_000))

    const stats = await sync.syncNow()
    expect(stats).toMatchObject({ conflicts: 1 })
    const active = await noteRepository.listActive()
    expect(active.find((n) => n.id === 'n1')?.excerpt).toContain('本机新内容')
    const copy = active.find((n) => n.id !== 'n1')!
    expect(copy.title).toBe('标题-n1（冲突@设备B）')
    expect(copy.excerpt).toContain('远端改动')
  })

  it('远端删除传播：本地未动的笔记被物理删除', async () => {
    await seedNotes([makeNote('n1'), makeNote('n2')])
    const sync = useSyncStore()
    sync.pat = 'pat'
    await sync.syncNow()

    const remoteLib: SyncLibrary = { folders: [], notes: [makeNote('n1')], attachments: [] }
    gist.fetchResult = JSON.stringify(await buildSyncFile(remoteLib, { id: 'db', name: '设备B' }, 4_000))

    const stats = await sync.syncNow()
    expect(stats).toMatchObject({ deletedByRemote: 1 })
    expect((await noteRepository.listActive()).map((n) => n.id)).toEqual(['n1'])
    expect(await noteRepository.getContent('n2')).toBe('')
  })
})

describe('syncStore：端到端加密（F-503）', () => {
  it('开启加密后 Gist 内容为不可读信封，拉取走解密路径', async () => {
    await seedNotes([makeNote('n1', { content: '机密内容' })])
    const sync = useSyncStore()
    sync.pat = 'pat'
    sync.encryptionEnabled = true
    sync.password = '共享密码'

    await sync.syncNow()
    expect(gist.created).toHaveLength(1)
    const envelope = JSON.parse(gist.created[0])
    expect(envelope.format).toBe('tinynote-sync-enc')
    expect(gist.created[0]).not.toContain('机密内容')

    // 同一密文回放（模拟另一设备上传的本机密文）：解密成功，状态收敛零动作
    gist.fetchResult = gist.created[0]
    const stats = await sync.syncNow()
    expect(sync.status).toBe('ok')
    expect(stats).toMatchObject({ uploaded: 0, downloaded: 0, conflicts: 0 })
  })
})

describe('syncStore：自动同步与断开', () => {
  it('未配置或关闭开关时不自动同步；配置后启动同步', async () => {
    const sync = useSyncStore()
    await sync.autoSyncIfDue()
    expect(gist.created).toHaveLength(0)

    sync.pat = 'pat'
    sync.autoSyncEnabled = false
    await sync.autoSyncIfDue()
    expect(gist.created).toHaveLength(0)

    sync.autoSyncEnabled = true
    await seedNotes([makeNote('n1')])
    await sync.autoSyncIfDue()
    expect(gist.created).toHaveLength(1)
    expect(sync.status).toBe('ok')
  })

  it('disconnect 清除配置与基线，笔记数据不动', async () => {
    await seedNotes([makeNote('n1')])
    const sync = useSyncStore()
    sync.pat = 'pat'
    sync.password = 'pw'
    sync.encryptionEnabled = true
    await sync.syncNow()
    expect(sync.configured).toBe(true)

    sync.disconnect()
    expect(sync.configured).toBe(false)
    expect(sync.gistId).toBe('')
    expect(sync.encryptionEnabled).toBe(false)
    expect(await settingsRepository.get(SYNC_BASELINE_KEY)).toBeNull()
    expect((await noteRepository.listActive()).map((n) => n.id)).toEqual(['n1'])
  })
})

describe('backupPort.applySyncLibrary（同步落库口径）', () => {
  it('全量覆盖四表但不触碰快照；被删笔记的快照一并清理', async () => {
    await seedNotes([makeNote('n1'), makeNote('n2')])
    await db.snapshots.bulkPut([
      { id: 's1', noteId: 'n1', content: '旧', createdAt: 1 },
      { id: 's2', noteId: 'n2', content: '旧', createdAt: 1 },
    ])

    await backupPort.applySyncLibrary(
      {
        folders: [],
        notes: [makeNote('n1', { content: '合并后' })],
        attachments: [],
      },
      ['n2'],
    )

    expect((await noteRepository.listActive()).map((n) => n.id)).toEqual(['n1'])
    expect(await noteRepository.getContent('n1')).toBe('合并后')
    const snapshots = await db.snapshots.toArray()
    expect(snapshots.map((s) => s.id)).toEqual(['s1']) // n1 的历史保留，n2 的随删除清理
  })

  it('excerpt 按正文重算', async () => {
    await backupPort.applySyncLibrary({
      folders: [],
      notes: [makeNote('n1', { content: '# 标题\n正文内容' })],
      attachments: [],
    })
    const meta = await db.notes.get('n1')
    expect(meta?.excerpt).toContain('正文内容')
    expect(meta?.excerpt).not.toContain('#')
  })
})
