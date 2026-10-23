<script setup lang="ts">
import { useNotesStore } from './stores/notes'
import NoteEditor from './NoteEditor.vue'

const notesStore = useNotesStore()
</script>

<template>
  <!-- :key 使切换笔记时重建编辑器：旧实例卸载时 flush 待写草稿，新实例从新笔记初始化 -->
  <NoteEditor
    v-if="notesStore.selectedNote"
    :key="notesStore.selectedId ?? ''"
    :note="notesStore.selectedNote"
  />
  <div
    v-else
    class="flex h-full flex-col items-center justify-center gap-1 text-sm text-gray-400 dark:text-neutral-500"
  >
    <template v-if="notesStore.activeFolderId !== null">
      <span>这个文件夹还没有笔记</span>
      <span>点击左侧「+ 新建笔记」，将创建到当前文件夹</span>
    </template>
    <template v-else-if="notesStore.notes.length > 0">
      <span>选择左侧一篇笔记</span>
      <span>或点击「+ 新建笔记」</span>
    </template>
    <template v-else>
      <span>还没有笔记</span>
      <span>点击左侧「+ 新建笔记」开始记录</span>
    </template>
  </div>
</template>
