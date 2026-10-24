<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { formatRelativeTime } from '@/lib/utils/time'
import { SNAPSHOT_KEEP_LIMIT } from './history'
import { useHistoryStore } from './stores/history'
import type { NoteMeta } from '@/types'

/**
 * 历史版本面板（F-402）：展示当前笔记的快照（最新在前），支持手动快照与回滚。
 * 面板不触碰草稿与确认弹窗——手动快照取当前草稿、回滚前确认由 NoteEditor 处理（emit）。
 */
const props = defineProps<{ note: NoteMeta }>()
const emit = defineEmits<{ snapshot: []; restore: [snapshotId: string] }>()

const historyStore = useHistoryStore()
const snapshots = computed(() => historyStore.lists[props.note.id])

onMounted(() => {
  void historyStore.ensureLoaded(props.note.id)
})
</script>

<template>
  <nav
    aria-label="历史版本"
    class="flex w-60 shrink-0 flex-col overflow-hidden border-l border-gray-900/8 bg-white/25 dark:border-white/8 dark:bg-white/[0.03]"
  >
    <div class="flex items-center justify-between px-4 py-3">
      <p class="text-[11px] font-medium text-gray-400">
        历史版本
        <span v-if="snapshots">{{ snapshots.length }}/{{ SNAPSHOT_KEEP_LIMIT }}</span>
      </p>
      <button
        type="button"
        class="rounded-md px-1.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-white/80 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100"
        @click="emit('snapshot')"
      >
        存为快照
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <p v-if="snapshots === undefined" class="px-2 py-1 text-xs text-gray-400">加载中…</p>
      <p v-else-if="snapshots.length === 0" class="px-2 py-1 text-xs leading-5 text-gray-400">
        暂无历史版本。编辑保存后，内容变化超过 20% 时会自动生成快照。
      </p>
      <ul v-else class="space-y-0.5">
        <li
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          class="group flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/70 dark:hover:bg-white/8"
        >
          <span class="min-w-0">
            <span class="block text-xs text-gray-700 dark:text-neutral-200">
              {{ formatRelativeTime(snapshot.createdAt) }}
            </span>
            <span class="block text-[11px] text-gray-400">{{ snapshot.content.length }} 字符</span>
          </span>
          <button
            type="button"
            class="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-gray-400 opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover:opacity-100 dark:text-neutral-500 dark:hover:text-accent"
            @click="emit('restore', snapshot.id)"
          >
            恢复
          </button>
        </li>
      </ul>
    </div>
  </nav>
</template>
