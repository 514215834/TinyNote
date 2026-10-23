// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import type { Note } from '@/types'

function makeNote(id: string, updatedAt: number, trashed = false): Note {
  return {
    id,
    title: `标题-${id}`,
    content: `内容-${id}`,
    folderId: null,
    tags: [],
    pinned: false,
    trashed,
    trashedAt: trashed ? updatedAt : null,
    createdAt: updatedAt,
    updatedAt,
  }
}

beforeEach(async () => {
  await db.notes.clear()
})

describe('noteRepository（F-107，经 fake-indexeddb 走真实 Dexie 路径）', () => {
  it('保存后可按 id 读取', async () => {
    await noteRepository.save(makeNote('n1', 100))
    expect((await noteRepository.get('n1'))?.title).toBe('标题-n1')
  })

  it('listActive 仅返回未删除笔记并按 updatedAt 倒序', async () => {
    await noteRepository.save(makeNote('n1', 100))
    await noteRepository.save(makeNote('n2', 300))
    await noteRepository.save(makeNote('n3', 200))
    await noteRepository.save(makeNote('n4', 400, true))
    expect((await noteRepository.listActive()).map((note) => note.id)).toEqual(['n2', 'n3', 'n1'])
  })

  it('softDelete 打回收站标记而不丢数据（F-101 软删除）', async () => {
    await noteRepository.save(makeNote('n1', 100))
    await noteRepository.softDelete('n1')
    const trashed = await noteRepository.get('n1')
    expect(trashed?.trashed).toBe(true)
    expect(trashed?.trashedAt).toBeGreaterThan(0)
    expect(await noteRepository.listActive()).toEqual([])
  })

  it('save 对已存在 id 为整体覆盖（put 语义）', async () => {
    await noteRepository.save(makeNote('n1', 100))
    await noteRepository.save({ ...makeNote('n1', 200), title: '新标题' })
    const note = await noteRepository.get('n1')
    expect(note?.title).toBe('新标题')
    expect(note?.updatedAt).toBe(200)
  })

  it('save 接受 Proxy 包装的输入（回归：Vue reactive Proxy 触发 DataCloneError）', async () => {
    const proxy = new Proxy(makeNote('n1', 100), {})
    await noteRepository.save(proxy)
    expect((await noteRepository.get('n1'))?.title).toBe('标题-n1')
  })
})
