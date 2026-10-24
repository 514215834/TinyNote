<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import NoteListSidebar from '@/features/notes/NoteListSidebar.vue'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import { useSettingsStore } from '@/features/settings/stores/settings'
import BackupBanner from '@/features/backup/BackupBanner.vue'
import UpdateBanner from '@/features/pwa/UpdateBanner.vue'
import { requestPersistentStorage } from '@/features/pwa/storage'
import { displayTitle } from '@/features/notes/notes'
import { useHotkeys, focusSearchInput } from '@/composables/shortcuts'

const router = useRouter()
const notesStore = useNotesStore()
const foldersStore = useFoldersStore()
const settings = useSettingsStore()

onMounted(() => {
  void bootstrap()
})

/** 启动流程：先惰性清理过期回收站（F-204），再加载列表与文件夹；F-405 申请持久化存储 */
async function bootstrap(): Promise<void> {
  void requestPersistentStorage()
  await notesStore.autopurge(Date.now())
  await notesStore.init()
  await foldersStore.init()
  await settings.initBackupReminder()
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
  if (!note || !window.confirm(`删除「${displayTitle(note)}」？`)) return
  void notesStore.softDelete(note.id)
}

// F-206 快捷键：Ctrl+N 新建、Ctrl+K 聚焦搜索、Ctrl+D 删除；Ctrl+E 在编辑器内注册
useHotkeys([
  { combo: 'ctrl+n', handler: () => void createNote() },
  { combo: 'ctrl+k', handler: focusSearchInput },
  { combo: 'ctrl+d', handler: deleteSelected },
])
</script>

<template>
  <!-- 液态玻璃布局：环境光晕打底，顶栏 / 侧栏 / 主区为三块浮动的磨砂玻璃 -->
  <div class="relative flex h-dvh flex-col overflow-hidden text-gray-900 dark:text-neutral-100">
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <span class="orb left-[-6rem] top-[-8rem] h-[30rem] w-[30rem] bg-indigo-300/45 dark:bg-indigo-500/20"></span>
      <span class="orb right-[-8rem] top-1/4 h-[26rem] w-[26rem] bg-sky-300/40 dark:bg-sky-500/15" style="animation-delay: -9s"></span>
      <span class="orb bottom-[-10rem] left-1/3 h-[28rem] w-[28rem] bg-rose-300/35 dark:bg-fuchsia-500/12" style="animation-delay: -17s"></span>
    </div>

    <AppHeader />
    <BackupBanner />
    <div class="flex min-h-0 flex-1 gap-3 p-3">
      <NoteListSidebar />
      <main class="glass min-w-0 flex-1 overflow-hidden rounded-2xl">
        <RouterView />
      </main>
    </div>
    <!-- F-404：检测到新版本 Service Worker 时提示刷新 -->
    <UpdateBanner />
  </div>
</template>
