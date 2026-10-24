import { describe, expect, it } from 'vitest'
import { highlightSegments } from '@/features/search/highlight'

describe('highlightSegments（F-205）', () => {
  it('空查询返回单段未命中片段', () => {
    expect(highlightSegments('Hello world', '  ')).toEqual([{ text: 'Hello world', hit: false }])
  })

  it('空文本与空查询返回空数组', () => {
    expect(highlightSegments('', '')).toEqual([])
  })

  it('大小写不敏感命中，保留原文大小写', () => {
    expect(highlightSegments('Vue 与 VUE', 'vue')).toEqual([
      { text: 'Vue', hit: true },
      { text: ' 与 ', hit: false },
      { text: 'VUE', hit: true },
    ])
  })

  it('多命中按出现顺序切分', () => {
    expect(highlightSegments('a-b-a', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: '-b-', hit: false },
      { text: 'a', hit: true },
    ])
  })

  it('关键词中的正则特殊字符按字面匹配', () => {
    expect(highlightSegments('1a*b2', 'a*b')).toEqual([
      { text: '1', hit: false },
      { text: 'a*b', hit: true },
      { text: '2', hit: false },
    ])
  })

  it('无命中返回单段', () => {
    expect(highlightSegments('abc', 'xyz')).toEqual([{ text: 'abc', hit: false }])
  })
})
