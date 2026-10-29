/**
 * 自研轻量力导向布局（F-703，§10.1）：SVG + requestAnimationFrame 的组件侧实现，
 * 本模块为其纯计算内核——不引入 D3 量级依赖，无随机源（黄金角螺旋初始位置），
 * 逐 tick 确定性推进，便于单测断言收敛行为。
 *
 * 模型：库仑斥力（O(n²) 成对，≤ 500 节点量级可控）+ 弹簧约束 + 中心引力，
 * 速度阻尼 + alpha 衰减（复用 D3 的经验衰减曲线），拖拽固定由组件直接写节点坐标。
 */

/** 仿真实体：组件逐帧直接读坐标渲染（绕开 Vue 响应式的每帧 diff） */
export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export interface ForceEdge {
  source: string
  target: string
}

export interface ForceOptions {
  /** 画布尺寸（仿真坐标即视口坐标，缩放平移由外层 transform 承担） */
  width: number
  height: number
  /** 库仑斥力强度 */
  repulsion?: number
  /** 弹簧自然长度 */
  linkDistance?: number
  /** 弹簧刚度 */
  linkStrength?: number
  /** 指向画布中心的引力（孤立节点收敛靠它） */
  gravity?: number
  /** 速度阻尼（每步乘子） */
  friction?: number
  /** 初始 alpha（火力档位） */
  alphaInit?: number
  /** 每步 alpha 衰减量 */
  alphaDecay?: number
  /** 收敛判定阈值（alpha ≤ 此值停帧） */
  alphaMin?: number
}

const DEFAULTS = {
  repulsion: 2600,
  linkDistance: 72,
  linkStrength: 0.05,
  gravity: 0.06,
  friction: 0.82,
  alphaInit: 1,
  /** D3 经验衰减 0.0228：乘法衰减 alpha *= (1 - decay)，约 270 步收敛停帧（渐缓，动效自然） */
  alphaDecay: 0.0228,
  alphaMin: 0.002,
} as const

/** 单帧速度上限：防爆炸（强吸引边一次性拉飞节点） */
const MAX_VELOCITY = 48
/** 重合节点斥力的最小分母（同时保证不会除以零） */
const MIN_DIST2 = 0.01

export interface ForceLayout {
  nodes: SimNode[]
  /** 推进一步，返回衰减后的 alpha（≤ alphaMin 表示已收敛，组件可停帧省 CPU） */
  step(): number
  /** 重热：拉回火力（拖拽释放 / 数据重建后调用；可传小值做温和重热） */
  restart(heat?: number): void
  alpha(): number
  node(id: string): SimNode | undefined
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * 创建布局：ids 为节点 id（重复 id 防御性去重），edges 为有向边
 * （允许引用不存在的 id，解析时忽略）。seeds 提供既有坐标（数据重建时热启动：
 * 同 id 节点保持原位，仅新增节点落到螺旋空位），给定的坐标不再打乱。
 */
export function createForceLayout(
  ids: string[],
  edges: ForceEdge[],
  options: ForceOptions,
  seeds?: Map<string, { x: number; y: number }>,
): ForceLayout {
  const cfg: Required<ForceOptions> = { ...DEFAULTS, ...options }
  const cx = cfg.width / 2
  const cy = cfg.height / 2

  let alpha = cfg.alphaInit

  // 初始化：seed 命中的直接复用，其余按黄金角螺旋铺散（确定性、无随机源）
  const nodeById = new Map<string, SimNode>()
  const nodes: SimNode[] = []
  let spiral = 0
  for (const id of ids) {
    if (nodeById.has(id)) continue
    const seed = seeds?.get(id)
    const node: SimNode =
      seed !== undefined
        ? { id, x: seed.x, y: seed.y, vx: 0, vy: 0 }
        : (() => {
            const angle = spiral * GOLDEN_ANGLE
            const radius = 14 + 10 * Math.sqrt(spiral)
            spiral++
            return { id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, vx: 0, vy: 0 }
          })()
    nodeById.set(id, node)
    nodes.push(node)
  }

  // 边解析成节点对序（断端与自环丢弃）
  const links: Array<{ a: SimNode; b: SimNode }> = []
  for (const edge of edges) {
    const a = nodeById.get(edge.source)
    const b = nodeById.get(edge.target)
    if (a === undefined || b === undefined || a === b) continue
    links.push({ a, b })
  }

  function step(): number {
    if (alpha > cfg.alphaMin) {
      applyForces()
      for (const node of nodes) {
        clampSpeed(node)
        node.x += node.vx
        node.y += node.vy
        node.vx *= cfg.friction
        node.vy *= cfg.friction
      }
    }
    // 乘法衰减（D3 语义）：慢速渐缓收敛，alpha ≤ alphaMin 后不再受力、组件停帧
    alpha = Math.max(0, alpha * (1 - cfg.alphaDecay))
    return alpha
  }

  function applyForces(): void {
    // 中心引力
    for (const node of nodes) {
      node.vx += (cx - node.x) * cfg.gravity * alpha
      node.vy += (cy - node.y) * cfg.gravity * alpha
    }
    // 弹簧（胡克定律）
    for (const { a, b } of links) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || MIN_DIST2
      const force = (dist - cfg.linkDistance) * cfg.linkStrength * alpha
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
    // 成对斥力
    for (let i = 0; i < nodes.length; i++) {
      const first = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const second = nodes[j]
        const dx = second.x - first.x
        const dy = second.y - first.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < MIN_DIST2) dist2 = MIN_DIST2
        const dist = Math.sqrt(dist2)
        const force = cfg.repulsion / dist2
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        first.vx -= fx * alpha
        first.vy -= fy * alpha
        second.vx += fx * alpha
        second.vy += fy * alpha
      }
    }
  }

  function clampSpeed(node: SimNode): void {
    const speed = Math.hypot(node.vx, node.vy)
    if (speed > MAX_VELOCITY) {
      const scale = MAX_VELOCITY / speed
      node.vx *= scale
      node.vy *= scale
    }
  }

  return {
    nodes,
    step,
    restart: (heat?: number) => {
      alpha = heat ?? cfg.alphaInit
    },
    alpha: () => alpha,
    node: (id) => nodeById.get(id),
  }
}
