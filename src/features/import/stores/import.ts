import { ref } from 'vue'
import { defineStore } from 'pinia'
import { importFiles } from '../importService'
import type { ImportSummary } from '../types'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import {
  importClipPackage,
  isClipImported,
  recordClipFingerprint,
  type ClipImportOptions,
} from '@/features/clipImport/clipImport'
import { sniffClipZip, type ClipPackage } from '@/features/clipImport/clipFile'

/**
 * 导入 store（F-801/F-803/F-804 + F-902/F-903）：入口（数据菜单/整页拖拽）触发导入。
 * zip 按内容嗅探分流——剪藏产物进剪藏导入弹窗（标题/文件夹/标签修正 + 防重拦截），
 * 其余走常规导入；两类互不阻塞，剪藏包排队逐个弹窗。
 * 完成后联动刷新列表/文件夹/派生索引（与备份恢复同一套整库刷新口径）。
 * 导入进行中忽略新的触发（防并发重复插入）。
 */
export const useImportStore = defineStore('import', () => {
  const open = ref(false)
  const working = ref(false)
  const summary = ref<ImportSummary | null>(null)

  // F-902 剪藏导入弹窗状态（当前包 / 防重判定 / 处理中 / 摘要）
  const clipPackage = ref<ClipPackage | null>(null)
  const clipDuplicate = ref(false)
  const clipWorking = ref(false)
  const clipSummary = ref<ImportSummary | null>(null)
  let clipQueue: ClipPackage[] = []

  /** 常规/剪藏导入完成后的整库刷新（列表/文件夹重载 + 派生索引择机重建） */
  async function refreshViews(): Promise<void> {
    const notesStore = useNotesStore()
    await notesStore.noteExternalReload()
    await useFoldersStore().init()
  }

  /** @returns 是否真正启动（进行中重复触发返回 false） */
  async function run(files: File[]): Promise<boolean> {
    if (working.value || files.length === 0) return false

    // F-902 分流：zip 内容嗅探（manifest.format === 'tinynote-clip'），其余走常规导入
    const clipFiles: ClipPackage[] = []
    const rest: File[] = []
    for (const file of files) {
      const clip = await sniffClipZip(file)
      if (clip !== null) clipFiles.push(clip)
      else rest.push(file)
    }

    if (rest.length > 0) {
      working.value = true
      summary.value = null
      open.value = true
      try {
        summary.value = await importFiles(rest)
        await refreshViews()
      } finally {
        working.value = false
      }
    }

    // 剪藏包排队弹窗（常规导入完成后逐个处理；弹窗为模态，无并发入口）
    clipQueue = clipFiles
    if (clipQueue.length > 0) void presentNextClip()
    return true
  }

  /** 展示队列中的下一个剪藏包（计算指纹、判定防重） */
  async function presentNextClip(): Promise<void> {
    const pkg = clipQueue.shift()
    if (pkg === undefined) {
      clipPackage.value = null
      clipSummary.value = null
      return
    }
    clipPackage.value = pkg
    clipSummary.value = null
    clipWorking.value = false
    clipDuplicate.value = await isClipImported(pkg.fingerprint)
  }

  /** 确认导入当前剪藏包（重复场景由弹窗以「强制重新导入」显式传入）；成功后记录防重指纹 */
  async function confirmClip(options: ClipImportOptions): Promise<void> {
    const pkg = clipPackage.value
    if (pkg === null || clipWorking.value) return
    clipWorking.value = true
    try {
      clipSummary.value = await importClipPackage(pkg, options)
      await recordClipFingerprint(pkg.fingerprint)
      await refreshViews()
    } finally {
      clipWorking.value = false
    }
  }

  function close(): void {
    open.value = false
  }

  /** 关闭剪藏弹窗（自动展示队列中的下一个） */
  function closeClip(): void {
    void presentNextClip()
  }

  return {
    open,
    working,
    summary,
    run,
    close,
    clipPackage,
    clipDuplicate,
    clipWorking,
    clipSummary,
    confirmClip,
    closeClip,
  }
})
