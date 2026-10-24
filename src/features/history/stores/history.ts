import { reactive } from 'vue'
import { defineStore } from 'pinia'
import type { Note, NoteSnapshot } from '@/types'
import { createId } from '@/lib/utils/id'
import { snapshotRepository } from '@/lib/db/repositories/snapshotRepository'
import { shouldAutoSnapshot, splitByLimit } from '../history'
import { useNotesStore } from '@/features/notes/stores/notes'

/**
 * 历史版本 store（F-402）：
 * - 自动快照挂在编辑器自动保存之后（NoteEditor 持久化回调），口径见 history.ts；
 * - 快照列表按笔记惰性加载（打开编辑器或首次保存时），避免启动即全量拉取；
 * - 回滚前把「当前内容」先存为快照，恢复动作本身可再撤销。
 */
export const useHistoryStore = defineStore('history', () => {
  /** noteId → 该笔记快照（最新在前）；未加载的笔记无对应键 */
  const lists = reactive<Record<string, NoteSnapshot[]>>({})

  /** 面板/清理所需的列表按需加载；已加载则跳过 */
  async function ensureLoaded(noteId: string): Promise<void> {
    if (lists[noteId] !== undefined) return
    lists[noteId] = await snapshotRepository.listByNote(noteId)
  }

  /** 全部快照内容（供孤儿附件清理判定引用）；未加载时返回 undefined，调用方应跳过清理以防误删 */
  function contents(noteId: string): string[] | undefined {
    return lists[noteId]?.map((snapshot) => snapshot.content)
  }

  function snapshotOf(noteId: string, snapshotId: string): NoteSnapshot | undefined {
    return lists[noteId]?.find((snapshot) => snapshot.id === snapshotId)
  }

  async function createSnapshotEntry(noteId: string, content: string): Promise<void> {
    const snapshot: NoteSnapshot = { id: createId(), noteId, content, createdAt: Date.now() }
    await snapshotRepository.save(snapshot)
    const next = [snapshot, ...(lists[noteId] ?? [])]
    const { keep, overflow } = splitByLimit(next)
    await snapshotRepository.deleteByIds(overflow.map((row) => row.id))
    lists[noteId] = keep
  }

  /** 自动快照（自动保存后调用）：按 shouldAutoSnapshot 口径判断，命中才落库 */
  async function maybeAutoSnapshot(noteId: string, content: string): Promise<boolean> {
    await ensureLoaded(noteId)
    if (!shouldAutoSnapshot((lists[noteId] ?? []).map((row) => row.content), content)) return false
    await createSnapshotEntry(noteId, content)
    return true
  }

  /** 手动快照（面板「存为快照」按钮）：不做过阈判断，用户意图优先 */
  async function createManualSnapshot(noteId: string, content: string): Promise<void> {
    await ensureLoaded(noteId)
    await createSnapshotEntry(noteId, content)
  }

  /**
   * 回滚（F-402）：把笔记内容替换为快照内容并走正常保存路径（updatedAt 刷新、列表重排）。
   * 返回恢复后的内容供编辑器同步草稿；无可恢复对象或内容未变化时返回 null。
   */
  async function restoreSnapshot(note: Note, snapshotId: string): Promise<string | null> {
    await ensureLoaded(note.id)
    const target = snapshotOf(note.id, snapshotId)
    if (!target || target.content === note.content) return null
    await createSnapshotEntry(note.id, note.content) // 回滚前的现状先存档，恢复可再撤销
    await useNotesStore().saveChanges(note.id, { title: note.title, content: target.content })
    return target.content
  }

  return {
    lists,
    ensureLoaded,
    contents,
    snapshotOf,
    maybeAutoSnapshot,
    createManualSnapshot,
    restoreSnapshot,
  }
})
