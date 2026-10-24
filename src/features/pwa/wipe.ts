import { backupPort } from '@/lib/db/repositories/backupPort'
import { clearAppCaches } from './storage'

/**
 * 清空全部本地数据（F-522）：破坏性操作，调用方负责双重确认与「先备份」提示。
 * 范围：IndexedDB 全部表（笔记/正文/文件夹/附件/快照/设置）+ localStorage 内的应用偏好
 * （tinynote:* 与深浅色）+ 离线缓存（Cache Storage）。完成后由调用方刷新页面。
 */
export async function wipeLocalData(): Promise<void> {
  await backupPort.wipe()
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null) keys.push(key)
  }
  for (const key of keys) {
    if (key.startsWith('tinynote:') || key === 'vueuse-color-scheme') localStorage.removeItem(key)
  }
  await clearAppCaches()
}
