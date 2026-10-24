<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { watchDebounced } from '@vueuse/core'
import type { NoteMeta } from '@/types'
import { t } from '@/lib/i18n'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useSearchStore } from '@/features/search/stores/search'
import { useCommandRegistry, type Command } from '@/features/commands/registry'
import { filterNotes } from '@/features/search/search'
import { highlightSegments } from '@/features/search/highlight'
import { displayTitle } from '@/features/notes/notes'
import { formatRelativeTime } from '@/lib/utils/time'

/**
 * Ctrl+K / Ctrl+P 全局搜索面板（F-524/F-603）：搜索标题/标签/摘要（内存即时）+ 正文（异步流式
 * 扫描或倒排索引，F-604），空查询展示最近笔记与命令（经命令注册表，F-603 插件化入口）。
 * 结果高亮复用 highlightSegments（无 v-html，ADR-006）。
 */
const router = useRouter()
const notesStore = useNotesStore()
const searchStore = useSearchStore()
const commandRegistry = useCommandRegistry()

const input = useTemplateRef<HTMLInputElement>('paletteInput')
const resultsEl = useTemplateRef<HTMLUListElement>('resultsEl')
const keyword = ref('')

// 打开时聚焦并带入当前全局搜索词（与侧栏搜索框共用同一搜索状态）
watch(
  () => searchStore.paletteOpen,
  async (open) => {
    if (!open) return
    keyword.value = searchStore.query
    activeIndex.value = 0
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)

// 输入防抖 200ms（架构文档 §8）→ store.set：触发元数据过滤与正文扫描
watchDebounced(keyword, (value) => searchStore.set(value), { debounce: 200 })

interface NoteItem {
  kind: 'note'
  note: NoteMeta
  snippet: string | null
}
interface CommandItem {
  kind: 'command'
  command: Command
}
type Item = NoteItem | CommandItem

const RESULT_LIMIT = 20
/** 标题/摘要命中最多展示数，其余名额让给正文命中（宽查询下两边都能露出） */
const META_CAP = 12

/** 命令匹配：标题 + 额外 keywords（大小写不敏感的包含匹配） */
function matchCommand(command: Command, query: string): boolean {
  const haystack = `${command.title()} ${command.keywords ?? ''}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}

const items = computed<Item[]>(() => {
  const query = searchStore.query.trim()
  if (query === '') {
    const recent: Item[] = notesStore.notes
      .slice(0, 8)
      .map((note) => ({ kind: 'note' as const, note, snippet: null }))
    const commands: Item[] = commandRegistry.commands.map((command) => ({
      kind: 'command' as const,
      command,
    }))
    return [...recent, ...commands]
  }
  const commandPart: Item[] = commandRegistry.commands
    .filter((command) => matchCommand(command, query))
    .map((command) => ({ kind: 'command' as const, command }))
  const metaHits = filterNotes(notesStore.notes, query)
  const metaIds = new Set(metaHits.map((note) => note.id))
  const metaPart = metaHits.slice(0, META_CAP).map((note) => ({ kind: 'note' as const, note, snippet: null }))
  const contentPart = searchStore.contentHits
    .filter((hit) => !metaIds.has(hit.id))
    .slice(0, RESULT_LIMIT - metaPart.length)
    .flatMap((hit) => {
      const note = notesStore.notes.find((candidate) => candidate.id === hit.id)
      return note === undefined ? [] : [{ kind: 'note' as const, note, snippet: hit.snippet }]
    })
  return [...commandPart, ...metaPart, ...contentPart]
})

const activeIndex = ref(0)
watch(items, () => {
  activeIndex.value = 0
})
watch(activeIndex, async () => {
  await nextTick()
  resultsEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, items.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void activate(items.value[activeIndex.value])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    searchStore.closePalette()
  }
}

async function activate(item: Item | undefined): Promise<void> {
  if (!item) return
  searchStore.closePalette()
  if (item.kind === 'note') {
    if (router.currentRoute.value.name !== 'notes') await router.push({ name: 'notes' })
    notesStore.select(item.note.id)
    return
  }
  await item.command.run()
}

const emptyText = computed(() => {
  if (searchStore.query.trim() === '') return t('palette.emptyHint')
  return searchStore.scanning ? t('palette.searching') : t('sidebar.noMatch')
})
</script>

<template>
  <div
    v-if="searchStore.paletteOpen"
    class="fixed inset-0 z-40 overflow-y-auto bg-gray-950/25 backdrop-blur-sm dark:bg-black/40"
    @click.self="searchStore.closePalette()"
  >
    <div
      class="glass-strong mx-auto mt-[12vh] w-[min(38rem,92vw)] overflow-hidden rounded-2xl shadow-xl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('palette.dialogAria')"
    >
      <div class="flex items-center gap-2.5 border-b border-gray-900/8 px-4 py-3 dark:border-white/8">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="shrink-0 text-gray-400"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref="paletteInput"
          v-model="keyword"
          type="text"
          :placeholder="t('palette.placeholder')"
          :aria-label="t('palette.dialogAria')"
          class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-neutral-500"
          @keydown="onKeydown"
        />
        <button
          type="button"
          class="shrink-0 rounded border border-gray-900/10 px-1.5 py-0.5 text-[10px] text-gray-400 dark:border-white/10"
          :aria-label="t('palette.closeAria')"
          @click="searchStore.closePalette()"
        >
          Esc
        </button>
      </div>
      <ul ref="resultsEl" class="max-h-[52vh] overflow-y-auto py-1" role="listbox" :aria-label="t('palette.resultsAria')">
        <li v-if="items.length === 0" class="px-4 py-8 text-center text-xs text-gray-400" aria-live="polite">
          {{ emptyText }}
        </li>
        <li
          v-for="(item, index) in items"
          :key="item.kind === 'note' ? item.note.id : item.command.id"
          role="option"
          :aria-selected="index === activeIndex"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors"
            :class="
              index === activeIndex
                ? 'bg-white/85 dark:bg-white/10'
                : 'hover:bg-white/50 dark:hover:bg-white/5'
            "
            :data-active="index === activeIndex ? 'true' : undefined"
            @mouseenter="activeIndex = index"
            @click="activate(item)"
          >
            <template v-if="item.kind === 'note'">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  <template
                    v-for="(segment, i) in highlightSegments(displayTitle(item.note), searchStore.query)"
                    :key="i"
                  >
                    <mark v-if="segment.hit" class="bg-amber-200 text-inherit dark:bg-amber-700/50">{{ segment.text }}</mark>
                    <template v-else>{{ segment.text }}</template>
                  </template>
                </p>
                <p v-if="item.snippet !== null" class="truncate text-xs text-gray-500 dark:text-neutral-400">
                  <template v-for="(segment, i) in highlightSegments(item.snippet, searchStore.query)" :key="i">
                    <mark v-if="segment.hit" class="bg-amber-200 text-inherit dark:bg-amber-700/50">{{ segment.text }}</mark>
                    <template v-else>{{ segment.text }}</template>
                  </template>
                </p>
              </div>
              <span class="shrink-0 text-[10px] text-gray-400">{{ formatRelativeTime(item.note.updatedAt) }}</span>
            </template>
            <template v-else>
              <span class="flex-1 text-sm">{{ item.command.title() }}</span>
              <span v-if="item.command.hint" class="shrink-0 text-[10px] text-gray-400">{{ item.command.hint }}</span>
            </template>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
