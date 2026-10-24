import { describe, expect, it } from 'vitest'
import type { Attachment, Folder, Note } from '@/types'
import {
  CURRENT_SYNC_VERSION,
  SYNC_FORMAT,
  SyncFormatError,
  SyncVersionError,
  buildBaseline,
  buildSyncFile,
  canonicalFolderState,
  canonicalNoteState,
  defaultDeviceName,
  fingerprint,
  mergeSync,
  parseSyncFile,
  syncAttachmentsToEntities,
  toRemoteState,
  type SyncBaseline,
  type SyncLibrary,
  type SyncRemoteState,
} from '@/features/sync/sync'

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

function makeFolder(id: string, overrides: Partial<Folder> = {}): Folder {
  return { id, name: `文件夹-${id}`, order: 0, createdAt: 100, ...overrides }
}

function makeAttachment(id: string, noteId: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    id,
    noteId,
    name: `${id}.png`,
    mime: 'image/png',
    size: 4,
    blob: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }),
    createdAt: 100,
    ...overrides,
  }
}

function library(overrides: Partial<SyncLibrary> = {}): SyncLibrary {
  return { folders: [], notes: [], attachments: [], ...overrides }
}

function remoteState(overrides: Partial<SyncRemoteState> = {}): SyncRemoteState {
  return {
    deviceId: 'device-b',
    deviceName: '设备B',
    folders: [],
    notes: [],
    attachments: [],
    ...overrides,
  }
}

const DEVICE = { id: 'device-a', name: '设备A' }
const NOW = 5_000

/** 以某份库的状态构建基线（模拟「这份库上次同步成功」） */
function baselineOf(lib: SyncLibrary, savedAt = 1_000): SyncBaseline {
  return buildBaseline(lib, savedAt)
}

describe('parseSyncFile（F-501 载荷校验）', () => {
  const valid: Record<string, unknown> = {
    format: SYNC_FORMAT,
    schemaVersion: CURRENT_SYNC_VERSION,
    exportedAt: 123,
    deviceId: 'd1',
    deviceName: 'D1',
    folders: [],
    notes: [makeNote('n1')],
    attachments: [],
  }

  it('合法载荷原样通过', () => {
    const file = parseSyncFile(valid)
    expect(file.notes).toHaveLength(1)
    expect(file.deviceName).toBe('D1')
  })

  it('format 不匹配 / 结构缺失 → SyncFormatError', () => {
    expect(() => parseSyncFile({ ...valid, format: 'other' })).toThrow(SyncFormatError)
    expect(() => parseSyncFile(null)).toThrow(SyncFormatError)
    expect(() => parseSyncFile({ ...valid, notes: undefined })).toThrow(SyncFormatError)
    expect(() => parseSyncFile({ ...valid, exportedAt: 'x' })).toThrow(SyncFormatError)
  })

  it('未来版本 → SyncVersionError；旧版本号放行（向前兼容迁移入口）', () => {
    expect(() => parseSyncFile({ ...valid, schemaVersion: 99 })).toThrow(SyncVersionError)
    expect(parseSyncFile({ ...valid, schemaVersion: 1 }).schemaVersion).toBe(1)
  })

  it('宽容归一化：deviceId/deviceName/attachments 缺失不致命', () => {
    const file = parseSyncFile({
      format: SYNC_FORMAT,
      schemaVersion: 1,
      exportedAt: 1,
      folders: [],
      notes: [],
    })
    expect(file.deviceId).toBe('')
    expect(file.attachments).toEqual([])
  })
})

describe('syncAttachmentsToEntities / toRemoteState', () => {
  it('base64 数据物化为 Blob，size 以实际字节为准', () => {
    const [entity] = syncAttachmentsToEntities([
      { id: 'a1', noteId: 'n1', name: 'pic.png', mime: 'image/png', size: 1, createdAt: 5, data: bytesBase4() },
    ])
    expect(entity.blob.type).toBe('image/png')
    expect(entity.size).toBe(4)
  })

  it('toRemoteState 物化附件且保留设备信息', () => {
    const state = toRemoteState(
      parseSyncFile({
        format: SYNC_FORMAT,
        schemaVersion: 1,
        exportedAt: 1,
        deviceId: 'db',
        deviceName: 'B',
        folders: [],
        notes: [],
        attachments: [
          { id: 'a1', noteId: 'n1', name: 'p', mime: 'text/plain', size: 2, createdAt: 1, data: 'aGk=' },
        ],
      }),
    )
    expect(state.deviceName).toBe('B')
    expect(state.attachments[0].blob).toBeInstanceOf(Blob)
  })

  function bytesBase4(): string {
    // Uint8Array [1,2,3,4] 的 base64
    return 'AQIDBA=='
  }
})

describe('状态指纹（F-502 变更判定）', () => {
  it('同状态同指纹；标签顺序无关；updatedAt 不参与', () => {
    expect(fingerprint(canonicalNoteState(makeNote('n1')))).toBe(
      fingerprint(canonicalNoteState(makeNote('n1'))),
    )
    expect(fingerprint(canonicalNoteState(makeNote('n1', { tags: ['b', 'a'] })))).toBe(
      fingerprint(canonicalNoteState(makeNote('n1', { tags: ['a', 'b'] }))),
    )
    expect(fingerprint(canonicalNoteState(makeNote('n1', { updatedAt: 999 })))).toBe(
      fingerprint(canonicalNoteState(makeNote('n1'))),
    )
  })

  it('内容/软删状态变化可检出；文件夹 rename 可检出', () => {
    const base = fingerprint(canonicalNoteState(makeNote('n1')))
    expect(fingerprint(canonicalNoteState(makeNote('n1', { content: '改' })))).not.toBe(base)
    expect(fingerprint(canonicalNoteState(makeNote('n1', { trashed: true, trashedAt: 5 })))).not.toBe(base)
    expect(fingerprint(canonicalFolderState(makeFolder('f1')))).toBe(
      fingerprint(canonicalFolderState(makeFolder('f1'))),
    )
    expect(fingerprint(canonicalFolderState(makeFolder('f1', { name: '改名' })))).not.toBe(
      fingerprint(canonicalFolderState(makeFolder('f1'))),
    )
  })

  it('指纹为 16 位 hex', () => {
    expect(fingerprint('anything')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('mergeSync：无基线（首次同步，纯 LWW）', () => {
  it('本地独有 → 上行；远端独有 → 落地并带附件', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('local1')] }),
      remote: remoteState({ notes: [makeNote('remote1', { updatedAt: 200 })] }),
      baseline: null,
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.notes.map((n) => n.id).sort()).toEqual(['local1', 'remote1'])
    expect(result.stats).toMatchObject({ uploaded: 1, downloaded: 1, conflicts: 0 })
  })

  it('双方都有且不同：较新一方胜出，不生成冲突副本', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('n1', { content: '本地新', updatedAt: 300 })] }),
      remote: remoteState({ notes: [makeNote('n1', { content: '远端旧', updatedAt: 200 })] }),
      baseline: null,
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.notes).toHaveLength(1)
    expect(result.library.notes[0].content).toBe('本地新')
    expect(result.stats.conflicts).toBe(0)

    const flipped = mergeSync({
      local: library({ notes: [makeNote('n1', { content: '本地旧', updatedAt: 100 })] }),
      remote: remoteState({ notes: [makeNote('n1', { content: '远端新', updatedAt: 400 })] }),
      baseline: null,
      device: DEVICE,
      now: NOW,
    })
    expect(flipped.library.notes[0].content).toBe('远端新')
    expect(flipped.stats.downloaded).toBe(1)
  })

  it('双方状态一致 → 原样保留', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('n1')] }),
      remote: remoteState({ notes: [makeNote('n1')] }),
      baseline: null,
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.notes).toHaveLength(1)
    expect(result.stats).toMatchObject({ uploaded: 0, downloaded: 0 })
  })
})

describe('mergeSync：有基线（三方合并）', () => {
  const baseLib = library({ notes: [makeNote('n1')], attachments: [makeAttachment('a1', 'n1')] })

  it('双侧都没变 → 零动作', () => {
    const result = mergeSync({
      local: baseLib,
      remote: remoteState({ notes: [makeNote('n1')] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.stats).toMatchObject({ uploaded: 0, downloaded: 0, conflicts: 0, deletedByRemote: 0 })
    expect(result.deletedNoteIds).toEqual([])
  })

  it('只有本地改 → 保留本地上行；只有远端改 → 落地远端（含附件）', () => {
    const localOnly = mergeSync({
      local: library({ notes: [makeNote('n1', { content: '本地改', updatedAt: 200 })] }),
      remote: remoteState({ notes: [makeNote('n1')] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(localOnly.library.notes[0].content).toBe('本地改')
    expect(localOnly.stats.uploaded).toBe(1)

    const remoteOnly = mergeSync({
      local: baseLib,
      remote: remoteState({
        notes: [makeNote('n1', { content: '远端改', updatedAt: 200 })],
        attachments: [makeAttachment('a1', 'n1'), makeAttachment('a2', 'n1')],
      }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(remoteOnly.library.notes[0].content).toBe('远端改')
    expect(remoteOnly.stats.downloaded).toBe(1)
    expect(remoteOnly.library.attachments.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })

  it('双侧都改 → LWW 本地胜：远端落败方成为冲突副本（署名远端设备）', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('n1', { content: '本地改', updatedAt: 300 })] }),
      remote: remoteState({ notes: [makeNote('n1', { content: '远端改', updatedAt: 200 })] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.stats.conflicts).toBe(1)
    expect(result.library.notes).toHaveLength(2)
    const winner = result.library.notes.find((n) => n.id === 'n1')!
    const copy = result.library.notes.find((n) => n.id !== 'n1')!
    expect(winner.content).toBe('本地改')
    expect(copy.title).toBe('标题-n1（冲突@设备B）')
    expect(copy.content).toBe('远端改')
    expect(copy.updatedAt).toBe(NOW)
  })

  it('双侧都改 → LWW 远端胜：本地落败方成为冲突副本，附件引用重映射到新附件行', () => {
    const baseLib = library({ notes: [makeNote('n1')], attachments: [makeAttachment('a1', 'n1')] })
    const localLib = library({
      notes: [makeNote('n1', { content: '看图 tinynote-attachment://a1', updatedAt: 100 })],
      attachments: [makeAttachment('a1', 'n1')],
    })
    const result = mergeSync({
      local: localLib,
      remote: remoteState({ notes: [makeNote('n1', { content: '远端改', updatedAt: 400 })] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.stats.conflicts).toBe(1)
    const winner = result.library.notes.find((n) => n.id === 'n1')!
    const copy = result.library.notes.find((n) => n.id !== 'n1')!
    expect(winner.content).toBe('远端改')
    expect(copy.title).toBe('标题-n1（冲突@设备A）')
    // 引用重映射：副本不再指向旧附件 a1，且新附件行属于副本笔记、字节相同
    expect(copy.content).not.toContain('tinynote-attachment://a1')
    expect(copy.content).toMatch(/tinynote-attachment:\/\/[\w-]+/)
    const copyRef = copy.content.match(/tinynote-attachment:\/\/([\w-]+)/)![1]
    const copiedAttachment = result.library.attachments.find((a) => a.id === copyRef)!
    expect(copiedAttachment.noteId).toBe(copy.id)
    expect(copiedAttachment.id).not.toBe('a1')
    // 主笔记的原附件仍在（本地存量保留）
    expect(result.library.attachments.some((a) => a.id === 'a1')).toBe(true)
  })

  it('双侧都改但收敛为同一状态 → 不生成副本', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('n1', { content: '一致', updatedAt: 200 })] }),
      remote: remoteState({ notes: [makeNote('n1', { content: '一致', updatedAt: 999 })] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.notes).toHaveLength(1)
    expect(result.stats.conflicts).toBe(0)
  })

  it('远端删除 + 本地未动 → 物理删除传播，其附件不进合并结果', () => {
    const result = mergeSync({
      local: baseLib,
      remote: remoteState({ notes: [] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.deletedNoteIds).toEqual(['n1'])
    expect(result.stats.deletedByRemote).toBe(1)
    expect(result.library.notes).toHaveLength(0)
    expect(result.library.attachments).toHaveLength(0)
  })

  it('远端删除 + 本地已改 → 修改优先于删除，本地保留并上行', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('n1', { content: '本地改', updatedAt: 500 })] }),
      remote: remoteState({ notes: [] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.deletedNoteIds).toEqual([])
    expect(result.library.notes.map((n) => n.id)).toEqual(['n1'])
    expect(result.stats.uploaded).toBe(1)
  })

  it('本地物理删除 + 远端未动 → 保持删除；远端又改过 → 修改优先于删除（复活）', () => {
    const staysDeleted = mergeSync({
      local: library({ notes: [] }),
      remote: remoteState({ notes: [makeNote('n1')] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(staysDeleted.library.notes).toHaveLength(0)
    expect(staysDeleted.stats.downloaded).toBe(0)

    const resurrected = mergeSync({
      local: library({ notes: [] }),
      remote: remoteState({ notes: [makeNote('n1', { content: '远端改', updatedAt: 800 })] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(resurrected.library.notes.map((n) => n.id)).toEqual(['n1'])
    expect(resurrected.stats.downloaded).toBe(1)
  })

  it('回收站状态参与合并：远端笔记入站 → 本地跟随进入回收站', () => {
    const result = mergeSync({
      local: baseLib,
      remote: remoteState({
        notes: [makeNote('n1', { trashed: true, trashedAt: 400, updatedAt: 100 })],
      }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.notes[0].trashed).toBe(true)
    expect(result.library.notes[0].trashedAt).toBe(400)
    expect(result.stats.downloaded).toBe(1)
  })

  it('本地置入回收站（状态变更）→ 上行；updatedAt 未变也视作变更', () => {
    const result = mergeSync({
      local: library({ notes: [makeNote('n1', { trashed: true, trashedAt: 900 })] }),
      remote: remoteState({ notes: [makeNote('n1')] }),
      baseline: baselineOf(baseLib),
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.notes[0].trashed).toBe(true)
    expect(result.stats.uploaded).toBe(1)
  })
})

describe('mergeSync：文件夹合并', () => {
  it('远端新建/本地新建都保留；远端改名（仅远端改）被采纳；双侧改名保留本地', () => {
    const f1 = makeFolder('f1')
    const base = baselineOf(library({ folders: [f1] }))

    const remoteNew = mergeSync({
      local: library({ folders: [f1] }),
      remote: remoteState({ folders: [f1, makeFolder('f2')] }),
      baseline: base,
      device: DEVICE,
      now: NOW,
    })
    expect(remoteNew.library.folders.map((f) => f.id)).toEqual(['f1', 'f2'])

    const remoteRename = mergeSync({
      local: library({ folders: [f1] }),
      remote: remoteState({ folders: [makeFolder('f1', { name: '远端名' })] }),
      baseline: base,
      device: DEVICE,
      now: NOW,
    })
    expect(remoteRename.library.folders[0].name).toBe('远端名')

    const bothRename = mergeSync({
      local: library({ folders: [makeFolder('f1', { name: '本地名' })] }),
      remote: remoteState({ folders: [makeFolder('f1', { name: '远端名' })] }),
      baseline: base,
      device: DEVICE,
      now: NOW,
    })
    expect(bothRename.library.folders[0].name).toBe('本地名')
  })

  it('远端删除文件夹 → 本地跟随删除，引用它的笔记回退未分类', () => {
    const base = baselineOf(library({ folders: [makeFolder('f1')], notes: [makeNote('n1', { folderId: 'f1' })] }))
    const result = mergeSync({
      local: library({ folders: [makeFolder('f1')], notes: [makeNote('n1', { folderId: 'f1' })] }),
      remote: remoteState({ folders: [], notes: [makeNote('n1', { folderId: 'f1' })] }),
      baseline: base,
      device: DEVICE,
      now: NOW,
    })
    expect(result.library.folders).toHaveLength(0)
    expect(result.library.notes[0].folderId).toBeNull()
  })
})

describe('buildSyncFile / buildBaseline（载荷与基线构建）', () => {
  it('载荷内联 base64 附件，远端物化后字节一致', async () => {
    const lib = library({
      notes: [makeNote('n1')],
      attachments: [makeAttachment('a1', 'n1')],
    })
    const file = await buildSyncFile(lib, DEVICE, 1234)
    expect(file.format).toBe(SYNC_FORMAT)
    expect(file.deviceName).toBe('设备A')
    expect(file.exportedAt).toBe(1234)
    const [entity] = syncAttachmentsToEntities(file.attachments)
    expect(new Uint8Array(await entity.blob.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4]))
  })

  it('基线覆盖全部笔记与文件夹，savedAt 记录', () => {
    const lib = library({ folders: [makeFolder('f1')], notes: [makeNote('n1'), makeNote('n2')] })
    const baseline = buildBaseline(lib, 777)
    expect(baseline.savedAt).toBe(777)
    expect(Object.keys(baseline.notes).sort()).toEqual(['n1', 'n2'])
    expect(Object.keys(baseline.folders)).toEqual(['f1'])
    // 基线与库自洽：未改动的库对基线 merge 应零动作
    const result = mergeSync({
      local: lib,
      remote: remoteState({ notes: lib.notes, folders: lib.folders }),
      baseline,
      device: DEVICE,
      now: NOW,
    })
    expect(result.stats).toMatchObject({ uploaded: 0, downloaded: 0, conflicts: 0 })
  })
})

describe('defaultDeviceName', () => {
  it('按 UA 平台给出默认名', () => {
    expect(defaultDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows设备')
    expect(defaultDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac设备')
    expect(defaultDeviceName('Mozilla/5.0 (Android 14; Mobile)')).toBe('Android设备')
    expect(defaultDeviceName('')).toBe('我的设备')
  })
})
