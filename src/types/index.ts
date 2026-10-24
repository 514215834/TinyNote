/** 笔记：唯一事实来源是 content（Markdown 原文），预览只是渲染结果 */
export interface Note {
  id: string // UUID v7：时间有序（ADR-003）
  title: string
  content: string
  folderId: string | null // v0.2 启用
  tags: string[] // v0.2 启用
  pinned: boolean // v0.2 启用
  trashed: boolean // v0.1 即启用：删除一律软删
  trashedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  order: number
  createdAt: number
}

/** 图片等附件二进制直接存 IndexedDB Blob（v0.3 启用） */
export interface Attachment {
  id: string
  noteId: string
  name: string
  mime: string
  size: number
  blob: Blob
  createdAt: number
}

/** 历史版本快照（v0.4 启用） */
export interface NoteSnapshot {
  id: string
  noteId: string
  content: string
  createdAt: number
}

/** settings 表的 KV 行，value 为 JSON 序列化字符串 */
export interface Setting {
  key: string
  value: string
}

/**
 * 备份格式（架构文档 4.4）：
 * - schemaVersion 1（v0.1–v0.2）：单文件 JSON，无 attachments
 * - schemaVersion 2（v0.3 起）：zip 包内的 manifest.json，notes/assets 附带在包内
 *   attachments 为元数据列表，blob 本体存放在 file 指向的 zip 内路径
 */
export interface BackupAttachment {
  id: string
  noteId: string
  name: string
  mime: string
  size: number
  createdAt: number
  /** zip 包内路径，如 `assets/<id>.png` */
  file: string
}

export interface BackupFile {
  format: 'tinynote-backup'
  schemaVersion: number // 1 = JSON 全量备份；2 = zip 全量备份（含附件）
  exportedAt: number
  folders: Folder[]
  /** 全量备份包含回收站中的笔记（trashed = true） */
  notes: Note[]
  /** schemaVersion 2 起提供；导入 v1 备份时迁移函数补空数组 */
  attachments?: BackupAttachment[]
}
