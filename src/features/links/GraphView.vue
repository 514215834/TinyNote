<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useTemplateRef, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn, useEventListener, useResizeObserver, watchDebounced } from '@vueuse/core'
import { t } from '@/lib/i18n'
import { useNotesStore } from '@/features/notes/stores/notes'
import { useFoldersStore } from '@/features/folders/stores/folders'
import { useSearchStore } from '@/features/search/stores/search'
import { filterByFolder, filterByTag, filterNotes } from '@/features/search/search'
import { useLinksStore } from '@/features/links/stores/links'
import { createForceLayout } from '@/features/links/forceLayout'
import { GRAPH_NODE_LIMIT, type GraphData, type GraphNodeData } from '@/features/links/graphData'

/**
 * 关系图谱（F-703，§10.1）：/graph 路由，自研轻量力导向图（SVG + rAF，
 * 不引入 D3 量级依赖）。节点 = 笔记（文件夹着色、半径按链接度），边 = 双链；
 * 数据复用 F-702 链接索引（内存派生数据）。
 *
 * 渲染策略：力仿真坐标不经 Vue 响应式——rAF 循环直写节点 transform 与边 path 的 d，
 * 仅 hover/范围切换等低频状态走响应式渲染，500 节点量级不掉帧。
 * 降级口径：默认仅渲染当前文件夹/标签/搜索过滤的子集（≤ 500 节点，超出按链接度
 * 截断并提示）；全库模式切换前显式提示阈值与冻结风险（可取消后维持子集）。
 */

const router = useRouter()
const notesStore = useNotesStore()
const foldersStore = useFoldersStore()
const searchStore = useSearchStore()
const linksStore = useLinksStore()

/** 渲染范围：subset = 当前过滤子集（默认，≤ 500 节点）；all = 全库（显式提示后进入） */
type ScopeMode = 'subset' | 'all'
const mode = ref<ScopeMode>('subset')
/** 全库确认的时间戳：拒绝后 4s 内的数据抖动不重复弹窗 */
let allConfirmedAt = 0

// —— 数据装配（computed 同步派生；索引变更经 store.version 依赖自动重算） ————
const subsetNotes = computed(() => {
  const base = filterByTag(filterByFolder(notesStore.notes, notesStore.activeFolderId), notesStore.activeTag)
  const query = searchStore.query.trim()
  if (query === '') return base
  const metaHits = filterNotes(base, query)
  const metaIds = new Set(metaHits.map((note) => note.id))
  return [...metaHits, ...base.filter((note) => !metaIds.has(note.id) && searchStore.contentHitIds.has(note.id))]
})

const graph = computed<GraphData>(() =>
  linksStore.assembleGraph(mode.value === 'all' ? notesStore.notes : subsetNotes.value),
)

/** 邻接表（hover 高亮邻接用）：id → 直接相连的 id 集合 */
const adjacency = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const edge of graph.value.edges) {
    addNeighbor(map, edge.source, edge.target)
    addNeighbor(map, edge.target, edge.source)
  }
  return map
})

function addNeighbor(map: Map<string, Set<string>>, a: string, b: string): void {
  let set = map.get(a)
  if (set === undefined) {
    set = new Set()
    map.set(a, set)
  }
  set.add(b)
}

/** 半径按链接度（孤立节点最小，枢纽节点醒目） */
function radiusOf(node: GraphNodeData): number {
  return Math.min(16, 5 + Math.sqrt(node.outDegree + node.inDegree) * 2.6)
}

const renderNodes = computed(() => graph.value.nodes.map((node) => ({ ...node, radius: radiusOf(node) })))

/** 标签降噪：小图全显；大图仅链度 top30 + hover 高亮本人 */
const LABEL_ALWAYS_MAX = 80
const LABEL_TOP = 30
const hoveredId = ref<string | null>(null)

const labelIds = computed<Set<string>>(() => {
  const nodes = renderNodes.value
  if (nodes.length <= LABEL_ALWAYS_MAX) return new Set(nodes.map((node) => node.id))
  const ids = new Set(
    [...nodes]
      .sort((a, b) => b.outDegree + b.inDegree - (a.outDegree + a.inDegree))
      .slice(0, LABEL_TOP)
      .map((node) => node.id),
  )
  const hovered = hoveredId.value
  if (hovered !== null) ids.add(hovered)
  return ids
})

/* 文件夹着色：与设置面板主题预设同一族色（F-521），未分类固定中性灰 */
const FOLDER_PALETTE = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9'] as const
const UNCLASSIFIED_COLOR = '#94a3b8'
const folderColorById = computed(() => {
  const byId = new Map<string, string>()
  foldersStore.folders.forEach((folder, index) => {
    byId.set(folder.id, FOLDER_PALETTE[index % FOLDER_PALETTE.length])
  })
  return byId
})
function colorOf(node: GraphNodeData): string {
  if (node.folderId === null) return UNCLASSIFIED_COLOR
  return folderColorById.value.get(node.folderId) ?? UNCLASSIFIED_COLOR
}

/** 图例：有节点归属的文件夹 + 未分类（数量随当前子集；空文件夹不占位） */
const legend = computed(() => {
  const rows: Array<{ name: string; color: string; count: number }> = []
  for (const folder of foldersStore.folders) {
    const count = graph.value.nodes.filter((node) => node.folderId === folder.id).length
    if (count > 0) rows.push({ name: folder.name, color: folderColorById.value.get(folder.id) ?? UNCLASSIFIED_COLOR, count })
  }
  const uncategorized = graph.value.nodes.filter((node) => node.folderId === null).length
  if (uncategorized > 0) rows.push({ name: t('common.uncategorized'), color: UNCLASSIFIED_COLOR, count: uncategorized })
  return rows
})

// —— 力仿真 + 直写 DOM 渲染 —————————————————————————————————————
const svgEl = useTemplateRef<SVGSVGElement>('svgEl')
const box = reactive({ width: 0, height: 0 })
const layout = shallowRef<ReturnType<typeof createForceLayout> | null>(null)

const view = reactive({ x: 0, y: 0, k: 1 })
const viewTransform = computed(() => `translate(${view.x} ${view.y}) scale(${view.k})`)
const ZOOM_MIN = 0.3
const ZOOM_MAX = 4

/** 节点 <g> 直写注册表（v-for 函数 ref；元素被 patch 更换时自动换绑） */
const nodeEls = new Map<string, SVGGElement>()
function registerNode(id: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof SVGGElement) nodeEls.set(id, el)
  else nodeEls.delete(id)
}

const edgesPath = useTemplateRef<SVGPathElement>('edgesPath')
const highlightPath = useTemplateRef<SVGPathElement>('highlightPath')

/** 数据重建：同 id 节点热启动保持现位，新增节点落螺旋空位；温和重热避免反复抖动 */
function rebuildLayout(): void {
  if (box.width <= 0 || box.height <= 0) return
  const seeds = new Map<string, { x: number; y: number }>()
  if (layout.value !== null) {
    for (const node of layout.value.nodes) seeds.set(node.id, { x: node.x, y: node.y })
  }
  layout.value = createForceLayout(
    renderNodes.value.map((node) => node.id),
    graph.value.edges,
    { width: box.width, height: box.height },
    seeds,
  )
  if (layoutWasEmpty) fitView()
  layoutWasEmpty = renderNodes.value.length === 0
  layout.value.restart(0.5)
  kick()
}
let layoutWasEmpty = true

useResizeObserver(
  svgEl,
  useDebounceFn((entries: readonly ResizeObserverEntry[]) => {
    const entry = entries[0]
    if (entry === undefined) return
    if (Math.round(entry.contentRect.width) === Math.round(box.width) && Math.round(entry.contentRect.height) === Math.round(box.height))
      return
    box.width = entry.contentRect.width
    box.height = entry.contentRect.height
    rebuildLayout()
  }, 200),
)

onMounted(() => {
  // 首次进入即确保链接索引就绪（构建完成会 bump store.version → graph 重算）
  void linksStore.ensureIndex().then(() => nextTick(rebuildLayout))
})

onBeforeUnmount(() => {
  if (rafId !== 0) cancelAnimationFrame(rafId)
  rafId = 0
})

/** 数据 → 布局重建：索引变更/保存/过滤/切换范围触发；hover 只影响类名不触发 */
watchDebounced([graph], rebuildLayout, { debounce: 150 })

/** rAF 主循环：step 一次 + 直写一次；alpha 收敛且无拖拽时停帧省 CPU */
let rafId = 0
function loop(): void {
  rafId = 0
  const current = layout.value
  if (current === null) return
  const alpha = current.step()
  paint()
  if (alpha > 0.002 || draggingId.value !== null) rafId = requestAnimationFrame(loop)
}

function kick(): void {
  if (rafId === 0) rafId = requestAnimationFrame(loop)
}

/** 单帧直写：全部节点 transform + 边 path d（字符串拼接一次写完） */
function paint(): void {
  const current = layout.value
  if (current === null) return
  for (const node of current.nodes) {
    nodeEls.get(node.id)?.setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`)
  }
  edgesPath.value?.setAttribute('d', edgePathD(null))
  const hovered = hoveredId.value
  const highlight = highlightPath.value
  if (highlight !== null) {
    highlight.setAttribute('d', hovered === null ? '' : edgePathD(hovered))
    highlight.style.display = hovered === null ? 'none' : ''
  }
}

/** 边 path d 组装；hovered 非空时仅该节点的邻接边（高亮层专用） */
function edgePathD(hovered: string | null): string {
  const current = layout.value
  if (current === null) return ''
  let d = ''
  for (const edge of graph.value.edges) {
    if (hovered !== null && edge.source !== hovered && edge.target !== hovered) continue
    const a = current.node(edge.source)
    const b = current.node(edge.target)
    if (a === undefined || b === undefined) continue
    d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`
  }
  return d
}

// —— 缩放平移（滚轮以指针为锚；拖空白处平移） —————————————————————————
function onWheel(event: WheelEvent): void {
  if (box.width <= 0) return
  event.preventDefault()
  const rect = svgEl.value?.getBoundingClientRect()
  if (rect === undefined) return
  const factor = Math.exp(-event.deltaY * 0.0015)
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor))
  if (next === view.k) return
  // 以 (px, py) 为锚点：指针下的世界坐标点保持屏幕位置不动
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  const wx = (px - view.x) / view.k
  const wy = (py - view.y) / view.k
  view.x = px - wx * next
  view.y = py - wy * next
  view.k = next
}

const panning = ref(false)
let panLast: { x: number; y: number } | null = null

function onBackgroundDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  panning.value = true
  panLast = { x: event.clientX, y: event.clientY }
}

function onBackgroundMove(event: PointerEvent): void {
  if (draggingId.value !== null) {
    dragNodeTo(event)
    return
  }
  if (!panning.value || panLast === null) return
  view.x += event.clientX - panLast.x
  view.y += event.clientY - panLast.y
  panLast = { x: event.clientX, y: event.clientY }
}

/** 越界收尾：svg 之外松开也停掉平移/拖拽（节点点击语义在节点自身 up 处理） */
useEventListener(window, 'pointerup', () => {
  panning.value = false
  panLast = null
  draggingId.value = null
  dragStart = null
})

// —— 节点拖拽固定与点击打开（位移 < 4px 视为点击） ————————————————————
const draggingId = ref<string | null>(null)
let dragStart: { x: number; y: number; moved: boolean } | null = null

function onNodeDown(node: GraphNodeData, event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.stopPropagation() // 不进 background 平移
  draggingId.value = node.id
  dragStart = { x: event.clientX, y: event.clientY, moved: false }
  ;(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId)
}

/**
 * 节点捕获后指针移动 → 直写固定坐标（vx/vy 清零），其余节点继续受力。
 * 事件经捕获元素冒泡到 svg 的 pointermove，由 draggingId 分流到此。
 */
function dragNodeTo(event: PointerEvent): void {
  const id = draggingId.value
  const node = id === null ? undefined : layout.value?.node(id)
  const rect = svgEl.value?.getBoundingClientRect()
  if (node === undefined || rect === undefined || dragStart === null) return
  if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 4) dragStart.moved = true
  node.x = (event.clientX - rect.left - view.x) / view.k
  node.y = (event.clientY - rect.top - view.y) / view.k
  node.vx = 0
  node.vy = 0
  kick()
}

function onNodeUp(node: GraphNodeData): void {
  const wasClick = dragStart !== null && !dragStart.moved
  draggingId.value = null
  dragStart = null
  if (wasClick) openNote(node.id)
}

function openNote(id: string): void {
  notesStore.select(id)
  void router.push({ name: 'notes' })
}

/** 复位视图：节点包围盒按当前画布自适应（首次出图与复位按钮共用） */
function fitView(): void {
  const nodes = layout.value?.nodes ?? []
  if (nodes.length === 0 || box.width <= 0) {
    view.x = 0
    view.y = 0
    view.k = 1
    return
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }
  const pad = 60
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((box.width - pad * 2) / w, (box.height - pad * 2) / h)))
  view.k = k
  view.x = box.width / 2 - ((minX + maxX) / 2) * k
  view.y = box.height / 2 - ((minY + maxY) / 2) * k
}

// —— 大库降级（§10.1）：子集截断提示 + 全库模式显式确认 ————————————————————
const truncatedHint = computed(() => graph.value.truncated)
const allOversize = computed(() => mode.value === 'all' && notesStore.notes.length > GRAPH_NODE_LIMIT)

function switchMode(next: ScopeMode): void {
  if (next === mode.value) return
  if (next === 'all' && notesStore.notes.length > GRAPH_NODE_LIMIT && Date.now() - allConfirmedAt > 4000) {
    if (!window.confirm(t('graph.confirmAll', { n: notesStore.notes.length, limit: GRAPH_NODE_LIMIT }))) return
    allConfirmedAt = Date.now()
  }
  mode.value = next
}
</script>

<template>
  <section class="flex h-full min-w-0 flex-1 flex-col">
    <header
      class="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-900/8 px-6 py-3 dark:border-white/8"
    >
      <button
        type="button"
        :aria-label="t('graph.back')"
        :title="t('graph.back')"
        class="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/60 dark:text-neutral-400 dark:hover:bg-white/8"
        @click="router.push({ name: 'notes' })"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="text-base font-semibold">{{ t('graph.title') }}</h1>
      <span class="text-xs text-gray-400">
        {{ t('graph.nodesCount', { nodes: graph.nodes.length, edges: graph.edges.length }) }}
      </span>

      <!-- 范围切换：子集（默认）/ 全库（超阈值先确认） -->
      <div
        class="flex items-center rounded-full border border-gray-900/10 bg-white/60 p-0.5 text-xs dark:border-white/10 dark:bg-white/5"
        role="tablist"
        :aria-label="t('graph.scopeAria')"
      >
        <button
          v-for="item in (['subset', 'all'] as const)"
          :key="item"
          type="button"
          role="tab"
          :aria-selected="mode === item"
          class="rounded-full px-2.5 py-1 transition-colors"
          :class="mode === item ? 'bg-gradient-to-r from-accent to-accent-strong text-white shadow-sm shadow-accent/30' : 'text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-100'"
          @click="switchMode(item)"
        >
          {{ item === 'subset' ? t('graph.scopeSubset') : t('graph.scopeAll') }}
        </button>
      </div>

      <!-- 降级提示：子集截断 / 全库超阈值 -->
      <span
        v-if="truncatedHint"
        class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-700/30 dark:text-amber-300"
      >
        {{ t('graph.truncated', { limit: GRAPH_NODE_LIMIT }) }}
      </span>
      <span
        v-if="allOversize"
        class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-700/30 dark:text-amber-300"
      >
        {{ t('graph.limitWarn', { n: notesStore.notes.length, limit: GRAPH_NODE_LIMIT }) }}
      </span>

      <button
        type="button"
        class="ml-auto rounded-full border border-gray-900/10 bg-white/60 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10"
        :title="t('graph.resetView')"
        @click="fitView"
      >
        {{ t('graph.resetView') }}
      </button>
    </header>

    <!-- 图例（文件夹着色） -->
    <div
      v-if="legend.length > 0"
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-900/8 px-6 py-2 text-[11px] text-gray-500 dark:border-white/8 dark:text-neutral-400"
    >
      <span v-for="item in legend" :key="item.name" class="flex items-center gap-1">
        <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: item.color }" aria-hidden="true"></span>
        <span class="truncate">{{ item.name }}</span>
        <span class="text-gray-400">{{ item.count }}</span>
      </span>
    </div>

    <div class="relative min-h-0 flex-1">
      <!-- 索引构建中（首次进入/同步整库重建） -->
      <p
        v-if="linksStore.building"
        class="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-white/80 px-3 py-1 text-xs text-gray-500 shadow-sm dark:bg-neutral-800/80 dark:text-neutral-300"
      >
        {{ t('links.loading') }}
      </p>
      <p
        v-if="graph.nodes.length === 0"
        class="absolute inset-0 flex items-center justify-center text-sm text-gray-400 dark:text-neutral-500"
      >
        {{
          mode === 'subset' &&
          (notesStore.activeFolderId !== null || notesStore.activeTag !== null || searchStore.query !== '')
            ? t('graph.emptyFiltered')
            : t('graph.empty')
        }}
      </p>

      <svg
        ref="svgEl"
        class="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        :aria-label="t('graph.title')"
        @wheel="onWheel"
        @pointerdown="onBackgroundDown"
        @pointermove="onBackgroundMove"
        @pointerup="panning = false"
        @pointerleave="hoveredId = null"
      >
        <g :transform="viewTransform">
          <!-- 边双层：常规一次直写 + hover 邻接高亮层 -->
          <path
            ref="edgesPath"
            class="fill-none stroke-gray-900/12 dark:stroke-white/15"
            stroke-width="1"
            pointer-events="none"
          />
          <path
            ref="highlightPath"
            class="fill-none stroke-accent/60"
            stroke-width="2"
            pointer-events="none"
            style="display: none"
          />
          <!-- 节点：transform 由 rAF 直写（不进响应式 diff），半径/标签/hover 类走绑定 -->
          <g
            v-for="node in renderNodes"
            :key="node.id"
            :ref="(el) => registerNode(node.id, el)"
            :class="
              hoveredId !== null && hoveredId !== node.id && !adjacency.get(hoveredId)?.has(node.id)
                ? 'opacity-20'
                : 'opacity-100'
            "
            class="cursor-pointer transition-opacity"
            @pointerenter="hoveredId = node.id"
            @pointerleave="hoveredId = null"
            @pointerdown="onNodeDown(node, $event)"
            @pointerup="onNodeUp(node)"
          >
            <circle :r="node.radius" :fill="colorOf(node)" />
            <circle v-if="hoveredId === node.id" :r="node.radius + 3" class="fill-none stroke-accent/50" stroke-width="1" />
            <text
              v-if="labelIds.has(node.id)"
              :y="node.radius + 10"
              text-anchor="middle"
              class="fill-gray-600 text-[10px] dark:fill-neutral-300"
            >{{ node.title }}</text>
            <title>{{ node.title }}</title>
          </g>
        </g>
      </svg>
    </div>
  </section>
</template>
