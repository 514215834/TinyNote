import type { Attachment, BackupAttachment, BackupFile, Folder, Note } from '@/types'
import { t } from '@/lib/i18n'

/**
 * 备份领域层（F-305，架构文档 4.4）：
 * - schemaVersion 1（v0.1–v0.2）：单文件 JSON
 * - schemaVersion 2（v0.3 起）：zip 包（manifest.json + notes/*.md + assets/*）
 * 本文件全部为纯函数：manifest 构建、导入校验与 v1→v2 迁移、包内路径命名。
 * zip 组装/解包与下载动作在 useBackup.ts（有副作用的编排层）。
 */

export const BACKUP_FORMAT = 'tinynote-backup'
export const CURRENT_BACKUP_VERSION = 2

/** 备份提醒周期（天，F-403）：距上次全量备份导出超过该时长时，启动显示提醒横幅 */
export const BACKUP_REMINDER_DAYS = 7

const DAY_MS = 86_400_000

/**
 * 是否应显示备份提醒（F-403）：从未备份过视为需要提醒；上次备份早于等于
 * now - days 时再次提醒（恰好满 N 天即提醒，边界与回收站清理口径一致）。
 */
export function backupReminderDue(
  lastBackupAt: number | null | undefined,
  now: number,
  days: number = BACKUP_REMINDER_DAYS,
): boolean {
  if (lastBackupAt === null || lastBackupAt === undefined) return true
  return lastBackupAt <= now - days * DAY_MS
}

/**
 * 「暂不提醒」贪睡是否仍有效（F-403）：关闭横幅记忆为一次提醒计时重置（存 localStorage），
 * 同一提醒周期内不再提示，超过 days 后重新提醒（关闭不等于「已备份」）。
 * 无记录（0/null/undefined）或时间戳已过周期均视为未贪睡。
 */
export function backupSnoozeActive(
  snoozedAt: number | null | undefined,
  now: number,
  days: number = BACKUP_REMINDER_DAYS,
): boolean {
  if (snoozedAt === null || snoozedAt === undefined) return false
  return snoozedAt > now - days * DAY_MS
}

/** 缺失/非法的备份文件：format 不匹配等结构问题 */
export class BackupFormatError extends Error {
  constructor(message = t('backup.invalidFile')) {
    super(message)
    this.name = 'BackupFormatError'
  }
}

/** 备份由更新版本的应用创建，schemaVersion 超出当前支持 */
export class BackupVersionError extends Error {
  constructor(
    message: string,
    public readonly version: number,
  ) {
    super(message)
    this.name = 'BackupVersionError'
  }
}

/** 依据当前库全量数据构建 manifest.json 内容（schemaVersion 2） */
export function buildBackupManifest(data: {
  folders: Folder[]
  notes: Note[]
  attachments: Attachment[]
}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_BACKUP_VERSION,
    exportedAt: Date.now(),
    folders: data.folders,
    notes: data.notes,
    attachments: data.attachments.map((attachment): BackupAttachment => ({
      id: attachment.id,
      noteId: attachment.noteId,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      createdAt: attachment.createdAt,
      file: attachmentEntryPath(attachment.id, attachment.mime),
    })),
  }
}

/**
 * 校验并迁移备份数据：返回可直接入库的 manifest（schemaVersion 2 形态）。
 * - v1（JSON 备份，无 attachments）→ 补空数组，其余字段原样保留（向后兼容）
 * - 未来版本 → 拒绝并提示升级应用
 */
export function parseBackupManifest(raw: unknown): BackupFile {
  if (typeof raw !== 'object' || raw === null || (raw as BackupFile).format !== BACKUP_FORMAT) {
    throw new BackupFormatError()
  }
  const manifest = raw as BackupFile
  const version = (manifest as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupFormatError()
  }
  if (version > CURRENT_BACKUP_VERSION) {
    throw new BackupVersionError(
      t('backup.versionTooNew', { version, current: CURRENT_BACKUP_VERSION }),
      version,
    )
  }
  if (typeof manifest.exportedAt !== 'number' || !Array.isArray(manifest.folders) || !Array.isArray(manifest.notes)) {
    throw new BackupFormatError()
  }
  return manifest.schemaVersion === CURRENT_BACKUP_VERSION
    ? manifest
    : migrateToCurrent(manifest)
}

/** 旧版本 → 当前版本的迁移（当前仅 v1 → v2：补 attachments 空数组） */
function migrateToCurrent(manifest: BackupFile): BackupFile {
  return { ...manifest, schemaVersion: CURRENT_BACKUP_VERSION, attachments: manifest.attachments ?? [] }
}

/** manifest → 可入库的附件实体；blob 本体由 zip 内 assets/ 文件重建（含正确 MIME）传入 */
export function manifestAttachmentsToEntities(
  manifest: BackupFile,
  readFile: (meta: BackupAttachment) => Blob | undefined,
): Attachment[] {
  return (manifest.attachments ?? []).flatMap((meta) => {
    const blob = readFile(meta)
    if (blob === undefined) return [] // assets 内文件缺失：跳过该附件，正文引用渲染为「图片缺失」占位
    return [{
      id: meta.id,
      noteId: meta.noteId,
      name: meta.name,
      mime: meta.mime,
      size: Math.max(meta.size, blob.size),
      blob,
      createdAt: meta.createdAt,
    }]
  })
}

/* ============================== 命名规范 ============================== */

/** 备份 zip 文件名：tinynote-backup-YYYYMMDD.zip（时间注入便于测试） */
export function backupFileName(exportedAt: number = Date.now()): string {
  return `tinynote-backup-${dateStamp(exportedAt)}.zip`
}

/** 全部笔记导出 zip 的文件名：tinynote-notes-YYYYMMDD.zip（F-304） */
export function notesZipFileName(exportedAt: number = Date.now()): string {
  return `tinynote-notes-${dateStamp(exportedAt)}.zip`
}

/** 附件在 zip 内的路径：assets/<id>.<扩展名>（id 为 UUID v7，本身适合做文件名） */
export function attachmentEntryPath(id: string, mime: string): string {
  return `assets/${id}.${extensionFor(mime)}`
}

/** 官方备份包内的 notes/ 目录文件名（F-305）：`0001-标题-slug.md`，序号保证唯一与稳定排序 */
export function backupNotePath(note: Pick<Note, 'title' | 'content'>, index: number): string {
  return `notes/${String(index + 1).padStart(4, '0')}-${fileNameSlug(note)}.md`
}

/** 自主导出（F-304）zip 内的文件名：`note-0001-标题-slug.md`，与备份包区分避免误导入混淆 */
export function exportNotePath(note: Pick<Note, 'title' | 'content'>, index: number): string {
  return `notes/note-${String(index + 1).padStart(4, '0')}-${fileNameSlug(note)}.md`
}

/** 文件系统安全化标题：剔除 Windows/Unix 非法字符，保留 CJK；空白折叠为连字符；超长截断 */
export function fileNameSlug(note: Pick<Note, 'title' | 'content'>): string {
  const raw = (note.title.trim() || note.content.split('\n')[0]?.trim() || t('common.untitled'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/^[.\-]+/, '') // 避免以点/连字符开头（Windows 保留名/隐藏文件的常见坑）
  return raw === '' ? 'untitled' : raw
}

/** 单篇导出（F-304）的 .md 文件名 */
export function noteMarkdownFileName(note: Pick<Note, 'title' | 'content'>): string {
  return `${fileNameSlug(note)}.md`
}

/** MIME → 扩展名映射（仅覆盖常见图片格式，未知类型回退 bin） */
export function extensionFor(mime: string): string {
  const table: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
  }
  return table[mime] ?? 'bin'
}

/** 导出 .md 的人类可读正文：标题非空且正文未以其开头时，补一行 `# 标题` */
export function noteToMarkdown(note: Pick<Note, 'title' | 'content'>): string {
  const title = note.title.trim()
  const firstLine = note.content.split('\n')[0]?.trim() ?? ''
  if (title === '' || firstLine === `# ${title}`) return note.content
  return `# ${title}\n\n${note.content}`
}

function dateStamp(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}${month}${day}`
}
