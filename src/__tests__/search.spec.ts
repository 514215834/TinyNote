import { describe, expect, it } from 'vitest'
import type { Note } from '@/types'
import { filterNotes } from '@/features/search/search'

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
