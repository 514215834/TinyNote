import { describe, expect, it } from 'vitest'
import { matchesShortcut } from '@/composables/shortcuts'

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

describe('matchesShortcut（F-206）', () => {
  it('Ctrl+字母命中（key 大小写不敏感）', () => {
    expect(matchesShortcut(press('n', { ctrlKey: true }), 'ctrl+n')).toBe(true)
    expect(matchesShortcut(press('N', { ctrlKey: true }), 'ctrl+n')).toBe(true)
  })

  it('缺少修饰位不命中', () => {
    expect(matchesShortcut(press('n'), 'ctrl+n')).toBe(false)
  })

  it('⌘（meta）等价于 ctrl 修饰位（macOS）', () => {
    expect(matchesShortcut(press('n', { metaKey: true }), 'ctrl+n')).toBe(true)
  })

  it('多余的修饰位不命中（strict shift）', () => {
    expect(matchesShortcut(press('k', { ctrlKey: true }), 'ctrl+shift+k')).toBe(false)
    expect(matchesShortcut(press('k', { ctrlKey: true, shiftKey: true }), 'ctrl+shift+k')).toBe(true)
  })

  it('单独按下修饰键本身不命中', () => {
    expect(matchesShortcut(press('Control', { ctrlKey: true }), 'ctrl+n')).toBe(false)
  })

  it('多出的 ctrl 不命中非兜底组合', () => {
    expect(matchesShortcut(press('n', { ctrlKey: true, shiftKey: true }), 'ctrl+n')).toBe(false)
  })

  it('不支持未知修饰位直接判不匹配', () => {
    expect(matchesShortcut(press('n', { ctrlKey: true }), 'ctrl+cmd+n')).toBe(false)
  })

  it('alt 组合', () => {
    expect(matchesShortcut(press('p', { altKey: true }), 'alt+p')).toBe(true)
    expect(matchesShortcut(press('p'), 'alt+p')).toBe(false)
  })
})
