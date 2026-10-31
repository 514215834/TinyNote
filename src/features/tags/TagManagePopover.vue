<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/lib/i18n'

/**
 * 标签管理浮层（F-1005）：侧栏标签云每枚标签的 ⋯ 入口。
 * 三态：菜单（重命名/合并/删除）→ 重命名输入 / 合并目标选择。
 * 动作只上报事件，落库与刷新由宿主（侧栏）编排。
 */
const props = defineProps<{
  tag: string
  /** 其余标签（合并目标候选，不含自身） */
  others: string[]
}>()

const emit = defineEmits<{
  rename: [from: string, to: string]
  merge: [from: string, into: string]
  remove: [tag: string]
  close: []
}>()

type Mode = 'menu' | 'rename' | 'merge'
const mode = ref<Mode>('menu')
const renameValue = ref('')

watch(
  () => props.tag,
  () => {
    mode.value = 'menu'
    renameValue.value = ''
  },
)

const renameValid = computed(() => {
  const next = renameValue.value.trim()
  return next !== '' && next.toLowerCase() !== props.tag.toLowerCase()
})

function submitRename(): void {
  if (!renameValid.value) return
  emit('rename', props.tag, renameValue.value.trim())
}

function pickMergeTarget(into: string): void {
  emit('merge', props.tag, into)
}

function confirmRemove(): void {
  if (window.confirm(t('tags.removeConfirm', { tag: props.tag }))) emit('remove', props.tag)
}
</script>

<template>
  <div
    class="glass-strong absolute right-0 top-6 z-30 w-56 overflow-hidden rounded-xl p-2 shadow-xl"
    role="menu"
    :aria-label="t('tags.manageTitle', { tag })"
    @click.stop
  >
    <template v-if="mode === 'menu'">
      <p class="truncate px-2 pb-1.5 text-[11px] text-gray-400">{{ tag }}</p>
      <button
        type="button"
        class="w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-gray-900/5 dark:hover:bg-white/10"
        role="menuitem"
        @click="mode = 'rename'"
      >
        {{ t('tags.rename') }}
      </button>
      <button
        type="button"
        class="w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-gray-900/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
        role="menuitem"
        :disabled="others.length === 0"
        @click="mode = 'merge'"
      >
        {{ t('tags.merge') }}
      </button>
      <button
        type="button"
        class="w-full rounded-lg px-2 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-700/20"
        role="menuitem"
        @click="confirmRemove"
      >
        {{ t('tags.remove') }}
      </button>
    </template>

    <template v-else-if="mode === 'rename'">
      <p class="px-2 pb-1.5 text-[11px] text-gray-400">{{ t('tags.renameTitle', { tag }) }}</p>
      <input
        v-model="renameValue"
        type="text"
        class="w-full rounded-lg border-0 bg-white/70 px-2.5 py-1.5 text-xs shadow-sm outline-none ring-1 ring-gray-900/10 focus:ring-2 focus:ring-[--color-accent] dark:bg-white/10 dark:ring-white/10"
        :placeholder="tag"
        @keydown.enter.prevent="submitRename"
        @keydown.esc.prevent="mode = 'menu'"
      />
      <p v-if="renameValue.trim() !== '' && !renameValid" class="px-2 pt-1 text-[11px] text-amber-600 dark:text-amber-400">
        {{ t('tags.renameUnchanged') }}
      </p>
      <div class="mt-2 flex justify-end gap-1.5">
        <button type="button" class="rounded-full px-3 py-1 text-[11px] text-gray-500 hover:bg-white/70 dark:text-neutral-400 dark:hover:bg-white/10" @click="mode = 'menu'">
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-full bg-[--color-accent] px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40"
          :disabled="!renameValid"
          @click="submitRename"
        >
          {{ t('common.confirm') }}
        </button>
      </div>
    </template>

    <template v-else>
      <p class="px-2 pb-1.5 text-[11px] text-gray-400">{{ t('tags.mergeTitle', { tag }) }}</p>
      <ul class="max-h-40 overflow-y-auto">
        <li v-for="other in others" :key="other">
          <button
            type="button"
            class="w-full truncate rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-gray-900/5 dark:hover:bg-white/10"
            @click="pickMergeTarget(other)"
          >
            {{ other }}
          </button>
        </li>
      </ul>
      <button type="button" class="mt-1 w-full rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:bg-white/70 dark:text-neutral-400 dark:hover:bg-white/10" @click="mode = 'menu'">
        {{ t('common.cancel') }}
      </button>
    </template>
  </div>
</template>
