<script setup lang="ts">
import { t } from '@/lib/i18n'
import { usePwaUpdate } from './usePwaUpdate'

/** 版本更新提示（F-404）：检测到新版本 Service Worker 后常驻右下角，用户确认才重载 */
const { needRefresh, updateServiceWorker } = usePwaUpdate()

function refresh(): void {
  void updateServiceWorker(true)
}
</script>

<template>
  <div
    v-if="needRefresh"
    class="glass-strong fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl px-4 py-3"
    role="status"
  >
    <span class="text-xs text-gray-700 dark:text-neutral-200">{{ t('update.ready') }}</span>
    <button
      type="button"
      class="rounded-full bg-gradient-to-r from-accent to-accent-strong px-3 py-1 text-xs font-medium text-white shadow-sm shadow-accent/30 transition-all hover:from-indigo-400 hover:to-violet-400"
      @click="refresh"
    >
      {{ t('update.refresh') }}
    </button>
    <button
      type="button"
      class="rounded-md p-1 text-gray-400 transition-colors hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-200"
      :aria-label="t('update.closeAria')"
      @click="needRefresh = false"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
</template>
