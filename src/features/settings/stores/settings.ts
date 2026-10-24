import { defineStore } from 'pinia'
import { useDark, useLocalStorage, useToggle } from '@vueuse/core'
import { ref, watch } from 'vue'
import { settingsRepository } from '@/lib/db/repositories/settingsRepository'
import { backupReminderDue as isBackupDue, backupSnoozeActive } from '@/features/backup/backup'
import {
  DEFAULT_ACCENT_ID,
  resolveAppearance,
  type AccentId,
  type ContentWidth,
  type FontChoice,
} from '../theme'

/** 笔记查看模式（编辑/分栏/预览）：持久化到 localStorage，重启与切换笔记后保持 */
export type EditorViewMode = 'edit' | 'split' | 'preview'

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

  const EDITOR_VIEW_MODES: readonly EditorViewMode[] = ['edit', 'split', 'preview']
  // flush: 'sync'：低频偏好写入立即落盘，不依赖调度器 flush
  const editorMode = useLocalStorage<EditorViewMode>('tinynote:editor-mode', 'edit', { flush: 'sync' })
  // 手改 localStorage 等脏数据兜底：非法值归位编辑模式
  if (!EDITOR_VIEW_MODES.includes(editorMode.value)) editorMode.value = 'edit'

  // F-521 外观定制偏好（全部 localStorage）：主题色（预设 id + 自定义取色）、正文字体、预览字号、行宽
  const accentId = useLocalStorage<AccentId>('tinynote:accent', DEFAULT_ACCENT_ID, { flush: 'sync' })
  const accentCustom = useLocalStorage('tinynote:accent-custom', '#6366f1', { flush: 'sync' })
  const fontFamily = useLocalStorage<FontChoice>('tinynote:font-family', 'system', { flush: 'sync' })
  const previewFontSize = useLocalStorage('tinynote:preview-font-size', 16, { flush: 'sync' })
  const contentWidth = useLocalStorage<ContentWidth>('tinynote:content-width', 'wide', { flush: 'sync' })

  /** 设置面板（AppHeader 齿轮入口）开关 */
  const panelOpen = ref(false)
  function openPanel(): void {
    panelOpen.value = true
  }
  function closePanel(): void {
    panelOpen.value = false
  }

  /** 把外观偏好写入 documentElement 的 CSS 变量（@theme/:root 提供默认值，内联覆盖生效） */
  function applyAppearance(): void {
    const vars = resolveAppearance(
      accentId.value,
      accentCustom.value,
      fontFamily.value,
      Number(previewFontSize.value) || 16,
      contentWidth.value,
    )
    const root = document.documentElement
    root.style.setProperty('--color-accent', vars.accent)
    root.style.setProperty('--color-accent-strong', vars.accentStrong)
    vars.orbLight.forEach((color, index) => root.style.setProperty(`--orb-${index + 1}`, color))
    vars.orbDark.forEach((color, index) => root.style.setProperty(`--orb-${index + 1}-dark`, color))
    root.style.setProperty('--font-content', vars.fontContent)
    root.style.setProperty('--preview-font-size', vars.previewFontSize)
    root.style.setProperty('--content-max-width', vars.contentMaxWidth)
  }
  applyAppearance()
  watch([accentId, accentCustom, fontFamily, previewFontSize, contentWidth], applyAppearance)

  // F-403 备份提醒：lastBackupAt 存 IndexedDB settings KV（属于用户数据口径）。
  // 「暂不提醒」记忆为贪睡时间戳（localStorage，0 = 未贪睡）：同一提醒周期内不再显示，
  // 跨启动生效，超过提醒周期后重新提示（关闭不等于「已备份」）
  const lastBackupAt = ref<number | null>(null)
  const backupReminderDue = ref(false)
  const backupSnoozedAt = useLocalStorage('tinynote:backup-snoozed-at', 0, { flush: 'sync' })

  async function initBackupReminder(now: number = Date.now()): Promise<void> {
    lastBackupAt.value = (await settingsRepository.get<number>('lastBackupAt')) ?? null
    backupReminderDue.value =
      isBackupDue(lastBackupAt.value, now) && !backupSnoozeActive(backupSnoozedAt.value, now)
  }

  /** 全量备份导出成功后调用（useBackup），横幅随之消失并清除贪睡记录 */
  async function markBackedUp(at: number = Date.now()): Promise<void> {
    lastBackupAt.value = at
    backupReminderDue.value = false
    backupSnoozedAt.value = 0
    await settingsRepository.set('lastBackupAt', at)
  }

  /** 「暂不提醒」（BackupBanner）：记忆为贪睡时间戳，超过提醒周期后重新提示 */
  function dismissBackupBanner(now: number = Date.now()): void {
    backupSnoozedAt.value = now
  }

  return {
    isDark,
    toggleTheme,
    editorMode,
    accentId,
    accentCustom,
    fontFamily,
    previewFontSize,
    contentWidth,
    panelOpen,
    openPanel,
    closePanel,
    editorLineNumbers,
    toggleEditorLineNumbers,
    lastBackupAt,
    backupReminderDue,
    backupSnoozedAt,
    initBackupReminder,
    markBackedUp,
    dismissBackupBanner,
  }
})
