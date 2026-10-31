// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_SIZE,
  buildAttachment,
  filesToInsertions,
  insertIntoText,
  isAttachableFile,
  isImageFile,
  makeAttachmentMarkdown,
  orphanAttachmentIds,
  pickAttachableFiles,
} from '@/features/editor/attachments'
import { extractAttachmentIds } from '@/lib/markdown/attachmentRef'

/** Node 环境下的 File 同样按内容取值 size；这里显式改写以便按需模拟超大文件 */
function makeFile(name: string, type: string, size: number): File {
  const content = new Uint8Array(Math.max(size, 1))
  const file = new File([content], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('isImageFile / isAttachableFile（F-303/F-1003 准入）', () => {
  it('isImageFile 仅接受 image/* 且未超限的非空文件（data: 内嵌图等确定图片场景用）', () => {
    expect(isImageFile(makeFile('a.png', 'image/png', 1024))).toBe(true)
    expect(isImageFile(makeFile('doc.pdf', 'application/pdf', 1024))).toBe(false)
    expect(isImageFile(makeFile('big.png', 'image/png', MAX_ATTACHMENT_SIZE + 1))).toBe(false)
    expect(isImageFile({ type: 'image/png', size: 0 })).toBe(false)
  })

  it('isAttachableFile 白名单：图片 + PDF + 纯文本 + 音频（F-1003），超限/空文件拒绝', () => {
    expect(isAttachableFile(makeFile('a.png', 'image/png', 1024))).toBe(true)
    expect(isAttachableFile(makeFile('doc.pdf', 'application/pdf', 1024))).toBe(true)
    expect(isAttachableFile(makeFile('note.txt', 'text/plain', 1024))).toBe(true)
    expect(isAttachableFile(makeFile('song.mp3', 'audio/mpeg', 1024))).toBe(true)
    expect(isAttachableFile(makeFile('app.exe', 'application/octet-stream', 1024))).toBe(false)
    expect(isAttachableFile(makeFile('vid.mp4', 'video/mp4', 1024))).toBe(false)
    expect(isAttachableFile(makeFile('big.pdf', 'application/pdf', MAX_ATTACHMENT_SIZE + 1))).toBe(false)
    expect(isAttachableFile({ type: 'application/pdf', size: 0 })).toBe(false)
  })

  it('pickAttachableFiles 过滤白名单外并保持顺序', () => {
    const files = [
      makeFile('app.exe', 'application/octet-stream', 10),
      makeFile('a.png', 'image/png', 10),
      makeFile('doc.pdf', 'application/pdf', 10),
      makeFile('note.txt', 'text/plain', 10),
    ]
    const picked = pickAttachableFiles(files)
    expect(picked.map((file) => file.name)).toEqual(['a.png', 'doc.pdf', 'note.txt'])
  })
})

describe('makeAttachmentMarkdown（F-303/F-1003 引用协议）', () => {
  it('图片走 ![alt](引用)，alt 剥除破坏语法的方括号，空名回退「附件」', () => {
    expect(makeAttachmentMarkdown('id1', '我的 截图', 'image/png')).toBe('![我的 截图](tinynote-attachment://id1)')
    expect(makeAttachmentMarkdown('id2', 'a[b]c', 'image/jpeg')).toBe('![a b c](tinynote-attachment://id2)')
    expect(makeAttachmentMarkdown('id3', '   ', 'image/webp')).toBe('![附件](tinynote-attachment://id3)')
  })

  it('非图片（PDF/文本/音频）走 [名称](引用)，预览渲染为附件卡片', () => {
    expect(makeAttachmentMarkdown('id4', '报告.pdf', 'application/pdf')).toBe('[报告.pdf](tinynote-attachment://id4)')
    expect(makeAttachmentMarkdown('id5', 'notes.txt', 'text/plain')).toBe('[notes.txt](tinynote-attachment://id5)')
    expect(makeAttachmentMarkdown('id6', 'song.mp3', 'audio/mpeg')).toBe('[song.mp3](tinynote-attachment://id6)')
  })
})

describe('buildAttachment / filesToInsertions（F-303）', () => {
  it('从 File 产出完整 Attachment 实体', () => {
    const file = makeFile('photo.png', 'image/png', 128)
    const attachment = buildAttachment(file, 'note-1', 'att-1')
    expect(attachment).toMatchObject({ id: 'att-1', noteId: 'note-1', name: 'photo.png', mime: 'image/png', size: 128 })
    expect(attachment.blob).toBe(file)
  })

  it('filesToInsertions 逐个产出「附件 + 待插入 Markdown」（F-1003 起含非图片）', () => {
    const result = filesToInsertions(
      [
        makeFile('doc.pdf', 'application/pdf', 10),
        makeFile('a.png', 'image/png', 10),
      ],
      'note-1',
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.attachment.noteId).toBe('note-1')
    expect(result[0]!.markdown).toBe('[doc.pdf](tinynote-attachment://' + result[0]!.attachment.id + ')')
    expect(result[1]!.markdown).toBe('![a.png](tinynote-attachment://' + result[1]!.attachment.id + ')')
  })
})

describe('insertIntoText（F-303 光标插入）', () => {
  it('在指定位置插入并返回新光标', () => {
    expect(insertIntoText('abc', 1, 'X')).toEqual({ text: 'aXbc', caret: 2 })
    expect(insertIntoText('abc', 3, 'X')).toEqual({ text: 'abcX', caret: 4 })
  })

  it('位置越界时收敛到文本两端', () => {
    expect(insertIntoText('abc', 99, 'X')).toEqual({ text: 'abcX', caret: 4 })
    expect(insertIntoText('abc', -1, 'X')).toEqual({ text: 'Xabc', caret: 1 })
  })
})

describe('extractAttachmentIds（F-303/F-305）', () => {
  it('按出现顺序去重提取全部附件 id', () => {
    expect(
      extractAttachmentIds('![a](tinynote-attachment://id-1) 文字 ![b](tinynote-attachment://id-2) ![c](tinynote-attachment://id-1)'),
    ).toEqual(['id-1', 'id-2'])
  })

  it('无附件时为空数组；其他 URL 里的同前缀子串会提取 id，但未映射时渲染为占位（无害）', () => {
    expect(extractAttachmentIds('普通正文')).toEqual([])
    // 该子串会提取出 'fake'，但 attachmentUrls 无此键 → 预览渲染「图片缺失」占位
    expect(extractAttachmentIds('https://example.com/tinynote-attachment://fake')).toEqual(['fake'])
  })
})

describe('orphanAttachmentIds（F-406 孤儿附件判定）', () => {
  const existing = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]

  it('正文与全部历史快照都未引用的附件才算孤儿', () => {
    const keepContents = [
      '正文引用 a1 ![x](tinynote-attachment://a1)',
      '快照里引用 a2 ![y](tinynote-attachment://a2)', // 快照回滚依赖附件存在，同等保留
    ]
    expect(orphanAttachmentIds(existing, keepContents)).toEqual(['a3'])
  })

  it('全部被引用时不产生待删项；空内容则全部视为孤儿', () => {
    const allReferenced = ['![x](tinynote-attachment://a1) ![y](tinynote-attachment://a2) ![z](tinynote-attachment://a3)']
    expect(orphanAttachmentIds(existing, allReferenced)).toEqual([])
    expect(orphanAttachmentIds(existing, ['正文已删掉所有图片'])).toEqual(['a1', 'a2', 'a3'])
  })
})
