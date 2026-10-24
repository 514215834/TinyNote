// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { NoteSnapshot } from '@/types'
import {
  SNAPSHOT_CHANGE_THRESHOLD,
  SNAPSHOT_KEEP_LIMIT,
  changedChars,
  relativeChange,
  shouldAutoSnapshot,
  splitByLimit,
} from '@/features/history/history'

function snapshot(id: string, content: string, createdAt: number): NoteSnapshot {
  return { id, noteId: 'n1', content, createdAt }
}

describe('changedChars（编辑量近似：剥除公共前后缀）', () => {
  it('完全相同为 0；追加只在尾部计变化', () => {
    expect(changedChars('同一内容', '同一内容')).toBe(0)
    expect(changedChars('同一内容', '同一内容!')).toBe(1)
    expect(changedChars('同一内容!', '同一内容')).toBe(1)
  })

  it('等长替换（长度差为 0）也能测出变化', () => {
    expect(changedChars('今天天气很好', '昨天气压很低')).toBeGreaterThan(0)
    expect(changedChars('abc', 'xyz')).toBe(3)
  })

  it('中间插入只计插入部分', () => {
    expect(changedChars('开始结束', '开始中间插入结束')).toBe(4)
  })
})

describe('relativeChange（相对上次快照的变化率）', () => {
  it('基线为空：空→空为 0，空→非空为无穷', () => {
    expect(relativeChange('', '')).toBe(0)
    expect(relativeChange('', '新内容')).toBe(Number.POSITIVE_INFINITY)
  })

  it('按原文长度归一化', () => {
    expect(relativeChange('a'.repeat(100), 'a'.repeat(80) + 'b'.repeat(40))).toBeCloseTo(0.4)
  })
})

describe('shouldAutoSnapshot（F-402 自动快照口径）', () => {
  it('空内容/纯空白不快照', () => {
    expect(shouldAutoSnapshot([], '')).toBe(false)
    expect(shouldAutoSnapshot([], '   \n  ')).toBe(false)
  })

  it('无快照时首个非空版本即为基线快照', () => {
    expect(shouldAutoSnapshot([], '第一版内容')).toBe(true)
  })

  it('与任一既有快照逐字相同则跳过（防回滚场景重复快照）', () => {
    expect(shouldAutoSnapshot(['版本甲', '版本乙'], '版本乙')).toBe(false)
  })

  it('阈值边界：恰好 20% 不快照，超过才快照', () => {
    const baseline = 'a'.repeat(1000)
    const below = baseline + 'b'.repeat(200)
    expect(relativeChange(baseline, below)).toBeCloseTo(SNAPSHOT_CHANGE_THRESHOLD)
    expect(shouldAutoSnapshot([baseline], below)).toBe(false)
    expect(shouldAutoSnapshot([baseline], below + 'c')).toBe(true)
  })

  it('与最新快照比较（existingContents 首位），而非更早的快照', () => {
    const old = 'a'.repeat(1000)
    const latest = 'b'.repeat(1000)
    expect(shouldAutoSnapshot([latest, old], latest + 'c')).toBe(false)
  })
})

describe('splitByLimit（保留上限 20 条/篇）', () => {
  it('超出上限时保留最新、淘汰最旧（输入按最新在前排序）', () => {
    const list = Array.from({ length: SNAPSHOT_KEEP_LIMIT + 3 }, (_, i) =>
      snapshot(`s${i}`, `内容${i}`, 1000 + (SNAPSHOT_KEEP_LIMIT + 2 - i)), // i 越小越新
    )
    const { keep, overflow } = splitByLimit(list)
    expect(keep).toHaveLength(SNAPSHOT_KEEP_LIMIT)
    expect(keep[0]!.id).toBe('s0') // 最新在前
    expect(overflow.map((row) => row.id)).toEqual(['s20', 's21', 's22'])
  })

  it('未超上限时全部保留', () => {
    const list = [snapshot('s0', '内容', 1), snapshot('s1', '内容2', 2)]
    const { keep, overflow } = splitByLimit(list)
    expect(keep).toHaveLength(2)
    expect(overflow).toHaveLength(0)
  })
})
