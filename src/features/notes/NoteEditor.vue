<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener, watchDebounced } from '@vueuse/core'
import type { EditorView } from '@codemirror/view'
import type { NoteMeta } from '@/types'
import { t } from '@/lib/i18n'
import { renderMarkdown } from '@/lib/markdown/render'
import { extractHeadings } from '@/lib/markdown/outline'
import { useAutoSave } from './composables/useAutoSave'
import { useHotkeys } from '@/composables/shortcuts'
import { addTag, removeTag } from '@/features/tags/tags'
import { countChars, countWords } from './stats'
import { formatDateTime, formatRelativeTime } from '@/lib/utils/time'
import { useNotesStore } from './stores/notes'
import { displayTitle, sortNotesForList } from './notes'
import { useSettingsStore, type EditorViewMode } from '@/features/settings/stores/settings'
import { useAttachmentsStore } from '@/features/editor/stores/attachments'
import { useHistoryStore } from '@/features/history/stores/history'
import { useLinksStore } from '@/features/links/stores/links'
import { backlinkRefsOf } from '@/features/links/linkIndex'
import type { WikiLinkCandidate } from '@/features/editor/wikilinkComplete'
import LinksPanel from '@/features/links/LinksPanel.vue'
import HistoryPanel from '@/features/history/HistoryPanel.vue'
import { makeImageMarkdown, pickImageFiles } from '@/features/editor/attachments'
import NoteCodeEditor from '@/features/editor/NoteCodeEditor.vue'
import { useBackup } from '@/features/backup/useBackup'

const props = defineProps<{ note: NoteMeta }>()

const notesStore = useNotesStore()
const settings = useSettingsStore()
const attachmentsStore = useAttachmentsStore()
const historyStore = useHistoryStore()
const linksStore = useLinksStore()
const backup = useBackup()

const modes: { value: EditorViewMode; labelKey: string }[] = [
  { value: 'edit', labelKey: 'editor.modeEdit' },
  { value: 'split', labelKey: 'editor.modeSplit' },
  { value: 'preview', labelKey: 'editor.modePreview' },
]

// 查看模式持久化在 settings（localStorage）：重启与切换笔记后保持上次选择
const { editorMode: mode } = storeToRefs(settings)
const title = ref(props.note.title)
/** 正文草稿（F-523）：异步从 contents 表加载，loaded 前不触发保存 */
const content = ref('')
const loaded = ref(false)
/** 最近一次落库的正文基线：与草稿一致时跳过保存，避免失焦/切换时的空写 */
let savedContent = ''
const titleInput = useTemplateRef<HTMLInputElement>('titleInput')
const previewEl = useTemplateRef<HTMLDivElement>('previewEl')
const editorView = shallowRef<EditorView | null>(null)

// 草稿保存在本地响应式引用；持久化由 useAutoSave 调度（防抖 + 失焦 + 关页兜底），
// persist 调用时才读取 title/content，因此切换笔记前的待写内容也能被正确保存。
// 保存成功后追加 F-402 自动快照判定（大变更才落快照）。
const { schedule, flush, status } = useAutoSave(async () => {
  if (title.value === props.note.title && content.value === savedContent) return
  await notesStore.saveChanges(props.note.id, { title: title.value, content: content.value })
  savedContent = content.value
  await historyStore.maybeAutoSnapshot(props.note.id, content.value)
})

watch([title, content], () => {
  if (loaded.value) schedule()
})

onMounted(async () => {
  void attachmentsStore.loadForNote(props.note.id)
  void historyStore.ensureLoaded(props.note.id)
  // F-523：正文按需加载；加载完成前编辑器不可保存（防把空正文写库）
  const initial = await notesStore.loadContent(props.note.id)
  content.value = initial
  savedContent = initial
  renderSource.value = initial
  statsSource.value = initial
  loaded.value = true
  // 新建的空笔记直接聚焦标题
  if (props.note.title === '' && initial === '') titleInput.value?.focus()
})

onBeforeUnmount(() => {
  // 卸载兜底：先尽力落盘草稿，再做 F-406 孤儿附件清理（正文与历史快照都不再引用才删），
  // 最后释放 blob URL。历史列表未加载完成时 pruneOrphans 会自动跳过，宁可暂留不误删；
  // 正文尚未加载完成时同样跳过（无从判定引用，也不能拿空草稿落库）。
  void (async () => {
    await flush()
    if (!loaded.value) {
      attachmentsStore.release()
      return
    }
    const snapshotContents = historyStore.contents(props.note.id)
    if (snapshotContents !== undefined) {
      await attachmentsStore.pruneOrphans(props.note.id, [content.value, ...snapshotContents])
    }
    attachmentsStore.release()
  })()
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

// 编辑模式下跳过渲染，避免无预览时白算 Markdown（附件 blob URL 快照随内容/附件变化刷新）。
// 渲染源 250ms 防抖（F-523）：大正文下逐键全量 Markdown 解析是卡顿主因，停顿后才重算预览。
const attachmentUrls = computed(() => ({ ...attachmentsStore.urls }))
const renderSource = ref('')
const statsSource = ref('')
watchDebounced(
  content,
  (value) => {
    renderSource.value = value
    statsSource.value = value
  },
  { debounce: 250 },
)
const html = computed(() =>
  mode.value === 'edit' ? '' : renderMarkdown(renderSource.value, { attachmentUrls: attachmentUrls.value }),
)

// F-302：预览态的大纲（标题结构与预览锚点逐字对应）
const headings = computed(() => extractHeadings(renderSource.value))

function scrollToHeading(id: string): void {
  const target = previewEl.value?.querySelector(`#${CSS.escape(id)}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const statusText = computed(() => {
  switch (status.value) {
    case 'saving':
      return t('editor.saving')
    case 'saved':
      return t('editor.saved')
    case 'error':
      return t('editor.saveFailed')
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

// F-402：历史版本面板。手动快照取当前草稿；回滚前先确认，恢复成功后同步本地草稿
const historyOpen = ref(false)

function onManualSnapshot(): void {
  void historyStore.createManualSnapshot(props.note.id, content.value)
}

async function onRestoreSnapshot(snapshotId: string): Promise<void> {
  const snapshot = historyStore.snapshotOf(props.note.id, snapshotId)
  if (!snapshot) return
  const confirmed = window.confirm(t('editor.restoreConfirm', { time: formatDateTime(snapshot.createdAt) }))
  if (!confirmed) return
  await flush()
  // 当前草稿随调用传入（F-523：store 元数据不含正文）
  const restored = await historyStore.restoreSnapshot(props.note, snapshotId, content.value)
  if (restored !== null) content.value = restored
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

/** F-701：`[[` 补全候选——活跃笔记标题（去重），按最近更新倒序（与侧栏列表同源） */
function getLinkCandidates(): readonly WikiLinkCandidate[] {
  const byTitle = new Map<string, number>()
  for (const note of notesStore.notes) {
    const trimmed = note.title.trim()
    if (trimmed === '' || byTitle.has(trimmed)) continue
    byTitle.set(trimmed, note.updatedAt)
  }
  return [...byTitle]
    .map(([candidateTitle, updatedAt]) => ({ title: candidateTitle, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * F-701：预览内双链点击——命中唯一 → 跳转；同名多篇 → 候选列表消歧；
 * 未命中 → 新建同名笔记消除断链。锚点 href="#"，默认行为必须拦截
 * （hash 路由下会触发一次多余的路由跳转）。
 */
const sameTitlePick = ref<{ title: string; candidates: NoteMeta[] } | null>(null)

function onPreviewClick(event: MouseEvent): void {
  const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wikilink]') : null
  if (anchor === null) return
  event.preventDefault()
  const target = anchor.dataset.wikilink ?? ''
  if (target !== '') void openWikiLink(target)
}

async function openWikiLink(target: string): Promise<void> {
  const matches = sortNotesForList(notesStore.notes.filter((note) => note.title.trim() === target))
  if (matches.length === 1) {
    notesStore.select(matches[0]!.id)
    return
  }
  if (matches.length === 0) {
    await flush() // 当前草稿先落盘，再切到新建的同名笔记
    await notesStore.createNoteWithTitle(target)
    return
  }
  sameTitlePick.value = { title: target, candidates: matches }
}

function pickSameTitle(id: string): void {
  sameTitlePick.value = null
  notesStore.select(id)
}
useEventListener(window, 'keydown', (event) => {
  if (sameTitlePick.value !== null && event.key === 'Escape') sameTitlePick.value = null
})

/**
 * F-701 重命名迁移：标题草稿与已落库基线不一致、且旧标题仍被 `[[ ]]` 引用时，
 * 展示一键「更新全部引用」（先落库重命名，再全库替换引用；迁移可能改写本篇正文——
 * 自引用场景——完成后重读草稿与保存基线，避免旧内容在下次自动保存时回写覆盖）。
 * 点 × 表示接受现状：旧引用留作断链（仍可点击走「新建同名」）；之后再次重命名会重新检测。
 */
const savedTitle = ref(props.note.title)
const migrating = ref(false)
const pendingRenameRefs = computed(() => {
  void linksStore.version // 索引更新后重新求值
  const oldTitle = savedTitle.value.trim()
  const newTitle = title.value.trim()
  if (oldTitle === '' || newTitle === '' || oldTitle === newTitle) return 0
  return backlinkRefsOf(oldTitle).length
})

async function migrateRenameRefs(): Promise<void> {
  if (migrating.value) return
  const oldTitle = savedTitle.value.trim()
  const newTitle = title.value.trim()
  if (oldTitle === '' || newTitle === '' || oldTitle === newTitle) return
  migrating.value = true
  try {
    await flush() // 重命名先落库（编辑器卸载兜底之外的确定性保存点）
    const touched = await notesStore.renameReferences(oldTitle, newTitle)
    savedTitle.value = newTitle
    if (touched > 0) {
      // 迁移可能改写了本篇正文：重读草稿并对齐保存基线（store 已清正文缓存）
      content.value = await notesStore.loadContent(props.note.id)
      savedContent = content.value
    }
  } finally {
    migrating.value = false
  }
}

function dismissRenameRefs(): void {
  savedTitle.value = title.value
}

// F-302/F-702：编辑器右侧栏——预览态常显「大纲」页签，工具栏按钮可随时切换「链接」页签
const linksOpen = ref(false)
const sidebarTab = computed(() => (linksOpen.value ? 'links' : 'outline'))
const sidebarVisible = computed(() => mode.value === 'preview' || linksOpen.value)
function toggleLinksPanel(): void {
  linksOpen.value = !linksOpen.value
}

function onLinkOpen(id: string): void {
  notesStore.select(id)
}

function onLinkCreate(target: string): void {
  void openWikiLink(target)
}

// F-207：字数/字符数统计（随渲染源一并防抖，行号开关 F-301）
const stats = computed(() => ({ words: countWords(statsSource.value), chars: countChars(statsSource.value) }))
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col">
    <div
      class="flex shrink-0 items-center gap-4 border-b border-gray-900/8 px-6 py-3 dark:border-white/8"
    >
      <input
        ref="titleInput"
        v-model="title"
        :placeholder="t('common.untitled')"
        :aria-label="t('editor.titleAria')"
        class="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-gray-400 dark:placeholder:text-neutral-600"
        @blur="flush()"
      />
      <button
        type="button"
        class="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/60 hover:text-amber-500 dark:text-neutral-500 dark:hover:bg-white/8"
        :class="{ 'text-amber-500': props.note.pinned }"
        :title="props.note.pinned ? t('common.unpin') : t('common.pin')"
        :aria-label="props.note.pinned ? t('common.unpin') : t('common.pin')"
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
        class="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-700 dark:text-neutral-500 dark:hover:bg-white/8 dark:hover:text-neutral-200"
        :title="t('editor.exportMd')"
        :aria-label="t('editor.exportMd')"
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
      <!-- F-402：历史版本面板开关 -->
      <button
        type="button"
        class="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-700 dark:text-neutral-500 dark:hover:bg-white/8 dark:hover:text-neutral-200"
        :class="{ 'bg-white/70 text-gray-900 dark:bg-white/10 dark:text-neutral-100': historyOpen }"
        :title="historyOpen ? t('editor.closeHistory') : t('editor.history')"
        :aria-label="historyOpen ? t('editor.closeHistory') : t('editor.history')"
        @click="historyOpen = !historyOpen"
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
          <path d="M3 3v5h5" />
          <path d="M3.05 13a9 9 0 1 0 .5-5.5L3 8" />
          <path d="M12 7v5l4 2" />
        </svg>
      </button>
      <!-- F-702：链接面板（出入链接）开关 -->
      <button
        type="button"
        class="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-700 dark:text-neutral-500 dark:hover:bg-white/8 dark:hover:text-neutral-200"
        :class="{ 'bg-white/70 text-gray-900 dark:bg-white/10 dark:text-neutral-100': sidebarVisible && sidebarTab === 'links' }"
        :title="t('links.panelAria')"
        :aria-label="t('links.panelAria')"
        @click="toggleLinksPanel"
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
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>
      <div
        class="flex shrink-0 items-center rounded-full border border-gray-900/10 bg-white/50 p-0.5 text-xs shadow-sm dark:border-white/10 dark:bg-white/5"
      >
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          :class="
            mode === m.value
              ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-neutral-100'
              : 'text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200'
          "
          class="rounded-full px-3 py-1 transition-colors"
          @click="mode = m.value"
        >
          {{ t(m.labelKey) }}
        </button>
      </div>
      <span class="w-16 shrink-0 text-right text-xs text-gray-400 dark:text-neutral-500">
        {{ statusText }}
      </span>
    </div>
    <!-- 标签行（F-202）：回车添加，× 移除 -->
    <div
      class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-900/8 px-6 py-2 dark:border-white/8"
    >
      <span
        v-for="tag in props.note.tags"
        :key="tag"
        class="flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-0.5 text-xs text-gray-600 shadow-sm dark:bg-white/10 dark:text-neutral-300"
      >
        {{ tag }}
        <button
          type="button"
          :aria-label="t('editor.removeTagAria', { tag })"
          class="text-gray-400 hover:text-red-500 dark:text-neutral-500"
          @click="removeNoteTag(tag)"
        >
          ×
        </button>
      </span>
      <input
        v-model="tagDraft"
        :placeholder="t('editor.tagPlaceholder')"
        :aria-label="t('editor.tagAria')"
        class="min-w-32 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400 dark:placeholder:text-neutral-600"
        @keydown.enter.prevent="commitTagInput"
        @blur="commitTagInput"
      />
    </div>
    <!-- F-701：重命名迁移——旧标题仍被 `[[ ]]` 引用时的一键迁移入口（× 为接受现状留断链） -->
    <div
      v-if="pendingRenameRefs > 0"
      class="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-300/40 bg-amber-100/50 px-6 py-1.5 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span class="min-w-0 flex-1 truncate">
        {{ t('links.renameRefs', { n: pendingRenameRefs, old: savedTitle.trim() }) }}
      </span>
      <button
        type="button"
        class="shrink-0 rounded-full bg-amber-500/90 px-2.5 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
        :disabled="migrating"
        @click="void migrateRenameRefs()"
      >
        {{ t('links.updateRefs') }}
      </button>
      <button
        type="button"
        class="shrink-0 text-amber-700/70 transition-colors hover:text-amber-800 dark:text-amber-200/70 dark:hover:text-amber-100"
        :aria-label="t('links.renameDismiss')"
        @click="dismissRenameRefs"
      >
        ×
      </button>
    </div>
    <div
      class="flex min-h-0 flex-1 gap-3"
      @paste="onPaste"
      @dragover.prevent
      @drop="onDrop"
    >
      <!-- F-301：CodeMirror 6 编辑器（光标处可粘贴/拖入图片）；磨砂卡内嵌半透明内胆 -->
      <div
        v-show="mode !== 'preview'"
        class="h-full min-w-0 flex-1 overflow-hidden p-2"
      >
        <NoteCodeEditor
          v-model="content"
          :line-numbers="settings.editorLineNumbers"
          :dark="settings.isDark"
          :get-link-candidates="getLinkCandidates"
          class="h-full overflow-hidden rounded-xl border border-gray-900/8 bg-white/40 dark:border-white/8 dark:bg-white/[0.03]"
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
          :class="mode === 'split' ? 'border-l border-gray-900/8 dark:border-white/8' : ''"
          class="h-full min-w-0 flex-1 overflow-y-auto p-6"
          @click="onPreviewClick"
        >
          <!-- v-html 全项目唯一插口：仅渲染 markdown-it（html:false）自身输出，见 ADR-006 -->
          <!-- F-521：字体/字号/行宽由外观偏好变量驱动（main.css :root 定义，设置面板可改） -->
          <article
            class="prose prose-sm prose-pre:bg-gray-100 prose-pre:text-gray-900 dark:prose-invert dark:prose-pre:bg-neutral-800 dark:prose-pre:text-neutral-100"
            :style="{
              fontFamily: 'var(--font-content)',
              fontSize: 'var(--preview-font-size)',
              maxWidth: 'var(--content-max-width)',
              marginInline: 'auto',
            }"
            v-html="html"
          ></article>
        </div>
      </div>
      <!-- F-302/F-702：编辑器右侧栏——「大纲 / 链接」页签；预览态常显（大纲），链接页签任意模式可开 -->
      <aside
        :aria-label="t('links.sidebarAria')"
        class="flex w-60 shrink-0 flex-col overflow-hidden border-l border-gray-900/8 bg-white/25 dark:border-white/8 dark:bg-white/[0.03]"
      >
        <div
          class="flex shrink-0 items-center gap-1 border-b border-gray-900/8 px-3 py-2 dark:border-white/8"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="sidebarTab === 'outline'"
            class="rounded-full px-2.5 py-0.5 text-[11px] transition-colors"
            :class="
              sidebarTab === 'outline'
                ? 'bg-white/80 text-gray-900 shadow-sm dark:bg-white/10 dark:text-neutral-100'
                : 'text-gray-400 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-300'
            "
            @click="linksOpen = false"
          >
            {{ t('editor.outline') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="sidebarTab === 'links'"
            class="rounded-full px-2.5 py-0.5 text-[11px] transition-colors"
            :class="
              sidebarTab === 'links'
                ? 'bg-white/80 text-gray-900 shadow-sm dark:bg-white/10 dark:text-neutral-100'
                : 'text-gray-400 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-300'
            "
            @click="linksOpen = true"
          >
            {{ t('links.panelTab') }}
          </button>
        </div>
        <!-- F-302：预览态大纲（TOC），点击平滑跳转到对应标题；编辑模式下提示切换预览 -->
        <template v-if="sidebarTab === 'outline'">
          <p v-if="mode !== 'preview'" class="px-4 py-3 text-xs text-gray-400 dark:text-neutral-500">
            {{ t('links.outlinePreviewHint') }}
          </p>
          <p v-else-if="headings.length === 0" class="px-4 py-3 text-xs text-gray-400 dark:text-neutral-500">
            {{ t('links.outlineEmpty') }}
          </p>
          <ul v-else class="min-h-0 flex-1 space-y-0.5 overflow-y-auto py-3">
            <li v-for="heading in headings" :key="heading.id">
              <button
                type="button"
                class="block w-full truncate text-left text-xs text-gray-500 hover:text-gray-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                :style="{ paddingLeft: `${16 + (heading.level - 1) * 14}px` }"
                :title="heading.text"
                @click="scrollToHeading(heading.id)"
              >
                {{ heading.text }}
              </button>
            </li>
          </ul>
        </template>
        <!-- F-702：出入链接面板 -->
        <LinksPanel v-else :note="props.note" @open="onLinkOpen" @create="onLinkCreate" />
      </aside>
      <!-- F-402：历史版本面板（手动快照/回滚；与编辑模式无关，随开关显示） -->
      <HistoryPanel
        v-if="historyOpen"
        :note="props.note"
        @snapshot="onManualSnapshot"
        @restore="onRestoreSnapshot"
      />
    </div>
    <!-- 统计信息（F-207）+ 行号开关（F-301） -->
    <footer
      class="flex shrink-0 items-center justify-between border-t border-gray-900/8 px-6 py-1.5 text-xs text-gray-500 dark:border-white/8 dark:text-neutral-400"
    >
      <span class="flex items-center gap-4">
        <span>{{ t('editor.wordCount', { words: stats.words, chars: stats.chars }) }}</span>
        <button
          type="button"
          class="transition-colors hover:text-gray-800 dark:hover:text-neutral-200"
          :class="{ 'text-gray-800 dark:text-neutral-100': settings.editorLineNumbers }"
          :title="settings.editorLineNumbers ? t('editor.hideLineNumbers') : t('editor.showLineNumbers')"
          :aria-label="settings.editorLineNumbers ? t('editor.hideLineNumbers') : t('editor.showLineNumbers')"
          @click="settings.toggleEditorLineNumbers()"
        >
          {{ t('editor.lineNumbers') }}
        </button>
      </span>
      <span>
        {{ t('editor.createdUpdated', { created: formatDateTime(props.note.createdAt), updated: formatRelativeTime(props.note.updatedAt) }) }}
      </span>
    </footer>
    <!-- F-701：同名多篇双链消歧（候选列表点击打开；Esc/遮罩关闭） -->
    <Teleport to="body">
      <div
        v-if="sameTitlePick !== null"
        class="fixed inset-0 z-40 overflow-y-auto bg-gray-950/25 backdrop-blur-sm dark:bg-black/40"
        @click.self="sameTitlePick = null"
      >
        <div
          class="glass-strong mx-auto mt-[24vh] w-[min(22rem,92vw)] overflow-hidden rounded-2xl p-4 shadow-xl"
          role="dialog"
          aria-modal="true"
          :aria-label="t('links.sameTitleAria')"
        >
          <p class="text-sm font-medium">
            {{ t('links.sameTitle', { n: sameTitlePick.candidates.length, title: sameTitlePick.title }) }}
          </p>
          <p class="mt-0.5 text-xs text-gray-400 dark:text-neutral-500">{{ t('links.sameTitlePick') }}</p>
          <ul class="mt-3 max-h-64 space-y-1 overflow-y-auto">
            <li v-for="candidate in sameTitlePick.candidates" :key="candidate.id">
              <button
                type="button"
                class="w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/8"
                @click="pickSameTitle(candidate.id)"
              >
                <span class="block truncate text-xs font-medium text-gray-700 dark:text-neutral-200">
                  {{ displayTitle(candidate) }}
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-gray-400">{{ candidate.excerpt }}</span>
                <span class="mt-0.5 block text-[10px] text-gray-400 dark:text-neutral-500">
                  {{ formatRelativeTime(candidate.updatedAt) }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </Teleport>
  </section>
</template>
