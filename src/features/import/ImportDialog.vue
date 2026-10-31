<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/lib/i18n'
import { useImportStore } from './stores/import'

/**
 * 导入弹窗（F-801/F-803/F-804）：处理中状态 + 完成后的统计摘要
 * （成功/跳过/失败计数与明细）。入口为数据菜单与整页拖拽，状态在 import store。
 */
const importStore = useImportStore()

const totalIssues = computed(
  () => (importStore.summary?.skipped.length ?? 0) + (importStore.summary?.failed.length ?? 0),
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="importStore.open"
      class="fixed inset-0 z-40 overflow-y-auto bg-gray-950/25 backdrop-blur-sm dark:bg-black/40"
      @click.self="importStore.close()"
    >
      <div
        class="glass-strong mx-auto mt-[22vh] w-[min(26rem,92vw)] overflow-hidden rounded-2xl p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        :aria-label="t('import.title')"
      >
        <p class="text-sm font-medium">{{ t('import.title') }}</p>

        <p v-if="importStore.working" class="mt-3 text-xs text-gray-500 dark:text-neutral-400">
          {{ t('import.working') }}
        </p>

        <template v-else-if="importStore.summary !== null">
          <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-700/30 dark:text-emerald-300">
              {{ t('import.summaryNotes', { n: importStore.summary.notesCreated }) }}
            </span>
            <span
              v-if="importStore.summary.foldersCreated > 0"
              class="rounded-full bg-gray-900/5 px-2 py-0.5 text-gray-600 dark:bg-white/10 dark:text-neutral-300"
            >
              {{ t('import.summaryFolders', { n: importStore.summary.foldersCreated }) }}
            </span>
            <span
              v-if="importStore.summary.attachmentsCreated > 0"
              class="rounded-full bg-gray-900/5 px-2 py-0.5 text-gray-600 dark:bg-white/10 dark:text-neutral-300"
            >
              {{ t('import.summaryAttachments', { n: importStore.summary.attachmentsCreated }) }}
            </span>
            <span
              v-if="importStore.summary.skipped.length > 0"
              class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-700/30 dark:text-amber-300"
            >
              {{ t('import.summarySkipped', { n: importStore.summary.skipped.length }) }}
            </span>
            <span
              v-if="importStore.summary.failed.length > 0"
              class="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-700/30 dark:text-red-300"
            >
              {{ t('import.summaryFailed', { n: importStore.summary.failed.length }) }}
            </span>
          </div>
          <ul v-if="totalIssues > 0" class="mt-3 max-h-44 space-y-1 overflow-y-auto text-[11px] leading-4">
            <li
              v-for="(issue, index) in [...importStore.summary.failed, ...importStore.summary.skipped]"
              :key="index"
              class="rounded-lg px-2 py-1 hover:bg-white/60 dark:hover:bg-white/5"
            >
              <span class="block truncate text-gray-600 dark:text-neutral-300">{{ issue.source }}</span>
              <span class="block truncate text-gray-400">{{ issue.reason }}</span>
            </li>
          </ul>
        </template>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="rounded-full bg-white/70 px-4 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:text-neutral-100 dark:hover:bg-white/15"
            :disabled="importStore.working"
            @click="importStore.close()"
          >
            {{ t('import.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
