import type { Folder } from '@/types'
import { createId } from '@/lib/utils/id'

/** 新建文件夹工厂（F-201）：order 取当前已有数量，作为列表创建序 */
export function makeFolder(name: string, order: number, now = Date.now()): Folder {
  return { id: createId(), name: name.trim(), order, createdAt: now }
}
