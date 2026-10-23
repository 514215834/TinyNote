import { describe, expect, it } from 'vitest'
import { extractHeadings, slugify } from '@/lib/markdown/outline'
import { renderMarkdown } from '@/lib/markdown/render'

describe('slugify（F-302 锚点约定）', () => {
  it('去标记、空白折叠为连字符、小写化，支持 CJK', () => {
    expect(slugify('安装 指南')).toBe('安装-指南')
    expect(slugify('## **深入**:配置')).toBe('深入配置')
    expect(slugify('  Build  Setup! ')).toBe('build-setup')
  })

  it('空结果回退 heading，保证 id 非空', () => {
    expect(slugify('***')).toBe('heading')
  })
})

describe('extractHeadings（F-302）', () => {
  it('提取层级与纯文本，跳过代码块中的伪标题', () => {
    const source = [
      '# 入门',
      '',
      '## 安装依赖',
      '',
      '### 配置 Vite',
      '',
      '```md',
      '# 这不是标题',
      '```',
      '',
      '## 收尾',
    ].join('\n')
    expect(extractHeadings(source)).toEqual([
      { level: 1, text: '入门', id: '入门' },
      { level: 2, text: '安装依赖', id: '安装依赖' },
      { level: 3, text: '配置 Vite', id: '配置-vite' },
      { level: 2, text: '收尾', id: '收尾' },
    ])
  })

  it('重复标题去重后缀与渲染产出的 id 完全一致', () => {
    const source = '# 重复\n\n# **重复**'
    const headings = extractHeadings(source)
    expect(headings.map((heading) => heading.id)).toEqual(['重复', '重复-1'])

    const html = renderMarkdown(source)
    expect(html).toContain('<h1 id="重复">')
    expect(html).toContain('<h1 id="重复-1">')
  })

  it('空文档返回空数组', () => {
    expect(extractHeadings('')).toEqual([])
    expect(extractHeadings('只有正文，没有标题')).toEqual([])
  })
})
