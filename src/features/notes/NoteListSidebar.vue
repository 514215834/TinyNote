<script setup lang="ts">
import { computed, ref, nextTick, watch, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener, watchDebounced } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { Folder, NoteMeta } from '@/types'
import { t } from '@/lib/i18n'
import { useNotesStore } from './stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import { useSearchStore } from '@/features/search/stores/search'
import { filterByFolder, filterByTag, filterNotes } from '@/features/search/search'
import { highlightSegments } from '@/features/search/highlight'
import { collectTags } from '@/features/tags/tags'
import { displayTitle, sortNotesForList } from './notes'
import { ESTIMATED_ROW_HEIGHT, shouldVirtualize } from './virtualList'
import { formatRelativeTime } from '@/lib/utils/time'

const router = useRouter()
const notesStore = useNotesStore()
const foldersStore = useFoldersStore()
const searchStore = useSearchStore()

// 搜索输入防抖 200ms（架构文档 §8）。与 Ctrl+K 面板共用全局搜索词：面板修改时回写输入框
const keyword = ref('')
watchDebounced(keyword, (value) => searchStore.set(value.trim()), { debounce: 200 })
watch(
  () => searchStore.query,
  (value) => {
    if (value !== keyword.value.trim()) keyword.value = value
  },
)

// 过滤流水线：文件夹 → 标签 → 搜索 → 置顶优先（F-201/F-202/F-205/F-203）。
// F-524：标题/摘要即时过滤 + 正文异步命中并入（扫描完成后列表渐进更新，无功能回退）
const visibleNotes = computed(() => {
  const base = filterByTag(filterByFolder(notesStore.notes, notesStore.activeFolderId), notesStore.activeTag)
  const query = searchStore.query.trim()
  if (query === '') return sortNotesForList(base)
  const metaHits = filterNotes(base, query)
  const metaIds = new Set(metaHits.map((note) => note.id))
  const contentHits = base.filter((note) => !metaIds.has(note.id) && searchStore.contentHitIds.has(note.id))
  return sortNotesForList([...metaHits, ...contentHits])
})

const tags = computed(() => collectTags(notesStore.notes))
const totalNotes = computed(() => notesStore.notes.length)

function countIn(folderId: string): number {
  return notesStore.notes.filter((note) => note.folderId === folderId).length
}

const isFiltering = computed(() => searchStore.query !== '' || notesStore.activeTag !== null)

const listEmptyText = computed(() =>
  isFiltering.value
    ? t('sidebar.noMatch')
    : notesStore.activeFolderId === null
      ? t('sidebar.emptyAll')
      : t('sidebar.emptyFolder'),
)

const inTrash = computed(() => router.currentRoute.value.name === 'trash')

function openNotesView(): void {
  if (inTrash.value) void router.push({ name: 'notes' })
}

async function createNote(): Promise<void> {
  openNotesView()
  await notesStore.createNote()
}

function selectNote(note: NoteMeta): void {
  notesStore.select(note.id)
  openNotesView()
}

/** 切换文件夹（F-201）：选中态跟随列表首位，避免编辑器停留在不可见的笔记上 */
function applyFolder(folderId: string | null): void {
  notesStore.setFolderFilter(folderId)
  notesStore.select(visibleNotes.value[0]?.id ?? null)
  openNotesView()
}

function toggleTag(tag: string): void {
  notesStore.toggleTagFilter(tag)
  notesStore.select(visibleNotes.value[0]?.id ?? null)
  openNotesView()
}

function removeNote(note: NoteMeta): void {
  if (window.confirm(t('common.confirmDeleteNote', { title: displayTitle(note) }))) {
    void notesStore.softDelete(note.id)
  }
}

function togglePin(note: NoteMeta): void {
  void notesStore.togglePin(note.id)
}

/** F-201：菜单移动笔记（点击菜单外任意位置收起，菜单内按钮已 stopPropagation） */
const movingMenuId = ref<string | null>(null)
function moveNote(note: NoteMeta, folderId: string | null): void {
  movingMenuId.value = null
  void notesStore.moveToFolder(note.id, folderId)
}
useEventListener(document, 'click', () => {
  movingMenuId.value = null
})

/** F-201：拖拽移动笔记 */
const dragNoteId = ref<string | null>(null)
function onDrop(folderId: string | null): void {
  if (dragNoteId.value === null) return
  void notesStore.moveToFolder(dragNoteId.value, folderId)
  dragNoteId.value = null
}

/** F-201 文件夹管理：新建 / 重命名（内联输入）/ 删除 */
const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = useTemplateRef<HTMLInputElement>('newFolderInput')
watch(creatingFolder, async (open) => {
  if (open) {
    await nextTick()
    newFolderInput.value?.focus()
  }
})
function commitNewFolder(): void {
  if (newFolderName.value.trim()) void foldersStore.create(newFolderName.value)
  creatingFolder.value = false
  newFolderName.value = ''
}
function cancelNewFolder(): void {
  creatingFolder.value = false
  newFolderName.value = ''
}

const renamingFolderId = ref<string | null>(null)
const renamingName = ref('')
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')
watch(renamingFolderId, async (id) => {
  if (id !== null) {
    await nextTick()
    renameInput.value?.focus()
  }
})
function startRename(folder: Folder): void {
  renamingFolderId.value = folder.id
  renamingName.value = folder.name
}
function commitRename(): void {
  const folderId = renamingFolderId.value
  renamingFolderId.value = null
  if (folderId === null) return
  void foldersStore.rename(folderId, renamingName.value)
}
function renameKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  }
  if (event.key === 'Escape') renamingFolderId.value = null
}
function removeFolder(folder: Folder): void {
  if (window.confirm(t('sidebar.deleteFolderConfirm', { name: folder.name }))) {
    void foldersStore.remove(folder.id)
  }
}

/* F-604 长列表虚拟化：超过阈值才启用动态测量虚拟滚动，之下保持普通 v-for */
const listNav = useTemplateRef<HTMLElement>('listNav')
const virtualizerOptions = computed(() => ({
  count: visibleNotes.value.length,
  getScrollElement: () => listNav.value ?? null,
  estimateSize: () => ESTIMATED_ROW_HEIGHT,
  overscan: 8,
  getItemKey: (index: number) => visibleNotes.value[index]?.id ?? index,
}))
const rowVirtualizer = useVirtualizer(virtualizerOptions)
const virtualRows = computed(() =>
  shouldVirtualize(visibleNotes.value.length) ? rowVirtualizer.value.getVirtualItems() : [],
)
const totalListSize = computed(() =>
  shouldVirtualize(visibleNotes.value.length) ? rowVirtualizer.value.getTotalSize() : 0,
)
function measureRow(el: unknown): void {
  if (el instanceof HTMLElement) void rowVirtualizer.value.measureElement(el)
}

/** 归一化行模型：虚拟化（绝对定位 + translateY）与普通流共用同一套行标记 */
interface ListItemRow {
  note: NoteMeta
  index: number
  virtual: boolean
  size?: number
  start?: number
}
const listRows = computed<ListItemRow[]>(() => {
  if (!shouldVirtualize(visibleNotes.value.length)) {
    return visibleNotes.value.map((note, index) => ({ note, index, virtual: false }))
  }
  return virtualRows.value.flatMap((virtualRow) => {
    const note = visibleNotes.value[virtualRow.index]
    return note === undefined
      ? []
      : [{ note, index: virtualRow.index, virtual: true, size: virtualRow.size, start: virtualRow.start }]
  })
})
</script>

<template>
  <aside class="glass flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl">
    <div class="space-y-2 p-3">
      <button
        type="button"
        class="w-full rounded-xl bg-gradient-to-r from-accent to-accent-strong px-3 py-2 text-sm font-medium text-white shadow-sm shadow-accent/30 transition-all hover:shadow-md hover:shadow-accent/40 hover:brightness-110 active:scale-[0.99]"
        @click="createNote()"
      >
        {{ t('sidebar.newNote') }}
      </button>
      <input
        v-model="keyword"
        type="search"
        :placeholder="t('sidebar.searchPlaceholder')"
        :aria-label="t('sidebar.searchAria')"
        data-note-search
        class="w-full rounded-full border border-gray-900/10 bg-white/50 px-3.5 py-1.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-accent/60 focus:bg-white/80 focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-500 dark:focus:border-accent/50 dark:focus:bg-white/10"
      />
    </div>

    <!-- 文件夹（F-201，仅一层） -->
    <nav class="px-2 pb-1" aria-label="文件夹">
      <div
        :class="notesStore.activeFolderId === null ? 'bg-white/80 shadow-sm dark:bg-white/10' : 'hover:bg-white/50 dark:hover:bg-white/5'"
        class="group cursor-pointer rounded-xl px-3 py-1.5 text-sm transition-colors"
        @dragover.prevent
        @drop="onDrop(null)"
        @click="applyFolder(null)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ t('sidebar.allNotes') }}</span>
          <span class="text-[11px] text-gray-400">{{ totalNotes }}</span>
        </div>
      </div>
      <div
        v-for="folder in foldersStore.folders"
        :key="folder.id"
        :class="notesStore.activeFolderId === folder.id ? 'bg-white/80 shadow-sm dark:bg-white/10' : 'hover:bg-white/50 dark:hover:bg-white/5'"
        class="group/f relative cursor-pointer rounded-xl px-3 py-1.5 text-sm transition-colors"
        @dragover.prevent
        @drop="onDrop(folder.id)"
        @click="applyFolder(folder.id)"
      >
        <input
          v-if="renamingFolderId === folder.id"
          ref="renameInput"
          v-model="renamingName"
          :aria-label="t('sidebar.renameFolderAria')"
          class="w-full rounded border border-gray-300 bg-transparent px-1 py-0.5 text-sm outline-none dark:border-neutral-600"
          @blur="commitRename"
          @keydown="renameKeydown"
        />
        <template v-else>
          <div class="flex items-center justify-between gap-2">
            <span class="truncate">{{ folder.name }}</span>
            <span class="text-[11px] text-gray-400 group-hover/f:hidden">{{ countIn(folder.id) }}</span>
          </div>
          <div
            class="absolute right-2 top-1.5 hidden gap-1 group-hover/f:flex"
          >
            <button
              type="button"
              :title="t('sidebar.rename')"
              :aria-label="t('sidebar.renameFolderAria')"
              class="rounded p-1 text-gray-400 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-200"
              @click.stop="startRename(folder)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            <button
              type="button"
              :title="t('sidebar.deleteFolder')"
              :aria-label="t('sidebar.deleteFolder')"
              class="rounded p-1 text-gray-400 hover:text-red-500 dark:text-neutral-500"
              @click.stop="removeFolder(folder)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
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
        </template>
      </div>
      <div v-if="creatingFolder" class="px-2 py-1">
        <input
          ref="newFolderInput"
          v-model="newFolderName"
          :placeholder="t('sidebar.folderPlaceholder')"
          :aria-label="t('sidebar.newFolderAria')"
          class="w-full rounded border border-gray-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-neutral-600"
          @keydown.enter.prevent="commitNewFolder"
          @keydown.escape="cancelNewFolder"
          @blur="commitNewFolder"
        />
      </div>
      <button
        v-else
        type="button"
        class="w-full rounded-lg px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-50 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
        @click="creatingFolder = true"
      >
        {{ t('sidebar.newFolder') }}
      </button>
    </nav>

    <!-- 标签云（F-202），点击过滤 -->
    <div v-if="tags.length > 0" class="border-t border-gray-900/8 px-3 py-2 dark:border-white/8">
      <p class="mb-1.5 text-[11px] font-medium text-gray-400">{{ t('sidebar.tags') }}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="item in tags"
          :key="item.tag"
          type="button"
          :class="
            notesStore.activeTag === item.tag
              ? 'bg-gradient-to-r from-accent to-accent-strong text-white shadow-sm shadow-accent/30'
              : 'bg-white/60 text-gray-600 hover:bg-white/90 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15'
          "
          class="rounded-full px-2.5 py-0.5 text-xs transition-colors"
          @click="toggleTag(item.tag)"
        >
          {{ item.tag }}
          <span class="opacity-60">{{ item.count }}</span>
        </button>
      </div>
    </div>

    <!-- 笔记列表（F-604：超过阈值启用虚拟滚动，之下普通流式渲染；两态共用同一行标记） -->
    <nav ref="listNav" class="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2" :aria-label="t('sidebar.listAria')">
      <p v-if="isFiltering" class="px-3 pb-1 text-[11px] text-gray-400" aria-live="polite">
        {{ t('sidebar.resultCount', { n: visibleNotes.length }) }}
      </p>
      <p
        v-if="visibleNotes.length === 0"
        class="px-3 py-8 text-center text-sm text-gray-400 dark:text-neutral-500"
      >
        {{ listEmptyText }}
      </p>
      <div
        class="relative"
        :style="totalListSize > 0 ? { height: `${totalListSize}px` } : undefined"
      >
        <div
          v-for="row in listRows"
          :key="row.note.id"
          :ref="row.virtual ? measureRow : undefined"
          :data-index="row.virtual ? row.index : undefined"
          :style="
            row.virtual
              ? {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start ?? 0}px)`,
                  height: `${row.size ?? 0}px`,
                }
              : undefined
          "
          :class="
            row.note.id === notesStore.selectedId
              ? 'bg-white/85 shadow-sm ring-1 ring-accent/30 dark:bg-white/10 dark:ring-accent/25'
              : 'hover:bg-white/55 dark:hover:bg-white/5'
          "
          class="group relative cursor-pointer rounded-xl px-3 py-2 transition-colors"
          draggable="true"
          @dragstart="dragNoteId = row.note.id"
          @dragend="dragNoteId = null"
          @click="selectNote(row.note)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="flex min-w-0 items-center gap-1">
              <!-- F-203：置顶标识常显 -->
              <svg
                v-if="row.note.pinned"
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="shrink-0 text-amber-500"
                :aria-label="t('sidebar.pinnedAria')"
              >
                <path d="M12 17v5" />
                <path
                  d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.36V17h14v-1.64a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 1 2 2v2"
                />
              </svg>
              <span class="truncate text-sm font-medium">
                <template
                  v-for="(segment, index) in highlightSegments(displayTitle(row.note), searchStore.query)"
                  :key="index"
                >
                  <mark v-if="segment.hit" class="bg-amber-200 text-inherit dark:bg-amber-700/50">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
            </span>
          </div>
          <p class="mt-0.5 truncate text-xs text-gray-500 group-hover:hidden dark:text-neutral-400">
            <template
              v-for="(segment, index) in highlightSegments(row.note.excerpt, searchStore.query)"
              :key="index"
            >
              <mark v-if="segment.hit" class="bg-amber-200 text-inherit dark:bg-amber-700/50">{{ segment.text }}</mark>
              <template v-else>{{ segment.text }}</template>
            </template>
          </p>
          <p class="mt-0.5 hidden truncate text-[11px] text-gray-400 group-hover:block dark:text-neutral-500">
            {{ formatRelativeTime(row.note.updatedAt) }}
          </p>
          <!-- 悬停操作：置顶 / 移动 / 删除（F-203/F-201/F-101） -->
          <div class="absolute right-2 top-2 hidden items-center gap-0.5 group-hover:flex">
            <button
              type="button"
              :title="row.note.pinned ? t('common.unpin') : t('common.pin')"
              :aria-label="row.note.pinned ? t('common.unpin') : t('common.pin')"
              class="rounded p-1 text-gray-400 hover:text-amber-500 dark:text-neutral-500"
              @click.stop="togglePin(row.note)"
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
                <path d="M12 17v5" />
                <path
                  d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.36V17h14v-1.64a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 1 2 2v2"
                />
              </svg>
            </button>
            <button
              type="button"
              :title="t('sidebar.moveToFolder')"
              :aria-label="t('sidebar.moveToFolder')"
              class="rounded p-1 text-gray-400 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-200"
              @click.stop="movingMenuId = movingMenuId === row.note.id ? null : row.note.id"
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
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
            </button>
            <button
              type="button"
              :title="t('sidebar.deleteNote')"
              :aria-label="t('sidebar.deleteNote')"
              class="rounded p-1 text-gray-400 hover:text-red-500 dark:text-neutral-500"
              @click.stop="removeNote(row.note)"
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
          <!-- 移动菜单（F-201）：列出全部文件夹与「未分类」 -->
          <div
            v-if="movingMenuId === row.note.id"
            class="glass-strong absolute right-2 top-9 z-10 w-40 rounded-xl py-1"
            role="menu"
            :aria-label="t('sidebar.moveToFolder')"
            @click.stop
          >
            <button
              type="button"
              class="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-900/5 dark:hover:bg-white/8"
              role="menuitem"
              @click="moveNote(row.note, null)"
            >
              {{ t('common.uncategorized') }}
            </button>
            <button
              v-for="folder in foldersStore.folders"
              :key="folder.id"
              type="button"
              class="w-full truncate px-3 py-1.5 text-left text-xs hover:bg-gray-900/5 dark:hover:bg-white/8"
              role="menuitem"
              @click="moveNote(row.note, folder.id)"
            >
              {{ folder.name }}
            </button>
          </div>
        </div>
      </div>
    </nav>

    <!-- 回收站入口（F-204） -->
    <div class="shrink-0 border-t border-gray-900/8 px-2 py-2 dark:border-white/8">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-sm transition-colors"
        :class="inTrash ? 'bg-white/80 shadow-sm dark:bg-white/10' : 'hover:bg-white/55 dark:hover:bg-white/5'"
        :aria-label="t('sidebar.openTrashAria')"
        @click="router.push({ name: 'trash' })"
      >
        <span class="flex items-center gap-2">
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
            class="text-gray-400"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {{ t('sidebar.trash') }}
        </span>
        <span class="text-[11px] text-gray-400">{{ notesStore.trashedNotes.length }}</span>
      </button>
    </div>
  </aside>
</template>
