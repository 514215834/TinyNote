// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import type { Attachment } from '@/types'

function makeAttachment(id: string, noteId: string): Attachment {
  return {
    id,
    noteId,
    name: `${id}.png`,
    mime: 'image/png',
    size: 3,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    createdAt: 100,
  }
}

beforeEach(async () => {
  await db.attachments.clear()
  await db.notes.clear()
})

describe('attachmentRepository（F-303，经 fake-indexeddb 走真实 Dexie 路径）', () => {
  it('保存（含 Blob 二进制）后可按 id 读回', async () => {
    await attachmentRepository.save(makeAttachment('a1', 'n1'))
    const got = await attachmentRepository.get('a1')
    expect(got?.blob).toBeInstanceOf(Blob)
    expect(got?.blob.size).toBe(3)
    expect(got?.mime).toBe('image/png')
  })

  it('listByNote 只返回该笔记的附件', async () => {
    await attachmentRepository.save(makeAttachment('a1', 'n1'))
    await attachmentRepository.save(makeAttachment('a2', 'n1'))
    await attachmentRepository.save(makeAttachment('a3', 'n2'))
    const ids = (await attachmentRepository.listByNote('n1')).map((attachment) => attachment.id)
    expect(ids.sort()).toEqual(['a1', 'a2'])
  })

  it('deleteByNote / deleteByIds 按条件物理删除', async () => {
    await attachmentRepository.save(makeAttachment('a1', 'n1'))
    await attachmentRepository.save(makeAttachment('a2', 'n2'))
    await attachmentRepository.deleteByNote('n1')
    expect(await attachmentRepository.listAll().then((list) => list.map((a) => a.id))).toEqual(['a2'])
    await attachmentRepository.deleteByIds(['a2'])
    expect(await attachmentRepository.listAll()).toEqual([])
  })

  it('replaceAll 全量替换（F-305 导入恢复用）', async () => {
    await attachmentRepository.save(makeAttachment('a1', 'n1'))
    await attachmentRepository.replaceAll([makeAttachment('b1', 'n9')])
    const ids = (await attachmentRepository.listAll()).map((attachment) => attachment.id)
    expect(ids).toEqual(['b1'])
  })
})
