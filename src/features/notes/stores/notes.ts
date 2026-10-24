import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { NoteMeta } from '@/types'
import { createId } from '@/lib/utils/id'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { makeExcerpt } from '@/features/notes/notes'
import { trashCutoff } from '@/features/trash/trash'

export const useNotesStore = defineStore('notes', () => {
  /** 元数据列表（F-523 正文分离）：不含正文，正文经 loadContent 按需读取 */
  const notes = ref<NoteMeta[]>([])
  /** 回收站中的笔记（F-204），init 时与列表一并加载 */
  const trashedNotes = ref<NoteMeta[]>([])
  const selectedId = ref<string | null>(null)
  const loaded = ref(false)
  /** 列表过滤态（F-201/F-205）：activeFolderId 为 null 表示「全部笔记」，activeTag 为 null 表示不按标签过滤 */
  const activeFolderId = ref<string | null>(null)
  const activeTag = ref<string | null>(null)

  const selectedNote = computed(() => notes.value.find((note) => note.id === selectedId.value) ?? null)

  /** 正文缓存（F-523）：只保留最近一篇（编辑器同时只打开一篇），loadContent 单飞防重复拉取 */
  let contentCache: { id: string; content: string } | null = null
  const contentPromises = new Map<string, Promise<string>>()

  /** 外部写入代数（F-501）：同步等外部来源重写了库内容时 +1，编辑器以其参与 :key 强制重建重读正文 */
  const contentEpoch = ref(0)

  function loadContent(id: string): Promise<string> {
    if (contentCache?.id === id) return Promise.resolve(contentCache.content)
    let pending = contentPromises.get(id)
    if (pending === undefined) {
      pending = noteRepository.getContent(id).then((content) => {
        contentCache = { id, content }
        contentPromises.delete(id)
        return content
      })
      contentPromises.set(id, pending)
    }
    return pending
  }

  /**
   * 外部来源（F-501 同步合并）改写了库数据后的联动：清空正文缓存与在途读取，
   * 并推进 contentEpoch 让挂载中的编辑器重建——否则编辑器草稿停留在旧正文，
   * 下次保存会以旧内容为基础覆盖远端写入。
   */
  async function noteExternalReload(): Promise<void> {
    contentCache = null
    contentPromises.clear()
    contentEpoch.value++
    await reload()
  }

  async function init(): Promise<void> {
    await reload()
  }

  async function reload(): Promise<void> {
    notes.value = await noteRepository.listActive()
    trashedNotes.value = await noteRepository.listTrashed()
    if (!notes.value.some((note) => note.id === selectedId.value)) {
      selectedId.value = notes.value[0]?.id ?? null
    }
    loaded.value = true
  }

  async function createNote(): Promise<void> {
    const now = Date.now()
    const note: NoteMeta = {
      id: createId(),
      title: '',
      excerpt: makeExcerpt(''),
      folderId: activeFolderId.value, // 在某个文件夹视图下新建 → 归入该文件夹（F-201）
      tags: [],
      pinned: false,
      trashed: false,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await noteRepository.saveWithContent(note, '')
    notes.value = [note, ...notes.value]
    selectedId.value = note.id
  }

  /**
   * 写通保存（编辑器自动保存路径）：元数据与正文同事务落库（excerpt 由 repository 统一重算）。
   * 「内容未变化跳过」的判定在编辑器侧完成（对比保存基线），此处只负责写入。
   */
  async function saveChanges(id: string, patch: { title: string; content: string }): Promise<void> {
    const note = notes.value.find((n) => n.id === id)
    if (!note) return
    note.title = patch.title
    note.excerpt = makeExcerpt(patch.content)
    note.updatedAt = Date.now()
    notes.value = [note, ...notes.value.filter((n) => n.id !== id)]
    await noteRepository.saveWithContent(note, patch.content)
    // 刚写入的正文进入缓存，编辑器随后的 loadContent 命中缓存
    contentCache = { id, content: patch.content }
  }

  /** F-202：整表写入标签（去重与解析由调用方完成）；无变化时跳过写库 */
  async function setTags(id: string, tags: string[]): Promise<void> {
    const note = notes.value.find((n) => n.id === id)
    if (!note) return
    if (note.tags.length === tags.length && note.tags.every((tag, index) => tag === tags[index])) return
    note.tags = tags
    note.updatedAt = Date.now()
    notes.value = [note, ...notes.value.filter((n) => n.id !== id)]
    await noteRepository.saveMeta(note)
  }

  /** F-203：置顶切换；已置顶的笔记经 sortNotesForList 排在列表最前 */
  async function togglePin(id: string): Promise<void> {
    const note = notes.value.find((n) => n.id === id)
    if (!note) return
    note.pinned = !note.pinned
    await noteRepository.saveMeta(note)
  }

  /** F-201：移动笔记到文件夹；folderId 传 null 表示移回未分类 */
  async function moveToFolder(id: string, folderId: string | null): Promise<void> {
    const note = notes.value.find((n) => n.id === id)
    if (!note) return
    if (note.folderId === folderId) return
    note.folderId = folderId
    await noteRepository.saveMeta(note)
  }

  async function softDelete(id: string): Promise<void> {
    await noteRepository.softDelete(id)
    notes.value = notes.value.filter((n) => n.id !== id)
    trashedNotes.value = await noteRepository.listTrashed()
    if (selectedId.value === id) selectedId.value = notes.value[0]?.id ?? null
  }

  /** F-204：从回收站恢复；folderId/tags/pinned 原样保留（由 repository.restore 保证） */
  async function restore(id: string): Promise<void> {
    await noteRepository.restore(id)
    await reload()
  }

  async function deleteForever(id: string): Promise<void> {
    await noteRepository.deleteForever(id)
    trashedNotes.value = trashedNotes.value.filter((note) => note.id !== id)
  }

  async function emptyTrash(): Promise<void> {
    await noteRepository.emptyTrash()
    trashedNotes.value = []
  }

  /** F-204：启动惰性清理——物理删除进入回收站超过 30 天的笔记（now 注入便于测试） */
  async function autopurge(now: number): Promise<void> {
    await noteRepository.purgeExpiredBefore(trashCutoff(now))
  }

  function setFolderFilter(folderId: string | null): void {
    activeFolderId.value = folderId
  }

  function toggleTagFilter(tag: string): void {
    activeTag.value = activeTag.value === tag ? null : tag
  }

  function select(id: string): void {
    selectedId.value = id
  }

  /** 文件夹被删除后的联动（folders store 调用）：清空指向它的过滤态并刷新列表 */
  async function onFolderDeleted(folderId: string): Promise<void> {
    if (activeFolderId.value === folderId) activeFolderId.value = null
    await reload()
  }

  return {
    notes,
    trashedNotes,
    selectedId,
    selectedNote,
    loaded,
    activeFolderId,
    activeTag,
    contentEpoch,
    loadContent,
    noteExternalReload,
    init,
    reload,
    createNote,
    saveChanges,
    setTags,
    togglePin,
    moveToFolder,
    softDelete,
    restore,
    deleteForever,
    emptyTrash,
    autopurge,
    setFolderFilter,
    toggleTagFilter,
    onFolderDeleted,
    select,
  }
})
