<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { Note } from '@/types'
import { renderMarkdown } from '@/lib/markdown/render'
import { useAutoSave } from './composables/useAutoSave'
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
  </section>
</template>
