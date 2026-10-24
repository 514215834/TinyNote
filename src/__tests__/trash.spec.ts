// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { TRASH_RETENTION_DAYS, isPurgeExpired, trashCutoff } from '@/features/trash/trash'
import type { Note } from '@/types'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

function makeNote(id: string, trashedAt: number | null, extra: Partial<Note> = {}): Note {
  return {
    id,
    title: `标题-${id}`,
    content: '内容',
    folderId: 'f1',
    tags: ['工作'],
    pinned: false,
    trashed: trashedAt !== null,
    trashedAt,
    createdAt: 100,
    updatedAt: 100,
    ...extra,
  }
}

beforeEach(async () => {
  await db.notes.clear()
})

describe('trashCutoff / isPurgeExpired（F-204，注入当前时间的 30 天清理判断）', () => {
  it('cutoff = 当前时间 - 30 天', () => {
    expect(trashCutoff(NOW)).toBe(NOW - TRASH_RETENTION_DAYS * DAY)
  })

  it('进入回收站超过 30 天视为过期', () => {
    expect(isPurgeExpired({ trashedAt: NOW - 31 * DAY }, NOW)).toBe(true)
  })

  it('30 天内不清理', () => {
    expect(isPurgeExpired({ trashedAt: NOW - 29 * DAY }, NOW)).toBe(false)
  })

  it('恰好 30 天边界视为过期（与 repository 的 belowOrEqual 同口径）', () => {
    expect(isPurgeExpired({ trashedAt: NOW - 30 * DAY }, NOW)).toBe(true)
  })

  it('未进入回收站（trashedAt 为 null）不清理', () => {
    expect(isPurgeExpired({ trashedAt: null }, NOW)).toBe(false)
  })
})

describe('noteRepository 回收站能力（F-204）', () => {
  it('restore 只清软删标记：folderId、tags、pinned 原样保留（验收要点）', async () => {
    await db.notes.put(makeNote('n1', NOW, { folderId: 'f1', tags: ['工作', '随手记'], pinned: true }))
    await noteRepository.restore('n1')
    const restored = await noteRepository.get('n1')
    expect(restored?.trashed).toBe(false)
    expect(restored?.trashedAt).toBe(null)
    expect(restored?.folderId).toBe('f1')
    expect(restored?.tags).toEqual(['工作', '随手记'])
    expect(restored?.pinned).toBe(true)
    expect((await noteRepository.listActive()).map((n) => n.id)).toEqual(['n1'])
    expect(await noteRepository.listTrashed()).toEqual([])
  })

  it('listTrashed 按进入回收站的时间倒序', async () => {
    await db.notes.put(makeNote('old', NOW - 10 * DAY))
    await db.notes.put(makeNote('new', NOW))
    expect((await noteRepository.listTrashed()).map((n) => n.id)).toEqual(['new', 'old'])
  })

  it('deleteForever 物理删除，彻底不可见', async () => {
    await db.notes.put(makeNote('n1', NOW))
    await noteRepository.deleteForever('n1')
    expect(await noteRepository.get('n1')).toBeUndefined()
  })

  it('purgeExpiredBefore 只清理过期条目，30 天内的保留', async () => {
    await db.notes.put(makeNote('expired', NOW - 40 * DAY))
    await db.notes.put(makeNote('fresh', NOW - 1 * DAY))
    await db.notes.put(makeNote('active', null))
    expect(await noteRepository.purgeExpiredBefore(trashCutoff(NOW))).toBe(1)
    expect(await noteRepository.get('expired')).toBeUndefined()
    expect(await noteRepository.get('fresh')).toBeDefined()
    expect(await noteRepository.get('active')).toBeDefined()
  })

  it('emptyTrash 清空回收站但不影响未删除笔记', async () => {
    await db.notes.put(makeNote('n1', NOW - 5 * DAY))
    await db.notes.put(makeNote('n2', null))
    await noteRepository.emptyTrash()
    expect(await noteRepository.get('n1')).toBeUndefined()
    expect(await noteRepository.get('n2')).toBeDefined()
  })
})
