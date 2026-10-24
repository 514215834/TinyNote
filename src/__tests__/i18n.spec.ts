import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dictionaryOf } from '@/lib/i18n/registry'
import { setLocale, t } from '@/lib/i18n'

const zh = dictionaryOf('zh-CN')!
const en = dictionaryOf('en')!

describe('i18n 字典（F-601）', () => {
  it('zh-CN 与 en 的 key 集合完全一致', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    const onlyZh = zhKeys.filter((key) => !enKeys.includes(key))
    const onlyEn = enKeys.filter((key) => !zhKeys.includes(key))
    expect({ onlyZh, onlyEn }).toEqual({ onlyZh: [], onlyEn: [] })
  })

  it('字典值均为非空字符串', () => {
    for (const dict of [zh, en]) {
      for (const value of Object.values(dict)) {
        expect(typeof value).toBe('string')
        expect((value as string).length).toBeGreaterThan(0)
      }
    }
  })

  it('t() 插值与回退：当前语言 → zh-CN → key 本身；缺参数保留占位符', () => {
    setLocale('zh-CN')
    expect(t('common.untitled')).toBe('无标题笔记')
    expect(t('time.minutesAgo', { n: 5 })).toBe('5 分钟前')
    expect(t('time.minutesAgo', { n: 5, extra: 1 })).toBe('5 分钟前')
    expect(t('time.minutesAgo')).toBe('{n} 分钟前')
    expect(t('no.such.key')).toBe('no.such.key')

    setLocale('en')
    expect(t('common.untitled')).toBe('Untitled note')
    expect(t('time.minutesAgo', { n: 3 })).toBe('3 min ago')
    setLocale('zh-CN')
  })

  it('locale 切换是响应式的（t() 读取 locale.value）', () => {
    setLocale('zh-CN')
    expect(t('sidebar.trash')).toBe('回收站')
    setLocale('en')
    expect(t('sidebar.trash')).toBe('Trash')
    setLocale('zh-CN')
  })
})

/* ============================== 使用中 key 的静态扫描 ============================== */

/** 递归收集 src 下被测源码文件（排除测试与字典自身） */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'i18n' || name === 'node_modules') continue
      collectSourceFiles(full, acc)
    } else if (/\.(ts|vue)$/.test(name)) {
      acc.push(full)
    }
  }
  return acc
}

describe('i18n 使用中 key 静态扫描（防字典缺 key）', () => {
  const srcRoot = join(__dirname, '..')
  const files = collectSourceFiles(srcRoot)

  it('源码中 t(\'...\') 的每个字面量 key 都存在于两份字典', () => {
    const used = new Set<string>()
    const dynamicPrefixes = new Set<string>()
    const callRe = /\bt\(\s*(['"])((?:[\w.-]+))\1/g
    const dynamicRe = /\bt\(\s*`([^`]+)`/g

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(callRe)) used.add(match[2]!)
      for (const match of source.matchAll(dynamicRe)) {
        // 模板串动态 key（如 `settings.accent.${id}`）：取字面前缀做前缀校验
        dynamicPrefixes.add(match[1]!.split('${')[0]!)
      }
    }

    const missing = [...used].filter((key) => zh[key] === undefined || en[key] === undefined)
    expect({ missing, checked: used.size }).toEqual({ missing: [], checked: expect.any(Number) })

    // 动态前缀（settings.accent.）至少覆盖一个已知实例
    for (const prefix of dynamicPrefixes) {
      const covered = Object.keys(zh).some((key) => key.startsWith(prefix))
      expect({ prefix, covered }).toEqual({ prefix, covered: true })
    }
  })
})
