<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import NoteListSidebar from '@/features/notes/NoteListSidebar.vue'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import { displayTitle } from '@/features/notes/notes'
import { useHotkeys, focusSearchInput } from '@/composables/shortcuts'

const router = useRouter()
const notesStore = useNotesStore()
const foldersStore = useFoldersStore()

onMounted(() => {
  void bootstrap()
})

/** 启动流程：先惰性清理过期回收站（F-204），再加载列表与文件夹 */
async function bootstrap(): Promise<void> {
  await notesStore.autopurge(Date.now())
  await notesStore.init()
  await foldersStore.init()
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
  <div class="flex h-dvh flex-col bg-gray-50 text-gray-900 dark:bg-neutral-900 dark:text-neutral-100">
    <AppHeader />
    <div class="flex min-h-0 flex-1">
      <NoteListSidebar />
      <main class="min-w-0 flex-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>
