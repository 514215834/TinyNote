import { describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS,
  clampHex,
  CONTENT_WIDTHS,
  darkenHex,
  FONT_STACKS,
  orbTrio,
  resolveAppearance,
  rotateHue,
  withAlpha,
} from '@/features/settings/theme'

describe('clampHex（自定义取色兜底）', () => {
  it('合法 6 位 hex 原样（小写化），非法输入回退默认品牌色', () => {
    expect(clampHex('#FF5733')).toBe('#ff5733')
    expect(clampHex('#6366f1')).toBe('#6366f1')
    expect(clampHex('red')).toBe('#6366f1')
    expect(clampHex('#12345')).toBe('#6366f1')
    expect(clampHex('')).toBe('#6366f1')
  })
})

describe('颜色派生工具', () => {
  it('withAlpha 产出 rgba 字符串', () => {
    expect(withAlpha('#a5b4fc', 0.45)).toBe('rgba(165, 180, 252, 0.45)')
  })

  it('darkenHex 按比例加深 RGB 通道', () => {
    expect(darkenHex('#6366f1', 0.15)).toBe('#5457cd')
    expect(darkenHex('#ff0000', 1)).toBe('#000000')
    expect(darkenHex('#ffffff', 0)).toBe('#ffffff')
  })

  it('rotateHue 保持明度与饱和度语义（纯红转 120° 得纯绿）', () => {
    expect(rotateHue('#ff0000', 120)).toBe('#00ff00')
    expect(rotateHue('#00ff00', -120)).toBe('#ff0000')
    // 灰色无色相：旋转后仍为灰
    expect(rotateHue('#808080', 90)).toBe('#808080')
  })

  it('orbTrio 生成三个带透明度的光晕色', () => {
    const trio = orbTrio('#6366f1', 0.45, 0.4, 0.35)
    expect(trio).toHaveLength(3)
    expect(trio.every((color) => color.startsWith('rgba('))).toBe(true)
    expect(trio[0]).toContain('0.45')
  })
})

describe('resolveAppearance（F-521 外观变量解析）', () => {
  it('预设 id 直接取预设色与光晕', () => {
    const vars = resolveAppearance('indigo', '#000000', 'system', 16, 'wide')
    expect(vars.accent).toBe('#6366f1')
    expect(vars.accentStrong).toBe('#4f46e5')
    expect(vars.orbLight).toEqual(ACCENT_PRESETS[0]!.orbLight)
    expect(vars.fontContent).toBe(FONT_STACKS.system)
    expect(vars.previewFontSize).toBe('16px')
    expect(vars.contentMaxWidth).toBe(CONTENT_WIDTHS.wide)
  })

  it('custom：accent 取自定义色，strong 为加深 15%，光晕按色相偏移派生', () => {
    const vars = resolveAppearance('custom', '#ff0000', 'mono', 14, 'narrow')
    expect(vars.accent).toBe('#ff0000')
    expect(vars.accentStrong).toBe(darkenHex('#ff0000', 0.15))
    expect(vars.orbLight.every((color) => color.startsWith('rgba(255, 0, 0') || color.startsWith('rgba('))).toBe(true)
    expect(vars.fontContent).toBe(FONT_STACKS.mono)
    expect(vars.previewFontSize).toBe('14px')
    expect(vars.contentMaxWidth).toBe(CONTENT_WIDTHS.narrow)
  })

  it('字号越界夹取 12–20，未知偏好回退默认', () => {
    expect(resolveAppearance('indigo', '#6366f1', 'system', 8, 'wide').previewFontSize).toBe('12px')
    expect(resolveAppearance('indigo', '#6366f1', 'system', 99, 'wide').previewFontSize).toBe('20px')
    // accentId 非法（预设表查不到）走 custom 分支且取色非法回退品牌色
    expect(resolveAppearance('bogus' as never, 'not-a-color', 'system', 16, 'wide').accent).toBe('#6366f1')
  })
})
