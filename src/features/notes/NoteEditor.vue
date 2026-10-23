<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { Note } from '@/types'
import { renderMarkdown } from '@/lib/markdown/render'
import { useAutoSave } from './composables/useAutoSave'
import { useHotkeys } from '@/composables/shortcuts'
import { addTag, removeTag } from '@/features/tags/tags'
import { countChars, countWords } from './stats'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/time'
import { useNotesStore } from './stores/notes'

type EditorMode = 'edit' | 'split' | 'preview'

const props = defineProps<{ note: Note }>()

const notesStore = useNotesStore()

const modes: { value: EditorMode; label: string }[] = [
  { value: 'edit', label: '编辑' },
  { value: 'split', label: '分栏' },
  { value: 'preview', label: '预览' },
]

const mode = ref<EditorMode>('edit')
const title = ref(props.note.title)
const content = ref(props.note.content)
const titleInput = useTemplateRef<HTMLInputElement>('titleInput')

// 草稿保存在本地响应式引用；持久化由 useAutoSave 调度（防抖 + 失焦 + 关页兜底），
// persist 调用时才读取 title/content，因此切换笔记前的待写内容也能被正确保存
const { schedule, flush, status } = useAutoSave(async () => {
  await notesStore.saveChanges(props.note.id, { title: title.value, content: content.value })
})

watch([title, content], () => schedule())

onMounted(() => {
  // 新建的空笔记直接聚焦标题
  if (props.note.title === '' && props.note.content === '') titleInput.value?.focus()
})

useEventListener(window, 'beforeunload', () => {
  // 尽力保存：IndexedDB 写入不保证在页面卸载前完成，失焦保存是主路径
  void flush()
})
useEventListener(window, 'pagehide', () => {
  void flush()
})

// F-206：Ctrl+E 在编辑与预览两种状态间切换
function togglePreview(): void {
  mode.value = mode.value === 'preview' ? 'edit' : 'preview'
}
useHotkeys([{ combo: 'ctrl+e', handler: togglePreview }])

// 编辑模式下跳过渲染，避免无预览时白算 Markdown
const html = computed(() => (mode.value === 'edit' ? '' : renderMarkdown(content.value)))

const statusText = computed(() => {
  switch (status.value) {
    case 'saving':
      return '保存中…'
    case 'saved':
      return '已保存'
    case 'error':
      return '保存失败'
    default:
      return ''
  }
})

// F-202：标签在编辑器内增删，store.setTags 即时落库（不参与防抖草稿）
const tagDraft = ref('')
function commitTagInput(): void {
  const raw = tagDraft.value
  tagDraft.value = ''
  if (!raw.trim()) return
  void notesStore.setTags(props.note.id, addTag(props.note.tags, raw))
}
function removeNoteTag(tag: string): void {
  void notesStore.setTags(props.note.id, removeTag(props.note.tags, tag))
}

// F-203：置顶
function togglePin(): void {
  void notesStore.togglePin(props.note.id)
}

// F-207：字数/字符数统计
const stats = computed(() => ({ words: countWords(content.value), chars: countChars(content.value) }))
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center gap-4 border-b border-gray-200 px-6 py-3 dark:border-neutral-800"
    >
      <input
        ref="titleInput"
        v-model="title"
        placeholder="无标题笔记"
        aria-label="笔记标题"
        class="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-gray-400 dark:placeholder:text-neutral-600"
        @blur="flush()"
      />
      <button
        type="button"
        class="shrink-0 rounded-lg p-2 text-gray-400 hover:text-amber-500 dark:text-neutral-500"
        :class="{ 'text-amber-500': props.note.pinned }"
        :title="props.note.pinned ? '取消置顶' : '置顶'"
        :aria-label="props.note.pinned ? '取消置顶' : '置顶'"
        @click="togglePin"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          :fill="props.note.pinned ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 17v5" />
          <path
            d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.36V17h14v-1.64a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"
          />
        </svg>
      </button>
      <div
        class="flex shrink-0 rounded-lg border border-gray-200 p-0.5 text-xs dark:border-neutral-700"
      >
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          :class="
            mode === m.value
              ? 'bg-gray-200 dark:bg-neutral-700'
              : 'hover:text-gray-600 dark:hover:text-neutral-300'
          "
          class="rounded-md px-2.5 py-1"
          @click="mode = m.value"
        >
          {{ m.label }}
        </button>
      </div>
      <span class="w-16 shrink-0 text-right text-xs text-gray-400 dark:text-neutral-500">
        {{ statusText }}
      </span>
    </div>
    <!-- 标签行（F-202）：回车添加，× 移除 -->
    <div
      class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-200 px-6 py-2 dark:border-neutral-800"
    >
      <span
        v-for="tag in props.note.tags"
        :key="tag"
        class="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-neutral-800 dark:text-neutral-300"
      >
        {{ tag }}
        <button
          type="button"
          :aria-label="`移除标签 ${tag}`"
          class="text-gray-400 hover:text-red-500 dark:text-neutral-500"
          @click="removeNoteTag(tag)"
        >
          ×
        </button>
      </span>
      <input
        v-model="tagDraft"
        placeholder="添加标签，回车确认"
        aria-label="添加标签"
        class="min-w-32 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400 dark:placeholder:text-neutral-600"
        @keydown.enter.prevent="commitTagInput"
        @blur="commitTagInput"
      />
    </div>
    <div class="flex min-h-0 flex-1">
      <textarea
        v-show="mode !== 'preview'"
        v-model="content"
        spellcheck="false"
        placeholder="在这里用 Markdown 记录…"
        aria-label="笔记正文"
        class="h-full min-w-0 flex-1 resize-none overflow-y-auto bg-transparent p-6 font-mono text-sm leading-6 outline-none placeholder:text-gray-400 dark:placeholder:text-neutral-600"
        @blur="flush()"
      ></textarea>
      <div v-show="mode !== 'edit'" class="h-full min-w-0 flex-1 overflow-y-auto p-6">
        <!-- v-html 全项目唯一插口：仅渲染 markdown-it（html:false）自身输出，见 ADR-006 -->
        <article
          class="prose prose-sm max-w-none prose-pre:bg-gray-100 prose-pre:text-gray-900 dark:prose-invert dark:prose-pre:bg-neutral-800 dark:prose-pre:text-neutral-100"
          v-html="html"
        ></article>
      </div>
    </div>
    <!-- 统计信息（F-207） -->
    <footer
      class="flex shrink-0 items-center justify-between border-t border-gray-200 px-6 py-1.5 text-xs text-gray-400 dark:border-neutral-800 dark:text-neutral-500"
    >
      <span>共 {{ stats.words }} 字 · {{ stats.chars }} 字符</span>
      <span>
        创建于 {{ formatDateTime(props.note.createdAt) }} ·
        更新于 {{ formatRelativeTime(props.note.updatedAt) }}
      </span>
    </footer>
  </section>
</template>
