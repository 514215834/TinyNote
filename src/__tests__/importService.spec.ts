// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { db } from '@/lib/db/db'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import { importFiles } from '@/features/import/importService'
import { installXmlDomShim } from './xmlDomShim'

// node 环境无原生 DOMParser：装 shim（ENEX 分支需要 XML 结构）
beforeAll(() => {
  installXmlDomShim()
})

beforeEach(async () => {
  await db.notes.clear()
  await db.contents.clear()
  await db.folders.clear()
  await db.attachments.clear()
})

// 1×1 PNG（最小合法图片字节）
const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

function fileFrom(parts: BlobPart, name: string, type = 'application/octet-stream'): File {
  return new File([parts], name, { type })
}

describe('importService（F-801/F-803/F-804）', () => {
  it('F-801：多选 .md 全量插入，H1 取标题、空文件跳过', async () => {
    const summary = await importFiles([
      fileFrom('# 笔记一\n内容一', 'note-1.md', 'text/markdown'),
      fileFrom('无标题正文', 'note-2.md', 'text/markdown'),
      fileFrom('', 'empty.md', 'text/markdown'),
      fileFrom('二进制', 'pic.png', 'image/png'),
    ])
    expect(summary.notesCreated).toBe(2)
    expect(summary.skipped.some((issue) => issue.source === 'empty.md')).toBe(true)
    expect(summary.skipped.some((issue) => issue.source === 'pic.png')).toBe(true) // 不支持类型
    const notes = await db.notes.toArray()
    const first = notes.find((note) => note.title === '笔记一')
    expect(first !== undefined).toBe(true)
    expect((await db.contents.get(first!.id))?.content).toBe('内容一')
    const second = notes.find((note) => note.title === 'note-2')
    expect((await db.contents.get(second!.id))?.content).toBe('无标题正文')
  })

  it('F-801：zip 包（notes/ + assets/）——容器目录不建文件夹、图片重链为附件引用', async () => {
    const zip = zipSync({
      'notes/日记/第一天.md': strToU8('# 日记\n![图](../assets/pic.png)\n正文'),
      'assets/pic.png': PNG_BYTES,
    })
    const summary = await importFiles([fileFrom(zip, 'pack.zip', 'application/zip')])
    expect(summary.notesCreated).toBe(1)
    expect(summary.foldersCreated).toBe(1) // 日记（notes/ 容器剥离）
    expect(summary.attachmentsCreated).toBe(1)
    const folders = await db.folders.toArray()
    expect(folders.map((folder) => folder.name)).toContain('日记')
    const note = (await db.notes.toArray())[0]!
    const content = (await db.contents.get(note.id))?.content ?? ''
    expect(content).toMatch(/!\[图\]\(tinynote-attachment:\/\/[0-9a-f-]+\)/)
    expect(content).not.toContain('assets/pic.png')
    const attachments = await attachmentRepository.listByNote(note.id)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]!.mime).toBe('image/png')
  })

  it('F-803：ENEX 导入——资源落附件、来源 URL 进首部 blockquote、标签与文件夹映射', async () => {
    const pngBase64 = Buffer.from(PNG_BYTES).toString('base64')
    const enex = `<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>剪藏页</title><created>20260101T000000Z</created><updated>20260102T000000Z</updated><tag>工作</tag><note-attributes><source-url>https://example.com/a</source-url></note-attributes><content><![CDATA[<en-note><div>正文</div><en-media type="image/png" hash="h123"/></en-note>]]></content><resource><data encoding="base64" hash="h123">${pngBase64}</data><mime>image/png</mime><resource-attributes><file-name>shot.png</file-name></resource-attributes></resource></note></en-export>`
    const summary = await importFiles([fileFrom(enex, '我的笔记本.enex')])
    expect(summary.notesCreated).toBe(1)
    expect(summary.foldersCreated).toBe(1)
    expect(summary.attachmentsCreated).toBe(1)
    const folders = await db.folders.toArray()
    expect(folders.map((folder) => folder.name)).toContain('我的笔记本')
    const note = (await db.notes.toArray())[0]!
    expect(note.tags).toEqual(['工作'])
    expect(note.createdAt).toBe(Date.UTC(2026, 0, 1))
    const content = (await db.contents.get(note.id))?.content ?? ''
    expect(content.startsWith('> 来源：https://example.com/a')).toBe(true)
    expect(content).toMatch(/!\[[^\]]*\]\(tinynote-attachment:\/\/[0-9a-f-]+\)/)
    expect(content).toContain('正文')
  })

  it('F-804：Notion 导出包——页面 + csv 数据库每行一篇、Untitled 空壳跳过', async () => {
    const zip = zipSync({
      '项目页 11111111111111111111111111111111.md': strToU8('页面内容\n![截图](11111111111111111111111111111111-9ab.png)'),
      '11111111111111111111111111111111-9ab.png': PNG_BYTES,
      '项目页 11111111111111111111111111111111/子页 22222222222222222222222222222222.md': strToU8('子页内容'),
      '任务库 33333333333333333333333333333333.csv': strToU8('Name,状态,截止\n任务一,待办,2024-05-01\n任务二,完成,2024-06-01'),
      'Untitled 44444444444444444444444444444444.md': strToU8(''),
    })
    const summary = await importFiles([fileFrom(zip, 'Export-xyz.zip', 'application/zip')])
    // 页面 1（子页内联不单算）+ csv 2 行 = 3 篇；Untitled 跳过
    expect(summary.notesCreated).toBe(3)
    const notes = await db.notes.toArray()
    const page = notes.find((note) => note.title === '项目页')
    const pageContent = (await db.contents.get(page!.id))?.content ?? ''
    expect(pageContent).toContain('子页内容')
    expect(pageContent).toMatch(/!\[截图\]\(tinynote-attachment:\/\/[0-9a-f-]+\)/)
    expect(pageContent).toContain('# 子页')
    const rows = notes.filter((note) => note.title.startsWith('任务'))
    expect(rows).toHaveLength(2)
    const row = notes.find((note) => note.title === '任务一')
    expect(row!.tags).toEqual(['待办'])
    expect(row!.createdAt).toBe(Date.parse('2024-05-01T00:00:00Z'))
  })

  it('不支持的类型计入跳过，导入不覆盖既有笔记', async () => {
    await db.notes.put({
      id: 'existing',
      title: '既有',
      excerpt: '',
      folderId: null,
      tags: [],
      pinned: false,
      trashed: false,
      trashedAt: null,
      createdAt: 1,
      updatedAt: 1,
    })
    const summary = await importFiles([fileFrom('x', 'data.docx')])
    expect(summary.notesCreated).toBe(0)
    expect(summary.skipped).toHaveLength(1)
    expect(await db.notes.get('existing')).toBeDefined()
  })
})
