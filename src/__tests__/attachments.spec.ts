// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_SIZE,
  buildAttachment,
  filesToInsertions,
  insertIntoText,
  isImageFile,
  makeImageMarkdown,
  pickImageFiles,
} from '@/features/editor/attachments'
import { extractAttachmentIds } from '@/lib/markdown/attachmentRef'

/** Node 环境下的 File 同样按内容取值 size；这里显式改写以便按需模拟超大文件 */
function makeFile(name: string, type: string, size: number): File {
  const content = new Uint8Array(Math.max(size, 1))
  const file = new File([content], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('isImageFile / pickImageFiles（F-303 准入）', () => {
  it('仅接受 image/* 且未超限的非空文件', () => {
    expect(isImageFile(makeFile('a.png', 'image/png', 1024))).toBe(true)
    expect(isImageFile(makeFile('doc.pdf', 'application/pdf', 1024))).toBe(false)
    expect(isImageFile(makeFile('big.png', 'image/png', MAX_ATTACHMENT_SIZE + 1))).toBe(false)
    expect(isImageFile({ type: 'image/png', size: 0 })).toBe(false)
  })

  it('pickImageFiles 过滤非图片并保持顺序', () => {
    const files = [
      makeFile('doc.pdf', 'application/pdf', 10),
      makeFile('a.png', 'image/png', 10),
      makeFile('b.jpg', 'image/jpeg', 10),
    ]
    const picked = pickImageFiles(files)
    expect(picked.map((file) => file.name)).toEqual(['a.png', 'b.jpg'])
  })
})

describe('makeImageMarkdown（F-303 引用协议）', () => {
  it('alt 剥除破坏语法的方括号，空名回退「图片」', () => {
    expect(makeImageMarkdown('id1', '我的 截图')).toBe('![我的 截图](tinynote-attachment://id1)')
    expect(makeImageMarkdown('id2', 'a[b]c')).toBe('![a b c](tinynote-attachment://id2)')
    expect(makeImageMarkdown('id3', '   ')).toBe('![图片](tinynote-attachment://id3)')
  })
})

describe('buildAttachment / filesToInsertions（F-303）', () => {
  it('从 File 产出完整 Attachment 实体', () => {
    const file = makeFile('photo.png', 'image/png', 128)
    const attachment = buildAttachment(file, 'note-1', 'att-1')
    expect(attachment).toMatchObject({ id: 'att-1', noteId: 'note-1', name: 'photo.png', mime: 'image/png', size: 128 })
    expect(attachment.blob).toBe(file)
  })

  it('filesToInsertions 逐个产出「附件 + 待插入 Markdown」', () => {
    const result = filesToInsertions(
      [
        makeFile('doc.pdf', 'application/pdf', 10),
        makeFile('a.png', 'image/png', 10),
      ],
      'note-1',
    )
    expect(result).toHaveLength(1)
    expect(result[0].attachment.noteId).toBe('note-1')
    expect(result[0].markdown).toBe('![a.png](tinynote-attachment://' + result[0].attachment.id + ')')
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
