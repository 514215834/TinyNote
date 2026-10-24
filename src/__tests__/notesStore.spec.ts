// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/lib/db/db'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import type { NoteMeta } from '@/types'

function makeMeta(id: string, trashedAt: number | null): NoteMeta {
  return {
    id,
    title: `标题-${id}`,
    excerpt: '内容',
    folderId: null,
    tags: [],
    pinned: false,
    trashed: trashedAt !== null,
    trashedAt,
    createdAt: 100,
    updatedAt: 100,
  }
}

/** 直写数据库的种子：元数据 + 正文两行（F-523 分离后的存储形态） */
async function seedNote(id: string, trashedAt: number | null, content = '内容'): Promise<void> {
  await db.notes.put(makeMeta(id, trashedAt))
  await db.contents.put({ id, content })
}

const DAY = 86_400_000
const NOW = 1_700_000_000_000

beforeEach(async () => {
  setActivePinia(createPinia())
  await Promise.all([db.notes.clear(), db.folders.clear(), db.contents.clear()])
})

describe('notesStore（v0.2 store 编排）', () => {
  it('文件夹视图（F-201）下新建笔记自动归入该文件夹', async () => {
    const foldersStore = useFoldersStore()
    await foldersStore.create('工作')
    const folderId = foldersStore.folders[0]!.id

    const notesStore = useNotesStore()
    notesStore.setFolderFilter(folderId)
    await notesStore.createNote()
    expect(notesStore.notes[0]?.folderId).toBe(folderId)
    expect(notesStore.selectedNote?.folderId).toBe(folderId)
  })

  it('软删 → 回收站可见 → 恢复后 folderId/tags/pinned 完整（F-204 验收）', async () => {
    const foldersStore = useFoldersStore()
    await foldersStore.create('工作')
    const folderId = foldersStore.folders[0]!.id

    const notesStore = useNotesStore()
    await notesStore.init()
    notesStore.setFolderFilter(folderId)
    await notesStore.createNote()
    const id = notesStore.notes[0]!.id
    await notesStore.setTags(id, ['工作'])
    await notesStore.togglePin(id)

    await notesStore.softDelete(id)
    expect(notesStore.notes).toHaveLength(0)
    expect(notesStore.trashedNotes.map((note) => note.id)).toEqual([id])

    await notesStore.restore(id)
    const restored = notesStore.notes.find((note) => note.id === id)!
    expect(restored.folderId).toBe(folderId) // 回到原文件夹
    expect(restored.tags).toEqual(['工作']) // 标签完整
    expect(restored.pinned).toBe(true)
    expect(notesStore.trashedNotes).toHaveLength(0)
  })

  it('删除文件夹联动：其中笔记回到未分类且过滤态复归「全部笔记」（F-201）', async () => {
    const foldersStore = useFoldersStore()
    await foldersStore.create('工作')
    const folderId = foldersStore.folders[0]!.id

    const notesStore = useNotesStore()
    notesStore.setFolderFilter(folderId)
    await notesStore.createNote()

    await foldersStore.remove(folderId)
    expect(notesStore.activeFolderId).toBe(null)
    expect(notesStore.notes[0]?.folderId).toBe(null)
    expect(foldersStore.folders).toHaveLength(0)
  })

  it('moveToFolder 落库（拖拽/菜单移动共用路径）', async () => {
    const foldersStore = useFoldersStore()
    await foldersStore.create('工作')
    const folderId = foldersStore.folders[0]!.id

    const notesStore = useNotesStore()
    await notesStore.init()
    await notesStore.createNote()
    const id = notesStore.notes[0]!.id

    await notesStore.moveToFolder(id, folderId)
    expect(notesStore.notes[0]?.folderId).toBe(folderId)
    expect((await db.notes.get(id))?.folderId).toBe(folderId)
  })

  it('autopurge（F-204）物理删除 30 天前的回收站条目且不影响列表', async () => {
    await seedNote('old', NOW - 40 * DAY)
    await seedNote('fresh', NOW - 1 * DAY)

    const notesStore = useNotesStore()
    await notesStore.autopurge(NOW)
    await notesStore.init()
    expect(notesStore.trashedNotes.map((note) => note.id)).toEqual(['fresh'])
    expect(await db.notes.get('old')).toBeUndefined()
    expect(await db.contents.get('old')).toBeUndefined()
  })

  it('saveChanges（F-523）写入元数据与正文两表，正文不在列表行中', async () => {
    const notesStore = useNotesStore()
    await notesStore.init()
    await notesStore.createNote()
    const id = notesStore.notes[0]!.id

    await notesStore.saveChanges(id, { title: '新标题', content: '# 正文\n\n内容多多' })
    expect(notesStore.notes[0]).toMatchObject({ title: '新标题', excerpt: '正文 内容多多' })
    expect(await db.contents.get(id)).toEqual({ id, content: '# 正文\n\n内容多多' })
    expect(notesStore.notes[0]).not.toHaveProperty('content')
  })

  it('loadContent（F-523）按需读取正文并缓存', async () => {
    await seedNote('n1', null, 'Hello 世界')
    const notesStore = useNotesStore()
    await notesStore.init()
    expect(await notesStore.loadContent('n1')).toBe('Hello 世界')
    // 二次读取命中缓存（行为等价：结果一致）
    expect(await notesStore.loadContent('n1')).toBe('Hello 世界')
  })
})
