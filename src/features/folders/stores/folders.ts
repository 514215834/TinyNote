import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Folder } from '@/types'
import { folderRepository } from '@/lib/db/repositories/folderRepository'
import { makeFolder, reorderList } from '../folders'
import { useNotesStore } from '@/features/notes/stores/notes'

/** 文件夹（F-201，仅一层）：侧边栏树 + 笔记归属 */
export const useFoldersStore = defineStore('folders', () => {
  const folders = ref<Folder[]>([])
  const loaded = ref(false)

  async function init(): Promise<void> {
    folders.value = await folderRepository.list()
    loaded.value = true
  }

  async function create(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    const folder = makeFolder(trimmed, folders.value.length)
    await folderRepository.save(folder)
    folders.value = [...folders.value, folder]
  }

  async function rename(id: string, name: string): Promise<void> {
    const folder = folders.value.find((item) => item.id === id)
    const trimmed = name.trim()
    if (!folder || !trimmed) return
    await folderRepository.save({ ...folder, name: trimmed })
    folder.name = trimmed
  }

  /**
   * F-1006 拖拽排序：把 dragId 移动到 targetId 之前（order 字段 v0.1 即存在，
   * 本版启用写入）。跨重启保持——order 落库，list() 按 order 排序。
   */
  async function reorder(dragId: string, targetId: string): Promise<void> {
    const next = reorderList(folders.value, dragId, targetId)
    if (next === folders.value) return
    folders.value = next
    await Promise.all(folders.value.map((folder) => folderRepository.save(folder)))
  }

  /** 删除文件夹：repository 单事务把其下笔记移回未分类，并联动刷新笔记列表 */
  async function remove(id: string): Promise<void> {
    await folderRepository.delete(id)
    folders.value = folders.value.filter((item) => item.id !== id)
    await useNotesStore().onFolderDeleted(id)
  }

  return { folders, loaded, init, create, rename, remove, reorder }
})
