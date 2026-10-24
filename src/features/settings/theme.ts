/**
 * 外观定制领域层（F-521）：主题预设表与自定义取色的派生计算，全部为纯函数。
 * 应用（写 CSS 变量）在 settings store 的 applyAppearance；派生算法在此便于单测。
 * 注：背景环境光晕已移除（半透明玻璃下光斑干扰正文阅读），只保留强调色 token。
 */

export interface AccentPreset {
  id: AccentId
  label: string
  accent: string
  accentStrong: string
}

export type AccentId = 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky' | 'custom'
export type FontChoice = 'system' | 'serif' | 'mono'
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full'

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', label: '靛蓝', accent: '#6366f1', accentStrong: '#4f46e5' },
  { id: 'violet', label: '紫罗兰', accent: '#8b5cf6', accentStrong: '#7c3aed' },
  { id: 'emerald', label: '翠绿', accent: '#10b981', accentStrong: '#059669' },
  { id: 'amber', label: '琥珀', accent: '#f59e0b', accentStrong: '#d97706' },
  { id: 'rose', label: '玫红', accent: '#f43f5e', accentStrong: '#e11d48' },
  { id: 'sky', label: '天蓝', accent: '#0ea5e9', accentStrong: '#0284c7' },
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
  fontContent: string
  previewFontSize: string
  contentMaxWidth: string
}

/**
 * 依据偏好解析出全部 CSS 变量。自定义色时：
 * - accent = 取色值，accentStrong = 加深 15%。
 * fontPx 越界时夹取（12–20）。
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
  return {
    accent,
    accentStrong,
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

/** 按比例加深（amount ∈ [0,1]）：RGB 各通道线性趋近 0 */
export function darkenHex(hex: string, amount: number): string {
  const value = clampHex(hex).slice(1)
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
  const [r, g, b] = channels.map((channel) => Math.round(channel * (1 - amount)))
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}
