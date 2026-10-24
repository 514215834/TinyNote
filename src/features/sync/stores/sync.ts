import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { createId } from '@/lib/utils/id'
import { t } from '@/lib/i18n'
import { backupPort } from '@/lib/db/repositories/backupPort'
import { settingsRepository } from '@/lib/db/repositories/settingsRepository'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import { SyncDecryptError, decryptSyncPayload, encryptSyncPayload, isEncryptedEnvelope } from '../syncCrypto'
import { createSyncGist, fetchSyncGist, updateSyncGist } from '../gistClient'
import {
  SyncFormatError,
  buildBaseline,
  buildSyncFile,
  defaultDeviceName,
  mergeSync,
  parseSyncFile,
  toRemoteState,
  type SyncBaseline,
  type SyncRemoteState,
  type SyncStats,
} from '../sync'

export { SyncFormatError }

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error'

/** 同步基线在 settings KV 的键名（属于需要跨设备口径一致的数据，随「清空全部数据」一并清除） */
export const SYNC_BASELINE_KEY = 'syncBaseline'

/** 首次同步提示：基线缺失时 UI 展示（随语言切换） */
export function baselineMissingMessage(): string {
  return t('sync.firstSyncWarn')
}

/**
 * 同步编排（F-501/F-502/F-503）：配置（PAT/Gist/设备名/加密）存 localStorage（架构文档 4.3），
 * 基线存 IndexedDB settings KV。syncNow 的流程：
 * 快照本地库 → 拉取并解析远端载荷 → 基线三方合并 → 单事务落库 → 上传合并结果 → 保存新基线。
 * 任一步失败即整体失败：基线只在「落库 + 上传」都成功后写入，失败不会让下一次同步误判变更方向。
 */
export const useSyncStore = defineStore('sync', () => {
  const pat = useLocalStorage('tinynote:sync:pat', '', { flush: 'sync' })
  const gistId = useLocalStorage('tinynote:sync:gist-id', '', { flush: 'sync' })
  const deviceName = useLocalStorage('tinynote:sync:device-name', defaultDeviceName(), { flush: 'sync' })
  const encryptionEnabled = useLocalStorage('tinynote:sync:encrypt', false, { flush: 'sync' })
  const password = useLocalStorage('tinynote:sync:password', '', { flush: 'sync' })
  const autoSyncEnabled = useLocalStorage('tinynote:sync:auto', true, { flush: 'sync' })
  const lastSyncAt = useLocalStorage('tinynote:sync:last-at', 0, { flush: 'sync' })
  // 设备标识（UUID v7）：冲突副本署名与排查用，仅本机意义
  const deviceId = useLocalStorage('tinynote:sync:device-id', createId(), { flush: 'sync' })

  const status = ref<SyncStatus>('idle')
  const errorMessage = ref('')
  const lastStats = ref<SyncStats | null>(null)

  const configured = computed(() => pat.value.trim() !== '')
  const encryptReady = computed(() => !encryptionEnabled.value || password.value !== '')
  const ready = computed(() => configured.value && encryptReady.value)

  /** 完整一轮同步；失败时置 error 状态并返回 null（错误信息在 errorMessage） */
  async function syncNow(): Promise<SyncStats | null> {
    if (!configured.value) {
      errorMessage.value = t('sync.noPat')
      status.value = 'error'
      return null
    }
    if (!encryptReady.value) {
      errorMessage.value = t('sync.noPassword')
      status.value = 'error'
      return null
    }
    if (status.value === 'syncing') return null

    status.value = 'syncing'
    errorMessage.value = ''
    const token = pat.value.trim()
    const device = { id: deviceId.value, name: deviceName.value.trim() || defaultDeviceName() }
    const now = Date.now()

    try {
      const local = await backupPort.snapshot()
      const remote = await fetchRemote(token)
      const baseline = (await settingsRepository.get<SyncBaseline>(SYNC_BASELINE_KEY)) ?? null

      const merged = mergeSync({ local, remote, baseline, device, now })
      await backupPort.applySyncLibrary(merged.library, merged.deletedNoteIds)

      const payload = await buildSyncFile(merged.library, device, now)
      const payloadJson = JSON.stringify(payload)
      const payloadOut = encryptionEnabled.value
        ? await encryptSyncPayload(password.value, payloadJson)
        : payloadJson

      if (gistId.value) {
        await updateSyncGist(token, gistId.value, payloadOut)
      } else {
        gistId.value = await createSyncGist(token, payloadOut)
      }

      // 落库与上传都成功后才更新基线与同步时间
      await settingsRepository.set(SYNC_BASELINE_KEY, buildBaseline(merged.library, now))
      lastSyncAt.value = now
      lastStats.value = merged.stats
      status.value = 'ok'

      await refreshViews(merged.stats.downloaded + merged.stats.conflicts > 0)
      return merged.stats
    } catch (error) {
      status.value = 'error'
      errorMessage.value = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  /** 拉取远端载荷：无 Gist / 文件缺失 → null（空远端）；明文与加密信封统一在此分派 */
  async function fetchRemote(token: string): Promise<SyncRemoteState | null> {
    if (!gistId.value) return null
    const raw = await fetchSyncGist(token, gistId.value)
    if (raw === null) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new SyncFormatError(t('sync.invalidJson'))
    }
    if (isEncryptedEnvelope(parsed)) {
      const plaintext = await decryptSyncPayload(password.value, raw)
      try {
        parsed = JSON.parse(plaintext)
      } catch {
        throw new SyncFormatError(t('sync.invalidDecryptedJson'))
      }
    }
    return toRemoteState(parseSyncFile(parsed))
  }

  /** 同步改变了库内容时刷新视图；外部重写正文需要让挂载中的编辑器重建（避免旧草稿覆盖远端） */
  async function refreshViews(changed: boolean): Promise<void> {
    const notesStore = useNotesStore()
    const foldersStore = useFoldersStore()
    if (changed) {
      await notesStore.noteExternalReload()
      await foldersStore.init()
    } else {
      await notesStore.reload()
      await foldersStore.init()
    }
  }

  /** 启动自动同步（F-501「进入时自动触发」）：未配置/已关闭/正在同步时静默跳过，错误留在状态里 */
  async function autoSyncIfDue(): Promise<void> {
    if (!configured.value || !autoSyncEnabled.value || status.value === 'syncing') return
    await syncNow()
  }

  /** 断开同步：清除本机同步配置与基线（远端 Gist 与笔记数据不动） */
  function disconnect(): void {
    pat.value = ''
    gistId.value = ''
    password.value = ''
    encryptionEnabled.value = false
    lastSyncAt.value = 0
    lastStats.value = null
    status.value = 'idle'
    errorMessage.value = ''
    void settingsRepository.set(SYNC_BASELINE_KEY, null)
  }

  return {
    pat,
    gistId,
    deviceName,
    encryptionEnabled,
    password,
    autoSyncEnabled,
    deviceId,
    lastSyncAt,
    status,
    errorMessage,
    lastStats,
    configured,
    encryptReady,
    ready,
    syncNow,
    autoSyncIfDue,
    disconnect,
  }
})

// SyncDecryptError 再导出：UI 层据此区分「密码错误」与其他失败
export { SyncDecryptError }
