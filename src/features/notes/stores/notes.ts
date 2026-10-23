import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Note } from '@/types'
import { createId } from '@/lib/utils/id'
import { noteRepository } from '@/lib/db/repositories/noteRepository'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<Note[]>([])
  const selectedId = ref<string | null>(null)
  const loaded = ref(false)

  const selectedNote = computed(() => notes.value.find((note) => note.id === selectedId.value) ?? null)

  async function init(): Promise<void> {
    notes.value = await noteRepository.listActive()
    if (selectedId.value === null) selectedId.value = notes.value[0]?.id ?? null
    loaded.value = true
  }

  async function createNote(): Promise<void> {
    const now = Date.now()
    const note: Note = {
      id: createId(),
      title: '',
      content: '',
      folderId: null,
      tags: [],
      pinned: false,
      trashed: false,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await noteRepository.save(note)
    notes.value = [note, ...notes.value]
    selectedId.value = note.id
  }

  /** 写通保存：内容未变化时跳过，避免切换笔记时的空写 */
  async function saveChanges(id: string, patch: Pick<Note, 'title' | 'content'>): Promise<void> {
    const note = notes.value.find((n) => n.id === id)
    if (!note) return
    if (note.title === patch.title && note.content === patch.content) return
    note.title = patch.title
    note.content = patch.content
    note.updatedAt = Date.now()
    notes.value = [note, ...notes.value.filter((n) => n.id !== id)]
    await noteRepository.save(note)
  }

  async function softDelete(id: string): Promise<void> {
    await noteRepository.softDelete(id)
    notes.value = notes.value.filter((n) => n.id !== id)
    if (selectedId.value === id) selectedId.value = notes.value[0]?.id ?? null
  }

  function select(id: string): void {
    selectedId.value = id
  }

  return { notes, selectedId, selectedNote, loaded, init, createNote, saveChanges, softDelete, select }
})
