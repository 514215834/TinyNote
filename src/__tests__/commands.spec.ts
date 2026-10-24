import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCommandRegistry, type Command } from '@/features/commands/registry'

function makeCommand(id: string, title = id): Command {
  return { id, title: () => title, run: () => undefined }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('命令注册机制（F-603）', () => {
  it('注册 / 获取 / 注销', () => {
    const registry = useCommandRegistry()
    registry.register(makeCommand('notes.create', '新建笔记'))
    expect(registry.get('notes.create')?.title()).toBe('新建笔记')
    expect(registry.commands).toHaveLength(1)

    registry.unregister('notes.create')
    expect(registry.get('notes.create')).toBeUndefined()
    expect(registry.commands).toHaveLength(0)
  })

  it('重复 id 覆盖旧命令（插件热更新语义）', () => {
    const registry = useCommandRegistry()
    registry.register(makeCommand('same.id', 'v1'))
    registry.register(makeCommand('same.id', 'v2'))
    expect(registry.commands).toHaveLength(1)
    expect(registry.get('same.id')?.title()).toBe('v2')
  })

  it('title 为函数：渲染时求值，语言切换后标题随之变化', () => {
    const registry = useCommandRegistry()
    let label = '中文标题'
    registry.register({ id: 'x', title: () => label, run: () => undefined })
    expect(registry.get('x')?.title()).toBe('中文标题')
    label = 'english title'
    expect(registry.get('x')?.title()).toBe('english title')
  })

  it('run 可为异步；批量注册保留全部命令', async () => {
    const registry = useCommandRegistry()
    let executed = false
    registry.registerAll([
      { id: 'a', title: () => 'a', run: () => undefined },
      {
        id: 'b',
        title: () => 'b',
        run: async () => {
          executed = true
        },
      },
    ])
    await registry.get('b')!.run()
    expect(executed).toBe(true)
    expect(registry.commands.map((command) => command.id).sort()).toEqual(['a', 'b'])
  })
})
