import { describe, expect, it } from 'vitest'
import type { Note } from '@/types'
import { addTag, collectTags, parseTagInput, removeTag } from '@/features/tags/tags'

function makeNote(id: string, tags: string[]): Note {
  return {
    id,
    title: `标题-${id}`,
    content: '内容',
    folderId: null,
    tags,
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('parseTagInput（F-202）', () => {
  it('按空白 / 中英文逗号 / 顿号切分', () => {
    expect(parseTagInput('工作, 旅行、学习party， meeting')).toEqual([
      '工作',
      '旅行',
      '学习party',
      'meeting',
    ])
  })

  it('空白片段被丢弃', () => {
    expect(parseTagInput('  a  ,  ，，  b ')).toEqual(['a', 'b'])
    expect(parseTagInput('')).toEqual([])
  })
})

describe('addTag / removeTag（F-202）', () => {
  it('追加并大小写不敏感去重（保留首次出现的大小写）', () => {
    expect(addTag(['work'], 'WORK  学习')).toEqual(['work', '学习'])
    expect(addTag([], 'a, a, A')).toEqual(['a'])
  })

  it('返回新数组，不改入参', () => {
    const original = ['work']
    const next = addTag(original, '学习')
    expect(original).toEqual(['work'])
    expect(next).toEqual(['work', '学习'])
  })

  it('移除时大小写不敏感', () => {
    expect(removeTag(['工作', 'Work2'], 'WORK2')).toEqual(['工作'])
    expect(removeTag(['工作'], '学习')).toEqual(['工作'])
  })
})

describe('collectTags（F-202 标签云）', () => {
  it('统计笔记数并按频次降序、同频按名称升序', () => {
    const notes = [
      makeNote('a', ['工作', '紧急']),
      makeNote('b', ['工作']),
      makeNote('c', ['生活']),
    ]
    expect(collectTags(notes)).toEqual([
      { tag: '工作', count: 2 },
      { tag: '紧急', count: 1 },
      { tag: '生活', count: 1 },
    ])
  })

  it('大小写不同的标签算同一张（保留首次大小写）', () => {
    expect(collectTags([makeNote('a', ['work']), makeNote('b', ['WORK'])])).toEqual([
      { tag: 'work', count: 2 },
    ])
  })

  it('无标签返回空数组', () => {
    expect(collectTags([makeNote('a', [])])).toEqual([])
  })
})
