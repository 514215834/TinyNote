import { describe, expect, it } from 'vitest'
import type { Note } from '@/types'
import { filterByFolder, filterByTag, filterNotes } from '@/features/search/search'

function makeNote(id: string, title: string, content: string, updatedAt = 1): Note {
  return {
    id,
    title,
    content,
    folderId: null,
    tags: [],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

const notes = [
  makeNote('a', 'Vue 学习笔记', 'Composition API 的用法'),
  makeNote('b', '购物清单', '买一本 vue router 的书'),
  makeNote('c', '工作日志', '完成架构评审'),
]

describe('filterNotes（F-105）', () => {
  it('空查询原样返回（保持 updatedAt 排序）', () => {
    expect(filterNotes(notes, '   ')).toEqual(notes)
  })

  it('大小写不敏感地命中标题与正文', () => {
    expect(filterNotes(notes, 'VUE').map((note) => note.id)).toEqual(['a', 'b'])
  })

  it('标题命中排在正文命中之前', () => {
    const list = [makeNote('x', '日常记录', 'vue'), makeNote('y', 'vue 教程', '正文')]
    expect(filterNotes(list, 'vue').map((note) => note.id)).toEqual(['y', 'x'])
  })

  it('无命中返回空数组', () => {
    expect(filterNotes(notes, '不存在的关键词')).toEqual([])
  })
})

describe('filterByFolder（F-205）', () => {
  it('null 表示「全部笔记」，原样返回', () => {
    expect(filterByFolder(notes, null)).toEqual(notes)
  })

  it('按 folderId 精确过滤', () => {
    const inFolder = { ...makeNote('f1', '文件夹笔记', '内容'), folderId: 'f1' }
    expect(filterByFolder([...notes, inFolder], 'f1')).toEqual([inFolder])
    expect(filterByFolder([...notes, inFolder], '不存在的文件夹')).toEqual([])
  })
})

describe('filterByTag（F-205）', () => {
  it('null 表示不按标签过滤', () => {
    expect(filterByTag(notes, null)).toEqual(notes)
  })

  it('大小写不敏感地按标签过滤', () => {
    const work = { ...makeNote('w', '工作清单', '内容'), tags: ['Work'] }
    const other = { ...makeNote('o', '购物', '内容'), tags: ['生活'] }
    expect(filterByTag([work, other], 'work')).toEqual([work])
    expect(filterByTag([work, other], 'WORK')).toEqual([work])
    expect(filterByTag([work, other], '不存在的')).toEqual([])
  })
})
