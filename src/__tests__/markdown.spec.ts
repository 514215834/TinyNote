import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdown/render'

describe('renderMarkdown（F-103）', () => {
  it('渲染基础 Markdown 语法', () => {
    expect(renderMarkdown('# 标题')).toContain('<h1 id="标题">标题</h1>')
    expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>')
    expect(renderMarkdown('> 引用')).toContain('<blockquote>')
  })

  it('原始 HTML 一律转义，不产生可执行标签（ADR-006）', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('onerror 之类内联属性同样被转义', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('外链统一 target=_blank 且 rel=noopener noreferrer', () => {
    const html = renderMarkdown('[TinyNote](https://github.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('代码块经 highlight.js 高亮', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')
    expect(html).toContain('hljs-keyword')
  })

  it('支持 GFM 表格与删除线（default 预置）', () => {
    expect(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).toContain('<table>')
    expect(renderMarkdown('~~删除~~')).toContain('<s>删除</s>')
  })

  it('支持任务列表（F-306）：复选框只读，不接受用户输入', () => {
    const html = renderMarkdown('- [x] 已完成\n- [ ] 待办')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('task-list-item')
  })

  it('支持脚注（F-306）', () => {
    const html = renderMarkdown('一句话[^1]\n\n[^1]: 脚注内容')
    expect(html).toContain('<sup')
    expect(html).toContain('footnote-ref')
    expect(html).toContain('脚注内容')
  })

  it('为标题写入与大纲一致的 id 锚点（F-302）', () => {
    const html = renderMarkdown('# 安装 指南\n\n## 深入:配置')
    expect(html).toContain('<h1 id="安装-指南">')
    expect(html).toContain('<h2 id="深入配置">')
  })

  it('重复标题的 id 追加序号去重（F-302）', () => {
    const html = renderMarkdown('# 重复\n\n# 重复')
    expect(html).toContain('<h1 id="重复">')
    expect(html).toContain('<h1 id="重复-1">')
  })

  it('内部附件引用解析为 blob URL（F-303，经 env 提供映射）', () => {
    const html = renderMarkdown('![截图](tinynote-attachment://att-1)', {
      attachmentUrls: { 'att-1': 'blob:http://localhost/x' },
    })
    // F-523：img 惰性加载属性由渲染器统一写入
    expect(html).toContain('<img src="blob:http://localhost/x" alt="截图" loading="lazy" decoding="async">')
  })

  it('附件映射缺失时渲染占位提示，不留下可疑 img 属性（F-303）', () => {
    const html = renderMarkdown('![截图](tinynote-attachment://missing)', {
      attachmentUrls: {},
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('[图片缺失]')
  })

  it('普通外链 img 不受附件规则影响', () => {
    const html = renderMarkdown('![logo](https://example.com/logo.png)', { attachmentUrls: {} })
    expect(html).toContain('src="https://example.com/logo.png"')
  })
})
