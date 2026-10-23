import { defineStore } from 'pinia'
import { useDark, useLocalStorage, useToggle } from '@vueuse/core'

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

  return { isDark, toggleTheme, editorLineNumbers, toggleEditorLineNumbers }
})
