import type { Folder } from '@/types'
import { createId } from '@/lib/utils/id'

/** 新建文件夹工厂（F-201）：order 取当前已有数量，作为列表创建序 */
export function makeFolder(name: string, order: number, now = Date.now()): Folder {
  return { id: createId(), name: name.trim(), order, createdAt: now }
}

/**
 * F-1006 拖拽重排（纯函数）：把 dragId 移动到 targetId 之前，并按新顺序重排 order。
 * dragId/targetId 相同或缺失时原样返回（不产生写库）。
 */
export function reorderList(list: Folder[], dragId: string, targetId: string): Folder[] {
  if (dragId === targetId) return list
  const from = list.findIndex((folder) => folder.id === dragId)
  const to = list.findIndex((folder) => folder.id === targetId)
  if (from === -1 || to === -1) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next.map((folder, index) => ({ ...folder, order: index }))
}
