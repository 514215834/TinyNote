<script setup lang="ts">
import { computed } from 'vue'
import { Codemirror } from 'vue-codemirror'
import type { EditorView } from '@codemirror/view'
import { createMarkdownExtensions } from './setup'

/**
 * CodeMirror 6 编辑器封装（F-301，ADR-004）：
 * 对外只暴露 v-model 式接口（modelValue + ready/blur 事件），
 * 升级编辑器实现时 store 层不感知。
 */
const props = defineProps<{
  modelValue: string
  /** 行号开关（可在统计栏切换并持久化） */
  lineNumbers: boolean
  /** 跟随暗色模式切换编辑器主题 */
  dark: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  ready: [view: EditorView]
  blur: []
}>()

const extensions = computed(() =>
  createMarkdownExtensions({
    lineNumbers: props.lineNumbers,
    dark: props.dark,
  }),
)
</script>

<template>
  <Codemirror
    class="h-full min-w-0 flex-1"
    :model-value="props.modelValue"
    :extensions="extensions"
    placeholder="在这里用 Markdown 记录…"
    :indent-with-tab="false"
    @update:model-value="(value: string) => emit('update:modelValue', value)"
    @ready="({ view }) => emit('ready', view)"
    @blur="() => emit('blur')"
  />
</template>
