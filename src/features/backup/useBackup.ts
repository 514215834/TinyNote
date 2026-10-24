import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { ref } from 'vue'
import type { Attachment, BackupFile, Note } from '@/types'
import { backupPort } from '@/lib/db/repositories/backupPort'
import { folderRepository } from '@/lib/db/repositories/folderRepository'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import { downloadBlob } from '@/lib/utils/download'
import { displayTitle } from '@/features/notes/notes'
import { useSettingsStore } from '@/features/settings/stores/settings'
import {
  BackupFormatError,
  backupFileName,
  attachmentEntryPath,
  backupNotePath,
  buildBackupManifest,
  exportNotePath,
  manifestAttachmentsToEntities,
  noteMarkdownFileName,
  noteToMarkdown,
  notesZipFileName,
  parseBackupManifest,
} from './backup'

/**
 * 备份/导出编排层（F-304/F-305）：把纯函数（backup.ts）+ fflate 压缩 + 文件下载串起来。
 * 组件只调用本组合式函数；zip 与 IndexedDB 细节不外泄。
 */
export function useBackup() {
  const busy = ref(false)

  /** 全量备份（F-305）：manifest.json + notes/*.md + assets/*，zip 用于精确还原。
   *  导出成功后记录 lastBackupAt（F-403 备份提醒的计时起点） */
  async function exportBackupZip(): Promise<void> {
    await withBusy(async () => {
      const snapshot = await backupPort.snapshot()
      const manifest = buildBackupManifest(snapshot)
      const entries: Record<string, Uint8Array> = {
        'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      }
      snapshot.notes.forEach((note, index) => {
        entries[backupNotePath(note, index)] = strToU8(noteToMarkdown(note))
      })
      for (const attachment of snapshot.attachments) {
        entries[attachmentEntryPath(attachment.id, attachment.mime)] = new Uint8Array(
          await attachment.blob.arrayBuffer(),
        )
      }
      downloadBlob(
        new Blob([zipSync(entries)], { type: 'application/zip' }),
        backupFileName(manifest.exportedAt),
      )
      await useSettingsStore().markBackedUp()
    })
  }

  /** 全部笔记导出为 .md zip（F-304）：只含未删除笔记，面向通用可读，不用于还原 */
  async function exportNotesZip(): Promise<void> {
    await withBusy(async () => {
      const [notes, folders] = await Promise.all([noteRepository.listActive(), folderRepository.list()])
      const folderById = new Map(folders.map((folder) => [folder.id, folder]))
      const entries: Record<string, Uint8Array> = {}
      notes.forEach((note, index) => {
        entries[exportNotePath(note, index)] = strToU8(noteToMarkdown(note))
      })
      entries['README.txt'] = strToU8(notesReadme(notes, folderById))
      downloadBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), notesZipFileName())
    })
  }

  /** 单篇导出 .md（F-304）；NoteEditor 传入当前草稿（title+content），调用前负责 flush 保证一致性 */
  async function exportNoteMarkdown(note: Pick<Note, 'title' | 'content'>): Promise<void> {
    await withBusy(async () => {
      downloadBlob(
        new Blob([noteToMarkdown(note)], { type: 'text/markdown;charset=utf-8' }),
        noteMarkdownFileName(note),
      )
    })
  }

  /**
   * 导入备份（F-305）：支持 v0.3 起 zip 包与 v0.1/v0.2 的 legacy JSON，统一走校验+迁移管线。
   * 恢复为全量覆盖（backupPort.restore 单事务），调用方负责先弹窗确认。
   */
  async function importBackupFile(
    file: File,
  ): Promise<{ notes: number; folders: number; attachments: number }> {
    return withBusy(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())

      let manifest: BackupFile
      let attachments: Attachment[]
      if (file.name.toLowerCase().endsWith('.zip')) {
        const entries = unzipSync(bytes)
        const manifestRaw = entries['manifest.json']
        if (manifestRaw === undefined) throw new BackupFormatError()
        manifest = parseBackupManifest(JSON.parse(strFromU8(manifestRaw)))
        attachments = manifestAttachmentsToEntities(manifest, (meta) => {
          const data = entries[meta.file]
          return data === undefined ? undefined : new Blob([data], { type: meta.mime })
        })
      } else {
        // legacy JSON 备份（无 zip 包装，v0.1/v0.2 产物），同一校验/迁移管线
        manifest = parseBackupManifest(JSON.parse(strFromU8(bytes)))
        attachments = manifestAttachmentsToEntities(manifest, () => undefined)
      }

      await backupPort.restore({
        folders: manifest.folders,
        notes: manifest.notes,
        attachments,
      })
      return {
        notes: manifest.notes.length,
        folders: manifest.folders.length,
        attachments: attachments.length,
      }
    })
  }

  async function withBusy<T>(task: () => Promise<T>): Promise<T> {
    busy.value = true
    try {
      return await task()
    } finally {
      busy.value = false
    }
  }

  return { busy, exportBackupZip, exportNotesZip, exportNoteMarkdown, importBackupFile }
}

/** 全部笔记导出包内的 README：说明这是通用可读格式，精确还原要用全量备份 */
function notesReadme(
  notes: Note[],
  folderById: Map<string, { name: string }>,
): string {
  const lines = notes.map((note, index) => {
    const folder = note.folderId === null ? undefined : folderById.get(note.folderId)
    return `${String(index + 1).padStart(4, '0')}. ${displayTitle(note)}${folder ? `（文件夹：${folder.name}）` : ''}`
  })
  return [
    'TinyNote 笔记导出（F-304）',
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `笔记总数：${notes.length}（不含回收站中的笔记）`,
    '说明：本包用于通用阅读与迁移到其他 Markdown 工具；带标签/置顶/回收站/附件的精确还原，请使用「全量备份」导出的 zip（可在应用数据菜单中导入）。',
    '',
    ...lines,
  ].join('\n')
}
