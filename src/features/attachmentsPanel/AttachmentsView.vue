<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { formatBytes } from '@/features/pwa/storage'
import { formatDateTime } from '@/lib/utils/time'
import { attachmentRepository } from '@/lib/db/repositories/attachmentRepository'
import {
  collectAttachmentRows,
  freedBytes,
  orphanRows,
  scanAttachmentReferences,
  type AttachmentRow,
} from './lib'

/**
 * 附件管理面板（F-1004）：全部附件列表（归属笔记、大小、类型、引用状态）、
 * 逐个下载与删除、孤儿批量清理。引用状态口径见 ./lib.ts（与 F-406 一致且更保守）。
 */
const router = useRouter()

const rows = ref<AttachmentRow[]>([])
const loading = ref(true)
const working = ref(false)

async function reload(): Promise<void> {
  loading.value = true
  try {
    rows.value = await collectAttachmentRows(await scanAttachmentReferences())
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void reload()
})

const orphans = (): AttachmentRow[] => orphanRows(rows.value)

function download(row: AttachmentRow): void {
  void attachmentRepository.get(row.id).then((attachment) => {
    if (attachment === undefined) return
    const url = URL.createObjectURL(attachment.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = attachment.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  })
}

function remove(row: AttachmentRow): void {
  if (window.confirm(t('attachments.deleteConfirm', { name: row.name }))) {
    void attachmentRepository.deleteByIds([row.id]).then(reload)
  }
}

/** 孤儿批量清理：确认弹窗提示可释放的存储量 */
function cleanupOrphans(): void {
  const targets = orphans()
  if (targets.length === 0 || working.value) return
  if (window.confirm(t('attachments.cleanupConfirm', { n: targets.length, size: formatBytes(freedBytes(targets)) }))) {
    working.value = true
    void attachmentRepository
      .deleteByIds(targets.map((row) => row.id))
      .then(reload)
      .finally(() => {
        working.value = false
      })
  }
}

const stateBadgeClass = (state: AttachmentRow['state']): string =>
  state === 'orphan'
    ? 'bg-red-100 text-red-700 dark:bg-red-700/30 dark:text-red-300'
    : state === 'snapshot'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-700/30 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-700/30 dark:text-emerald-300'

/** mime → 类型字典 key（面板行展示用） */
function kindOf(mime: string): 'pdf' | 'audio' | 'text' | 'image' | 'other' {
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/')) return 'text'
  if (mime.startsWith('image/')) return 'image'
  return 'other'
}
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col">
    <header class="flex shrink-0 items-center gap-3 border-b border-gray-900/8 px-6 py-3 dark:border-white/8">
      <button
        type="button"
        :aria-label="t('attachments.back')"
        :title="t('attachments.back')"
        class="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/60 dark:text-neutral-400 dark:hover:bg-white/8"
        @click="router.push({ name: 'notes' })"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="text-base font-semibold">{{ t('attachments.title') }}</h1>
      <span class="text-xs text-gray-400">{{ t('attachments.count', { n: rows.length }) }}</span>
      <button
        type="button"
        class="ml-auto rounded-full border border-gray-900/10 bg-white/60 px-3.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
        :disabled="orphans().length === 0 || working"
        @click="cleanupOrphans"
      >
        {{ t('attachments.cleanupButton', { n: orphans().length }) }}
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <p v-if="loading" class="text-xs text-gray-400">{{ t('attachments.loading') }}</p>
      <p v-else-if="rows.length === 0" class="text-xs text-gray-400">{{ t('attachments.empty') }}</p>

      <ul v-else class="space-y-1.5">
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex items-center gap-3 rounded-xl bg-white/50 px-3 py-2 dark:bg-white/5"
        >
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
            :class="stateBadgeClass(row.state)"
          >
            {{ t(`attachments.state.${row.state}`) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-gray-700 dark:text-neutral-200">{{ row.name }}</span>
            <span class="block truncate text-[11px] text-gray-400">
              {{ row.noteTitle ?? t('attachments.noteMissing') }} · {{ t(`attachments.kind.${kindOf(row.mime)}`) }} ·
              {{ formatBytes(row.size) }} · {{ formatDateTime(row.createdAt) }}
            </span>
          </span>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:bg-white/80 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100"
            @click="download(row)"
          >
            {{ t('common.download') }}
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-700/20 dark:hover:text-red-300"
            @click="remove(row)"
          >
            {{ t('common.delete') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
