import { describe, expect, it } from 'vitest'
import {
  demoteHeadings,
  planNotionDatabase,
  planNotionPages,
  stripNotionId,
} from '@/features/import/notionImport'

describe('notionImport（F-804）', () => {
  describe('stripNotionId', () => {
    it('剥离尾部 32 位 hex 标识', () => {
      expect(stripNotionId('项目计划 8b7c1a2d3e4f5a6b7c8d9e0f1a2b3c4d')).toBe('项目计划')
    })

    it('无标识时原样', () => {
      expect(stripNotionId('普通标题')).toBe('普通标题')
    })
  })

  describe('demoteHeadings', () => {
    it('标题按深度降级', () => {
      expect(demoteHeadings('# 一\n## 二', 2)).toBe('### 一\n#### 二')
    })

    it('超过 6 级封顶', () => {
      expect(demoteHeadings('## 五', 5)).toBe('###### 五')
    })
  })

  describe('planNotionPages', () => {
    it('嵌套子页内联进父页：标题层级随深度、页间链接降噪、图片重链', () => {
      const mdFiles = new Map<string, string>([
        ['父页 11111111111111111111111111111111.md', '父内容\n![图](11111111111111111111111111111111-hash.png)\n[子页](%E5%AD%90%E9%A1%B5%2022222222222222222222222222222222.md)'],
        ['父页 11111111111111111111111111111111/子页 22222222222222222222222222222222.md', '## 子节\n子内容'],
      ])
      const [plan] = planNotionPages(mdFiles, (href) =>
        href.includes('hash') ? 'tinynote-attachment://att1' : null,
      )
      expect(plan!.title).toBe('父页')
      expect(plan!.content).toContain('![图](tinynote-attachment://att1)')
      expect(plan!.content).toContain('子页') // 链接降噪为纯文本
      expect(plan!.content).not.toContain('.md)')
      // 子页内联：标题 # 子页，内部 ## 降为 ###
      expect(plan!.content).toContain('# 子页')
      expect(plan!.content).toContain('### 子节')
    })

    it('Untitled 空壳页跳过', () => {
      const mdFiles = new Map<string, string>([
        ['Untitled 11111111111111111111111111111111.md', ''],
        ['实页 22222222222222222222222222222222.md', '内容'],
      ])
      const plans = planNotionPages(mdFiles)
      expect(plans).toHaveLength(1)
      expect(plans[0]!.title).toBe('实页')
    })

    it('孤儿子页（无同名父 md）也作为顶页产出', () => {
      const mdFiles = new Map<string, string>([
        ['散页/孤页 11111111111111111111111111111111.md', '内容'],
      ])
      const plans = planNotionPages(mdFiles)
      expect(plans).toHaveLength(1)
      expect(plans[0]!.title).toBe('孤页')
    })
  })

  describe('planNotionDatabase', () => {
    const CSV = [
      'Name,状态,创建时间,公式列',
      '"任务 A",进行中,"2024-03-01",=2+2',
      '"任务 B",完成,"2024-04-05 10:30",=1+1',
      ',,,' ,
    ].join('\n')

    it('每行一篇：标题/标签/日期映射、公式列进属性表、空行跳过计数', () => {
      const { rows, skipped } = planNotionDatabase(CSV)
      expect(skipped).toBe(1)
      expect(rows).toHaveLength(2)
      const [first] = rows
      expect(first!.title).toBe('任务 A')
      expect(first!.tags).toEqual(['进行中', '=2+2']) // 短文本值都归标签（公式列取纯文本）
      expect(first!.createdAt).toBe(Date.parse('2024-03-01T00:00:00Z'))
      expect(first!.updatedAt).toBeNull() // 单一日期列：只映射 createdAt
      expect(first!.content).toContain('| 状态 | 进行中 |')
      expect(first!.content).toContain('| 公式列 | =2+2 |')
    })

    it('日期列按列名优先：created → createdAt，modified/updated → updatedAt', () => {
      const table = ['Name,创建时间,修改时间', 'A,"2024-01-01","2024-02-02"'].join('\n')
      const [row] = planNotionDatabase(table).rows
      expect(row!.createdAt).toBe(Date.parse('2024-01-01T00:00:00Z'))
      expect(row!.updatedAt).toBe(Date.parse('2024-02-02T00:00:00Z'))
    })

    it('非日期列不误判：普通文本列不映射时间', () => {
      const table = ['Name,备注', 'A,进行中'].join('\n')
      const [row] = planNotionDatabase(table).rows
      expect(row!.createdAt).toBeNull()
      expect(row!.updatedAt).toBeNull()
    })

    it('只有表头的 csv：全部计为跳过', () => {
      const { rows, skipped } = planNotionDatabase('Name,状态')
      expect(rows).toHaveLength(0)
      expect(skipped).toBe(0) // 表头以下没有数据行
    })
  })
})
