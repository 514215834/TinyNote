// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { folderRepository } from '@/lib/db/repositories/folderRepository'
import { makeFolder } from '@/features/folders/folders'
import type { Note } from '@/types'

function makeNote(id: string, folderId: string | null): Note {
  return {
    id,
    title: `标题-${id}`,
    content: '内容',
    folderId,
    tags: ['工作'],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 100,
    updatedAt: 100,
  }
}

beforeEach(async () => {
  await db.notes.clear()
  await db.folders.clear()
})

describe('folderRepository（F-201，经 fake-indexeddb 走真实 Dexie 路径）', () => {
  it('list 按 order 升序返回', async () => {
    await folderRepository.save(makeFolder('工作', 2))
    await folderRepository.save(makeFolder('生活', 0))
    expect((await folderRepository.list()).map((folder) => folder.name)).toEqual(['生活', '工作'])
  })

  it('delete 后文件夹消失，且其下笔记移回未分类（folderId 置 null）', async () => {
    const folder = makeFolder('工作', 0)
    await folderRepository.save(folder)
    await db.notes.put(makeNote('n1', folder.id))
    await db.notes.put(makeNote('n2', null))

    await folderRepository.delete(folder.id)

    expect(await folderRepository.list()).toEqual([])
    const n1 = await noteById('n1')
    expect(n1?.folderId).toBe(null)
    expect(n1?.tags).toEqual(['工作']) // 移回未分类不触碰笔记其余字段
    expect((await noteById('n2'))?.folderId).toBe(null)
  })
})

async function noteById(id: string): Promise<Note | undefined> {
  return db.notes.get(id)
}
