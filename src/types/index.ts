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

/** 备份格式 v1（v0.1–v0.2：JSON；v0.3 起附件改走 zip，见架构文档 4.4） */
export interface BackupFile {
  format: 'tinynote-backup'
  schemaVersion: number
  exportedAt: number
  folders: Folder[]
  notes: Note[]
}
