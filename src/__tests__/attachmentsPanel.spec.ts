// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { collectAttachmentRows, freedBytes, orphanRows, scanAttachmentReferences } from '@/features/attachmentsPanel/lib'

/**
 * F-1004 附件管理面板数据层：引用状态分类口径（与 F-406 一致且更保守——
 * 全库任一正文或任一快照引用即保留）。
 */

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)])
}

async function seed(): Promise<void> {
  await noteRepository.saveWithContent(
    { id: 'n1', title: '有图的笔记', excerpt: '', folderId: null, tags: [], pinned: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1 },
    '正文引用 ![a](tinynote-attachment://a1)',
  )
  await noteRepository.saveWithContent(
    { id: 'n2', title: '只有快照引用', excerpt: '', folderId: null, tags: [], pinned: false, trashed: false, trashedAt: null, createdAt: 1, updatedAt: 1 },
    '正文已删掉图片',
  )
  await db.snapshots.bulkPut([
    { id: 's1', noteId: 'n2', content: '快照里还有 ![b](tinynote-attachment://a2)', createdAt: 2 },
  ])
  await attachmentRepository.save({ id: 'a1', noteId: 'n1', name: 'a.png', mime: 'image/png', size: 100, blob: blobOf(100), createdAt: 1 })
  await attachmentRepository.save({ id: 'a2', noteId: 'n2', name: 'b.png', mime: 'image/png', size: 200, blob: blobOf(200), createdAt: 2 })
  await attachmentRepository.save({ id: 'a3', noteId: 'n2', name: 'c.pdf', mime: 'application/pdf', size: 300, blob: blobOf(300), createdAt: 3 })
}

beforeEach(async () => {
  await Promise.all([db.notes.clear(), db.contents.clear(), db.attachments.clear(), db.snapshots.clear(), db.folders.clear()])
  await seed()
})

describe('scanAttachmentReferences（F-1004 引用扫描）', () => {
  it('正文引用与快照引用分集合收集', async () => {
    const scan = await scanAttachmentReferences()
    expect([...scan.contentRefs]).toEqual(['a1'])
    expect([...scan.snapshotRefs]).toEqual(['a2'])
  })
})

describe('collectAttachmentRows（F-1004 状态分类）', () => {
  it('三类状态：正文引用 / 仅快照引用（不算孤儿）/ 孤儿；孤儿排序最前', async () => {
    const rows = await collectAttachmentRows(await scanAttachmentReferences())
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get('a1')?.state).toBe('content')
    expect(byId.get('a2')?.state).toBe('snapshot')
    expect(byId.get('a3')?.state).toBe('orphan')
    expect(rows[0]?.id).toBe('a3') // 孤儿优先
    // 归属笔记标题
    expect(byId.get('a1')?.noteTitle).toBe('有图的笔记')
    expect(byId.get('a3')?.noteTitle).toBe('只有快照引用')
  })

  it('归属笔记被删除后 noteTitle 为 null（软删笔记仍有归属）', async () => {
    await noteRepository.softDelete('n2')
    const rows = await collectAttachmentRows(await scanAttachmentReferences())
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get('a2')?.noteTitle).not.toBeNull() // 软删笔记元数据仍在
    await noteRepository.deleteForever('n2')
    const after = await collectAttachmentRows(await scanAttachmentReferences())
    const a2 = after.find((row) => row.id === 'a2')
    expect(a2).toBeUndefined() // F-204 级联：彻底删除连带清理附件
  })
})

describe('orphanRows / freedBytes（F-1004 清理口径）', () => {
  it('孤儿集合与可释放字节数', async () => {
    const rows = await collectAttachmentRows(await scanAttachmentReferences())
    const orphans = orphanRows(rows)
    expect(orphans.map((row) => row.id)).toEqual(['a3'])
    expect(freedBytes(orphans)).toBe(300)
  })
})
