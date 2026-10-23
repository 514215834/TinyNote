import { defineStore } from 'pinia'
import { useDark, useToggle } from '@vueuse/core'

// useDark：初始 'auto' 跟随系统，手动切换后持久化到 localStorage（vueuse-color-scheme），
// 并同步 <html> 的 .dark 类（main.css 中 @custom-variant dark 与之对应）
export const useSettingsStore = defineStore('settings', () => {
  const isDark = useDark()
  const toggleTheme = useToggle(isDark)
  return { isDark, toggleTheme }
})
