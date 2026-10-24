import { db } from '../db'
import type { Attachment } from '@/types'

/** 附件数据访问（F-303）：组件与 store 不直接触碰 IndexedDB，一律经此层（架构文档 3.2） */
export const attachmentRepository = {
  async get(id: string): Promise<Attachment | undefined> {
    return db.attachments.get(id)
  },

  async listByNote(noteId: string): Promise<Attachment[]> {
    return db.attachments.where('noteId').equals(noteId).toArray()
  },

  async listAll(): Promise<Attachment[]> {
    return db.attachments.toArray()
  },

  async save(attachment: Attachment): Promise<void> {
    await db.attachments.put({ ...attachment })
  },

  async deleteByIds(ids: string[]): Promise<void> {
    await db.attachments.bulkDelete(ids)
  },

  async deleteByNote(noteId: string): Promise<void> {
    await db.attachments.where('noteId').equals(noteId).delete()
  },

  /**
   * 全量替换（F-305 导入恢复）：清空后整批写入。
   * 调用方负责在事务中先清空笔记等关联表（见 backupPort.restore）。
   */
  async replaceAll(attachments: Attachment[]): Promise<void> {
    await db.attachments.clear()
    await db.attachments.bulkPut([...attachments])
  },
}
