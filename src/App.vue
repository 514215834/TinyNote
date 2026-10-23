<script setup lang="ts">
import { onMounted } from 'vue'
import AppHeader from '@/components/AppHeader.vue'
import NoteListSidebar from '@/features/notes/NoteListSidebar.vue'
import { useNotesStore } from '@/features/notes/stores/notes'

const notesStore = useNotesStore()

onMounted(() => {
  void notesStore.init()
})
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
