import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { rankContentHits, scanContents, type ContentHit } from '../engine'
import { useNotesStore } from '@/features/notes/stores/notes'

/**
 * 搜索 store（F-105/F-524）：侧边栏搜索框与 Ctrl+K 命令面板共用的全局搜索状态。
 * query 为唯一搜索词来源（两处输入互相同步）；正文命中由 runQuery 异步扫描补充，
 * 防抖由调用方（组件层 watchDebounced 200ms，架构文档 §8）负责，本 store 负责取消与缓存。
 */
export const useSearchStore = defineStore('search', () => {
  const query = ref('')
  /** Ctrl+K 命令面板开关 */
  const paletteOpen = ref(false)
  /** 正文命中（异步扫描产出，按最近更新优先排序） */
  const contentHits = ref<ContentHit[]>([])
  /** 扫描进行中（面板可显示扫描态） */
  const scanning = ref(false)

  const contentHitIds = computed(() => new Set(contentHits.value.map((hit) => hit.id)))

  /** 代际号：新查询立即作废在途扫描的结果 */
  let runId = 0
  /** 查询 → 命中 的 LRU 缓存（容量 5）：删除字符回退时免重扫 */
  const cache = new Map<string, ContentHit[]>()

  async function runQuery(raw: string): Promise<void> {
    const q = raw.trim()
    const id = ++runId
    if (q === '') {
      contentHits.value = []
      scanning.value = false
      return
    }
    const cached = cache.get(q)
    if (cached !== undefined) {
      cache.delete(q)
      cache.set(q, cached) // 触达即移到 LRU 末尾
      scanning.value = false
      contentHits.value = cached
      return
    }
    scanning.value = true
    // 陈旧查询（期间已有新查询接管）通过取消钩子提前中止扫描
    const hits = await scanContents(q, {}, () => id !== runId)
    if (id !== runId) return // 已有更新的查询，丢弃本次结果
    scanning.value = false
    // 展示按最近更新优先（扫描按存储序产出）
    const notesStore = useNotesStore()
    const metaById = new Map(notesStore.notes.map((note) => [note.id, note]))
    const ranked = rankContentHits(hits, metaById)
    cache.set(q, ranked)
    if (cache.size > 5) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    contentHits.value = ranked
  }

  /** 唯一入口：更新搜索词并触发正文扫描 */
  function set(value: string): void {
    query.value = value
    void runQuery(value)
  }

  function openPalette(): void {
    paletteOpen.value = true
  }

  function closePalette(): void {
    paletteOpen.value = false
  }

  function togglePalette(): void {
    paletteOpen.value = !paletteOpen.value
  }

  return {
    query,
    paletteOpen,
    contentHits,
    contentHitIds,
    scanning,
    set,
    openPalette,
    closePalette,
    togglePalette,
  }
})
