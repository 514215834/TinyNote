// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { installXmlDomShim } from './xmlDomShim'
import { base64ToBlob, enmlToHtml, parseEnex } from '@/features/import/enexImport'

// node 环境无原生 DOMParser：装 shim（happy-dom 的 text/xml 解析不保结构，见 shim 注释）
beforeAll(() => {
  installXmlDomShim()
})

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export export-date="20260101T000000Z" application="Evernote" version="10.x">
  <note>
    <title>会议纪要</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>要点一</div><en-todo checked="true"/>完成项<br clear="none"/><en-todo/>待办项<en-media type="image/png" hash="abc123"/><en-media type="application/pdf" hash="pdf456"/></en-note>]]></content>
    <created>20260101T000000Z</created>
    <updated>20260102T000000Z</updated>
    <tag>工作</tag>
    <tag>周会</tag>
    <note-attributes><source-url>https://example.com/source</source-url><author>张三</author></note-attributes>
    <resource>
      <data encoding="base64" hash="abc123">iVBORw0KGgoAAAANSUhEUg==</data>
      <mime>image/png</mime>
      <resource-attributes><file-name>截图.png</file-name></resource-attributes>
    </resource>
  </note>
</en-export>`

describe('enexImport（F-803）', () => {
  it('parseEnex：标题 / 标签 / 时间 / 来源 URL / 资源', () => {
    const [note] = parseEnex(ENEX)
    expect(note!.title).toBe('会议纪要')
    expect(note!.tags).toEqual(['工作', '周会'])
    expect(note!.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'))
    expect(note!.updatedAt).toBe(Date.parse('2026-01-02T00:00:00Z'))
    expect(note!.sourceUrl).toBe('https://example.com/source')
    expect(note!.resources).toHaveLength(1)
    expect(note!.resources[0]).toMatchObject({ hash: 'abc123', mime: 'image/png', filename: '截图.png' })
  })

  it('parseEnex：空数据资源被跳过', () => {
    const broken = ENEX.replace('hash="abc123"', '').replace('<mime>image/png</mime>', '')
    const [note] = parseEnex(broken)
    expect(note!.resources).toHaveLength(0)
  })

  it('enmlToHtml：en-media 图片转 enmedia 占位、非图片转占位提示、en-todo 转复选框', () => {
    const [note] = parseEnex(ENEX)
    const html = enmlToHtml(note!.content)
    expect(html).toContain('src="enmedia:abc123"')
    expect(html).toContain('type="checkbox" checked')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('application/pdf') // 非图片占位保留类型可读
  })

  it('enmlToHtml：en-crypt 剔除', () => {
    const html = enmlToHtml('<en-note><en-crypt>密文</en-crypt><div>正文</div></en-note>')
    expect(html).not.toContain('en-crypt')
    expect(html).toContain('正文')
  })

  it('base64ToBlob：解码为指定类型 Blob', () => {
    const blob = base64ToBlob('aGVsbG8=', 'text/plain')
    expect(blob.type).toBe('text/plain')
    expect(blob.size).toBe(5)
  })
})
