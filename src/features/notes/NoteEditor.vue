<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { EditorView } from '@codemirror/view'
import type { Note } from '@/types'
import { renderMarkdown } from '@/lib/markdown/render'
import { extractHeadings } from '@/lib/markdown/outline'
import { useAutoSave } from './composables/useAutoSave'
import { useHotkeys } from '@/composables/shortcuts'
import { addTag, removeTag } from '@/features/tags/tags'
import { countChars, countWords } from './stats'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/time'
import { useNotesStore } from './stores/notes'
import { useSettingsStore } from '@/features/settings/stores/settings'
import { useAttachmentsStore } from '@/features/editor/stores/attachments'
import { makeImageMarkdown, pickImageFiles } from '@/features/editor/attachments'
import NoteCodeEditor from '@/features/editor/NoteCodeEditor.vue'
import { useBackup } from '@/features/backup/useBackup'

type EditorMode = 'edit' | 'split' | 'preview'

const props = defineProps<{ note: Note }>()

const notesStore = useNotesStore()
const settings = useSettingsStore()
const attachmentsStore = useAttachmentsStore()
const backup = useBackup()

const modes: { value: EditorMode; label: string }[] = [
  { value: 'edit', label: '编辑' },
  { value: 'split', label: '分栏' },
  { value: 'preview', label: '预览' },
]

const mode = ref<EditorMode>('edit')
const title = ref(props.note.title)
const content = ref(props.note.content)
const titleInput = useTemplateRef<HTMLInputElement>('titleInput')
const previewEl = useTemplateRef<HTMLDivElement>('previewEl')
const editorView = shallowRef<EditorView | null>(null)

// 草稿保存在本地响应式引用；持久化由 useAutoSave 调度（防抖 + 失焦 + 关页兜底），
// persist 调用时才读取 title/content，因此切换笔记前的待写内容也能被正确保存
const { schedule, flush, status } = useAutoSave(async () => {
  await notesStore.saveChanges(props.note.id, { title: title.value, content: content.value })
})

watch([title, content], () => schedule())

onMounted(() => {
  // 新建的空笔记直接聚焦标题
  if (props.note.title === '' && props.note.content === '') titleInput.value?.focus()
  void attachmentsStore.loadForNote(props.note.id)
})

onBeforeUnmount(() => {
  attachmentsStore.release()
})

useEventListener(window, 'beforeunload', () => {
  // 尽力保存：IndexedDB 写入不保证在页面卸载前完成，失焦保存是主路径
  void flush()
})
useEventListener(window, 'pagehide', () => {
  void flush()
})

// F-206：Ctrl+E 在编辑与预览两种状态间切换（分栏视为编辑侧，切到预览再切回编辑）
function togglePreview(): void {
  mode.value = mode.value === 'preview' ? 'edit' : 'preview'
}
useHotkeys([{ combo: 'ctrl+e', handler: togglePreview }])

// v-show 隐藏时 CodeMirror 量不出几何尺寸，切回可视后强制重新测量
watch(mode, async () => {
  await nextTick()
  editorView.value?.requestMeasure()
})

// 编辑模式下跳过渲染，避免无预览时白算 Markdown（附件 blob URL 快照随内容/附件变化刷新）
const attachmentUrls = computed(() => ({ ...attachmentsStore.urls }))
const html = computed(() =>
  mode.value === 'edit' ? '' : renderMarkdown(content.value, { attachmentUrls: attachmentUrls.value }),
)

// F-302：预览态的大纲（标题结构与预览锚点逐字对应）
const headings = computed(() => extractHeadings(content.value))

function scrollToHeading(id: string): void {
  const target = previewEl.value?.querySelector(`#${CSS.escape(id)}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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

/** F-301：分栏模式下编辑滚动 ↔ 预览滚动按比例联动（syncing 标志防止反馈循环） */
let syncing = false
function scrollRatioOf(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight
  return max <= 0 ? 0 : el.scrollTop / max
}
function applyScrollRatio(el: HTMLElement, ratio: number): void {
  const max = el.scrollHeight - el.clientHeight
  if (max > 0) el.scrollTop = ratio * max
}
function syncFromEditor(): void {
  if (mode.value !== 'split' || syncing) return
  const to = previewEl.value
  const from = editorView.value?.scrollDOM
  if (!from || !to) return
  syncing = true
  applyScrollRatio(to, scrollRatioOf(from))
  requestAnimationFrame(() => {
    syncing = false
  })
}
function syncFromPreview(): void {
  if (mode.value !== 'split' || syncing) return
  const from = previewEl.value
  const to = editorView.value?.scrollDOM
  if (!from || !to) return
  syncing = true
  applyScrollRatio(to, scrollRatioOf(from))
  requestAnimationFrame(() => {
    syncing = false
  })
}
useEventListener(() => editorView.value?.scrollDOM ?? null, 'scroll', syncFromEditor)
useEventListener(previewEl, 'scroll', syncFromPreview)

function onEditorReady(view: EditorView): void {
  editorView.value = view
}

/**
 * F-303：粘贴 / 拖入图片 → 附件落库 → 正文在光标处插入内部引用。
 * 非图片文件不拦截，交还给 CodeMirror 的默认行为（文本/路径拖放）。
 */
function onPaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files
  if (!files?.length) return
  const images = pickImageFiles(files)
  if (images.length === 0) return
  event.preventDefault()
  void insertImages(images)
}
function onDrop(event: DragEvent): void {
  const files = event.dataTransfer?.files
  if (!files?.length) return
  const images = pickImageFiles(files)
  if (images.length === 0) return
  event.preventDefault()
  void insertImages(images)
}
async function insertImages(files: File[]): Promise<void> {
  const view = editorView.value
  if (!view) return
  let pos = Math.min(view.state.selection.main.head, content.value.length)
  for (const file of files) {
    const id = await attachmentsStore.attach(props.note.id, file)
    const image = makeImageMarkdown(id, file.name)
    view.dispatch({
      changes: { from: pos, to: pos, insert: image },
      selection: { anchor: pos + image.length },
    })
    pos += image.length // 多图顺序插入：每次 dispatch 后光标推进，下一张接在后面
  }
}

// F-304：单篇导出 .md（导出当前草稿，导出后随手 flush 保证草稿已落库）
function exportCurrentNote(): void {
  void backup.exportNoteMarkdown({ title: title.value, content: content.value })
  void flush()
}

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

// F-207：字数/字符数统计（行号开关 F-301）
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
      <button
        type="button"
        class="shrink-0 rounded-lg p-2 text-gray-400 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-200"
        title="导出单篇 Markdown"
        aria-label="导出单篇 Markdown"
        @click="exportCurrentNote"
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
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
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
    <div
      class="flex min-h-0 flex-1 gap-3"
      @paste="onPaste"
      @dragover.prevent
      @drop="onDrop"
    >
      <!-- F-301：CodeMirror 6 编辑器（光标处可粘贴/拖入图片） -->
      <div
        v-show="mode !== 'preview'"
        class="h-full min-w-0 flex-1 overflow-hidden px-3 py-2"
      >
        <NoteCodeEditor
          v-model="content"
          :line-numbers="settings.editorLineNumbers"
          :dark="settings.isDark"
          class="h-full"
          @ready="onEditorReady"
          @blur="flush()"
        />
      </div>
      <div
        v-show="mode !== 'edit'"
        class="flex min-w-0 flex-1"
      >
        <div
          ref="previewEl"
          :class="mode === 'split' ? 'border-l border-gray-200 dark:border-neutral-800' : ''"
          class="h-full min-w-0 flex-1 overflow-y-auto p-6"
        >
          <!-- v-html 全项目唯一插口：仅渲染 markdown-it（html:false）自身输出，见 ADR-006 -->
          <article
            class="prose prose-sm max-w-none prose-pre:bg-gray-100 prose-pre:text-gray-900 dark:prose-invert dark:prose-pre:bg-neutral-800 dark:prose-pre:text-neutral-100"
            v-html="html"
          ></article>
        </div>
        <!-- F-302：预览态大纲（TOC），点击平滑跳转到对应标题 -->
        <nav
          v-if="mode === 'preview' && headings.length > 0"
          aria-label="大纲"
          class="w-56 shrink-0 overflow-y-auto border-l border-gray-200 py-4 dark:border-neutral-800"
        >
          <p class="px-4 pb-2 text-[11px] font-medium text-gray-400">大纲</p>
          <ul class="space-y-0.5">
            <li v-for="heading in headings" :key="heading.id">
              <button
                type="button"
                class="block w-full truncate text-left text-xs text-gray-500 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                :style="{ paddingLeft: `${4 + (heading.level - 1) * 14}px` }"
                :title="heading.text"
                @click="scrollToHeading(heading.id)"
              >
                {{ heading.text }}
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </div>
    <!-- 统计信息（F-207）+ 行号开关（F-301） -->
    <footer
      class="flex shrink-0 items-center justify-between border-t border-gray-200 px-6 py-1.5 text-xs text-gray-400 dark:border-neutral-800 dark:text-neutral-500"
    >
      <span class="flex items-center gap-4">
        <span>共 {{ stats.words }} 字 · {{ stats.chars }} 字符</span>
        <button
          type="button"
          class="hover:text-gray-600 dark:hover:text-neutral-300"
          :class="{ 'text-gray-700 dark:text-neutral-200': settings.editorLineNumbers }"
          :title="settings.editorLineNumbers ? '隐藏行号' : '显示行号'"
          :aria-label="settings.editorLineNumbers ? '隐藏行号' : '显示行号'"
          @click="settings.toggleEditorLineNumbers()"
        >
          行号
        </button>
      </span>
      <span>
        创建于 {{ formatDateTime(props.note.createdAt) }} ·
        更新于 {{ formatRelativeTime(props.note.updatedAt) }}
      </span>
    </footer>
  </section>
</template>
