// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { snapshotRepository } from '@/lib/db/repositories/snapshotRepository'
import type { NoteSnapshot } from '@/types'

function snapshot(id: string, noteId: string, content: string, createdAt: number): NoteSnapshot {
  return { id, noteId, content, createdAt }
}

beforeEach(async () => {
  await db.snapshots.clear()
})

describe('snapshotRepository（F-402，走真实 Dexie 路径）', () => {
  it('listByNote 只返回该笔记快照并按创建时间倒序', async () => {
    await snapshotRepository.save(snapshot('a', 'n1', '第一版', 100))
    await snapshotRepository.save(snapshot('b', 'n1', '第二版', 300))
    await snapshotRepository.save(snapshot('c', 'n1', '第三版', 200))
    await snapshotRepository.save(snapshot('d', 'n2', '别家的', 400))

    const rows = await snapshotRepository.listByNote('n1')
    expect(rows.map((row) => row.id)).toEqual(['b', 'c', 'a'])
  })

  it('pruneToLimit 保留最新 N 条，返回被删除的 id', async () => {
    for (let i = 0; i < 5; i++) {
      await snapshotRepository.save(snapshot(`s${i}`, 'n1', `内容${i}`, 1000 + i))
    }
    const deleted = await snapshotRepository.pruneToLimit('n1', 3)
    expect(deleted).toEqual(['s1', 's0']) // 淘汰最旧的两条（按新→旧返回）
    const rows = await snapshotRepository.listByNote('n1')
    expect(rows.map((row) => row.id)).toEqual(['s4', 's3', 's2'])
  })

  it('deleteByIds 物理删除；空列表不报错', async () => {
    await snapshotRepository.save(snapshot('a', 'n1', '第一版', 100))
    await snapshotRepository.deleteByIds(['a'])
    expect(await snapshotRepository.listByNote('n1')).toHaveLength(0)
    await expect(snapshotRepository.deleteByIds([])).resolves.toBeUndefined()
  })
})
