<script setup lang="ts">
import { useSyncStore, BASELINE_MISSING_MESSAGE } from './stores/sync'
import { formatRelativeTime } from '@/lib/utils/time'

/**
 * 同步区块（F-501/F-502/F-503，v0.6）：GitHub Gist 配置、状态与手动同步入口。
 * 内嵌于设置面板（外观/缓存之外承载同步配置），PAT 与密码仅存本机 localStorage。
 */
const sync = useSyncStore()

function statsText(): string {
  const stats = sync.lastStats
  if (!stats) return ''
  const parts = [`上行 ${stats.uploaded}`, `下行 ${stats.downloaded}`]
  if (stats.conflicts > 0) parts.push(`冲突副本 ${stats.conflicts}`)
  if (stats.deletedByRemote > 0) parts.push(`远端删除落地 ${stats.deletedByRemote}`)
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
  return sync.errorMessage.includes('密码') || sync.errorMessage.includes('解密')
}

/** 断开同步：清除本机配置与基线（远端 Gist 保留，便于之后重新接入） */
function disconnect(): void {
  const confirmed = window.confirm(
    '断开同步将清除本机保存的令牌、Gist 关联与同步基线（笔记数据与远端 Gist 不受影响）。\n确定断开吗？',
  )
  if (confirmed) sync.disconnect()
}
</script>

<template>
  <section
    aria-label="同步"
    class="mt-4 border-t border-gray-900/8 pt-4 text-xs leading-5 text-gray-500 dark:border-white/8 dark:text-neutral-400"
  >
    <p class="mb-2 text-xs font-medium text-gray-400">同步（GitHub Gist）</p>

    <!-- 状态行 -->
    <p v-if="!sync.configured" class="mb-2">
      未配置。粘贴一个具备 <span class="font-medium">gist</span> 权限的 Personal Access Token
      即可在多设备间同步全部笔记；令牌只保存在本机浏览器。
    </p>
    <p v-else-if="sync.status === 'syncing'" class="mb-2 text-accent">同步中…</p>
    <p v-else-if="sync.status === 'error'" class="mb-2 text-red-500">
      {{ sync.errorMessage }}
      <span v-if="isPasswordHint()">（可检查加密密码是否与上传设备一致）</span>
    </p>
    <p v-else-if="sync.lastSyncAt" class="mb-2">
      上次同步 {{ formatRelativeTime(sync.lastSyncAt) }}<span v-if="statsText()"> · {{ statsText() }}</span>
    </p>
    <p v-else class="mb-2 text-amber-500">{{ BASELINE_MISSING_MESSAGE }}</p>

    <!-- 配置表单 -->
    <div class="mb-2 flex flex-col gap-2">
      <input
        type="password"
        :value="sync.pat"
        placeholder="GitHub Personal Access Token（ghp_… / github_pat_…）"
        aria-label="GitHub 访问令牌"
        autocomplete="off"
        spellcheck="false"
        class="w-full rounded-lg border border-gray-900/10 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-600"
        @input="onPatInput"
      />
      <div class="flex items-center gap-2">
        <span class="shrink-0 text-gray-400">设备名</span>
        <input
          type="text"
          v-model="sync.deviceName"
          placeholder="此设备"
          aria-label="设备名称"
          class="min-w-0 flex-1 rounded-lg border border-gray-900/10 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-600"
        />
      </div>

      <!-- 加密开关（F-503） -->
      <div class="flex items-center justify-between gap-2">
        <span class="shrink-0 text-gray-400">端到端加密</span>
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
        placeholder="加密密码（所有设备必须一致）"
        aria-label="同步加密密码"
        autocomplete="new-password"
        class="w-full rounded-lg border border-gray-900/10 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-accent dark:border-white/10 dark:bg-white/5 dark:placeholder:text-neutral-600"
      />
      <p v-if="sync.encryptionEnabled" class="text-[11px] text-gray-400/80 dark:text-neutral-500">
        开启后 Gist 内容以 AES-GCM 加密（密码经 PBKDF2 派生），GitHub 上不可读；密码遗失将无法解密远端数据。
      </p>

      <!-- 启动自动同步开关 -->
      <div class="flex items-center justify-between gap-2">
        <span class="shrink-0 text-gray-400">启动时自动同步</span>
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
        {{ sync.status === 'syncing' ? '同步中…' : '立即同步' }}
      </button>
      <button
        v-if="sync.configured"
        type="button"
        class="rounded-full border border-gray-900/10 bg-white/60 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
        @click="disconnect"
      >
        断开同步…
      </button>
    </div>
    <p v-if="sync.configured" class="mt-1.5 text-[11px] text-gray-400/80 dark:text-neutral-500">
      首次同步自动创建私有 Gist；此后同一令牌的设备共享这一份数据。双侧同时改动同一篇笔记时，
      较新修改胜出，另一方保留为「（冲突@设备）」副本。
    </p>
  </section>
</template>
