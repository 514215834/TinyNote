<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/lib/i18n'
import { useImportStore } from '@/features/import/stores/import'
import { useFoldersStore } from '@/features/folders/stores/folders'

/**
 * 剪藏导入弹窗（F-902/F-903）：导入前修正标题、文件夹归属、标签（默认「剪藏」）；
 * 同一剪藏产物再次导入时按内容指纹拦截（提示后允许「强制重新导入」）。
 * 导入完成后就地展示统计摘要（复用常规导入的摘要口径），关闭后自动排队下一个剪藏包。
 */
const importStore = useImportStore()
const foldersStore = useFoldersStore()

const title = ref('')
const folderId = ref<string>('')
const tagsText = ref('')

// 每个剪藏包展示前重置表单默认值（标题取扩展提取值，标签默认「剪藏」）
watch(
  () => importStore.clipPackage,
  (pkg) => {
    if (pkg === null) return
    title.value = pkg.manifest.title
    folderId.value = ''
    tagsText.value = t('clip.defaultTag')
    void foldersStore.init()
  },
  { immediate: true },
)

const totalIssues = computed(
  () => (importStore.clipSummary?.skipped.length ?? 0) + (importStore.clipSummary?.failed.length ?? 0),
)

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
}

function confirm(force: boolean): void {
  if (force && !importStore.clipDuplicate) return
  void importStore.confirmClip({
    title: title.value,
    folderId: folderId.value === '' ? null : folderId.value,
    tags: parseTags(tagsText.value),
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="importStore.clipPackage !== null"
      class="fixed inset-0 z-40 overflow-y-auto bg-gray-950/25 backdrop-blur-sm dark:bg-black/40"
      @click.self="importStore.closeClip()"
    >
      <div
        class="glass-strong mx-auto mt-[18vh] w-[min(26rem,92vw)] overflow-hidden rounded-2xl p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        :aria-label="t('clip.title')"
      >
        <p class="text-sm font-medium">{{ t('clip.title') }}</p>
        <p class="mt-1 truncate text-[11px] text-gray-400">{{ importStore.clipPackage.manifest.url }}</p>

        <!-- F-903：重复剪藏拦截（内容指纹一致），提示后允许强制重入 -->
        <p
          v-if="importStore.clipDuplicate && importStore.clipSummary === null"
          class="mt-3 rounded-xl bg-amber-100/80 px-3 py-2 text-[11px] leading-4 text-amber-700 dark:bg-amber-700/25 dark:text-amber-300"
        >
          {{ t('clip.duplicate') }}
        </p>

        <template v-if="importStore.clipSummary === null">
          <div class="mt-3 space-y-2.5">
            <label class="block">
              <span class="text-[11px] text-gray-500 dark:text-neutral-400">{{ t('clip.fieldTitle') }}</span>
              <input
                v-model="title"
                type="text"
                class="mt-1 w-full rounded-xl border-0 bg-white/70 px-3 py-2 text-xs shadow-sm outline-none ring-1 ring-gray-900/10 transition focus:ring-2 focus:ring-[--color-accent] dark:bg-white/10 dark:ring-white/10"
                :placeholder="t('common.untitled')"
              />
            </label>
            <label class="block">
              <span class="text-[11px] text-gray-500 dark:text-neutral-400">{{ t('clip.fieldFolder') }}</span>
              <select
                v-model="folderId"
                class="mt-1 w-full rounded-xl border-0 bg-white/70 px-3 py-2 text-xs shadow-sm outline-none ring-1 ring-gray-900/10 transition focus:ring-2 focus:ring-[--color-accent] dark:bg-white/10 dark:ring-white/10"
              >
                <option value="">{{ t('clip.folderNone') }}</option>
                <option v-for="folder in foldersStore.folders" :key="folder.id" :value="folder.id">
                  {{ folder.name }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] text-gray-500 dark:text-neutral-400">{{ t('clip.fieldTags') }}</span>
              <input
                v-model="tagsText"
                type="text"
                class="mt-1 w-full rounded-xl border-0 bg-white/70 px-3 py-2 text-xs shadow-sm outline-none ring-1 ring-gray-900/10 transition focus:ring-2 focus:ring-[--color-accent] dark:bg-white/10 dark:ring-white/10"
              />
            </label>
          </div>
        </template>

        <!-- 导入完成：统计摘要（与常规导入同一口径） -->
        <template v-else>
          <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-700/30 dark:text-emerald-300">
              {{ t('import.summaryNotes', { n: importStore.clipSummary.notesCreated }) }}
            </span>
            <span
              v-if="importStore.clipSummary.attachmentsCreated > 0"
              class="rounded-full bg-gray-900/5 px-2 py-0.5 text-gray-600 dark:bg-white/10 dark:text-neutral-300"
            >
              {{ t('import.summaryAttachments', { n: importStore.clipSummary.attachmentsCreated }) }}
            </span>
            <span
              v-if="importStore.clipSummary.skipped.length > 0"
              class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-700/30 dark:text-amber-300"
            >
              {{ t('import.summarySkipped', { n: importStore.clipSummary.skipped.length }) }}
            </span>
            <span
              v-if="importStore.clipSummary.failed.length > 0"
              class="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-700/30 dark:text-red-300"
            >
              {{ t('import.summaryFailed', { n: importStore.clipSummary.failed.length }) }}
            </span>
          </div>
          <ul v-if="totalIssues > 0" class="mt-3 max-h-32 space-y-1 overflow-y-auto text-[11px] leading-4">
            <li
              v-for="(issue, index) in [...importStore.clipSummary.failed, ...importStore.clipSummary.skipped]"
              :key="index"
              class="rounded-lg px-2 py-1 hover:bg-white/60 dark:hover:bg-white/5"
            >
              <span class="block truncate text-gray-600 dark:text-neutral-300">{{ issue.source }}</span>
              <span class="block truncate text-gray-400">{{ issue.reason }}</span>
            </li>
          </ul>
        </template>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-full bg-white/70 px-4 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-white dark:bg-white/10 dark:text-neutral-100 dark:hover:bg-white/15"
            :disabled="importStore.clipWorking"
            @click="importStore.closeClip()"
          >
            {{ importStore.clipSummary === null ? t('clip.cancel') : t('import.close') }}
          </button>
          <button
            v-if="importStore.clipSummary === null"
            type="button"
            class="rounded-full bg-[--color-accent] px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            :disabled="importStore.clipWorking"
            @click="confirm(importStore.clipDuplicate)"
          >
            {{ importStore.clipWorking ? t('clip.working') : importStore.clipDuplicate ? t('clip.confirmForce') : t('clip.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
