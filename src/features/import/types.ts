/**
 * 导入互操作（F-801/F-802/F-803/F-804）的共享类型。
 * 导入一律全量插入（不与既有笔记智能合并），完成后输出统计摘要。
 */

/** 单个来源（文件）的导入产物类型 */
export type ImportSourceKind = 'markdown' | 'enex' | 'notion'

/** 一条跳过/失败明细（reason 已本地化，直接展示） */
export interface ImportIssue {
  /** 来源标识：文件名 / 包内路径 / 笔记标题 */
  source: string
  reason: string
}

/** 导入统计摘要（成功/跳过/失败计数与明细） */
export interface ImportSummary {
  notesCreated: number
  foldersCreated: number
  attachmentsCreated: number
  skipped: ImportIssue[]
  failed: ImportIssue[]
}
