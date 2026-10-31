import { describe, expect, it } from 'vitest'
import {
  extractMarkdownTitle,
  planMarkdownNotes,
  relinkImageReferences,
  titleFromPath,
} from '@/features/import/markdownImport'

describe('markdownImport（F-801）', () => {
  describe('extractMarkdownTitle', () => {
    it('首个非空行是 H1：取作标题并剥离', () => {
      const result = extractMarkdownTitle('\n\n# 标题\n\n正文')
      expect(result.title).toBe('标题')
      expect(result.content).toBe('\n\n\n正文')
    })

    it('首个非空行不是 H1：标题为空、正文原样', () => {
      const result = extractMarkdownTitle('正文第一行\n# 不是标题')
      expect(result.title).toBe('')
      expect(result.content).toBe('正文第一行\n# 不是标题')
    })

    it('H1 闭合井号剥离', () => {
      expect(extractMarkdownTitle('# 标题 #').title).toBe('标题')
    })
  })

  describe('titleFromPath', () => {
    it('剥扩展名', () => {
      expect(titleFromPath('notes/会议记录.md')).toBe('会议记录')
      expect(titleFromPath('a/b.MARKDOWN')).toBe('b')
    })
  })

  describe('planMarkdownNotes', () => {
    it('根文件 → 未分类', () => {
      const [plan] = planMarkdownNotes([{ path: 'a.md', content: '# T\n内容' }])
      expect(plan!.folderName).toBeNull()
      expect(plan!.title).toBe('T')
    })

    it('一级目录 → 文件夹名', () => {
      const [plan] = planMarkdownNotes([{ path: '日记/x.md', content: '正文' }])
      expect(plan!.folderName).toBe('日记')
      expect(plan!.title).toBe('x')
    })

    it('二级目录起平铺：层级以标题前置保留在一篇内', () => {
      const [plan] = planMarkdownNotes([{ path: '工作/2024/计划.md', content: '# 计划\n内容' }])
      expect(plan!.folderName).toBe('工作')
      expect(plan!.content.startsWith('# 2024\n\n内容')).toBe(true)
    })

    it('三级目录的层级标题级别递增', () => {
      const [plan] = planMarkdownNotes([{ path: 'a/b/c/d.md', content: '内容' }])
      expect(plan!.folderName).toBe('a')
      expect(plan!.content.startsWith('# b\n\n## c\n\n内容')).toBe(true)
    })
  })

  describe('relinkImageReferences', () => {
    it('命中解析表 → 替换为附件引用', () => {
      const result = relinkImageReferences('![图](assets/img.png) 后文', () => 'tinynote-attachment://id1')
      expect(result).toBe('![图](tinynote-attachment://id1) 后文')
    })

    it('未命中保留原文', () => {
      const original = '![图](assets/missing.png)'
      expect(relinkImageReferences(original, () => null)).toBe(original)
    })

    it('远程 http 引用也交给 resolve 判定（调用方应放行远程）', () => {
      const original = '![图](https://example.com/a.png)'
      expect(relinkImageReferences(original, () => null)).toBe(original)
    })

    it('无图片引用时原样返回', () => {
      const original = '[链接](x.md) 文本'
      expect(relinkImageReferences(original, () => 'r')).toBe(original)
    })
  })
})
