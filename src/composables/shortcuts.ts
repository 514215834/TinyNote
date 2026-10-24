import { useEventListener } from '@vueuse/core'

export interface Hotkey {
  /** 形如 'ctrl+n'、'ctrl+shift+k'；修饰位支持 ctrl/shift/alt */
  combo: string
  handler: (event: KeyboardEvent) => void
}

const KNOWN_MODIFIERS = new Set(['ctrl', 'shift', 'alt'])

/**
 * F-206 快捷键匹配。规则：
 * - key 大小写不敏感；
 * - ctrl 修饰位由 Ctrl 或 ⌘（macOS meta）均可触发；
 * - shift/alt 等其余修饰位必须精确匹配，杜绝误触。
 */
export function matchesShortcut(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  if (!key) return false
  const modifiers = parts.slice(0, -1)
  if (modifiers.some((modifier) => !KNOWN_MODIFIERS.has(modifier))) return false

  if (event.key.toLowerCase() !== key) return false
  if ((event.ctrlKey || event.metaKey) !== modifiers.includes('ctrl')) return false
  if (event.shiftKey !== modifiers.includes('shift')) return false
  if (event.altKey !== modifiers.includes('alt')) return false
  return true
}

/** 注册全局按键：命中时阻止浏览器默认行为并执行 handler */
export function useHotkeys(hotkeys: Hotkey[]): void {
  useEventListener(window, 'keydown', (event) => {
    for (const { combo, handler } of hotkeys) {
      if (matchesShortcut(event, combo)) {
        event.preventDefault()
        handler(event)
        return
      }
    }
  })
}

/** Ctrl+K 聚焦侧边栏搜索框；侧边栏未挂载时不动作 */
export function focusSearchInput(): void {
  document.querySelector<HTMLInputElement>('input[data-note-search]')?.focus()
}
