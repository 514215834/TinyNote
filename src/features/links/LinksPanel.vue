<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { t } from '@/lib/i18n'
import type { NoteMeta } from '@/types'
import { useLinksStore, type BacklinkRow } from './stores/links'
import { outlinksOf } from './linkIndex'
import { useNotesStore } from '@/features/notes/stores/notes'

/**
 * 出入链接面板（F-702）：编辑器侧栏「链接」页签。
 * - 反链：引用了当前笔记的其他笔记列表（逐条引用行 ±40 字摘要）；
 * - 出链：当前笔记正文里 `[[ ]]` 引用的目标（断链标记区分）。
 * 链接数据来自内存索引（linkIndex），本组件只读展示与跳转；
 * 点击出链行断链时走「新建同名笔记」消除断链（与预览一致）。
 */
const props = defineProps<{ note: NoteMeta }>()
const emit = defineEmits<{
  open: [noteId: string]
  create: [title: string]
}>()

const linksStore = useLinksStore()
const notesStore = useNotesStore()

const backlinks = ref<BacklinkRow[]>([])
const backlinksLoading = ref(true)

async function refresh(): Promise<void> {
  await linksStore.ensureIndex()
  const title = props.note.title.trim()
  backlinks.value = title === '' ? [] : await linksStore.backlinksWithSnippets(title)
  backlinksLoading.value = false
}

onMounted(() => void refresh())
// 保存动作刷新标题后重取（新笔记可能刚被别处引用）
watch(() => props.note.title, () => void refresh())

/** 出链：当前笔记引用的目标 + 解析状态（断链标记；同名多篇取最近更新一篇） */
const outlinks = computed(() => {
  void linksStore.version // 挂接索引更新
  const byTitle = new Map<string, NoteMeta>()
  for (const note of notesStore.notes) {
    const key = note.title.trim()
    if (key !== '' && !byTitle.has(key)) byTitle.set(key, note)
  }
  return (outlinksOf(props.note.id) ?? []).map((link) => ({
    ...link,
    targetNote: byTitle.get(link.target) ?? null,
  }))
})

function onOutlinkClick(link: { target: string; targetNote: NoteMeta | null }): void {
  if (link.targetNote === null) emit('create', link.target)
  else emit('open', link.targetNote.id)
}

/** 反链行点击：打开被引用的笔记（当前笔记） */
function openNoteLink(id: string): void {
  emit('open', id)
}
</script>

<template>
  <aside
    :aria-label="t('links.panelTab')"
    class="flex w-60 shrink-0 flex-col overflow-hidden border-l border-gray-900/8 bg-white/25 dark:border-white/8 dark:bg-white/[0.03]"
  >
    <!-- 反链 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
      <p class="px-1 pb-2 text-[11px] font-medium text-gray-400">
        {{ t('links.backlinks') }}
        <span v-if="backlinks.length > 0">{{ backlinks.length }}</span>
      </p>
      <p v-if="backlinksLoading" class="px-1 py-1 text-xs text-gray-400">{{ t('links.loading') }}</p>
      <p v-else-if="backlinks.length === 0" class="px-1 py-1 text-xs leading-5 text-gray-400">
        {{ t('links.emptyBacklinks') }}
      </p>
      <ul v-else class="space-y-1">
        <li v-for="row in backlinks" :key="row.id">
          <button
            type="button"
            class="w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/8"
            :title="row.title"
            @click="openNoteLink(row.id)"
          >
            <span class="block truncate text-xs text-gray-700 dark:text-neutral-200">{{ row.title }}</span>
            <span class="mt-0.5 block truncate text-[11px] text-gray-400">{{ row.snippet }}</span>
          </button>
        </li>
      </ul>
    </div>
    <!-- 出链 -->
    <div class="min-h-0 flex-1 overflow-y-auto border-t border-gray-900/8 px-3 pb-3 pt-3">
      <p class="px-1 pb-2 text-[11px] font-medium text-gray-400">
        {{ t('links.outlinks') }}
        <span v-if="outlinks.length > 0">{{ outlinks.length }}</span>
      </p>
      <p v-if="outlinks.length === 0" class="px-1 py-1 text-xs leading-5 text-gray-400">
        {{ t('links.emptyOutlinks') }}
      </p>
      <ul v-else class="space-y-1">
        <li v-for="(link, index) in outlinks" :key="`${link.at}-${index}`">
          <button
            type="button"
            class="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/8"
            :title="link.target"
            @click="onOutlinkClick(link)"
          >
            <span class="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
              {{ link.alias ?? link.target }}
            </span>
            <span
              v-if="link.targetNote === null"
              class="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-700/30 dark:text-amber-300"
            >
              {{ t('links.broken') }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </aside>
</template>
