import { defineStore } from 'pinia'
import { useDark, useLocalStorage, useToggle } from '@vueuse/core'
import { ref } from 'vue'
import { settingsRepository } from '@/lib/db/repositories/settingsRepository'
import { backupReminderDue as isBackupDue } from '@/features/backup/backup'

// useDark：初始 'auto' 跟随系统，手动切换后持久化到 localStorage（vueuse-color-scheme），
// 并同步 <html> 的 .dark 类（main.css 中 @custom-variant dark 与之对应）
export const useSettingsStore = defineStore('settings', () => {
  const isDark = useDark()
  const toggleTheme = useToggle(isDark)

  // 编辑器偏好（架构文档 4.3：localStorage 只存轻量 UI 状态，丢了不心疼）
  const editorLineNumbers = useLocalStorage('tinynote:editor-line-numbers', true)
  function toggleEditorLineNumbers(): void {
    editorLineNumbers.value = !editorLineNumbers.value
  }

  // F-403 备份提醒：lastBackupAt 存 IndexedDB settings KV（属于用户数据口径），
  // 关闭横幅只在本会话生效，下次启动重新评估（关闭不等于「已备份」）
  const lastBackupAt = ref<number | null>(null)
  const backupReminderDue = ref(false)
  const backupBannerDismissed = ref(false)

  async function initBackupReminder(now: number = Date.now()): Promise<void> {
    lastBackupAt.value = (await settingsRepository.get<number>('lastBackupAt')) ?? null
    backupReminderDue.value = isBackupDue(lastBackupAt.value, now)
  }

  /** 全量备份导出成功后调用（useBackup），横幅随之消失 */
  async function markBackedUp(at: number = Date.now()): Promise<void> {
    lastBackupAt.value = at
    backupReminderDue.value = false
    await settingsRepository.set('lastBackupAt', at)
  }

  function dismissBackupBanner(): void {
    backupBannerDismissed.value = true
  }

  return {
    isDark,
    toggleTheme,
    editorLineNumbers,
    toggleEditorLineNumbers,
    lastBackupAt,
    backupReminderDue,
    backupBannerDismissed,
    initBackupReminder,
    markBackedUp,
    dismissBackupBanner,
  }
})
