import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/features/import/csv'

describe('csv（F-804 Notion 数据库 csv）', () => {
  it('基础逗号分隔', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('引号字段内逗号与换行', () => {
    expect(parseCsv('name,note\n"x,y","line1\nline2"')).toEqual([
      ['name', 'note'],
      ['x,y', 'line1\nline2'],
    ])
  })

  it('双引号转义', () => {
    expect(parseCsv('q\n"say ""hi"""')).toEqual([['q'], ['say "hi"']])
  })

  it('CRLF 行尾', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('BOM 剥离', () => {
    expect(parseCsv('\uFEFFa\n1')[0]).toEqual(['a'])
  })

  it('空行不产生记录', () => {
    expect(parseCsv('a\n1\n\n\n2')).toEqual([
      ['a'],
      ['1'],
      ['2'],
    ])
  })

  it('空输入返回空表', () => {
    expect(parseCsv('')).toEqual([])
  })
})
