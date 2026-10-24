<script setup lang="ts">
import { computed } from 'vue'
import { useBackup } from './useBackup'
import { useSettingsStore } from '@/features/settings/stores/settings'
import { useNotesStore } from '@/features/notes/stores/notes'
import { BACKUP_REMINDER_DAYS } from './backup'

/**
 * 备份提醒横幅（F-403）：距上次全量备份导出超过 BACKUP_REMINDER_DAYS 天（或从未备份）
 * 且库中有笔记时显示。「暂不提醒」仅关闭本会话横幅，下次启动重新评估。
 */
const settings = useSettingsStore()
const notesStore = useNotesStore()
const { busy: backupBusy, exportBackupZip } = useBackup()

const showBanner = computed(
  () => settings.backupReminderDue && !settings.backupBannerDismissed && notesStore.notes.length > 0,
)

/** 距上次备份的整天数；从未备份时为 null */
const daysSince = computed(() => {
  if (settings.lastBackupAt === null) return null
  return Math.floor((Date.now() - settings.lastBackupAt) / 86_400_000)
})

async function backupNow(): Promise<void> {
  try {
    await exportBackupZip()
  } catch (error) {
    window.alert(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
</script>

<template>
  <div
    v-if="showBanner"
    class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    role="status"
  >
    <span class="min-w-0 flex-1">
      <template v-if="daysSince === null">
        笔记只保存在这台浏览器里，还没有导出过备份——建议立即导出一份，防止浏览器数据被清理后丢失。
      </template>
      <template v-else>
        距上次全量备份已 {{ daysSince }} 天（每 {{ BACKUP_REMINDER_DAYS }} 天提醒一次），建议重新导出留存。
      </template>
    </span>
    <button
      type="button"
      :disabled="backupBusy"
      class="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-500 disabled:opacity-50 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
      @click="backupNow"
    >
      立即备份
    </button>
    <button
      type="button"
      class="shrink-0 rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
      @click="settings.dismissBackupBanner()"
    >
      暂不提醒
    </button>
  </div>
</template>
