import { describe, expect, it } from 'vitest'
import { countChars, countWords } from '@/features/notes/stats'

describe('countWords（F-207）', () => {
  it('CJK 逐字计、拉丁词整词计', () => {
    expect(countWords('你好 world hello 世界')).toBe(6) // 你/好/世/界 共 4 字 + world/hello 2 词
    expect(countWords('hello world')).toBe(2)
    expect(countWords('中英混合 writing')).toBe(5) // 中/英/混/合 4 字 + 1 词
  })

  it('数字串按词计数（点号切断）', () => {
    expect(countWords('版本 0.2 修订')).toBe(6) // 次/版/本/修/订 共 4 字 + 0/2 两词
  })

  it('空串与纯空白为 0', () => {
    expect(countWords('')).toBe(0)
    expect(countWords(' \n\t ')).toBe(0)
  })

  it('标点与 Markdown 标记不计词', () => {
    expect(countWords('# 标题\n**加粗**')).toBe(4)
  })
})

describe('countChars（F-207）', () => {
  it('含空白与换行按原样统计', () => {
    expect(countChars('a b\nc')).toBe(5)
    expect(countChars('你好')).toBe(2)
    expect(countChars('')).toBe(0)
  })
})
