// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { folderRepository } from '@/lib/db/repositories/folderRepository'
import { makeFolder, reorderList } from '@/features/folders/folders'
import type { NoteMeta } from '@/types'

function makeNote(id: string, folderId: string | null): NoteMeta {
  return {
    id,
    title: `标题-${id}`,
    excerpt: '内容',
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
  await db.contents.clear()
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

async function noteById(id: string): Promise<NoteMeta | undefined> {
  return db.notes.get(id)
}

// ———— F-1006 文件夹拖拽排序（order 字段启用写入） ————
describe('reorderList（F-1006 拖拽重排纯函数）', () => {
  it('移动到目标之前，order 按新顺序重排', () => {
    const list = [
      { id: 'a', name: '甲', order: 0, createdAt: 1 },
      { id: 'b', name: '乙', order: 1, createdAt: 2 },
      { id: 'c', name: '丙', order: 2, createdAt: 3 },
    ]
    const next = reorderList(list, 'c', 'a')
    expect(next.map((folder) => folder.id)).toEqual(['c', 'a', 'b'])
    expect(next.map((folder) => folder.order)).toEqual([0, 1, 2])
    expect(list.map((folder) => folder.order)).toEqual([0, 1, 2]) // 不改入参
  })

  it('同位移动 / 目标缺失时原样返回（不产生写库）', () => {
    const list = [
      { id: 'a', name: '甲', order: 0, createdAt: 1 },
      { id: 'b', name: '乙', order: 1, createdAt: 2 },
    ]
    expect(reorderList(list, 'a', 'a')).toBe(list)
    expect(reorderList(list, 'a', 'ghost')).toBe(list)
  })

  it('重排落库后 list() 按 order 排序返回（跨重启保持）', async () => {
    await folderRepository.save({ id: 'a', name: '甲', order: 0, createdAt: 1 })
    await folderRepository.save({ id: 'b', name: '乙', order: 1, createdAt: 2 })
    // 模拟拖拽后的重排持久化：乙提到最前
    const reordered = reorderList(await folderRepository.list(), 'b', 'a')
    await Promise.all(reordered.map((folder) => folderRepository.save(folder)))
    expect((await folderRepository.list()).map((folder) => folder.id)).toEqual(['b', 'a'])
  })
})
