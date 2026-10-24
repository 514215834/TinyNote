/**
 * 外观定制领域层（F-521）：主题预设表与自定义取色的派生计算，全部为纯函数。
 * 应用（写 CSS 变量）在 settings store 的 applyAppearance；派生算法在此便于单测。
 */

export interface AccentPreset {
  id: AccentId
  label: string
  accent: string
  accentStrong: string
  /** 环境光晕三色（浅色/深色模式各一组，hex） */
  orbLight: [string, string, string]
  orbDark: [string, string, string]
}

export type AccentId = 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky' | 'custom'
export type FontChoice = 'system' | 'serif' | 'mono'
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full'

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'indigo',
    label: '靛蓝',
    accent: '#6366f1',
    accentStrong: '#4f46e5',
    orbLight: ['#a5b4fc', '#7dd3fc', '#fda4af'],
    orbDark: ['#6366f1', '#0ea5e9', '#d946ef'],
  },
  {
    id: 'violet',
    label: '紫罗兰',
    accent: '#8b5cf6',
    accentStrong: '#7c3aed',
    orbLight: ['#c4b5fd', '#f0abfc', '#93c5fd'],
    orbDark: ['#8b5cf6', '#d946ef', '#60a5fa'],
  },
  {
    id: 'emerald',
    label: '翠绿',
    accent: '#10b981',
    accentStrong: '#059669',
    orbLight: ['#6ee7b7', '#7dd3fc', '#bef264'],
    orbDark: ['#10b981', '#0ea5e9', '#84cc16'],
  },
  {
    id: 'amber',
    label: '琥珀',
    accent: '#f59e0b',
    accentStrong: '#d97706',
    orbLight: ['#fcd34d', '#fda4af', '#fdba74'],
    orbDark: ['#f59e0b', '#fb7185', '#fb923c'],
  },
  {
    id: 'rose',
    label: '玫红',
    accent: '#f43f5e',
    accentStrong: '#e11d48',
    orbLight: ['#fda4af', '#f9a8d4', '#fdba74'],
    orbDark: ['#f43f5e', '#ec4899', '#fb923c'],
  },
  {
    id: 'sky',
    label: '天蓝',
    accent: '#0ea5e9',
    accentStrong: '#0284c7',
    orbLight: ['#7dd3fc', '#a5b4fc', '#6ee7b7'],
    orbDark: ['#0ea5e9', '#818cf8', '#14b8a6'],
  },
]

export const DEFAULT_ACCENT_ID: AccentId = 'indigo'

export const FONT_STACKS: Record<FontChoice, string> = {
  system: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Mono", monospace',
}

export const CONTENT_WIDTHS: Record<ContentWidth, string> = {
  narrow: '42rem',
  medium: '56rem',
  wide: '72rem',
  full: '100%',
}

/** 外观变量解析结果：写入 documentElement 的全部 CSS 变量 */
export interface AppearanceVars {
  accent: string
  accentStrong: string
  orbLight: [string, string, string]
  orbDark: [string, string, string]
  fontContent: string
  previewFontSize: string
  contentMaxWidth: string
}

/**
 * 依据偏好解析出全部 CSS 变量。自定义色时：
 * - accent = 取色值，accentStrong = 加深 15%；
 * - 光晕以取色值为基准做色相偏移，保留「三色环境光」的层次感。
 * fontPx 超界时夹取（12–20）。
 */
export function resolveAppearance(
  accentId: AccentId,
  customHex: string,
  font: FontChoice,
  fontSizePx: number,
  width: ContentWidth,
): AppearanceVars {
  const preset = ACCENT_PRESETS.find((item) => item.id === accentId)
  const accent = preset?.accent ?? clampHex(customHex)
  const accentStrong = preset?.accentStrong ?? darkenHex(accent, 0.15)
  const orbLight = preset?.orbLight ?? (orbTrio(accent, 0.45, 0.4, 0.35) as [string, string, string])
  const orbDark = preset?.orbDark ?? (orbTrio(accent, 0.2, 0.15, 0.12) as [string, string, string])
  return {
    accent,
    accentStrong,
    orbLight,
    orbDark,
    fontContent: FONT_STACKS[font] ?? FONT_STACKS.system,
    previewFontSize: `${Math.min(20, Math.max(12, Math.round(fontSizePx)))}px`,
    contentMaxWidth: CONTENT_WIDTHS[width] ?? CONTENT_WIDTHS.wide,
  }
}

/* ============================== 颜色工具（自定义取色派生） ============================== */

const HEX_RE = /^#([0-9a-f]{6})$/i

/** 非法输入一律回退默认品牌色（localStorage 手改兜底） */
export function clampHex(hex: string): string {
  return HEX_RE.test(hex.trim()) ? hex.trim().toLowerCase() : ACCENT_PRESETS[0]!.accent
}

/** hex → rgba 字符串（光晕需要透明度） */
export function withAlpha(hex: string, alpha: number): string {
  const value = clampHex(hex).slice(1)
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 按比例加深（amount ∈ [0,1]）：RGB 各通道线性趋近 0 */
export function darkenHex(hex: string, amount: number): string {
  const value = clampHex(hex).slice(1)
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
  const [r, g, b] = channels.map((channel) => Math.round(channel * (1 - amount)))
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** 色相旋转（度）后再转回 hex：自定义主题的光晕层次 */
export function rotateHue(hex: string, degrees: number): string {
  const value = clampHex(hex).slice(1)
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  h = (h + degrees + 360) % 360
  return hslToHex(h, s, l)
}

/** 以基准色生成三个色相错开的光晕色（返回 rgba 字符串） */
export function orbTrio(base: string, a1: number, a2: number, a3: number): string[] {
  return [0, 30, -40].map((degrees, index) => {
    const alpha = [a1, a2, a3][index]!
    return withAlpha(rotateHue(base, degrees), alpha)
  })
}

function hslToHex(h: number, s: number, l: number): string {
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12
    const value = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255)
  }
  return `#${[channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
