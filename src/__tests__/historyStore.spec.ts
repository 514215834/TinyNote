// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/lib/db/db'
import { backupPort } from '@/lib/db/repositories/backupPort'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useHistoryStore } from '@/features/history/stores/history'
import { SNAPSHOT_KEEP_LIMIT } from '@/features/history/history'
import { makeExcerpt } from '@/features/notes/notes'
import type { Note } from '@/types'

/** 只冻结 Date（快照 createdAt 可控），定时器保持真实以免干扰 fake-indexeddb 事务调度 */
const NOW = 1_700_000_000_000
let currentNow = NOW

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `标题-${id}`,
    content: '初始内容',
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

/** 直写数据库的种子（F-523 存储形态）：元数据行 + 正文行 */
async function seedNote(note: Note): Promise<void> {
  const { content, ...meta } = note
  await db.notes.put({ ...meta, tags: [...meta.tags], excerpt: makeExcerpt(content) })
  await db.contents.put({ id: note.id, content })
}

function advance(ms: number): void {
  currentNow += ms
  vi.setSystemTime(currentNow)
}

beforeEach(async () => {
  currentNow = NOW
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  setActivePinia(createPinia())
  await Promise.all([
    db.notes.clear(),
    db.folders.clear(),
    db.contents.clear(),
    db.attachments.clear(),
    db.snapshots.clear(),
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('historyStore 自动快照（F-402）', () => {
  it('首个非空版本成为基线快照；小改动不快照；超过阈值才快照', async () => {
    const notesStore = useNotesStore()
    await notesStore.init()
    await notesStore.createNote()
    const note = notesStore.notes[0]!
    const historyStore = useHistoryStore()

    expect(await historyStore.maybeAutoSnapshot(note.id, '第一版正文')).toBe(true)
    expect(await historyStore.maybeAutoSnapshot(note.id, '第一版正文。')).toBe(false) // 微小编辑

    advance(1000)
    const rewritten = '完全重写之后的正文内容，与第一版相比已经面目全非，字符变化远超两成阈值。'
    expect(await historyStore.maybeAutoSnapshot(note.id, rewritten)).toBe(true)

    const rows = await db.snapshots.where('noteId').equals(note.id).toArray()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.content))).toEqual(
      new Set(['第一版正文', rewritten]),
    )
  })

  it('内容与既有快照相同时跳过（防重复快照）', async () => {
    const historyStore = useHistoryStore()
    expect(await historyStore.maybeAutoSnapshot('n1', '正文甲')).toBe(true)
    expect(await historyStore.maybeAutoSnapshot('n1', '正文甲')).toBe(false)
  })

  it('保留上限 20 条：超出后最旧的被物理删除', async () => {
    const historyStore = useHistoryStore()
    for (let i = 0; i < SNAPSHOT_KEEP_LIMIT + 2; i++) {
      advance(1000)
      await historyStore.createManualSnapshot('n1', `第 ${i} 版内容各不相同`)
    }
    expect(await db.snapshots.where('noteId').equals('n1').count()).toBe(SNAPSHOT_KEEP_LIMIT)
    const rows = await db.snapshots.where('noteId').equals('n1').toArray()
    expect(rows.some((row) => row.content === '第 0 版内容各不相同')).toBe(false) // 最旧两条被淘汰
  })
})

describe('historyStore 回滚（F-402）', () => {
  it('回滚写回快照内容、刷新 updatedAt，并把回滚前的现状先存为快照', async () => {
    const notesStore = useNotesStore()
    await seedNote(makeNote('n1', { content: '回滚前的现状' }))
    await notesStore.init()
    const note = notesStore.notes[0]!
    const historyStore = useHistoryStore()

    advance(1000)
    await historyStore.createManualSnapshot('n1', '想回到的历史版本')
    advance(1000)
    const snapshotId = historyStore.lists['n1']![0]!.id

    advance(1000)
    const restored = await historyStore.restoreSnapshot(note, snapshotId, '回滚前的现状')
    expect(restored).toBe('想回到的历史版本')

    expect((await db.contents.get('n1'))?.content).toBe('想回到的历史版本')
    expect((await db.notes.get('n1'))!.updatedAt).toBeGreaterThanOrEqual(NOW)

    // 回滚前的现状已先存档（恢复动作可再撤销）
    const contents = historyStore.contents('n1')!
    expect(contents).toContain('回滚前的现状')
    expect(contents).toContain('想回到的历史版本')
  })

  it('恢复到与当前一致的内容时无事发生（返回 null）', async () => {
    const notesStore = useNotesStore()
    await seedNote(makeNote('n1', { content: '当前内容' }))
    await notesStore.init()
    const historyStore = useHistoryStore()
    advance(1000)
    await historyStore.createManualSnapshot('n1', '当前内容')
    const snapshotId = historyStore.lists['n1']![0]!.id

    expect(await historyStore.restoreSnapshot(notesStore.notes[0]!, snapshotId, '当前内容')).toBe(null)
    expect(historyStore.lists['n1']).toHaveLength(1) // 没有产生重复快照
  })
})

describe('快照的级联与备份语义（F-402/F-406 数据一致性）', () => {
  it('彻底删除笔记时连带删除其快照与正文（同事务）', async () => {
    await seedNote(makeNote('gone'))
    await seedNote(makeNote('kept'))
    await db.snapshots.put({ id: 's1', noteId: 'gone', content: 'x', createdAt: 1 })
    await db.snapshots.put({ id: 's2', noteId: 'kept', content: 'y', createdAt: 2 })

    await noteRepository.deleteForever('gone')
    expect(await db.snapshots.get('s1')).toBeUndefined()
    expect(await db.contents.get('gone')).toBeUndefined()
    expect(await db.snapshots.get('s2')).toMatchObject({ id: 's2' })
  })

  it('备份恢复为全量覆盖语义：快照一并清空，正文拆入 contents（快照不进入备份导出口径）', async () => {
    await db.snapshots.put({ id: 's1', noteId: 'n1', content: 'x', createdAt: 1 })
    await backupPort.restore({ folders: [], notes: [makeNote('imported')], attachments: [] })
    expect(await db.snapshots.count()).toBe(0)
    expect(await db.notes.get('imported')).toMatchObject({ excerpt: '初始内容' })
    expect(await db.contents.get('imported')).toEqual({ id: 'imported', content: '初始内容' })
  })

  it('清空回收站连带删除快照', async () => {
    await seedNote(makeNote('trashed-1', { trashed: true, trashedAt: NOW - 1000 }))
    await db.snapshots.put({ id: 's1', noteId: 'trashed-1', content: 'x', createdAt: 1 })
    await noteRepository.emptyTrash()
    expect(await db.snapshots.count()).toBe(0)
  })
})
