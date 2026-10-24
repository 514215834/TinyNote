// 默认 happy-dom 环境（localStorage 可用）；initBackupReminder 走真实 Dexie 路径读 lastBackupAt
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/lib/db/db'
import { settingsRepository } from '@/lib/db/repositories/settingsRepository'
import { useSettingsStore } from '@/features/settings/stores/settings'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

beforeEach(async () => {
  localStorage.clear()
  await db.settings.clear()
  setActivePinia(createPinia())
})

describe('settingsStore 备份提醒记忆（F-403）', () => {
  it('从未备份且未贪睡：需要提醒', async () => {
    const settings = useSettingsStore()
    await settings.initBackupReminder(NOW)
    expect(settings.backupReminderDue).toBe(true)
  })

  it('「暂不提醒」写入 localStorage：贪睡期内跨启动不再提醒，满周期重新提醒', async () => {
    const settings = useSettingsStore()
    await settings.initBackupReminder(NOW)
    settings.dismissBackupBanner(NOW)
    expect(localStorage.getItem('tinynote:backup-snoozed-at')).toBe(String(NOW))

    // 模拟下次启动：全新 pinia 重建 store，横幅不出现
    setActivePinia(createPinia())
    const nextLaunch = useSettingsStore()
    await nextLaunch.initBackupReminder(NOW)
    expect(nextLaunch.backupReminderDue).toBe(false)

    // 超过提醒周期后重新提醒（关闭不等于「已备份」）
    await nextLaunch.initBackupReminder(NOW + 7 * DAY)
    expect(nextLaunch.backupReminderDue).toBe(true)
  })

  it('贪睡覆盖「备份已过期」：关闭后同一周期内不再提醒', async () => {
    await settingsRepository.set('lastBackupAt', NOW - 8 * DAY)
    const settings = useSettingsStore()
    await settings.initBackupReminder(NOW)
    expect(settings.backupReminderDue).toBe(true)
    settings.dismissBackupBanner(NOW)
    await settings.initBackupReminder(NOW + 3 * DAY)
    expect(settings.backupReminderDue).toBe(false)
  })

  it('markBackedUp 落库 lastBackupAt 并清除贪睡记录', async () => {
    localStorage.setItem('tinynote:backup-snoozed-at', String(NOW - DAY))
    const settings = useSettingsStore()
    await settings.initBackupReminder(NOW)
    await settings.markBackedUp(NOW)
    expect(settings.backupReminderDue).toBe(false)
    expect(localStorage.getItem('tinynote:backup-snoozed-at')).toBe('0')
    expect(await settingsRepository.get<number>('lastBackupAt')).toBe(NOW)
  })

  it('未满提醒周期时已备份状态优先，不受贪睡影响', async () => {
    await settingsRepository.set('lastBackupAt', NOW - 3 * DAY)
    localStorage.setItem('tinynote:backup-snoozed-at', String(NOW - DAY))
    const settings = useSettingsStore()
    await settings.initBackupReminder(NOW)
    expect(settings.backupReminderDue).toBe(false)
  })
})

describe('settingsStore 查看模式记忆', () => {
  it('编辑/分栏/预览选择持久化，重启后保持', () => {
    const settings = useSettingsStore()
    settings.editorMode = 'preview'
    setActivePinia(createPinia())
    expect(useSettingsStore().editorMode).toBe('preview')
  })

  it('localStorage 脏数据兜底：非法值归位编辑模式', () => {
    localStorage.setItem('tinynote:editor-mode', 'bogus')
    expect(useSettingsStore().editorMode).toBe('edit')
  })

  it('环境光晕开关持久化（F-521）', () => {
    const settings = useSettingsStore()
    expect(settings.ambientEnabled).toBe(true)
    settings.ambientEnabled = false
    setActivePinia(createPinia())
    expect(useSettingsStore().ambientEnabled).toBe(false)
  })
})
