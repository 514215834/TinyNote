<script setup lang="ts">
import { ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useSettingsStore } from './stores/settings'
import { ACCENT_PRESETS, CONTENT_WIDTHS, FONT_STACKS, type AccentId, type ContentWidth, type FontChoice } from './theme'
import {
  clearAppCaches,
  formatBytes,
  listCacheSummary,
  readStorageSummary,
  requestPersistentStorage,
  type StorageSummary,
} from '@/features/pwa/storage'
import { wipeLocalData } from '@/features/pwa/wipe'
import SyncSection from '@/features/sync/SyncSection.vue'

/**
 * 设置面板（F-521/F-522）：外观定制（主题色/字体/字号/行宽）与浏览器缓存管理。
 * 弹层样式沿用 glass-strong 惯例；Esc 与点击遮罩关闭。
 */
const settings = useSettingsStore()

useEventListener(window, 'keydown', (event) => {
  if (event.key === 'Escape' && settings.panelOpen) settings.closePanel()
})

// F-522：面板打开时读取存储用量与离线缓存摘要（启动时已在 App.vue 申请过持久化）
const storageSummary = ref<StorageSummary | null>(null)
const cacheSummary = ref<{ name: string; entries: number }[] | null>(null)

watch(
  () => settings.panelOpen,
  async (open) => {
    if (!open) return
    storageSummary.value = await readStorageSummary()
    cacheSummary.value = await listCacheSummary()
  },
)

async function requestPersist(): Promise<void> {
  await requestPersistentStorage()
  storageSummary.value = await readStorageSummary()
}

const cacheCount = () => cacheSummary.value?.reduce((total, cache) => total + cache.entries, 0) ?? 0
async function clearCaches(): Promise<void> {
  const cleared = await clearAppCaches()
  cacheSummary.value = await listCacheSummary()
  storageSummary.value = await readStorageSummary()
  window.alert(cleared === null ? '当前环境不支持离线缓存。' : `已清理 ${cleared} 个离线缓存，重新访问时自动重建。`)
}

/** 清空全部本地数据（F-522）：双重确认（confirm + 输入「清空」），完成后刷新页面 */
async function wipeAllData(): Promise<void> {
  const confirmed = window.confirm(
    '将删除本浏览器内的全部笔记、文件夹、附件与历史快照，且不可恢复！\n建议先在数据菜单「导出全量备份」留存。确定继续吗？',
  )
  if (!confirmed) return
  const second = window.prompt('此操作不可恢复。请输入「清空」以确认：')
  if (second === null) return
  if (second !== '清空') {
    window.alert('输入不匹配，已取消。')
    return
  }
  await wipeLocalData()
  window.location.reload()
}

const FONTS: { value: FontChoice; label: string }[] = [
  { value: 'system', label: '系统' },
  { value: 'serif', label: '衬线' },
  { value: 'mono', label: '等宽' },
]
const WIDTHS: { value: ContentWidth; label: string }[] = [
  { value: 'narrow', label: '窄' },
  { value: 'medium', label: '中' },
  { value: 'wide', label: '宽' },
  { value: 'full', label: '不限' },
]

function pickAccent(id: AccentId): void {
  settings.accentId = id
}

function onCustomColor(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  settings.accentCustom = value
  settings.accentId = 'custom'
}

function setFontSize(delta: number): void {
  const next = Math.min(20, Math.max(12, Number(settings.previewFontSize) + delta))
  settings.previewFontSize = next
}
</script>

<template>
  <div
    v-if="settings.panelOpen"
    class="fixed inset-0 z-40 overflow-y-auto bg-gray-950/25 backdrop-blur-sm dark:bg-black/40"
    @click.self="settings.closePanel()"
  >
    <div
      class="glass-strong mx-auto mt-[10vh] w-[min(26rem,92vw)] rounded-2xl p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-semibold">设置</h2>
        <button
          type="button"
          class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          aria-label="关闭设置"
          @click="settings.closePanel()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <!-- 外观：主题色 -->
      <section aria-label="主题色" class="mb-5">
        <p class="mb-2 text-xs font-medium text-gray-400">主题色</p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="preset in ACCENT_PRESETS"
            :key="preset.id"
            type="button"
            class="h-7 w-7 rounded-full transition-transform hover:scale-110"
            :class="settings.accentId === preset.id ? 'ring-2 ring-gray-900/40 ring-offset-2 ring-offset-white dark:ring-white/50 dark:ring-offset-neutral-800' : ''"
            :style="{ backgroundColor: preset.accent }"
            :title="preset.label"
            :aria-label="`主题色：${preset.label}`"
            :aria-pressed="settings.accentId === preset.id"
            @click="pickAccent(preset.id)"
          ></button>
          <label
            class="relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-gray-900/10 px-2.5 text-xs text-gray-500 transition-colors hover:bg-white/60 dark:border-white/10 dark:text-neutral-400 dark:hover:bg-white/10"
            :class="settings.accentId === 'custom' ? 'ring-2 ring-gray-900/40 ring-offset-2 ring-offset-white dark:ring-white/50 dark:ring-offset-neutral-800' : ''"
          >
            自定义
            <input
              type="color"
              :value="settings.accentCustom"
              aria-label="自定义主题色"
              class="h-4 w-4 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
              @input="onCustomColor"
            />
          </label>
        </div>
      </section>

      <!-- 外观：环境光晕开关（F-521） -->
      <section aria-label="环境光晕" class="mb-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-xs font-medium text-gray-400">环境光晕</p>
            <p class="mt-0.5 text-[11px] text-gray-400/80 dark:text-neutral-500">
              三色光斑透过玻璃形成的环境光，颜色跟随主题色；觉得干扰阅读时可关闭
            </p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="settings.ambientEnabled"
            class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
            :class="settings.ambientEnabled ? 'bg-accent' : 'bg-gray-300 dark:bg-neutral-600'"
            @click="settings.ambientEnabled = !settings.ambientEnabled"
          >
            <span
              class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
              :class="settings.ambientEnabled ? 'left-[1.125rem]' : 'left-0.5'"
            ></span>
          </button>
        </div>
      </section>

      <!-- 外观：正文字体 -->
      <section aria-label="正文字体" class="mb-5">
        <p class="mb-2 text-xs font-medium text-gray-400">正文字体</p>
        <div class="flex gap-1.5">
          <button
            v-for="font in FONTS"
            :key="font.value"
            type="button"
            class="rounded-full px-3 py-1 text-xs transition-colors"
            :class="settings.fontFamily === font.value ? 'bg-accent text-white shadow-sm' : 'bg-white/60 text-gray-600 hover:bg-white/90 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15'"
            :aria-pressed="settings.fontFamily === font.value"
            @click="settings.fontFamily = font.value"
          >
            <span :style="{ fontFamily: FONT_STACKS[font.value] }">{{ font.label }}</span>
          </button>
        </div>
      </section>

      <!-- 外观：预览字号 -->
      <section aria-label="预览字号" class="mb-5">
        <p class="mb-2 flex items-center justify-between text-xs font-medium text-gray-400">
          预览字号
          <span class="text-gray-500 dark:text-neutral-400">{{ settings.previewFontSize }}px</span>
        </p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-7 w-7 rounded-full bg-white/60 text-sm text-gray-600 transition-colors hover:bg-white/90 disabled:opacity-40 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15"
            aria-label="减小字号"
            :disabled="Number(settings.previewFontSize) <= 12"
            @click="setFontSize(-1)"
          >
            −
          </button>
          <input
            type="range"
            min="12"
            max="20"
            step="1"
            :value="settings.previewFontSize"
            aria-label="预览字号"
            class="h-1 flex-1 accent-[var(--color-accent)]"
            @input="settings.previewFontSize = Number(($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="h-7 w-7 rounded-full bg-white/60 text-sm text-gray-600 transition-colors hover:bg-white/90 disabled:opacity-40 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15"
            aria-label="增大字号"
            :disabled="Number(settings.previewFontSize) >= 20"
            @click="setFontSize(1)"
          >
            +
          </button>
        </div>
      </section>

      <!-- 外观：行宽 -->
      <section aria-label="行宽" class="mb-1">
        <p class="mb-2 text-xs font-medium text-gray-400">行宽</p>
        <div class="flex gap-1.5">
          <button
            v-for="width in WIDTHS"
            :key="width.value"
            type="button"
            class="rounded-full px-3 py-1 text-xs transition-colors"
            :class="settings.contentWidth === width.value ? 'bg-accent text-white shadow-sm' : 'bg-white/60 text-gray-600 hover:bg-white/90 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15'"
            :aria-pressed="settings.contentWidth === width.value"
            :title="CONTENT_WIDTHS[width.value]"
            @click="settings.contentWidth = width.value"
          >
            {{ width.label }}
          </button>
        </div>
      </section>

      <!-- 缓存与存储（F-522，自数据菜单迁入） -->
      <section
        aria-label="缓存与存储"
        class="mt-4 border-t border-gray-900/8 pt-4 text-xs leading-5 text-gray-500 dark:border-white/8 dark:text-neutral-400"
      >
        <p class="mb-2 text-xs font-medium text-gray-400">缓存与存储</p>
        <p v-if="storageSummary">
          本地存储 {{ formatBytes(storageSummary.usage) }} / {{ formatBytes(storageSummary.quota) }}
          · {{ storageSummary.persisted ? '已持久化' : '未持久化' }}
          <button
            v-if="!storageSummary.persisted"
            type="button"
            class="ml-1 text-accent hover:underline"
            @click="requestPersist"
          >
            申请持久化
          </button>
        </p>
        <p v-if="cacheSummary !== null" class="mt-1">
          离线缓存 {{ cacheSummary.length }} 个缓存 · {{ cacheCount() }} 条
        </p>
        <div class="mt-2 flex items-center gap-2">
          <button
            type="button"
            class="rounded-full border border-gray-900/10 bg-white/60 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
            @click="clearCaches"
          >
            清理离线缓存
          </button>
          <button
            type="button"
            class="rounded-full border border-red-500/25 bg-red-500/5 px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/12 dark:border-red-400/25 dark:hover:bg-red-400/10"
            @click="wipeAllData"
          >
            清空全部数据…
          </button>
        </div>
      </section>

      <!-- 同步（F-501/F-502/F-503）：GitHub Gist 多设备同步 -->
      <SyncSection />
    </div>
  </div>
</template>
