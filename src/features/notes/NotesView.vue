<script setup lang="ts">
import { t } from '@/lib/i18n'
import { useNotesStore } from './stores/notes'
import NoteEditor from './NoteEditor.vue'

const notesStore = useNotesStore()
</script>

<template>
  <!-- :key 使切换笔记时重建编辑器：旧实例卸载时 flush 待写草稿，新实例从新笔记初始化。
       contentEpoch 参与取值（F-501）：同步合并重写库内容后强制重建，重读正文避免旧草稿覆盖远端写入 -->
  <NoteEditor
    v-if="notesStore.selectedNote"
    :key="`${notesStore.selectedId ?? ''}:${notesStore.contentEpoch}`"
    :note="notesStore.selectedNote"
  />
  <div
    v-else
    class="flex h-full flex-col items-center justify-center gap-1 text-sm text-gray-400 dark:text-neutral-500"
  >
    <div class="rounded-2xl border border-gray-900/8 bg-white/45 px-10 py-8 text-center shadow-sm backdrop-blur-sm dark:border-white/8 dark:bg-white/[0.04]">
      <template v-if="notesStore.activeFolderId !== null">
        <span class="block">{{ t('notesview.emptyFolder') }}</span>
        <span class="mt-1 block text-xs">{{ t('notesview.emptyFolderHint') }}</span>
      </template>
      <template v-else-if="notesStore.notes.length > 0">
        <span class="block">{{ t('notesview.emptyPick') }}</span>
        <span class="mt-1 block text-xs">{{ t('notesview.emptyPickHint') }}</span>
      </template>
      <template v-else>
        <span class="block">{{ t('notesview.emptyNone') }}</span>
        <span class="mt-1 block text-xs">{{ t('notesview.emptyNoneHint') }}</span>
      </template>
    </div>
  </div>
</template>
