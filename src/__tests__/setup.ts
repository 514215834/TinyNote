import { setLocale } from '@/lib/i18n'

// 全部单测钉在 zh-CN：字典/时间/领域字符串断言与源语言一致（happy-dom 的 navigator.language
// 默认为 en-US，不钉住会让 locale 检测漂移到英文）。node 环境无 localStorage，setLocale 仅改内存。
if (typeof localStorage !== 'undefined') {
  localStorage.setItem('tinynote:locale', 'zh-CN')
}
setLocale('zh-CN')
