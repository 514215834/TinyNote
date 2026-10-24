<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import { useSettingsStore } from '@/features/settings/stores/settings'
import { useBackup } from '@/features/backup/useBackup'
import { BackupFormatError, BackupVersionError } from '@/features/backup/backup'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'

const router = useRouter()
const settings = useSettingsStore()
const notesStore = useNotesStore()
const foldersStore = useFoldersStore()
const { busy, exportBackupZip, exportNotesZip, importBackupFile } = useBackup()

/**
 * 数据菜单（F-304/F-305）：全量备份导出 / 导入、全部笔记导出 .md。
 * 导入是覆盖语义，走确认弹窗；菜单点击外部任意位置收起（与侧边栏移动菜单同一交互模式）。
 * 存储用量/持久化/缓存管理在设置面板（F-521/F-522）。
 */
const menuOpen = ref(false)
const menuButton = useTemplateRef<HTMLButtonElement>('menuButton')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

useEventListener(document, 'click', (event) => {
  if (!menuOpen.value) return
  const target = event.target
  if (target instanceof Node && (menuButton.value?.contains(target) ?? false)) return
  menuOpen.value = false
})

async function exportBackup(): Promise<void> {
  menuOpen.value = false
  try {
    await exportBackupZip()
  } catch (error) {
    window.alert(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function exportNotes(): Promise<void> {
  menuOpen.value = false
  try {
    await exportNotesZip()
  } catch (error) {
    window.alert(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function pickImportFile(): void {
  menuOpen.value = false
  fileInput.value?.click()
}

async function onImportFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许连续选择同一文件重新导入
  if (!file) return
  const confirmed = window.confirm(
    '导入备份将覆盖当前全部笔记、文件夹与附件，且不可撤销。\n建议先「导出全量备份」留存当前数据。确定继续？',
  )
  if (!confirmed) return
  try {
    const result = await importBackupFile(file)
    // 覆盖式恢复后，所有正在展示的列表与选中态一并刷新
    await notesStore.reload()
    await foldersStore.init()
    window.alert(`恢复完成：${result.notes} 篇笔记、${result.folders} 个文件夹、${result.attachments} 个附件。`)
    if (router.currentRoute.value.name === 'trash') await router.push({ name: 'notes' })
  } catch (error) {
    window.alert(importErrorMessage(error))
  }
}

function importErrorMessage(error: unknown): string {
  if (error instanceof BackupFormatError) return '导入失败：不是有效的 TinyNote 备份文件（需要本应用导出的 zip 或 JSON）'
  if (error instanceof BackupVersionError) return `导入失败：${error.message}`
  if (error instanceof Error) return `导入失败：${error.message}`
  return '导入失败'
}
</script>

<template>
  <header
    class="relative z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/50 bg-white/45 px-5 backdrop-blur-2xl backdrop-saturate-150 dark:border-white/8 dark:bg-neutral-900/45"
  >
    <span class="flex items-center gap-2 text-sm font-bold tracking-wide">
      <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-[13px] text-white shadow-sm">T</span>
      TinyNote
    </span>
    <div class="flex items-center gap-1">
      <!-- 数据菜单（F-304/F-305） -->
      <div class="relative">
        <button
          ref="menuButton"
          type="button"
          class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/70 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100"
          :class="{ 'bg-white/70 text-gray-900 dark:bg-white/10 dark:text-neutral-100': menuOpen }"
          title="数据：备份导出 / 导入"
          aria-label="数据菜单"
          aria-haspopup="menu"
          @click="toggleMenu"
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
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14a9 3 0 0 0 18 0V5" />
            <path d="M3 12a9 3 0 0 0 18 0" />
          </svg>
        </button>
        <div
          v-if="menuOpen"
          class="glass-strong absolute right-0 top-11 z-20 w-56 rounded-xl py-1"
          role="menu"
          aria-label="数据操作"
        >
          <button
            type="button"
            class="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gray-900/5 dark:hover:bg-white/8"
            role="menuitem"
            :disabled="busy"
            @click="exportBackup"
          >
            <span class="block font-medium text-gray-700 dark:text-neutral-200">导出全量备份</span>
            <span class="block text-[11px] text-gray-400">.zip（含笔记 / 附件，可还原）</span>
          </button>
          <button
            type="button"
            class="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gray-900/5 dark:hover:bg-white/8"
            role="menuitem"
            :disabled="busy"
            @click="pickImportFile"
          >
            <span class="block font-medium text-gray-700 dark:text-neutral-200">导入备份</span>
            <span class="block text-[11px] text-gray-400">覆盖恢复，导入前会确认</span>
          </button>
          <button
            type="button"
            class="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gray-900/5 dark:hover:bg-white/8"
            role="menuitem"
            :disabled="busy"
            @click="exportNotes"
          >
            <span class="block font-medium text-gray-700 dark:text-neutral-200">导出全部笔记</span>
            <span class="block text-[11px] text-gray-400">.md zip（不含附件，通用可读）</span>
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept=".zip,.json,application/zip,application/json"
          class="hidden"
          aria-label="选择备份文件"
          @change="onImportFileChange"
        />
      </div>

      <!-- F-521：设置面板入口（外观定制） -->
      <button
        type="button"
        class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/70 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100"
        :class="{ 'bg-white/70 text-gray-900 dark:bg-white/10 dark:text-neutral-100': settings.panelOpen }"
        title="设置：外观与缓存"
        aria-label="设置"
        @click="settings.openPanel()"
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
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      <button
        type="button"
        class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/70 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100"
        :title="settings.isDark ? '切换到浅色模式' : '切换到深色模式'"
        :aria-label="settings.isDark ? '切换到浅色模式' : '切换到深色模式'"
        @click="settings.toggleTheme()"
      >
        <svg
          v-if="settings.isDark"
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
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <svg
          v-else
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
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    </div>
  </header>
</template>
