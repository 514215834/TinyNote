<script setup lang="ts">
import { ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { t, setLocale, locale, LOCALES } from '@/lib/i18n'
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
 * 设置面板（F-521/F-522/F-601）：标签页布局——外观 / 同步 / 存储 三个页签，
 * 弹层定高内部滚动（面板内容随迭代膨胀，单列长滚动查找成本高，v1.0.1 反馈迭代）。
 * 弹层样式沿用 glass-strong 惯例；Esc 与点击遮罩关闭。
 */
const settings = useSettingsStore()

type SettingsTab = 'appearance' | 'sync' | 'storage'
/** 页签状态存组件作用域：面板反复开关时停留在上次的页签（排查同步问题时 reopen 不用重找） */
const activeTab = ref<SettingsTab>('appearance')
const TABS: { value: SettingsTab; labelKey: string }[] = [
  { value: 'appearance', labelKey: 'settings.tabAppearance' },
  { value: 'sync', labelKey: 'settings.tabSync' },
  { value: 'storage', labelKey: 'settings.tabStorage' },
]

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
  window.alert(cleared === null ? t('settings.cacheUnsupported') : t('settings.cacheCleared', { n: cleared }))
}

/** 清空全部本地数据（F-522）：双重确认（confirm + 输入确认词），完成后刷新页面 */
async function wipeAllData(): Promise<void> {
  const confirmed = window.confirm(t('settings.wipeConfirm'))
  if (!confirmed) return
  const keyword = t('settings.wipeKeyword')
  const second = window.prompt(t('settings.wipePrompt'))
  if (second === null) return
  if (second !== keyword) {
    window.alert(t('settings.wipeMismatch'))
    return
  }
  await wipeLocalData()
  window.location.reload()
}

const FONTS: { value: FontChoice; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.fontSystem' },
  { value: 'serif', labelKey: 'settings.fontSerif' },
  { value: 'mono', labelKey: 'settings.fontMono' },
]
const WIDTHS: { value: ContentWidth; labelKey: string }[] = [
  { value: 'narrow', labelKey: 'settings.widthNarrow' },
  { value: 'medium', labelKey: 'settings.widthMedium' },
  { value: 'wide', labelKey: 'settings.widthWide' },
  { value: 'full', labelKey: 'settings.widthFull' },
]

function accentLabel(id: AccentId): string {
  return t(`settings.accent.${id}`)
}

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
      class="glass-strong mx-auto mt-[8vh] flex max-h-[80vh] w-[min(26rem,92vw)] flex-col rounded-2xl p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.title')"
    >
      <!-- 标题 + 页签（v1.0.1：外观/同步/存储分页，页签样式沿用编辑器模式切换的胶囊控件） -->
      <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 class="text-base font-semibold">{{ t('settings.title') }}</h2>
        <div
          role="tablist"
          :aria-label="t('settings.title')"
          class="flex items-center rounded-full border border-gray-900/10 bg-white/50 p-0.5 text-xs shadow-sm dark:border-white/10 dark:bg-white/5"
        >
          <button
            v-for="tab in TABS"
            :key="tab.value"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.value"
            class="rounded-full px-3 py-1 transition-colors"
            :class="
              activeTab === tab.value
                ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-neutral-100'
                : 'text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200'
            "
            @click="activeTab = tab.value"
          >
            {{ t(tab.labelKey) }}
          </button>
        </div>
        <button
          type="button"
          class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
          :aria-label="t('settings.close')"
          @click="settings.closePanel()"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <!-- 页签内容：定高内部滚动，切换不重挂载（存储摘要只读一次） -->
      <div class="min-h-0 flex-1 overflow-y-auto pr-1">
        <!-- 外观：语言 / 主题色 / 光晕 / 字体 / 字号 / 行宽 -->
        <div v-show="activeTab === 'appearance'">
          <div class="mb-5 flex items-center justify-between gap-2" aria-label="界面语言">
            <p class="text-xs font-medium text-gray-400">{{ t('settings.language') }}</p>
            <div class="flex gap-1">
              <button
                v-for="item in LOCALES"
                :key="item.value"
                type="button"
                class="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                :class="locale === item.value ? 'bg-accent text-white shadow-sm' : 'bg-white/60 text-gray-600 hover:bg-white/90 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15'"
                :aria-pressed="locale === item.value"
                @click="setLocale(item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>

          <!-- 主题色 -->
          <section aria-label="主题色" class="mb-5">
            <p class="mb-2 text-xs font-medium text-gray-400">{{ t('settings.accent') }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <button
                v-for="preset in ACCENT_PRESETS"
                :key="preset.id"
                type="button"
                class="h-7 w-7 rounded-full transition-transform hover:scale-110"
                :class="settings.accentId === preset.id ? 'ring-2 ring-gray-900/40 ring-offset-2 ring-offset-white dark:ring-white/50 dark:ring-offset-neutral-800' : ''"
                :style="{ backgroundColor: preset.accent }"
                :title="accentLabel(preset.id)"
                :aria-label="t('settings.accentAria', { label: accentLabel(preset.id) })"
                :aria-pressed="settings.accentId === preset.id"
                @click="pickAccent(preset.id)"
              ></button>
              <label
                class="relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-gray-900/10 px-2.5 text-xs text-gray-500 transition-colors hover:bg-white/60 dark:border-white/10 dark:text-neutral-400 dark:hover:bg-white/10"
                :class="settings.accentId === 'custom' ? 'ring-2 ring-gray-900/40 ring-offset-2 ring-offset-white dark:ring-white/50 dark:ring-offset-neutral-800' : ''"
              >
                {{ t('settings.accentCustom') }}
                <input
                  type="color"
                  :value="settings.accentCustom"
                  :aria-label="t('settings.accentCustomAria')"
                  class="h-4 w-4 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
                  @input="onCustomColor"
                />
              </label>
            </div>
          </section>

          <!-- 环境光晕开关（F-521） -->
          <section aria-label="环境光晕" class="mb-5">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-medium text-gray-400">{{ t('settings.ambient') }}</p>
                <p class="mt-0.5 text-[11px] text-gray-400/80 dark:text-neutral-500">
                  {{ t('settings.ambientDesc') }}
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

          <!-- 正文字体 -->
          <section aria-label="正文字体" class="mb-5">
            <p class="mb-2 text-xs font-medium text-gray-400">{{ t('settings.font') }}</p>
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
                <span :style="{ fontFamily: FONT_STACKS[font.value] }">{{ t(font.labelKey) }}</span>
              </button>
            </div>
          </section>

          <!-- 预览字号 -->
          <section aria-label="预览字号" class="mb-5">
            <p class="mb-2 flex items-center justify-between text-xs font-medium text-gray-400">
              {{ t('settings.fontSize') }}
              <span class="text-gray-500 dark:text-neutral-400">{{ settings.previewFontSize }}px</span>
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="h-7 w-7 rounded-full bg-white/60 text-sm text-gray-600 transition-colors hover:bg-white/90 disabled:opacity-40 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15"
                :aria-label="t('settings.fontSizeSmaller')"
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
                :aria-label="t('settings.fontSize')"
                class="h-1 flex-1 accent-[var(--color-accent)]"
                @input="settings.previewFontSize = Number(($event.target as HTMLInputElement).value)"
              />
              <button
                type="button"
                class="h-7 w-7 rounded-full bg-white/60 text-sm text-gray-600 transition-colors hover:bg-white/90 disabled:opacity-40 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/15"
                :aria-label="t('settings.fontSizeLarger')"
                :disabled="Number(settings.previewFontSize) >= 20"
                @click="setFontSize(1)"
              >
                +
              </button>
            </div>
          </section>

          <!-- 行宽 -->
          <section aria-label="行宽">
            <p class="mb-2 text-xs font-medium text-gray-400">{{ t('settings.width') }}</p>
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
                {{ t(width.labelKey) }}
              </button>
            </div>
          </section>
        </div>

        <!-- 同步（F-501/F-502/F-503）：GitHub Gist 多设备同步 -->
        <div v-show="activeTab === 'sync'" class="pb-1">
          <SyncSection />
        </div>

        <!-- 存储（F-522）：用量/持久化/离线缓存/清空数据 -->
        <div
          v-show="activeTab === 'storage'"
          class="text-xs leading-5 text-gray-500 dark:text-neutral-400"
        >
          <p v-if="storageSummary">
            {{ t('settings.storageUsage', { usage: formatBytes(storageSummary.usage), quota: formatBytes(storageSummary.quota) }) }}
            · {{ storageSummary.persisted ? t('settings.persisted') : t('settings.notPersisted') }}
            <button
              v-if="!storageSummary.persisted"
              type="button"
              class="ml-1 text-accent hover:underline"
              @click="requestPersist"
            >
              {{ t('settings.requestPersist') }}
            </button>
          </p>
          <p v-if="cacheSummary !== null" class="mt-1">
            {{ t('settings.cacheSummary', { caches: cacheSummary.length, entries: cacheCount() }) }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-full border border-gray-900/10 bg-white/60 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
              @click="clearCaches"
            >
              {{ t('settings.clearCaches') }}
            </button>
            <button
              type="button"
              class="rounded-full border border-red-500/25 bg-red-500/5 px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/12 dark:border-red-400/25 dark:hover:bg-red-400/10"
              @click="wipeAllData"
            >
              {{ t('settings.wipeData') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
