import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdown/render'

/**
 * F-1001 数学公式规则：占位节点产出与误判防护。
 * KaTeX 的真实渲染在预览增强阶段（动态 import，E2E 覆盖），此处验证 markdown-it 层。
 */

const ON = { math: true }
const OFF = {}

describe('mathInline（F-1001 $…$ 行内）', () => {
  it('开关联动：env.math 关闭时原文照排', () => {
    expect(renderMarkdown('$E=mc^2$', OFF)).toContain('$E=mc^2$')
    expect(renderMarkdown('$E=mc^2$', OFF)).not.toContain('math-inline')
  })

  it('开启时产出占位节点（data-tex 携带原文，内容为转义原文）', () => {
    const html = renderMarkdown('质量 $E=mc^2$ 好吗', ON)
    expect(html).toContain('<span class="math-inline" data-tex="E=mc^2">E=mc^2</span>')
    expect(html).toContain('质量 ')
  })

  it('tex 中的 HTML 特殊字符转义（ADR-006 同向）', () => {
    const html = renderMarkdown('$a<b & c>d$', ON)
    expect(html).toContain('data-tex="a&lt;b &amp; c&gt;d"')
    expect(html).not.toContain('<b &')
  })

  it('误判防护：价格/空白/跨行不触发', () => {
    expect(renderMarkdown('价格 $5 与 $10 合计', ON)).not.toContain('math-inline')
    expect(renderMarkdown('$ x $ 与 $x $ 不算公式', ON)).not.toContain('math-inline') // 定界符内侧空白
    expect(renderMarkdown('第一行 $\n第二行 x$', ON)).not.toContain('math-inline') // 跨行
    expect(renderMarkdown('只有一侧 $x', ON)).not.toContain('math-inline')
  })

  it('行内代码与围栏块内不触发', () => {
    expect(renderMarkdown('行内 `$x$` 不转', ON)).toContain('<code>$x$</code>')
    const fenced = renderMarkdown('```\n$x$\n```', ON)
    expect(fenced).not.toContain('math-inline')
  })

  it('\\$ 转义不参与定界', () => {
    const html = renderMarkdown('价格 \\$5 与 $x+y$ 共计', ON)
    expect(html).toContain('math-inline')
  })
})

describe('mathBlock（F-1001 $$…$$ 块级）', () => {
  it('块级公式（跨行）产出 math-block 占位', () => {
    const html = renderMarkdown('$$\n\\int_0^1 x dx\n$$', ON)
    expect(html).toContain('class="math-block"')
    expect(html).toContain('\\int_0^1 x dx')
  })

  it('单行块级 $$E=mc^2$$ 同样产出', () => {
    const html = renderMarkdown('$$E=mc^2$$', ON)
    expect(html).toContain('class="math-block"')
  })

  it('未闭合的 $$ 按普通段落渲染', () => {
    const html = renderMarkdown('$$\n没有闭合', ON)
    expect(html).not.toContain('math-block')
    expect(html).toContain('$$')
  })

  it('围栏块内的 $$ 不触发', () => {
    const html = renderMarkdown('```bash\n$$x$$\n```', ON)
    expect(html).not.toContain('math-block')
  })

  it('开关关闭时块级原文照排', () => {
    expect(renderMarkdown('$$\nx\n$$', OFF)).toContain('$$')
  })
})

describe('附件卡片（F-1003 链接形态渲染）', () => {
  const env = {
    attachmentUrls: { att1: 'blob:http://localhost/att1' },
    attachments: { att1: { name: '报告.pdf', size: 2048, mime: 'application/pdf' } },
  }

  it('非图片附件链接渲染为附件卡片（名称/类型/大小/下载）', () => {
    const html = renderMarkdown('[报告.pdf](tinynote-attachment://att1)', env)
    expect(html).toContain('class="attachment-card')
    expect(html).toContain('download="报告.pdf"')
    expect(html).toContain('href="blob:http://localhost/att1"')
    expect(html).toContain('PDF')
    expect(html).toContain('2.0 KB')
  })

  it('env 无该附件时渲染缺失占位（与图片缺失同口径）', () => {
    const html = renderMarkdown('[报告.pdf](tinynote-attachment://ghost)', env)
    expect(html).toContain('[附件缺失]')
    expect(html).not.toContain('attachment-card')
  })

  it('普通外链不受影响（link_open 规则照常）', () => {
    const html = renderMarkdown('[官网](https://example.com)', env)
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('attachment-card')
  })
})
