<script setup lang="ts">
import { computed, ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { useNotesStore } from './stores/notes'
import { useSearchStore } from '@/features/search/stores/search'
import { filterNotes } from '@/features/search/search'
import { displayTitle, makeExcerpt } from './notes'
import { formatRelativeTime } from '@/lib/utils/time'

const notesStore = useNotesStore()
const searchStore = useSearchStore()

// 搜索输入防抖 200ms（架构文档 §8），避免大列表下的高频过滤
const keyword = ref('')
watchDebounced(keyword, (value) => searchStore.set(value.trim()), { debounce: 200 })

const visibleNotes = computed(() => filterNotes(notesStore.notes, searchStore.query))

function removeNote(id: string, title: string): void {
  if (window.confirm(`删除「${title}」？`)) void notesStore.softDelete(id)
}
</script>

<template>
  <aside
    class="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
  >
    <div class="space-y-2 p-3">
      <button
        type="button"
        class="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        @click="notesStore.createNote()"
      >
        + 新建笔记
      </button>
      <input
        v-model="keyword"
        type="search"
        placeholder="搜索笔记…"
        aria-label="搜索笔记"
        class="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-gray-400 focus:border-gray-400 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-500"
      />
    </div>
    <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="笔记列表">
      <p
        v-if="visibleNotes.length === 0"
        class="px-2 py-8 text-center text-sm text-gray-400 dark:text-neutral-500"
      >
        {{ notesStore.notes.length === 0 ? '还没有笔记' : '没有匹配的笔记' }}
      </p>
      <div
        v-for="note in visibleNotes"
        :key="note.id"
        :class="
          note.id === notesStore.selectedId
            ? 'bg-gray-100 dark:bg-neutral-800'
            : 'hover:bg-gray-50 dark:hover:bg-neutral-800/60'
        "
        class="group relative cursor-pointer rounded-lg px-3 py-2"
        @click="notesStore.select(note.id)"
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="truncate text-sm font-medium">{{ displayTitle(note) }}</span>
          <span class="shrink-0 text-[11px] text-gray-400 group-hover:hidden dark:text-neutral-500">
            {{ formatRelativeTime(note.updatedAt) }}
          </span>
        </div>
        <p class="mt-0.5 truncate text-xs text-gray-500 dark:text-neutral-400">
          {{ makeExcerpt(note.content) }}
        </p>
        <button
          type="button"
          title="删除笔记"
          aria-label="删除笔记"
          class="absolute right-3 top-2.5 hidden rounded p-1 text-gray-400 hover:text-red-500 group-hover:block dark:text-neutral-500"
          @click.stop="removeNote(note.id, displayTitle(note))"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </nav>
  </aside>
</template>
