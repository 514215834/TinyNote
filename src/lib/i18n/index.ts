import { ref } from 'vue'
import type { Locale } from './types'
import { dictionaryOf } from './registry'
import './zh-CN'
import './en'

/**
 * i18n（F-601）：中/英双语，文案层抽离。中文（zh-CN）为源语言字典，英文为翻译字典；
 * t() 读取响应式 locale——在模板/计算属性中调用即获得语言切换的响应更新。
 * 缺失 key 的回退顺序：当前语言 → 源语言（zh-CN）→ key 本身（开发期可见，配套单测保证字典齐全）。
 * 语言偏好存 localStorage `tinynote:locale`（「清空全部数据」时随 tinynote:* 一并清除）。
 */

export type { Locale }
export { registerDictionary } from './registry'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
]

const STORAGE_KEY = 'tinynote:locale'

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'zh-CN' || value === 'en' ? value : null
  } catch {
    return null
  }
}

/** 当前语言（响应式）：t() 在渲染中调用时自动建立依赖，切换语言即时刷新界面 */
export const locale = ref<Locale>(readStoredLocale() ?? detectLocale())

export function setLocale(next: Locale): void {
  locale.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 无 localStorage 的环境（node 测试/隐私模式兜底）：仅本次会话生效
  }
}

/** toLocale* 用的 BCP 47 标签（时间格式化随语言切换） */
export function localeTag(): string {
  return locale.value === 'en' ? 'en-US' : 'zh-CN'
}

/** 翻译：{name} 占位符插值，参数缺失时保留占位符原样 */
export function t(key: string, params?: Record<string, string | number>): string {
  const raw = dictionaryOf(locale.value)?.[key] ?? dictionaryOf('zh-CN')?.[key] ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}
