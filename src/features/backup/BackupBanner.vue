<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/lib/i18n'
import { useBackup } from './useBackup'
import { useSettingsStore } from '@/features/settings/stores/settings'
import { useNotesStore } from '@/features/notes/stores/notes'
import { BACKUP_REMINDER_DAYS } from './backup'

/**
 * 备份提醒横幅（F-403）：距上次全量备份导出超过 BACKUP_REMINDER_DAYS 天（或从未备份）
 * 且库中有笔记时显示。「暂不提醒」记忆为贪睡（localStorage）：同一提醒周期内不再显示，
 * 跨启动生效，超过 BACKUP_REMINDER_DAYS 后重新提示。
 */
const settings = useSettingsStore()
const notesStore = useNotesStore()
const { busy: backupBusy, exportBackupZip } = useBackup()

const showBanner = computed(
  () => settings.backupReminderDue && notesStore.notes.length > 0,
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
    window.alert(t('header.exportFailed', { msg: error instanceof Error ? error.message : String(error) }))
  }
}
</script>

<template>
  <div
    v-if="showBanner"
    class="relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/20 bg-amber-100/55 px-5 py-2 text-xs text-amber-800 backdrop-blur-xl backdrop-saturate-150 dark:border-amber-400/15 dark:bg-amber-500/10 dark:text-amber-200"
    role="status"
  >
    <span class="min-w-0 flex-1">
      <template v-if="daysSince === null">
        {{ t('backup.bannerNever') }}
      </template>
      <template v-else>
        {{ t('backup.bannerDue', { days: daysSince, cycle: BACKUP_REMINDER_DAYS }) }}
      </template>
    </span>
    <button
      type="button"
      :disabled="backupBusy"
      class="shrink-0 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 font-medium text-white shadow-sm shadow-amber-500/30 transition-all hover:from-amber-400 hover:to-orange-400 disabled:opacity-50"
      @click="backupNow"
    >
      {{ t('backup.backupNow') }}
    </button>
    <button
      type="button"
      class="shrink-0 rounded-full px-2.5 py-1 text-amber-700 transition-colors hover:bg-amber-500/12 dark:text-amber-300 dark:hover:bg-amber-400/10"
      @click="settings.dismissBackupBanner()"
    >
      {{ t('backup.snooze') }}
    </button>
  </div>
</template>
