import type { Locale } from './types'

/**
 * 字典注册表（独立模块避免 index ↔ 字典循环导入的 TDZ 问题）：
 * 字典文件只依赖本模块；index.ts 负责 locale 状态并在末尾 side-effect 导入两份字典。
 */
const dictionaries: Partial<Record<Locale, Record<string, string>>> = {}

export function registerDictionary(id: Locale, dict: Record<string, string>): void {
  dictionaries[id] = dict
}

export function dictionaryOf(id: Locale): Record<string, string> | undefined {
  return dictionaries[id]
}
