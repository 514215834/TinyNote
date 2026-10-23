import { onBeforeUnmount, ref } from 'vue'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 自动保存调度（F-102）：schedule 以防抖合并高频输入，flush 立即落库。
 * flush 在失焦、切换笔记（组件卸载）、关闭页面时调用；
 * persist 在调用时才读取最新草稿，因此闭包必须引用响应式草稿而非提前取值。
 */
export function useAutoSave(persist: () => Promise<void>, delay: number = 800) {
  const status = ref<SaveStatus>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false

  function schedule(): void {
    pending = true
    status.value = 'saving'
    clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, delay)
  }

  async function flush(): Promise<void> {
    clearTimeout(timer)
    if (!pending) return
    pending = false
    try {
      await persist()
      status.value = 'saved'
    } catch (error) {
      status.value = 'error'
      pending = true // 保留待写状态，下次 schedule/flush 自动重试
      console.error('[TinyNote] 自动保存失败', error)
    }
  }

  onBeforeUnmount(() => {
    // 卸载（切换/删除笔记）时尽力保存上一篇的待写内容
    if (pending) void flush()
  })

  return { schedule, flush, status }
}
