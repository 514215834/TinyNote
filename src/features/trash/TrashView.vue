<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useNotesStore } from '@/features/notes/stores/notes'
import { displayTitle } from '@/features/notes/notes'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/time'

const router = useRouter()
const notesStore = useNotesStore()

/** F-204：恢复后笔记回到原文件夹且标签完整（repository.restore 只清软删标记） */
async function restore(id: string): Promise<void> {
  await notesStore.restore(id)
}

function removeForever(id: string, title: string): void {
  if (window.confirm(`彻底删除「${title}」？此操作不可恢复。`)) void notesStore.deleteForever(id)
}

function emptyTrash(): void {
  if (notesStore.trashedNotes.length === 0) return
  if (window.confirm('清空回收站？其中所有笔记将被彻底删除。')) void notesStore.emptyTrash()
}
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col">
    <header
      class="flex shrink-0 items-center gap-3 border-b border-gray-900/8 px-6 py-3 dark:border-white/8"
    >
      <button
        type="button"
        aria-label="返回笔记"
        title="返回笔记"
        class="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/60 dark:text-neutral-400 dark:hover:bg-white/8"
        @click="router.push({ name: 'notes' })"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="text-base font-semibold">回收站</h1>
      <span class="text-xs text-gray-400">{{ notesStore.trashedNotes.length }} 条</span>
      <button
        type="button"
        class="ml-auto rounded-full border border-gray-900/10 bg-white/60 px-3.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
        :disabled="notesStore.trashedNotes.length === 0"
        @click="emptyTrash"
      >
        清空回收站
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <p
        v-if="notesStore.trashedNotes.length === 0"
        class="py-16 text-center text-sm text-gray-400 dark:text-neutral-500"
      >
        回收站是空的
      </p>
      <ul v-else class="space-y-1">
        <li
          v-for="note in notesStore.trashedNotes"
          :key="note.id"
          class="flex items-center gap-4 rounded-xl border border-gray-900/8 bg-white/45 px-4 py-3 shadow-sm transition-colors hover:bg-white/70 dark:border-white/8 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ displayTitle(note) }}</p>
            <p class="mt-0.5 text-xs text-gray-400 dark:text-neutral-500">
              删除于 {{ formatRelativeTime(note.trashedAt ?? note.updatedAt) }} ·
              {{ formatDateTime(note.trashedAt ?? note.updatedAt) }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-full border border-gray-900/10 bg-white/60 px-3 py-1 text-xs transition-colors hover:bg-white/95 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            @click="restore(note.id)"
          >
            恢复
          </button>
          <button
            type="button"
            class="shrink-0 rounded-full border border-red-500/25 bg-red-500/5 px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/12 dark:border-red-400/25 dark:hover:bg-red-400/10"
            @click="removeForever(note.id, displayTitle(note))"
          >
            彻底删除
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
