/**
 * 长列表虚拟化开关（F-604）：列表项超过阈值后启用 @tanstack/vue-virtual 动态测量，
 * 之下保持普通 v-for（DOM 少时虚拟化的绝对定位反而增加复杂度与滚动条语义差异）。
 */
export const VIRTUALIZE_THRESHOLD = 300

/** 纯函数便于单测：达到阈值才虚拟化 */
export function shouldVirtualize(itemCount: number, threshold: number = VIRTUALIZE_THRESHOLD): boolean {
  return itemCount > threshold
}

/** 行高估算值（px）：动态测量前占位，偏差由 measureElement 修正 */
export const ESTIMATED_ROW_HEIGHT = 56
