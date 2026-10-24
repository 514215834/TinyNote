<script setup lang="ts">
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
    class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
    role="status"
  >
    <span class="text-xs text-gray-700 dark:text-neutral-200">新版本已就绪</span>
    <button
      type="button"
      class="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
      @click="refresh"
    >
      刷新更新
    </button>
    <button
      type="button"
      class="rounded-md p-1 text-gray-400 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-200"
      aria-label="关闭更新提示"
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
