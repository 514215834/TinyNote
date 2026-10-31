<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import AppHeader from '@/components/AppHeader.vue'
import NoteListSidebar from '@/features/notes/NoteListSidebar.vue'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import { useSettingsStore } from '@/features/settings/stores/settings'
import { useSearchStore } from '@/features/search/stores/search'
import { useCommandRegistry, type Command } from '@/features/commands/registry'
import BackupBanner from '@/features/backup/BackupBanner.vue'
import UpdateBanner from '@/features/pwa/UpdateBanner.vue'
import CommandPalette from '@/features/search/CommandPalette.vue'
import SettingsPanel from '@/features/settings/SettingsPanel.vue'
import ImportDialog from '@/features/import/ImportDialog.vue'
import ClipImportDialog from '@/features/clipImport/ClipImportDialog.vue'
import { useImportStore, isImportableFile } from '@/features/import'
import { useSyncStore } from '@/features/sync/stores/sync'
import { useBackup } from '@/features/backup/useBackup'
import { requestPersistentStorage } from '@/features/pwa/storage'
import { displayTitle } from '@/features/notes/notes'
import { t, locale, setLocale } from '@/lib/i18n'
import { measureStartup } from '@/lib/perf'
import { scheduleIndexBuild } from '@/features/search/searchIndex'
import { scheduleLinksBuild } from '@/features/links/linkIndex'
import { useHotkeys } from '@/composables/shortcuts'

const router = useRouter()
const notesStore = useNotesStore()
const foldersStore = useFoldersStore()
const settings = useSettingsStore()
const searchStore = useSearchStore()
const syncStore = useSyncStore()
const importStore = useImportStore()
const commandRegistry = useCommandRegistry()
const { exportBackupZip } = useBackup()

onMounted(() => {
  measureStartup('mounted')
  void bootstrap()
})

/** 启动流程：先惰性清理过期回收站（F-204），再加载列表与文件夹；F-405 申请持久化存储；
 *  F-501 配置了同步时进入应用自动同步一轮（不阻塞首屏，失败只体现在设置面板状态里）；
 *  F-604 达阈值时空闲补建全文索引（首屏让路） */
async function bootstrap(): Promise<void> {
  void requestPersistentStorage()
  await notesStore.autopurge(Date.now())
  await notesStore.init()
  await foldersStore.init()
  await settings.initBackupReminder()
  registerBuiltinCommands()
  measureStartup('ready')
  scheduleIndexBuild(notesStore.notes.length)
  scheduleLinksBuild() // F-702：链接索引空闲补建（反链/补全/后续图谱的派生数据源）
  void syncStore.autoSyncIfDue()
}

/**
 * 内置命令注册（F-603/F-605）：命令面板的动作来源。扩展点与 ADR-011 一致——
 * 第三方/未来插件复用 commandRegistry.register 挂载动作，无需改动面板。
 */
function registerBuiltinCommands(): void {
  const commands: Command[] = [
    {
      id: 'notes.create',
      title: () => t('commands.newNote'),
      hint: 'Ctrl+N',
      keywords: 'create new note 新建',
      run: () => createNote(),
    },
    {
      id: 'nav.trash',
      title: () => t('commands.openTrash'),
      keywords: 'trash recycle 回收站',
      run: () => router.push({ name: 'trash' }),
    },
    {
      id: 'nav.graph',
      title: () => t('commands.openGraph'),
      keywords: 'graph links network 图谱 链接 网络 关系',
      run: () => router.push({ name: 'graph' }),
    },
    {
      id: 'nav.attachments',
      title: () => t('commands.openAttachments'),
      keywords: 'attachments storage files 附件 管理 存储',
      run: () => router.push({ name: 'attachments' }),
    },
    {
      id: 'theme.toggle',
      title: () => t('commands.toggleTheme'),
      keywords: 'dark light theme 深浅色 主题',
      run: () => settings.toggleTheme(),
    },
    {
      id: 'editor.lineNumbers',
      title: () => t('commands.toggleLineNumbers'),
      keywords: 'line numbers 行号',
      run: () => settings.toggleEditorLineNumbers(),
    },
    {
      id: 'app.settings',
      title: () => t('commands.openSettings'),
      keywords: 'settings preferences 设置 外观',
      run: () => settings.openPanel(),
    },
    {
      id: 'app.language',
      title: () => t('commands.switchLanguage'),
      keywords: 'language i18n 语言 中英 english',
      run: () => setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN'),
    },
    {
      id: 'backup.export',
      title: () => t('commands.exportBackup'),
      keywords: 'backup export 备份 导出',
      run: async () => {
        try {
          await exportBackupZip()
        } catch (error) {
          window.alert(t('header.exportFailed', { msg: error instanceof Error ? error.message : String(error) }))
        }
      },
    },
  ]
  commandRegistry.registerAll(commands)
}

/** F-206：Ctrl+N 新建（在回收站视图下会先回到笔记视图） */
async function createNote(): Promise<void> {
  if (router.currentRoute.value.name !== 'notes') await router.push({ name: 'notes' })
  await notesStore.createNote()
}

/** F-206：Ctrl+D 删除当前选中笔记（带确认），仅在笔记视图下生效 */
function deleteSelected(): void {
  if (router.currentRoute.value.name !== 'notes') return
  const note = notesStore.selectedNote
  if (!note || !window.confirm(t('common.confirmDeleteNote', { title: displayTitle(note) }))) return
  void notesStore.softDelete(note.id)
}

// F-206/F-603 快捷键：Ctrl+N 新建、Ctrl+K / Ctrl+P 全局搜索面板、Ctrl+D 删除；Ctrl+E 在编辑器内注册
useHotkeys([
  { combo: 'ctrl+n', handler: () => void createNote() },
  { combo: 'ctrl+k', handler: () => searchStore.togglePalette() },
  { combo: 'ctrl+p', handler: () => searchStore.togglePalette() },
  { combo: 'ctrl+d', handler: deleteSelected },
])

// F-801：整页拖拽导入。dragover 放行带文件的拖拽（否则浏览器默认打开文件）；
// drop 命中可导入类型（.md/.zip/.enex）时走导入管线，其余（图片在编辑器外等）仅阻断默认行为。
// 编辑器内部的图片拖放由 NoteEditor 自身处理器先行接管（事件先于 window 到达）。
function dragHasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

function onWindowDragOver(event: DragEvent): void {
  if (dragHasFiles(event)) event.preventDefault()
}

function onWindowDrop(event: DragEvent): void {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  const files = [...(event.dataTransfer?.files ?? [])].filter(isImportableFile)
  if (files.length > 0) void importStore.run(files)
}

useEventListener(window, 'dragover', onWindowDragOver)
useEventListener(window, 'drop', onWindowDrop)
</script>

<template>
  <!-- 液态玻璃布局：环境光晕打底，顶栏 / 侧栏 / 主区为三块浮动的磨砂玻璃 -->
  <div class="relative flex h-dvh flex-col overflow-hidden text-gray-900 dark:text-neutral-100">
    <!-- F-521：三色环境光晕（颜色跟随主题预设，设置面板可关闭） -->
    <div
      v-if="settings.ambientEnabled"
      class="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <span class="orb orb-1 left-[-6rem] top-[-8rem] h-[30rem] w-[30rem]"></span>
      <span class="orb orb-2 right-[-8rem] top-1/4 h-[26rem] w-[26rem]" style="animation-delay: -9s"></span>
      <span class="orb orb-3 bottom-[-10rem] left-1/3 h-[28rem] w-[28rem]" style="animation-delay: -17s"></span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <AppHeader />
      <BackupBanner class="rounded-xl border" />
      <div class="flex min-h-0 flex-1 gap-3">
        <NoteListSidebar />
        <main class="glass min-w-0 flex-1 overflow-hidden rounded-2xl">
          <RouterView />
        </main>
      </div>
    </div>
    <!-- F-404：检测到新版本 Service Worker 时提示刷新 -->
    <UpdateBanner />
    <!-- F-524/F-603：Ctrl+K / Ctrl+P 全局搜索与命令面板 -->
    <CommandPalette />
    <!-- F-521/F-522：设置面板（外观与缓存管理） -->
    <SettingsPanel />
    <!-- F-801/F-803/F-804：导入弹窗（统计摘要） -->
    <ImportDialog />
    <!-- F-902/F-903：剪藏包导入弹窗（标题/文件夹/标签修正 + 防重拦截） -->
    <ClipImportDialog />
  </div>
</template>
