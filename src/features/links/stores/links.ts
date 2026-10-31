import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { NoteMeta } from '@/types'
import { displayTitle } from '@/features/notes/notes'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { backlinkRefsOf, buildLinksIndex, isLinksBuilding, isLinksReady, onLinksChanged, outlinkEntries } from '../linkIndex'
import { buildGraphData, GRAPH_NODE_LIMIT, type GraphData } from '../graphData'
import { linkSnippet } from '../wikilinks'

/** 反链行（面板展示口径）：引用目标笔记的活跃笔记 + 引用行摘要 */
export interface BacklinkRow {
  id: string
  /** 展示标题（标题缺失时回退摘要首行） */
  title: string
  folderId: string | null
  updatedAt: number
  snippet: string
}

/**
 * 双链 store（F-702/F-703）：面板与图谱共用的响应式门面。
 * linkIndex 模块本身非响应式，这里以 version 代数驱动调用方（组件 computed）
 * 在索引变更后重新求值——updateLinks/removeLinks/discard 与全量构建完成都会 +1。
 */
export const useLinksStore = defineStore('links', () => {
  /** 索引代数：任何索引变更 +1 */
  const version = ref(0)
  /** 索引是否就绪（首次打开面板/图谱时构建） */
  const ready = ref(false)
  /** 索引构建中（面板可显示进度态） */
  const building = ref(false)

  function syncFlags(): void {
    ready.value = isLinksReady()
    building.value = isLinksBuilding()
    version.value++
  }

  // 订阅索引层变更（保存/删除/恢复/整库重建等路径都会经过这里）
  onLinksChanged(() => syncFlags())

  /** 首次使用时全量构建；并发调用共享同一次构建 */
  let ensurePromise: Promise<void> | null = null
  async function ensureIndex(): Promise<void> {
    if (isLinksReady()) {
      syncFlags()
      return
    }
    ensurePromise ??= (async () => {
      await buildLinksIndex()
      ensurePromise = null
    })()
    await ensurePromise
    syncFlags()
  }

  /** 反链组装：目标标题 → 引用它的活跃笔记（含 ±40 字摘要），按最近更新排序 */
  async function backlinksWithSnippets(target: string): Promise<BacklinkRow[]> {
    const refs = backlinkRefsOf(target)
    const rows: BacklinkRow[] = []
    for (const ref of refs) {
      const meta = await noteRepository.get(ref.id)
      if (meta === undefined || meta.trashed) continue
      const content = await noteRepository.getContent(ref.id)
      rows.push({
        id: meta.id,
        title: displayTitle(meta),
        folderId: meta.folderId,
        updatedAt: meta.updatedAt,
        snippet: linkSnippet(content, ref.at),
      })
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * 图谱数据装配（F-703）：传入笔记子集（过滤口径由调用方决定）与上限，
   * 链接边完全复用链接索引。computed 内调用即随索引变更自动重算。
   */
  function assembleGraph(notes: NoteMeta[], limit = GRAPH_NODE_LIMIT): GraphData {
    void version.value // 挂接索引代数依赖：索引任何变更都会让调用方 computed 失效重算
    return buildGraphData(notes, outlinkEntries(), limit)
  }

  return {
    version,
    ready,
    building,
    ensureIndex,
    backlinksWithSnippets,
    assembleGraph,
  }
})
