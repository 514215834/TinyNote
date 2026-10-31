import { db } from '@/lib/db/db'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { findWikiLinks, type WikiLinkRef } from './wikilinks'

/**
 * 双链索引（F-702）：内存派生数据——正文正则扫描构建，不落库、可随时重建
 * （与 MiniSearch 索引同原则）。
 * - forward：noteId → 出链（含位置，供反链摘要与断链标记）
 * - inverted：目标标题 → 引用它的 noteId → 首次出现位置（反链查询 O(1)）
 * 维护时机：保存/新建（updateLinks）、软删/彻底删除（removeLinks）、
 * 同步整库改写（discardLinks 后按需重建）；构建期间的增量会收尾补账。
 */

/** 单篇笔记的出链条目 */
export interface LinkEntry {
  id: string
  title: string
  links: WikiLinkRef[]
}

let forward = new Map<string, LinkEntry>()
let inverted = new Map<string, Map<string, number>>()
let ready = false
let building = false
let dirtyDuringBuild: Set<string> | null = null

/** 索引变更监听（F-703）：store 订阅后以版本代数驱动面板/图谱等响应式消费者 */
let changeListener: (() => void) | null = null

export function onLinksChanged(listener: () => void): void {
  changeListener = listener
}

function notify(): void {
  changeListener?.()
}

export function isLinksReady(): boolean {
  return ready
}

export function isLinksBuilding(): boolean {
  return building
}

/** 重新登记一篇的出链（索引未就绪时静默跳过；构建期间挂起待补账） */
export function updateLinks(id: string, title: string, content: string): void {
  if (building && dirtyDuringBuild !== null) {
    dirtyDuringBuild.add(id)
    return
  }
  if (!ready) return
  unlink(id) // 内部摘除不发通知：对外仅一次变更事件
  const links = findWikiLinks(content)
  forward.set(id, { id, title, links })
  for (const link of links) {
    let atById = inverted.get(link.target)
    if (atById === undefined) {
      atById = new Map()
      inverted.set(link.target, atById)
    }
    if (!atById.has(id)) atById.set(id, link.at)
  }
  notify()
}

/** 摘除一篇的出链记录 */
export function removeLinks(id: string): void {
  if (unlink(id)) notify()
}

/** 摘除实现（返回是否确有变更）；构建期补账等内部路径复用 */
function unlink(id: string): boolean {
  const entry = forward.get(id)
  if (entry === undefined) return false
  forward.delete(id)
  for (const link of entry.links) {
    const atById = inverted.get(link.target)
    if (atById === undefined) continue
    atById.delete(id)
    if (atById.size === 0) inverted.delete(link.target)
  }
  return true
}

/** 丢弃全部索引（外部整库刷新/批量删除后调用），由 ensureIndex 择机重建 */
export function discardLinks(): void {
  forward = new Map()
  inverted = new Map()
  ready = false
  notify()
}

/** 出链条目全量快照（F-703 图谱数据源；索引未就绪返回空） */
export function outlinkEntries(): LinkEntry[] {
  return ready ? Array.from(forward.values()) : []
}

/** 反链查询：引用了 target 标题的 noteId 列表（索引未就绪返回空） */
export function backlinkRefsOf(target: string): Array<{ id: string; at: number }> {
  const atById = inverted.get(target)
  if (atById === undefined) return []
  return [...atById].map(([id, at]) => ({ id, at }))
}

/** 出链读取（未登记返回 undefined） */
export function outlinksOf(id: string): WikiLinkRef[] | undefined {
  return forward.get(id)?.links
}

/**
 * 全量构建：contents 流式读取 + 活跃笔记标题配对；完成后对构建期间到达的
 * 增量补一次准确重建（当时内存未就绪，按 db 当前值补齐）。
 */
export async function buildLinksIndex(): Promise<boolean> {
  if (building) return false
  building = true
  dirtyDuringBuild = new Set()
  try {
    const metas = await db.notes.toArray()
    const titleById = new Map(metas.filter((meta) => !meta.trashed).map((meta) => [meta.id, meta.title]))
    const freshForward = new Map<string, LinkEntry>()
    const freshInverted = new Map<string, Map<string, number>>()
    await db.contents.each((row) => {
      const title = titleById.get(row.id)
      if (title === undefined) return // 回收站笔记与孤儿正文不进索引
      const links = findWikiLinks(row.content)
      freshForward.set(row.id, { id: row.id, title, links })
      for (const link of links) {
        let atById = freshInverted.get(link.target)
        if (atById === undefined) {
          atById = new Map()
          freshInverted.set(link.target, atById)
        }
        if (!atById.has(row.id)) atById.set(row.id, link.at)
      }
    })
    forward = freshForward
    inverted = freshInverted
    ready = true
    notify()
    const dirty = dirtyUntilBuild()
    for (const id of dirty) {
      const meta = await db.notes.get(id)
      if (meta === undefined || meta.trashed) continue
      updateLinks(id, meta.title, await noteRepository.getContent(id))
    }
    if (dirty.length > 0) notify() // 补账完成后统一通知一次
    return true
  } finally {
    building = false
    dirtyDuringBuild = null
  }
}

/** 取走构建期间到达的增量 id（并清空暂存） */
function dirtyUntilBuild(): string[] {
  const dirty = dirtyDuringBuild
  dirtyDuringBuild = null
  return [...(dirty ?? [])]
}

const idle =
  typeof requestIdleCallback === 'function'
    ? (callback: () => void) => requestIdleCallback(() => callback(), { timeout: 5000 })
    : (callback: () => void) => setTimeout(callback, 2000)

let rebuildScheduled = false

/**
 * 择机全量构建（App 启动与整库刷新后调用）：索引未就绪时空闲后再建（让路首屏），
 * 建好前反链/补全查询返回空（与搜索索引构建期回退同一原则）。
 */
export function scheduleLinksBuild(): void {
  if (ready || building || rebuildScheduled) return
  rebuildScheduled = true
  idle(() => {
    rebuildScheduled = false
    if (ready || building) return
    void buildLinksIndex()
  })
}
