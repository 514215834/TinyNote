import { ref, reactive } from 'vue'
import { defineStore } from 'pinia'
import { buildAttachment } from '../attachments'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'

/**
 * 附件 store（F-303）：当前编辑中笔记的附件与 blob URL。
 * URL 与编辑器实例同生命周期：loadForNote 载入、release 释放（revokeObjectURL）。
 * 组件不直接触碰 attachmentRepository / URL API。
 */
export const useAttachmentsStore = defineStore('attachments', () => {
  /** 附件 id → blob URL（预览渲染时经 renderMarkdown 的 env 传入） */
  const urls = reactive<Record<string, string>>({})
  /** id → 元数据（体积等展示备用，当前未直接使用，保持与 urls 同步载入） */
  const list = reactive<Record<string, { name: string; size: number; mime: string }>>({})
  const loadedForNoteId = ref<string | null>(null)

  async function loadForNote(noteId: string): Promise<void> {
    if (loadedForNoteId.value === noteId) return
    release()
    for (const attachment of await attachmentRepository.listByNote(noteId)) {
      urls[attachment.id] = URL.createObjectURL(attachment.blob)
      list[attachment.id] = { name: attachment.name, size: attachment.size, mime: attachment.mime }
    }
    loadedForNoteId.value = noteId
  }

  /** 粘贴/拖入新图片：落库并登记 blob URL，返回要插入正文的附件 id（图片 Markdown 由调用方生成） */
  async function attach(noteId: string, file: File): Promise<string> {
    const attachment = buildAttachment(file, noteId)
    await attachmentRepository.save(attachment)
    urls[attachment.id] = URL.createObjectURL(attachment.blob)
    list[attachment.id] = { name: attachment.name, size: attachment.size, mime: attachment.mime }
    return attachment.id
  }

  /** 释放全部 blob URL（切换笔记卸载编辑器时调用） */
  function release(): void {
    for (const url of Object.values(urls)) URL.revokeObjectURL(url)
    for (const key of Object.keys(urls)) delete urls[key]
    for (const key of Object.keys(list)) delete list[key]
    loadedForNoteId.value = null
  }

  return { urls, list, loadedForNoteId, loadForNote, attach, release }
})
