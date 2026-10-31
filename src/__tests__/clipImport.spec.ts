// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { db } from '@/lib/db/db'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import { folderRepository } from '@/lib/db/repositories/folderRepository'
import {
  clipMetaBlock,
  importClipPackage,
  isClipImported,
  recordClipFingerprint,
} from '@/features/clipImport/clipImport'
import { sniffClipZip } from '@/features/clipImport/clipFile'
import { buildClipZip, type ClipManifest } from '../../extension/src/clip'

// 1×1 PNG（最小合法图片字节）
const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

const MANIFEST: ClipManifest = {
  format: 'tinynote-clip',
  schemaVersion: 1,
  url: 'https://example.com/articles/hello',
  siteName: '示例站',
  title: '一篇剪藏的文章',
  mode: 'article',
  clippedAt: '2026-10-31T04:30:00.000Z',
}

function clipFile(manifest: ClipManifest = MANIFEST, markdown = '# 一篇剪藏的文章\n\n![配图](assets/1-hero.png)\n\n正文段落。'): File {
  const zip = buildClipZip(manifest, markdown, [
    { path: 'assets/1-hero.png', name: '1-hero.png', mime: 'image/png', bytes: PNG_BYTES },
  ])
  return new File([zip as BlobPart], 'tinynote-clip-20261031-1230.zip', { type: 'application/zip' })
}

function markdownZipFile(): File {
  const zip = zipSync({ 'notes/a.md': strToU8('# 普通 Markdown 包\n正文') })
  return new File([zip as BlobPart], 'pack.zip', { type: 'application/zip' })
}

beforeEach(async () => {
  await db.notes.clear()
  await db.contents.clear()
  await db.folders.clear()
  await db.attachments.clear()
  await db.settings.clear()
})

describe('clipFile 剪藏包嗅探（F-902）', () => {
  it('剪藏产物 zip → 完整包（manifest/markdown/资源/指纹）', async () => {
    const file = clipFile()
    const pkg = await sniffClipZip(file)
    expect(pkg).not.toBeNull()
    expect(pkg!.manifest.format).toBe('tinynote-clip')
    expect(pkg!.manifest.title).toBe('一篇剪藏的文章')
    expect(pkg!.markdown).toContain('assets/1-hero.png')
    expect(pkg!.assets).toHaveLength(1)
    expect(pkg!.assets[0]!.mime).toBe('image/png')
    expect(pkg!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('普通 Markdown zip / 损坏 zip / 非 zip → null（交回常规导入）', async () => {
    expect(await sniffClipZip(markdownZipFile())).toBeNull()
    expect(await sniffClipZip(new File([new Uint8Array([1, 2, 3])], 'broken.zip'))).toBeNull()
    expect(await sniffClipZip(new File(['# 笔记'], 'note.md'))).toBeNull()
  })

  it('manifest 非法（format/version/缺字段）→ null', async () => {
    const bad = { format: 'tinynote-clip', schemaVersion: 99, url: 'https://x', siteName: '', title: 't', mode: 'article', clippedAt: '2026-10-31T00:00:00Z' }
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(bad)), 'note.md': strToU8('正文') })
    expect(await sniffClipZip(new File([zip as BlobPart], 'x.zip'))).toBeNull()

    const missing = { format: 'tinynote-clip', schemaVersion: 1 }
    const zip2 = zipSync({ 'manifest.json': strToU8(JSON.stringify(missing)), 'note.md': strToU8('正文') })
    expect(await sniffClipZip(new File([zip2 as BlobPart], 'x.zip'))).toBeNull()
  })

  it('同一产物字节 → 指纹一致；内容不同 → 指纹不同', async () => {
    const first = await sniffClipZip(clipFile())
    const second = await sniffClipZip(clipFile())
    expect(first!.fingerprint).toBe(second!.fingerprint)
    const other = await sniffClipZip(clipFile({ ...MANIFEST, title: '另一篇' }))
    expect(first!.fingerprint).not.toBe(other!.fingerprint)
  })
})

describe('clipImport 剪藏导入（F-902）', () => {
  it('元信息注入正文首部 + 图片重链为附件引用 + 剪藏时间作为创建时间', async () => {
    const pkg = (await sniffClipZip(clipFile()))!
    const summary = await importClipPackage(pkg, { title: '修正后的标题', folderId: null, tags: ['剪藏'] })
    expect(summary.notesCreated).toBe(1)
    expect(summary.attachmentsCreated).toBe(1)
    expect(summary.skipped).toHaveLength(0)

    const notes = await db.notes.toArray()
    expect(notes).toHaveLength(1)
    const note = notes[0]!
    expect(note.title).toBe('修正后的标题')
    expect(note.tags).toEqual(['剪藏'])
    // 剪藏时间（ISO）→ 创建时间
    expect(note.createdAt).toBe(Date.parse('2026-10-31T04:30:00.000Z'))

    const content = (await db.contents.get(note.id))?.content ?? ''
    // 元信息块在正文最前：来源 / 站点 / 剪藏时间（blockquote 文本行）
    expect(content.startsWith('> 来源：https://example.com/articles/hello\n> 站点：示例站\n> 剪藏时间：')).toBe(true)
    // 图片重链为内部附件引用
    expect(content).toContain('](tinynote-attachment://')
    expect(content).not.toContain('assets/1-hero.png')
    // 元信息块之后是原 markdown 正文
    expect(content).toContain('正文段落。')

    const attachments = await attachmentRepository.listByNote(note.id)
    expect(attachments).toHaveLength(1)
    expect(attachments[0]!.mime).toBe('image/png')
  })

  it('文件夹归属落到既有文件夹', async () => {
    const folder = { id: 'f1', name: '网页收藏', order: 0, createdAt: Date.now() }
    await folderRepository.save(folder)
    const pkg = (await sniffClipZip(clipFile()))!
    await importClipPackage(pkg, { title: '标题', folderId: folder.id, tags: [] })
    const note = (await db.notes.toArray())[0]!
    expect(note.folderId).toBe('f1')
  })

  it('空标题回退「未命名」；siteName 为空时元信息块无站点行', async () => {
    const manifest: ClipManifest = { ...MANIFEST, title: '', siteName: '' }
    const pkg = (await sniffClipZip(clipFile(manifest, '正文')))!
    await importClipPackage(pkg, { title: '', folderId: null, tags: [] })
    const note = (await db.notes.toArray())[0]!
    expect(note.title).toBe('无标题笔记')
    const content = (await db.contents.get(note.id))?.content ?? ''
    expect(content.startsWith('> 来源：')).toBe(true)
    expect(content).not.toContain('> 站点：')
  })

  it('clipMetaBlock：非法时间原样展示不抛错', () => {
    const block = clipMetaBlock({ ...MANIFEST, clippedAt: 'not-a-date' })
    expect(block).toContain('剪藏时间：not-a-date')
  })
})

describe('clipImport 防重指纹（F-903）', () => {
  it('导入记录指纹后 isClipImported 命中；未记录不命中', async () => {
    const pkg = (await sniffClipZip(clipFile()))!
    expect(await isClipImported(pkg.fingerprint)).toBe(false)
    await recordClipFingerprint(pkg.fingerprint)
    expect(await isClipImported(pkg.fingerprint)).toBe(true)
  })

  it('指纹记录 FIFO 上限 200 条（最新保留）', async () => {
    for (let i = 0; i < 205; i++) {
      await recordClipFingerprint(`fp-${String(i).padStart(3, '0')}`)
    }
    const list = (await db.settings.get('clipFingerprints'))?.value as string
    const parsed = JSON.parse(list) as string[]
    expect(parsed).toHaveLength(200)
    expect(await isClipImported('fp-204')).toBe(true)
    expect(await isClipImported('fp-000')).toBe(false)
  })
})

describe('剪藏产物字节完整性（往返口径）', () => {
  it('扩展产物 zip 解包后 manifest/note.md/资源字节与装配输入一致', async () => {
    const zip = buildClipZip(MANIFEST, '# 标题\n正文', [
      { path: 'assets/1-a.png', name: '1-a.png', mime: 'image/png', bytes: PNG_BYTES },
    ])
    const entries = unzipSync(zip)
    expect(JSON.parse(strFromU8(entries['manifest.json']!))).toMatchObject({ format: 'tinynote-clip', schemaVersion: 1, title: MANIFEST.title })
    expect(strFromU8(entries['note.md']!)).toBe('# 标题\n正文')
    expect(entries['assets/1-a.png']).toEqual(PNG_BYTES)
  })
})
