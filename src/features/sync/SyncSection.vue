<script setup lang="ts">
import { t } from '@/lib/i18n'
import { formatRelativeTime } from '@/lib/utils/time'
import { useSyncStore, baselineMissingMessage } from './stores/sync'

/**
 * 同步区块（F-501/F-502/F-503，v0.6）：GitHub Gist 配置、状态与手动同步入口。
 * 内嵌于设置面板（外观/缓存之外承载同步配置），PAT 与密码仅存本机 localStorage。
 */
const sync = useSyncStore()

function statsText(): string {
  const stats = sync.lastStats
  if (!stats) return ''
  const parts = [
    t('sync.statsUploaded', { n: stats.uploaded }),
    t('sync.statsDownloaded', { n: stats.downloaded }),
  ]
  if (stats.conflicts > 0) parts.push(t('sync.statsConflicts', { n: stats.conflicts }))
  if (stats.deletedByRemote > 0) parts.push(t('sync.statsDeleted', { n: stats.deletedByRemote }))
  return parts.join(' · ')
}

async function syncNow(): Promise<void> {
  await sync.syncNow()
}

function onPatInput(event: Event): void {
  sync.pat = (event.target as HTMLInputElement).value.trim()
}

/** 密码类失败给出针对性提示（解密失败信息里含「密码/解密」字样，见 syncCrypto.ts） */
function isPasswordHint(): boolean {
  return sync.errorMessage.includes('密码') || sync.errorMessage.includes('password')
}

/** 断开同步：清除本机配置与基线（远端 Gist 保留，便于之后重新接入） */
function disconnect(): void {
  const confirmed = window.confirm(t('sync.disconnectConfirm'))
  if (confirmed) sync.disconnect()
}
</script>

<template>
  <section
    aria-label="同步"
    class="text-xs leading-5 text-gray-500 dark:text-neutral-400"
  >
    <p class="mb-2 text-xs font-medium text-gray-400">{{ t('sync.title') }}</p>

    <!-- 状态行 -->
    <p v-if="!sync.configured" class="mb-2">
      {{ t('sync.notConfigured') }}
    </p>
    <p v-else-if="sync.status === 'syncing'" class="mb-2 text-accent">{{ t('sync.syncing') }}</p>
    <p v-else-if="sync.status === 'error'" class="mb-2 text-red-500">
      {{ sync.errorMessage }}
      <span v-if="isPasswordHint()">{{ t('sync.passwordHint') }}</span>
    </p>
    <p v-else-if="sync.lastSyncAt" class="mb-2">
      {{ t('sync.lastSync', { time: formatRelativeTime(sync.lastSyncAt) }) }}<span v-if="statsText()"> · {{ statsText() }}</span>
    </p>
    <p v-else class="mb-2 text-amber-500">{{ baselineMissingMessage() }}</p>

    <!-- 配置表单 -->
    <div class="mb-2 flex flex-col gap-2">
      <input
        type="password"
        :value="sync.pat"
        :placeholder="t('sync.patPlaceholder')"
        :aria-label="t('sync.patAria')"
        autocomplete="off"
        spellcheck="false"
        class="w-full rounded-lg border border-gray-900/10 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-600"
        @input="onPatInput"
      />
      <div class="flex items-center gap-2">
        <span class="shrink-0 text-gray-400">{{ t('sync.deviceName') }}</span>
        <input
          type="text"
          v-model="sync.deviceName"
          :placeholder="t('sync.deviceNamePlaceholder')"
          :aria-label="t('sync.deviceNameAria')"
          class="min-w-0 flex-1 rounded-lg border border-gray-900/10 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-600"
        />
      </div>

      <!-- 加密开关（F-503） -->
      <div class="flex items-center justify-between gap-2">
        <span class="shrink-0 text-gray-400">{{ t('sync.encryption') }}</span>
        <button
          type="button"
          role="switch"
          :aria-checked="sync.encryptionEnabled"
          class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          :class="sync.encryptionEnabled ? 'bg-accent' : 'bg-gray-300 dark:bg-neutral-600'"
          @click="sync.encryptionEnabled = !sync.encryptionEnabled"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
            :class="sync.encryptionEnabled ? 'left-[1.125rem]' : 'left-0.5'"
          ></span>
        </button>
      </div>
      <input
        v-if="sync.encryptionEnabled"
        type="password"
        v-model="sync.password"
        :placeholder="t('sync.passwordPlaceholder')"
        :aria-label="t('sync.passwordAria')"
        autocomplete="new-password"
        class="w-full rounded-lg border border-gray-900/10 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-600"
      />
      <p v-if="sync.encryptionEnabled" class="text-[11px] text-gray-400/80 dark:text-neutral-500">
        {{ t('sync.encryptionDesc') }}
      </p>

      <!-- 启动自动同步开关 -->
      <div class="flex items-center justify-between gap-2">
        <span class="shrink-0 text-gray-400">{{ t('sync.autoSync') }}</span>
        <button
          type="button"
          role="switch"
          :aria-checked="sync.autoSyncEnabled"
          class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          :class="sync.autoSyncEnabled ? 'bg-accent' : 'bg-gray-300 dark:bg-neutral-600'"
          @click="sync.autoSyncEnabled = !sync.autoSyncEnabled"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
            :class="sync.autoSyncEnabled ? 'left-[1.125rem]' : 'left-0.5'"
          ></span>
        </button>
      </div>
    </div>

    <!-- 操作 -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-full bg-accent px-3.5 py-1 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
        :disabled="!sync.ready || sync.status === 'syncing'"
        @click="syncNow"
      >
        {{ sync.status === 'syncing' ? t('sync.syncing') : t('sync.syncNow') }}
      </button>
      <button
        v-if="sync.configured"
        type="button"
        class="rounded-full border border-gray-900/10 bg-white/60 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
        @click="disconnect"
      >
        {{ t('sync.disconnect') }}
      </button>
    </div>
    <p v-if="sync.configured" class="mt-1.5 text-[11px] text-gray-400/80 dark:text-neutral-500">
      {{ t('sync.hint') }}
    </p>
  </section>
</template>
