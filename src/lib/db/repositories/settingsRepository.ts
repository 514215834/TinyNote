import { db } from '../db'
import type { Setting } from '@/types'

/** KV 偏好存储（v0.1 预留：v0.4 的 lastBackupAt 等将写入此处） */
export const settingsRepository = {
  async get<T>(key: string): Promise<T | undefined> {
    const row: Setting | undefined = await db.settings.get(key)
    return row === undefined ? undefined : (JSON.parse(row.value) as T)
  },

  async set(key: string, value: unknown): Promise<void> {
    await db.settings.put({ key, value: JSON.stringify(value) })
  },
}
