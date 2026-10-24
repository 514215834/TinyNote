import { describe, expect, it } from 'vitest'
import { displayTitle, makeExcerpt, sortNotesForList } from '@/features/notes/notes'

describe('displayTitle（F-104）', () => {
  it('优先使用标题字段（去除首尾空白）', () => {
    expect(displayTitle({ title: ' 我的标题 ', content: '内容' })).toBe('我的标题')
  })

  it('标题缺失时回退正文首行', () => {
    expect(displayTitle({ title: '', content: '\n第一行内容\n正文' })).toBe('第一行内容')
  })

  it('全空时回退占位文案', () => {
    expect(displayTitle({ title: '  ', content: ' \n ' })).toBe('无标题笔记')
  })
})

describe('makeExcerpt（F-104）', () => {
  it('去除常见 Markdown 标记', () => {
    expect(makeExcerpt('# 标题\n**加粗**和[链接](https://a.b)')).toBe('标题 加粗 和链接')
  })

  it('代码块不进入摘要', () => {
    expect(makeExcerpt('```js\nconst a = 1\n```\n正文')).toBe('正文')
  })

  it('超长内容截断并加省略号', () => {
    const excerpt = makeExcerpt('a'.repeat(100), 60)
    expect(excerpt).toHaveLength(61)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('空内容显示占位文案', () => {
    expect(makeExcerpt('')).toBe('空白笔记')
  })
})

describe('sortNotesForList（F-203）', () => {
  it('置顶笔记排在最前，组内保持原有 updatedAt 倒序', () => {
    const list = [
      { id: 'a', pinned: false }, // 最旧
      { id: 'b', pinned: false },
      { id: 'c', pinned: true },
      { id: 'd', pinned: true },
    ]
    expect(sortNotesForList(list).map((note) => note.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('返回新数组，不改入参顺序', () => {
    const list = [{ id: 'a', pinned: false }, { id: 'b', pinned: true }]
    sortNotesForList(list)
    expect(list.map((note) => note.id)).toEqual(['a', 'b'])
  })
})
