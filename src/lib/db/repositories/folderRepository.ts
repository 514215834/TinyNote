import { db } from '../db'
import type { Folder } from '@/types'

/**
 * 文件夹数据访问（F-201，仅一层）。
 * 删除文件夹时其下笔记移回未分类（folderId = null），笔记数据不删。
 */
export const folderRepository = {
  /** 按创建序（order）升序 */
  async list(): Promise<Folder[]> {
    const all = await db.folders.toArray()
    return all.sort((a, b) => a.order - b.order)
  },

  async save(folder: Folder): Promise<void> {
    await db.folders.put({ ...folder })
  },

  /**
   * 删除文件夹：「其下笔记换归属」与「删文件夹」在同一事务内，
   * 保证要么同时生效、要么都不动（避免出现指向已删除文件夹的悬空笔记）。
   */
  async delete(folderId: string): Promise<void> {
    await db.transaction('rw', db.folders, db.notes, async () => {
      await db.notes.where('folderId').equals(folderId).modify({ folderId: null })
      await db.folders.delete(folderId)
    })
  },
}
