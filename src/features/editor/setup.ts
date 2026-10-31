import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import {
  EditorState,
  type Extension,
} from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { wikilinkCompletion, type WikiLinkCandidate } from './wikilinkComplete'

/**
 * CodeMirror 6 扩展组合（F-301，ADR-004）：
 * 不用 codemirror 包的 basicSetup 聚合扩展（无法按需裁剪），改为显式组合，
 * 从而支持「行号可选」与按暗色模式切换主题两种动态配置。
 * 返回的数组每次调用重建，vue-codemirror 会对整组执行 reconfigure。
 */
export function createMarkdownExtensions(options: {
  lineNumbers: boolean
  dark: boolean
  /** 双链候选注入器（F-701）：返回库中活跃笔记标题（按最近更新排序），输入 `[[` 时补全 */
  getLinkCandidates?: () => readonly WikiLinkCandidate[]
}): Extension[] {
  return [
    // 明确以容器 100% 高度铺满，滚动由 .cm-scroller 自身处理（分栏同步依赖它）
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
      '&.cm-focused': { outline: 'none' },
    }),
    ...options.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    highlightActiveLine(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    history(),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // 不配置 codeLanguages：不做围栏内语言的高亮（预览侧由 highlight.js 负责），保持编辑器包体精简
    markdown(),
    // 浅色下的语法配色；暗色由 oneDark 的配色接管（其本身即一套 highlighter）
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ...options.dark ? [oneDark] : [],
    // F-701：`[[` 唤出标题补全浮层（候选由编辑器注入）
    ...options.getLinkCandidates ? [wikilinkCompletion(options.getLinkCandidates)] : [],
    // 玻璃化界面：编辑器与行号槽底色透明，透出容器的磨砂层（置于主题链最后以覆盖 oneDark 的实底）
    EditorView.theme({
      '&': { backgroundColor: 'transparent' },
      '.cm-gutters': { backgroundColor: 'transparent', borderRightColor: 'transparent' },
      '.cm-activeLine': { backgroundColor: 'rgb(0 0 0 / 0.04)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgb(0 0 0 / 0.05)' },
    }),
  ]
}
