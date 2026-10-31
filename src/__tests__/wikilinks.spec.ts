import { describe, expect, it } from 'vitest'
import {
  WIKI_LINK_MAX,
  findWikiLinks,
  linkSnippet,
  renderWikiLinkHtml,
  replaceTitleRefs,
} from '@/features/links/wikilinks'

describe('findWikiLinks（F-701 解析口径）', () => {
  it('解析基本语法与别名，at 为原文位置', () => {
    const refs = findWikiLinks('前文 [[目标标题]] 中段 [[标题二|别名文字]] 尾段')
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ target: '目标标题', alias: null })
    expect(refs[0]!.at).toBe(3)
    expect(refs[1]).toMatchObject({ target: '标题二', alias: '别名文字' })
  })

  it('target 与 alias 均 trim；空别名视为 null', () => {
    const refs = findWikiLinks('[[  空白标题  ]] [[标题二| ]]')
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ target: '空白标题', alias: null })
    expect(refs[1]).toMatchObject({ target: '标题二', alias: null })
  })

  it('空 target 无效（`[[|别名]]` / `[[]]` / `[[ ]]`）', () => {
    expect(findWikiLinks('[[|别名]] [[]] [[ ]]')).toEqual([])
  })

  it('行内代码与围栏代码块内不产生有效双链', () => {
    const refs = findWikiLinks('正文 `[[不计入]]` 与\n```\n[[也不计入]]\n```\n之后 [[计入]]')
    expect(refs).toHaveLength(1)
    expect(refs[0]!.target).toBe('计入')
  })

  it('未闭合的围栏代码块内跳过（防半截代码块泄漏链接）', () => {
    const refs = findWikiLinks('```js\nconst x = "[[a]]"')
    expect(refs).toEqual([])
  })

  it('`![[嵌入]]` 是未支持的嵌入语法，按纯文本处理', () => {
    expect(findWikiLinks('![[嵌入]] 与 [[正常]]')).toHaveLength(1)
    expect(findWikiLinks('![[嵌入]]')[0]).toBeUndefined()
  })

  it('含换行或超长 target 不匹配', () => {
    expect(findWikiLinks('[[多\n行]]')).toEqual([])
    expect(findWikiLinks(`[[${'x'.repeat(WIKI_LINK_MAX + 1)}]]`)).toEqual([])
    expect(findWikiLinks(`[[${'x'.repeat(WIKI_LINK_MAX)}]]`)).toHaveLength(1)
  })

  it('不含 [[ 的正文快速返回空', () => {
    expect(findWikiLinks('普通 [markdown](https://example.com) 正文')).toEqual([])
  })
})

describe('linkSnippet（与搜索摘要同口径的 ±40 字上下文）', () => {
  it('越界以 … 收边，引用本体完整包含', () => {
    const content = 'x'.repeat(100) + '[[目标]]' + 'y'.repeat(100)
    const at = 100
    const snippet = linkSnippet(content, at, 40)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('[[目标]]')
  })

  it('短正文不加省略号', () => {
    expect(linkSnippet('短文 [[目标]] 尾', 3, 40)).toBe('短文 [[目标]] 尾')
  })
})

describe('renderWikiLinkHtml（预览锚点，不可信输入转义）', () => {
  it('展示别名；无别名时展示 target', () => {
    expect(renderWikiLinkHtml({ target: '目标', alias: '别名', at: 0 })).toContain('>别名</a>')
    expect(renderWikiLinkHtml({ target: '目标', alias: null, at: 0 })).toContain('>目标</a>')
  })

  it('target 与 label 全部转义（防注入，ADR-006）', () => {
    const html = renderWikiLinkHtml({ target: '目标 <b>"x"</b>', alias: '别名 & <i>', at: 0 })
    expect(html).toContain('data-wikilink="目标 &lt;b&gt;&quot;x&quot;&lt;/b&gt;"')
    expect(html).toContain('>别名 &amp; &lt;i&gt;</a>')
    expect(html).not.toContain('<b>')
  })
})

describe('replaceTitleRefs（F-701 重命名迁移）', () => {
  it('替换指向旧标题的引用并保留别名部分', () => {
    const { content, count } = replaceTitleRefs('[[旧标题]] 与 [[旧标题|备注]] 与 [[无关]]', '旧标题', '新标题')
    expect(content).toBe('[[新标题]] 与 [[新标题|备注]] 与 [[无关]]')
    expect(count).toBe(2)
  })

  it('空别名形式 `[[标题|]]` 一并迁移', () => {
    const { content, count } = replaceTitleRefs('[[旧标题|]]', '旧标题', '新标题')
    expect(content).toBe('[[新标题|]]')
    expect(count).toBe(1)
  })

  it('标题含正则元字符时按字面匹配', () => {
    const { content, count } = replaceTitleRefs('[[C++ (1)]] [[C++ (12)]]', 'C++ (1)', 'C++ (2)')
    expect(content).toBe('[[C++ (2)]] [[C++ (12)]]')
    expect(count).toBe(1)
  })

  it('大小写敏感：拉丁标题不误伤大小写不同的引用', () => {
    const { content, count } = replaceTitleRefs('[[Note]]', 'note', 'Memo')
    expect(content).toBe('[[Note]]')
    expect(count).toBe(0)
  })

  it('oldTitle / newTitle trim 后为空时原样返回', () => {
    expect(replaceTitleRefs('[[旧标题]]', '旧标题', '   ')).toEqual({ content: '[[旧标题]]', count: 0 })
    expect(replaceTitleRefs('[[旧标题]]', '  ', '新标题')).toEqual({ content: '[[旧标题]]', count: 0 })
  })

  it('替换文本不展开 $ 语义', () => {
    const { content } = replaceTitleRefs('[[旧标题]]', '旧标题', '$&新')
    expect(content).toBe('[[$&新]]')
  })
})
