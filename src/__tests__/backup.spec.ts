// @vitest-environment node
import 'fake-indexeddb/auto'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/db'
import { backupPort } from '@/lib/db/repositories/backupPort'
import { noteRepository } from '@/lib/db/repositories/noteRepository'
import type { BackupFile, Note } from '@/types'
import {
  BackupFormatError,
  BackupVersionError,
  BACKUP_FORMAT,
  CURRENT_BACKUP_VERSION,
  attachmentEntryPath,
  backupFileName,
  backupNotePath,
  backupReminderDue,
  backupSnoozeActive,
  buildBackupManifest,
  extensionFor,
  fileNameSlug,
  manifestAttachmentsToEntities,
  noteMarkdownFileName,
  noteToMarkdown,
  notesZipFileName,
  parseBackupManifest,
} from '@/features/backup/backup'

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `标题-${id}`,
    content: `内容-${id}`,
    folderId: null,
    tags: [],
    pinned: false,
    trashed: false,
    trashedAt: null,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

function makeManifest(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: CURRENT_BACKUP_VERSION,
    exportedAt: 1700000000000,
    folders: [],
    notes: [makeNote('n1')],
    attachments: [],
    ...overrides,
  }
}

beforeEach(async () => {
  await db.notes.clear()
  await db.folders.clear()
  await db.attachments.clear()
  await db.snapshots.clear()
})

describe('parseBackupManifest（F-305 校验与迁移）', () => {
  it('format 不匹配 / 结构缺失 → BackupFormatError', () => {
    expect(() => parseBackupManifest({ format: 'other' })).toThrow(BackupFormatError)
    expect(() => parseBackupManifest(null)).toThrow(BackupFormatError)
    expect(() => parseBackupManifest('json')).toThrow(BackupFormatError)
    expect(() => parseBackupManifest(makeManifest({ folders: undefined as unknown as [] }))).toThrow(
      BackupFormatError,
    )
  })

  it('schemaVersion 高于当前 → BackupVersionError（提示升级应用）', () => {
    expect(() => parseBackupManifest(makeManifest({ schemaVersion: 99 }))).toThrow(BackupVersionError)
    expect(() => parseBackupManifest(makeManifest({ schemaVersion: Number.NaN }))).toThrow(
      BackupFormatError,
    )
  })

  it('v1 JSON 备份（无 attachments）迁移为 v2：补空数组，notes/folders 原样保留', () => {
    const v1: Partial<BackupFile> = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: 123,
      folders: [],
      notes: [makeNote('legacy')],
    }
    const migrated = parseBackupManifest(v1)
    expect(migrated.schemaVersion).toBe(CURRENT_BACKUP_VERSION)
    expect(migrated.attachments).toEqual([])
    expect(migrated.notes[0]?.id).toBe('legacy')
  })

  it('v2 备份原样通过，不做多余拷贝迁移', () => {
    const manifest = makeManifest()
    expect(parseBackupManifest(manifest)).toBe(manifest)
  })
})

describe('buildBackupManifest（F-305 导出）', () => {
  it('manifest 携带 v2 版本、全部笔记（含回收站）与附件元数据（file 指向 assets/ 路径）', () => {
    const manifest = buildBackupManifest({
      folders: [],
      notes: [makeNote('n1'), makeNote('n2', { trashed: true, trashedAt: 5 })],
      attachments: [
        {
          id: 'a1',
          noteId: 'n1',
          name: 'pic.png',
          mime: 'image/png',
          size: 3,
          blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
          createdAt: 7,
        },
      ],
    })
    expect(manifest.format).toBe(BACKUP_FORMAT)
    expect(manifest.schemaVersion).toBe(CURRENT_BACKUP_VERSION)
    expect(manifest.notes.map((note) => note.id)).toEqual(['n1', 'n2'])
    expect(manifest.attachments).toEqual([
      { id: 'a1', noteId: 'n1', name: 'pic.png', mime: 'image/png', size: 3, createdAt: 7, file: `assets/a1.png` },
    ])
  })
})

describe('命名规范（F-304/F-305）', () => {
  it('zip 文件名带 YYYYMMDD 日期戳', () => {
    expect(backupFileName(new Date(2026, 9, 23).getTime())).toBe('tinynote-backup-20261023.zip')
    expect(notesZipFileName(new Date(2026, 9, 23).getTime())).toBe('tinynote-notes-20261023.zip')
  })

  it('文件名 slug：剔除非法字符、空白折叠连字符、超长截断、无标题回退正文首行', () => {
    expect(fileNameSlug({ title: '我的:笔记/名?', content: '' })).toBe('我的笔记名')
    expect(fileNameSlug({ title: '', content: '首行 内容\n第二行' })).toBe('首行-内容')
    expect(fileNameSlug({ title: 'x'.repeat(100), content: '' })).toHaveLength(40)
    expect(fileNameSlug({ title: '  ', content: '  \n\n' })).toBe('无标题笔记') // 无任何可显示内容
    expect(fileNameSlug({ title: '///', content: '' })).toBe('untitled') // 净化后为空
    expect(fileNameSlug({ title: '...-前缀点', content: '' })).toBe('前缀点')
  })

  it('单篇导出与包内路径生成稳定', () => {
    const note = { title: '安装指南', content: '' }
    expect(noteMarkdownFileName(note)).toBe('安装指南.md')
    expect(backupNotePath(note, 9)).toBe('notes/0010-安装指南.md')
  })

  it('extensionFor 覆盖常见图片格式，未知类型回退 bin', () => {
    expect(extensionFor('image/png')).toBe('png')
    expect(extensionFor('image/jpeg')).toBe('jpg')
    expect(extensionFor('image/svg+xml')).toBe('svg')
    expect(extensionFor('application/octet-stream')).toBe('bin')
  })

  it('noteToMarkdown：非空标题补 H1；正文已以同标题开头则原样；无标题内容原样', () => {
    expect(noteToMarkdown({ title: 'T', content: 'body' })).toBe('# T\n\nbody')
    expect(noteToMarkdown({ title: 'T', content: '# T\nbody' })).toBe('# T\nbody')
    expect(noteToMarkdown({ title: '', content: 'raw' })).toBe('raw')
  })
})

describe('备份 zip 往返 → 导入恢复（F-305 验收购回路径）', () => {
  it('导出 manifest+notes+assets → zip → 解包校验 → restore 全量还原', async () => {
    // 造当前库数据
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' })
    const source = {
      folders: [{ id: 'f1', name: '工作', order: 0, createdAt: 1 }],
      notes: [makeNote('n1', { folderId: 'f1', tags: ['工作'] }), makeNote('n2', { trashed: true, trashedAt: 5 })],
      attachments: [
        { id: 'a1', noteId: 'n1', name: 'pic.png', mime: 'image/png', size: 3, blob, createdAt: 7 },
      ],
    }
    for (const note of source.notes) {
      const { content, ...meta } = note
      await db.notes.put({ ...meta, tags: [...meta.tags], excerpt: content })
      await db.contents.put({ id: note.id, content })
    }
    await db.folders.put(source.folders[0])
    await db.attachments.put(source.attachments[0])

    // 1) 导出：snapshot → manifest → 组 zip
    const snapshot = await backupPort.snapshot()
    const manifest = buildBackupManifest(snapshot)
    const entries: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(manifest)),
    }
    snapshot.notes.forEach((note, index) => {
      entries[backupNotePath(note, index)] = strToU8(noteToMarkdown(note))
    })
    entries[attachmentEntryPath('a1', 'image/png')] = new Uint8Array([9, 9, 9])
    const zipBytes = zipSync(entries)

    // 2) 清库（模拟换设备）
    await db.notes.clear()
    await db.contents.clear()
    await db.folders.clear()
    await db.attachments.clear()

    // 3) 导入：解包 → 校验/迁移 → restore
    const unzipped = unzipSync(zipBytes)
    const parsed = parseBackupManifest(JSON.parse(strFromU8(unzipped['manifest.json'])))
    const entities = manifestAttachmentsToEntities(parsed, (meta) =>
      unzipped[meta.file] === undefined ? undefined : new Blob([unzipped[meta.file]], { type: meta.mime }),
    )
    await backupPort.restore({ folders: parsed.folders, notes: parsed.notes, attachments: entities })

    expect((await db.notes.get('n1'))?.tags).toEqual(['工作'])
    expect((await db.notes.get('n2'))?.trashed).toBe(true)
    expect((await db.contents.get('n1'))?.content).toBe('内容-n1')
    expect(await db.contents.get('n2')).not.toBeUndefined()
    expect(await db.folders.toArray()).toEqual(source.folders)
    const restored = await db.attachments.get('a1')
    expect(restored?.blob).toBeInstanceOf(Blob)
    expect([...new Uint8Array(await restored!.blob.arrayBuffer())]).toEqual([9, 9, 9])
  })

  it('assets 中缺失文件 → 跳过附件（正文引用渲染为占位，不阻断恢复）', () => {
    const manifest = makeManifest({
      attachments: [
        { id: 'a1', noteId: 'n1', name: 'x.png', mime: 'image/png', size: 1, createdAt: 1, file: 'assets/a1.png' },
      ],
    })
    const entities = manifestAttachmentsToEntities(manifest, () => undefined)
    expect(entities).toEqual([])
  })
})

describe('noteRepository 物理删除连带附件清理（F-303 补充）', () => {
  it('deleteForever 顺带删除该笔记附件；listAll 含回收站笔记', async () => {
    for (const note of [makeNote('n1'), makeNote('n2', { trashed: true, trashedAt: 1 })]) {
      const { content, ...meta } = note
      await db.notes.put({ ...meta, tags: [...meta.tags], excerpt: content })
      await db.contents.put({ id: note.id, content })
    }
    await db.attachments.put({ ...sourceAttachment(), noteId: 'n1' })
    await db.attachments.put({ ...sourceAttachment(), id: 'a2', noteId: 'n2' })

    expect((await backupPort.snapshot()).notes).toHaveLength(2)
    await noteRepository.deleteForever('n1')
    expect(await db.attachments.get('a2')).not.toBeUndefined()
    expect(await db.attachments.where('noteId').equals('n1').toArray()).toEqual([])
  })
})

function sourceAttachment() {
  return {
    id: 'a1',
    noteId: 'n1',
    name: 'x.png',
    mime: 'image/png',
    size: 1,
    blob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
    createdAt: 1,
  }
}

describe('backupReminderDue（F-403 备份提醒口径）', () => {
  const DAY = 86_400_000
  const NOW = 1_700_000_000_000

  it('从未备份（null/undefined）视为需要提醒', () => {
    expect(backupReminderDue(null, NOW)).toBe(true)
    expect(backupReminderDue(undefined, NOW)).toBe(true)
  })

  it('边界：恰好满 7 天提醒，差 1ms 未满不提醒', () => {
    expect(backupReminderDue(NOW - 7 * DAY, NOW)).toBe(true)
    expect(backupReminderDue(NOW - 7 * DAY + 1, NOW)).toBe(false)
    expect(backupReminderDue(NOW - 8 * DAY, NOW)).toBe(true)
  })

  it('提醒周期可注入（days 参数）', () => {
    expect(backupReminderDue(NOW - 3 * DAY, NOW, 2)).toBe(true)
    expect(backupReminderDue(NOW - 3 * DAY, NOW, 4)).toBe(false)
  })
})

describe('backupSnoozeActive（F-403 「暂不提醒」贪睡口径）', () => {
  const DAY = 86_400_000
  const NOW = 1_700_000_000_000

  it('从未贪睡（null/undefined）视为未贪睡', () => {
    expect(backupSnoozeActive(null, NOW)).toBe(false)
    expect(backupSnoozeActive(undefined, NOW)).toBe(false)
  })

  it('贪睡期内生效；恰好满 7 天失效，重新进入提醒（边界与 backupReminderDue 一致）', () => {
    expect(backupSnoozeActive(NOW - 3 * DAY, NOW)).toBe(true)
    expect(backupSnoozeActive(NOW - 7 * DAY, NOW)).toBe(false)
    expect(backupSnoozeActive(NOW - 7 * DAY + 1, NOW)).toBe(true)
  })
})

describe('backupPort.wipe（F-522 清空全部数据）', () => {
  it('单事务清空全部表（笔记/正文/文件夹/附件/快照/设置）', async () => {
    const { content, ...meta } = makeNote('n1')
    await db.notes.put({ ...meta, tags: [...meta.tags], excerpt: content })
    await db.contents.put({ id: 'n1', content })
    await db.folders.put({ id: 'f1', name: '工作', order: 0, createdAt: 1 })
    await db.attachments.put({ ...sourceAttachment() })
    await db.snapshots.put({ id: 's1', noteId: 'n1', content: 'x', createdAt: 1 })
    await db.settings.put({ key: 'lastBackupAt', value: '123' })

    await backupPort.wipe()

    expect(await db.notes.count()).toBe(0)
    expect(await db.contents.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.snapshots.count()).toBe(0)
    expect(await db.settings.count()).toBe(0)
  })
})
