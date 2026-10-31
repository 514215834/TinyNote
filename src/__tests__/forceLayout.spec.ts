import { describe, expect, it } from 'vitest'
import { createForceLayout, type ForceEdge } from '../features/links/forceLayout'

/**
 * 自研力导向布局（F-703）单测：纯函数、无随机源的确定性仿真——
 * 收敛行为（弹簧归位/斥力铺散）、alpha 衰减与重热、热启动复用坐标、
 * 输入防御（重复 id / 断端边 / 大图不 NaN）。
 */

const BOX = { width: 800, height: 600 }

function run(layout: ReturnType<typeof createForceLayout>, steps: number): number {
  let alpha = 1
  for (let i = 0; i < steps; i++) alpha = layout.step()
  return alpha
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

describe('createForceLayout（F-703 力导向）', () => {
  it('相连两节点收敛到弹簧自然长度附近', () => {
    const layout = createForceLayout(['a', 'b'], [{ source: 'a', target: 'b' }], {
      ...BOX,
      linkDistance: 72,
    })
    const initial = distance(layout.nodes[0], layout.nodes[1])
    run(layout, 400)
    const settled = distance(layout.nodes[0], layout.nodes[1])
    expect(settled).toBeLessThan(72 * 2) // 明显比初始螺旋半径近
    expect(settled).toBeGreaterThan(10)
    expect(initial).not.toBeNaN()
  })

  it('孤立节点被中心引力聚拢但斥力防止重合', () => {
    const layout = createForceLayout(['a', 'b', 'c', 'd'], [], BOX)
    run(layout, 400)
    const nodes = layout.nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(distance(nodes[i], nodes[j])).toBeGreaterThan(10)
      }
    }
  })

  it('alpha 按步衰减至阈值后停在 alphaMin 以下；restart 重热回档', () => {
    const layout = createForceLayout(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], BOX)
    let alpha = 1
    let steps = 0
    while (alpha > 0.002 && steps < 1000) {
      alpha = layout.step()
      steps++
    }
    expect(alpha).toBeLessThanOrEqual(0.002)
    expect(steps).toBeGreaterThan(150) // 乘法衰减应支撑上百步的渐缓收敛
    expect(alpha).toBeGreaterThanOrEqual(0)
    layout.restart()
    expect(layout.alpha()).toBe(1)
  })

  it('restart(heat) 支持温和重热', () => {
    const layout = createForceLayout(['a'], [], BOX)
    layout.restart(0.4)
    expect(layout.alpha()).toBe(0.4)
  })

  it('seeds 热启动：同 id 节点保持给定坐标，新节点落螺旋空位', () => {
    const layout = createForceLayout(
      ['a', 'b', 'new'],
      [],
      BOX,
      new Map([
        ['a', { x: 111, y: 222 }],
        ['b', { x: -50, y: 90 }],
      ]),
    )
    expect(layout.node('a')!.x).toBe(111)
    expect(layout.node('a')!.y).toBe(222)
    expect(layout.node('b')!.x).toBe(-50)
    const fresh = layout.node('new')!
    expect(fresh.x).not.toBeNaN()
    expect(Number.isFinite(fresh.y)).toBe(true)
  })

  it('断端引用与重复 id 的防御输入不崩溃、不 NaN', () => {
    const edges: ForceEdge[] = [
      { source: 'a', target: 'ghost' }, // 断端
      { source: 'a', target: 'a' }, // 自环
      { source: 'b', target: 'a' },
    ]
    const layout = createForceLayout(['a', 'a', 'b'], edges, BOX)
    expect(layout.nodes).toHaveLength(2)
    run(layout, 100)
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
      expect(Number.isFinite(node.vx)).toBe(true)
      expect(Number.isFinite(node.vy)).toBe(true)
    }
  })

  it('500 节点链式图 50 步内无 NaN（量级性能护栏的数值行为）', () => {
    const ids = Array.from({ length: 500 }, (_, index) => `n${index}`)
    const edges = ids.slice(1).map((id, index) => ({ source: `n${index}`, target: id }))
    const layout = createForceLayout(ids, edges, BOX)
    run(layout, 50)
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })

  it('同一布局重复运行结果确定（无随机源）', () => {
    const build = () => {
      const layout = createForceLayout(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], BOX)
      run(layout, 120)
      return layout.nodes.map((node) => `${node.x.toFixed(4)},${node.y.toFixed(4)}`)
    }
    expect(build()).toEqual(build())
  })
})
