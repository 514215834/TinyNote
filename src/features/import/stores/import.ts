import { ref } from 'vue'
import { defineStore } from 'pinia'
import { importFiles } from '../importService'
import type { ImportSummary } from '../types'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'

/**
 * 导入 store（F-801/F-803/F-804）：入口（数据菜单/整页拖拽）触发导入，
 * 完成后联动刷新列表/文件夹/派生索引（与备份恢复同一套整库刷新口径），
 * 弹窗展示统计摘要。导入进行中忽略新的触发（防并发重复插入）。
 */
export const useImportStore = defineStore('import', () => {
  const open = ref(false)
  const working = ref(false)
  const summary = ref<ImportSummary | null>(null)

  /** @returns 是否真正启动（进行中重复触发返回 false） */
  async function run(files: File[]): Promise<boolean> {
    if (working.value || files.length === 0) return false
    working.value = true
    summary.value = null
    open.value = true
    try {
      summary.value = await importFiles(files)
      // 全量插入后整库刷新：列表/文件夹重载 + 派生索引（搜索/链接）择机重建（与备份恢复同口径）
      const notesStore = useNotesStore()
      await notesStore.noteExternalReload()
      await useFoldersStore().init()
    } finally {
      working.value = false
    }
    return true
  }

  function close(): void {
    open.value = false
  }

  return { open, working, summary, run, close }
})
