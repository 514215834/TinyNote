/**
 * 启动时间预算打点（F-604）：关键路径里程碑（模块求值 → 挂载 → 列表就绪），
 * performance.mark/measure 记录并输出到控制台，便于真机核对「首屏 < 1.5s」预算。
 * 打点失败静默（旧环境无 performance.mark 时不影响功能）。
 */
const BOOT_MARK = 'tinynote:boot'

export function markBoot(): void {
  try {
    performance.mark(BOOT_MARK)
  } catch {
    // 无 performance API：跳过打点
  }
}

export function measureStartup(stage: 'mounted' | 'ready'): void {
  try {
    const mark = `tinynote:startup:${stage}`
    const measure = `TinyNote startup / ${stage}`
    performance.mark(mark)
    performance.measure(measure, BOOT_MARK, mark)
    const entry = performance.getEntriesByName(measure).at(-1)
    if (entry) console.info(`[TinyNote] startup ${stage}: ${entry.duration.toFixed(1)}ms`)
  } catch {
    // 打点失败不影响功能
  }
}
