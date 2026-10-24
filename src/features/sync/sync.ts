import type { Attachment, Folder, Note } from '@/types'
import { createId } from '@/lib/utils/id'
import { base64ToBlob, blobToBase64 } from '@/lib/utils/base64'
import { attachmentRef, extractAttachmentIds } from '@/lib/markdown/attachmentRef'
import { displayTitle } from '@/features/notes/notes'

/**
 * 同步领域层（F-501/F-502，v0.6）：GitHub Gist 全量同步的纯函数核心。
 * - 载荷格式 SyncFile（schemaVersion 1）：全量库的 JSON 形态，附件以 base64 内联（Gist 只收文本）。
 * - 合并算法：以上次同步成功的库状态指纹为基线（SyncBaseline）做三方判定——
 *   只有一侧变更 → 采纳该侧；双侧都变更 → 以 updatedAt 为准 last-write-wins，
 *   落败方的完整状态保留为冲突副本笔记（`标题（冲突@设备）`）供手动合并；
 *   一侧删除另一侧修改 → 修改优先于删除；无基线（首次同步）→ 纯 LWW、不生成冲突副本。
 * - 文件夹无时间戳：双侧都改名时保留本地（已记录于 CHANGELOG 已知问题）。
 * 快照（F-402）与设置 KV 不参与同步；本文件不依赖 db / 网络（编排见 stores/sync.ts）。
 */

export const SYNC_FORMAT = 'tinynote-sync'
export const SYNC_FORMAT_ENCRYPTED = 'tinynote-sync-enc'
export const CURRENT_SYNC_VERSION = 1

/** 备份导出/恢复的数据口径（backupPort.LibrarySnapshot 的结构镜像，避免纯函数依赖 db 层） */
export interface SyncLibrary {
  folders: Folder[]
  notes: Note[]
  attachments: Attachment[]
}

/** 同步载荷内的附件：元数据 + base64 正文（Gist 文件只能存文本） */
export interface SyncAttachment {
  id: string
  noteId: string
  name: string
  mime: string
  size: number
  createdAt: number
  data: string
}

/** Gist 中 tinynote-sync.json 的内容（明文形态；加密时整体作为密文信封，见 syncCrypto.ts） */
export interface SyncFile {
  format: typeof SYNC_FORMAT
  schemaVersion: number
  exportedAt: number
  /** 产生本载荷的设备（冲突副本命名与排查用） */
  deviceId: string
  deviceName: string
  folders: Folder[]
  /** 全量笔记（含回收站），与备份格式同一口径 */
  notes: Note[]
  attachments: SyncAttachment[]
}

/** 合并输入的远端形态：附件已物化为 Blob（base64ToBlob），其余字段同 SyncFile */
export interface SyncRemoteState {
  deviceId: string
  deviceName: string
  folders: Folder[]
  notes: Note[]
  attachments: Attachment[]
}

/** 同步基线：上次同步成功时合并结果的逐笔记/逐文件夹状态指纹（settings KV 持久化） */
export interface SyncBaseline {
  savedAt: number
  notes: Record<string, string>
  folders: Record<string, string>
}

export interface SyncStats {
  /** 本次上行到远端的笔记数（本地新建/本地已改/冲突副本） */
  uploaded: number
  /** 本次从远端落地的笔记数（远端新建/远端更新/复活） */
  downloaded: number
  /** 生成的冲突副本数 */
  conflicts: number
  /** 远端删除在本机落地的物理删除数 */
  deletedByRemote: number
}

export interface SyncMergeInput {
  local: SyncLibrary
  remote: SyncRemoteState | null
  baseline: SyncBaseline | null
  /** 本机设备标识（冲突副本署名用） */
  device: { id: string; name: string }
  now: number
}

export interface SyncMergeResult {
  /** 合并后的全量库：写回本机 + 上传远端是同一份数据 */
  library: SyncLibrary
  /** 远端删除传播在本机物理删除的笔记 id（其历史快照一并清理） */
  deletedNoteIds: string[]
  stats: SyncStats
}

/** 载荷缺失/非法：format 不匹配等结构问题 */
export class SyncFormatError extends Error {
  constructor(message = '不是有效的 TinyNote 同步数据') {
    super(message)
    this.name = 'SyncFormatError'
  }
}

/** 载荷由更新版本的应用创建，schemaVersion 超出当前支持 */
export class SyncVersionError extends Error {
  constructor(
    message: string,
    public readonly version: number,
  ) {
    super(message)
    this.name = 'SyncVersionError'
  }
}

/* ============================== 校验与物化 ============================== */

/** 校验并归一化远端载荷：结构不合法抛 SyncFormatError，未来版本抛 SyncVersionError */
export function parseSyncFile(raw: unknown): SyncFile {
  if (typeof raw !== 'object' || raw === null || (raw as SyncFile).format !== SYNC_FORMAT) {
    throw new SyncFormatError()
  }
  const file = raw as SyncFile
  const version = (file as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SyncFormatError()
  }
  if (version > CURRENT_SYNC_VERSION) {
    throw new SyncVersionError(
      `同步数据 schemaVersion ${version} 高于当前支持的 ${CURRENT_SYNC_VERSION}，请先升级应用`,
      version,
    )
  }
  if (typeof file.exportedAt !== 'number' || !Array.isArray(file.folders) || !Array.isArray(file.notes)) {
    throw new SyncFormatError()
  }
  return {
    ...file,
    deviceId: typeof file.deviceId === 'string' ? file.deviceId : '',
    deviceName: typeof file.deviceName === 'string' ? file.deviceName : '',
    attachments: Array.isArray(file.attachments) ? file.attachments : [],
  }
}

/** 载荷附件 → 可入库实体（base64 → Blob；size 以实际字节为准） */
export function syncAttachmentsToEntities(
  list: SyncAttachment[],
): Attachment[] {
  return list.map((meta) => {
    const blob = base64ToBlob(meta.data, meta.mime)
    return {
      id: meta.id,
      noteId: meta.noteId,
      name: meta.name,
      mime: meta.mime,
      size: Math.max(meta.size, blob.size),
      blob,
      createdAt: meta.createdAt,
    }
  })
}

/** SyncFile → 合并输入的远端形态 */
export function toRemoteState(file: SyncFile): SyncRemoteState {
  return {
    deviceId: file.deviceId,
    deviceName: file.deviceName,
    folders: file.folders,
    notes: file.notes,
    attachments: syncAttachmentsToEntities(file.attachments),
  }
}

/* ============================== 状态指纹 ============================== */

/**
 * 笔记状态指纹（F-502 变更判定）：只含「有意义的同步状态」——updatedAt 不参与
 * （时间戳漂移不算变更，真正的内容/元数据变化才参与合并），标签排序后序列化保证跨设备稳定。
 */
export function canonicalNoteState(note: Note): string {
  return JSON.stringify({
    title: note.title,
    content: note.content,
    folderId: note.folderId,
    tags: [...note.tags].sort(),
    pinned: note.pinned,
    trashed: note.trashed,
    trashedAt: note.trashedAt,
  })
}

/** 文件夹状态指纹：rename/order 变更可被检出（文件夹无 updatedAt） */
export function canonicalFolderState(folder: Folder): string {
  return JSON.stringify({ name: folder.name, order: folder.order, createdAt: folder.createdAt })
}

/** FNV-1a 32bit × 双种子 → 16 位 hex（纯函数，无 crypto 依赖；碰撞概率对变更判定可忽略） */
export function fingerprint(state: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < state.length; i++) {
    const code = state.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/** 合并后全量库 → 新基线（保存于本次同步成功之后） */
export function buildBaseline(library: SyncLibrary, savedAt: number): SyncBaseline {
  const notes: Record<string, string> = {}
  for (const note of library.notes) notes[note.id] = fingerprint(canonicalNoteState(note))
  const folders: Record<string, string> = {}
  for (const folder of library.folders) folders[folder.id] = fingerprint(canonicalFolderState(folder))
  return { savedAt, notes, folders }
}

/* ============================== 全量库 → 载荷 ============================== */

/** 合并结果 → Gist 载荷（附件 base64 内联） */
export async function buildSyncFile(
  library: SyncLibrary,
  device: { id: string; name: string },
  exportedAt: number = Date.now(),
): Promise<SyncFile> {
  const attachments = await Promise.all(
    library.attachments.map(async (attachment): Promise<SyncAttachment> => ({
      id: attachment.id,
      noteId: attachment.noteId,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      createdAt: attachment.createdAt,
      data: await blobToBase64(attachment.blob),
    })),
  )
  return {
    format: SYNC_FORMAT,
    schemaVersion: CURRENT_SYNC_VERSION,
    exportedAt,
    deviceId: device.id,
    deviceName: device.name,
    folders: library.folders,
    notes: library.notes,
    attachments,
  }
}

/* ============================== 合并（F-502 核心） ============================== */

export function mergeSync(input: SyncMergeInput): SyncMergeResult {
  const { local, remote, baseline, device, now } = input

  const localNoteById = new Map(local.notes.map((note) => [note.id, note]))
  const remoteNotes = remote?.notes ?? []
  const remoteNoteById = new Map(remoteNotes.map((note) => [note.id, note]))
  const localAttachmentsByNote = groupByNote(local.attachments)
  const remoteAttachmentsByNote = groupByNote(remote?.attachments ?? [])
  const baseNotes = baseline?.notes ?? {}

  const mergedNotes: Note[] = []
  /** 合并中新增的附件（远端落地 + 冲突副本复制）；本地存量附件在循环后按删除名单过滤并入 */
  const addedAttachments: Attachment[] = []
  const deletedNoteIds: string[] = []
  const stats: SyncStats = { uploaded: 0, downloaded: 0, conflicts: 0, deletedByRemote: 0 }

  // 本地序在前、远端独有在后：输出顺序稳定（不参与排序，仅为可预期）
  const allIds = [...new Set([...localNoteById.keys(), ...remoteNoteById.keys()])]

  for (const id of allIds) {
    const ln = localNoteById.get(id)
    const rn = remoteNoteById.get(id)

    // —— 本地独有 ——
    if (ln && !rn) {
      const baseFp = baseNotes[id]
      if (baseFp === undefined) {
        keep(ln)
        stats.uploaded++
      } else if (fingerprint(canonicalNoteState(ln)) === baseFp) {
        // 上次同步后本机未动、远端已删除 → 跟随删除（物理删除，附件随删除级联清空）
        deletedNoteIds.push(id)
        stats.deletedByRemote++
      } else {
        // 本机改过、远端删除 → 修改优先于删除（改动随上传带回远端）
        keep(ln)
        stats.uploaded++
      }
      continue
    }

    // —— 远端独有 ——
    if (!ln && rn) {
      const baseFp = baseNotes[id]
      const remoteFp = fingerprint(canonicalNoteState(rn))
      if (baseFp !== undefined && remoteFp === baseFp) {
        // 双侧都已删除 → 保持消失
      } else {
        // 远端新建；或本地已物理删除但远端又有修改（修改优先于删除 → 复活）
        keep(rn)
        collectRemoteAttachments(rn.id)
        stats.downloaded++
      }
      continue
    }

    // —— 双方都有 ——
    const localFp = fingerprint(canonicalNoteState(ln!))
    const remoteFp = fingerprint(canonicalNoteState(rn!))

    if (baseline === null) {
      // 首次同步（无基线可判定双侧改动）：纯 LWW，较新 updatedAt 胜，平局本地胜。
      // 建议「先备份再首次同步」——该模式下不生成冲突副本（见 ROADMAP v0.6 实现口径）。
      if (localFp === remoteFp) {
        keep(ln!) // 状态一致：原样保留
      } else if (ln!.updatedAt >= rn!.updatedAt) {
        keep(ln!)
        stats.uploaded++
      } else {
        keep(rn!)
        collectRemoteAttachments(rn!.id)
        stats.downloaded++
      }
      continue
    }

    const baseFp = baseNotes[id]
    const localChanged = localFp !== baseFp
    const remoteChanged = remoteFp !== baseFp

    if (!localChanged && !remoteChanged) {
      keep(ln!) // 双侧都没动：原样保留进合并结果（合并输出是全量库）
      continue
    }
    if (localChanged && !remoteChanged) {
      keep(ln!)
      stats.uploaded++
      continue
    }
    if (!localChanged && remoteChanged) {
      keep(rn!)
      collectRemoteAttachments(rn!.id)
      stats.downloaded++
      continue
    }
    if (localFp === remoteFp) {
      keep(ln!) // 双侧都动但已收敛为同一状态
      continue
    }

    // 双侧都变更且不同 → LWW 决出主笔记，落败方保留为冲突副本（无静默数据丢失）
    stats.conflicts++
    if (ln!.updatedAt >= rn!.updatedAt) {
      keep(ln!)
      stats.uploaded++
      const copy = makeConflictCopy(rn!, remote?.deviceName || '其他设备', remoteAttachmentsByNote, now)
      mergedNotes.push(copy.note)
      addedAttachments.push(...copy.attachments)
    } else {
      keep(rn!)
      collectRemoteAttachments(rn!.id)
      stats.downloaded++
      const copy = makeConflictCopy(ln!, device.name, localAttachmentsByNote, now)
      mergedNotes.push(copy.note)
      addedAttachments.push(...copy.attachments)
    }
  }

  const folders = mergeFolders(local.folders, remote?.folders ?? [], baseline?.folders ?? {})

  // 文件夹删除传播后，引用已删除文件夹的笔记回退到未分类（否则出现悬空 folderId）
  const folderIds = new Set(folders.map((folder) => folder.id))
  for (const note of mergedNotes) {
    if (note.folderId !== null && !folderIds.has(note.folderId)) note.folderId = null
  }

  // 本地存量附件保留（被物理删除笔记的除外）；远端落地/冲突副本的新附件追加在后。
  // 同 id 只保留先到的一份（本地与远端共有的历史附件字节相同，bulkPut 亦按 id 幂等）
  const deletedIds = new Set(deletedNoteIds)
  const seenAttachmentIds = new Set<string>()
  const mergedAttachments = [
    ...local.attachments.filter((a) => !deletedIds.has(a.noteId)).map((a) => ({ ...a })),
    ...addedAttachments,
  ].filter((attachment) => {
    if (seenAttachmentIds.has(attachment.id)) return false
    seenAttachmentIds.add(attachment.id)
    return true
  })

  return {
    library: { folders, notes: mergedNotes, attachments: mergedAttachments },
    deletedNoteIds,
    stats,
  }

  function keep(note: Note): void {
    mergedNotes.push({ ...note, tags: [...note.tags] })
  }

  /** 远端胜出/落地时，其附件整批并入合并结果（不删除本地同笔记旧附件，交给 F-406 孤儿清理） */
  function collectRemoteAttachments(noteId: string): void {
    addedAttachments.push(...(remoteAttachmentsByNote.get(noteId) ?? []).map((a) => ({ ...a })))
  }
}

/**
 * 冲突副本：落败方状态的完整快照成为一篇新笔记——
 * 标题追加（冲突@来源设备），内容中的附件引用重映射到复制出的新附件行，避免与主笔记共享附件。
 */
function makeConflictCopy(
  loser: Note,
  originDeviceName: string,
  attachmentsByNote: Map<string, Attachment[]>,
  now: number,
): { note: Note; attachments: Attachment[] } {
  const id = createId()
  const source = attachmentsByNote.get(loser.id) ?? []
  const remap = new Map<string, string>()
  const attachments: Attachment[] = []
  for (const oldId of extractAttachmentIds(loser.content)) {
    const found = source.find((a) => a.id === oldId)
    if (!found) continue
    const newId = createId()
    remap.set(oldId, newId)
    attachments.push({ ...found, id: newId, noteId: id })
  }
  let content = loser.content
  for (const [oldId, newId] of remap) content = content.replaceAll(attachmentRef(oldId), attachmentRef(newId))
  return {
    note: {
      id,
      title: `${displayTitle(loser)}（冲突@${originDeviceName}）`,
      content,
      folderId: loser.folderId,
      tags: [...loser.tags],
      pinned: false,
      trashed: false,
      trashedAt: null,
      createdAt: loser.createdAt,
      updatedAt: now,
    },
    attachments,
  }
}

/**
 * 文件夹合并（按 id 并集）：仅一侧相对基线变化 → 采纳该侧；双侧都变 → 保留本地；
 * 一侧存在另一侧消失 → 删除跟随远端（本地改过则修改优先）。
 */
function mergeFolders(
  localFolders: Folder[],
  remoteFolders: Folder[],
  baseFolders: Record<string, string>,
): Folder[] {
  const localById = new Map(localFolders.map((f) => [f.id, f]))
  const remoteById = new Map(remoteFolders.map((f) => [f.id, f]))
  const merged: Folder[] = []
  for (const id of [...new Set([...localById.keys(), ...remoteById.keys()])]) {
    const lf = localById.get(id)
    const rf = remoteById.get(id)
    const baseFp = baseFolders[id]

    if (lf && !rf) {
      if (baseFp !== undefined && fingerprint(canonicalFolderState(lf)) === baseFp) continue // 远端已删除
      merged.push({ ...lf }) // 本地新建；或本地改过、远端删除（修改优先）
      continue
    }
    if (!lf && rf) {
      if (baseFp !== undefined && fingerprint(canonicalFolderState(rf)) === baseFp) continue // 本地已删除
      merged.push({ ...rf }) // 远端新建（或复活）
      continue
    }
    const localFp = fingerprint(canonicalFolderState(lf!))
    const remoteFp = fingerprint(canonicalFolderState(rf!))
    if (baseFp === undefined) {
      merged.push({ ...lf! }) // 无基线（首次同步）：本地优先
    } else if (localFp === remoteFp || localFp !== baseFp || remoteFp === baseFp) {
      merged.push({ ...lf! }) // 已收敛 / 仅本地改 / 双侧都改 → 本地
    } else {
      merged.push({ ...rf! }) // 仅远端改
    }
  }
  return merged
}

function groupByNote(attachments: Attachment[]): Map<string, Attachment[]> {
  const map = new Map<string, Attachment[]>()
  for (const attachment of attachments) {
    const list = map.get(attachment.noteId)
    if (list) list.push(attachment)
    else map.set(attachment.noteId, [attachment])
  }
  return map
}

/* ============================== 设备默认名 ============================== */

/** 新设备的默认名（可改）：从 UA 粗提平台 */
export function defaultDeviceName(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua)
      ? 'Mac'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : '我的'
  return `${os}设备`
}
