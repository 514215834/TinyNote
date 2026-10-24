import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 命令注册机制（F-603/F-605）：命令面板（Ctrl+K/Ctrl+P）的动作来源从硬编码改为可注册表。
 * 这是 v1.0 沉淀的第一个扩展点（ADR-011）：内置命令在 App 启动时注册；
 * 未来插件化加载器复用同一接口（register/unregister），无需改动面板本身。
 * title 为取词函数：渲染时求值，随界面语言即时切换（F-601）。
 */
export interface Command {
  /** 稳定 id（去重与移除用），约定 `<域>.<动作>` 命名 */
  id: string
  /** 展示标题（函数化以随 locale 响应切换） */
  title: () => string
  /** 快捷键提示（仅展示，如 'Ctrl+N'；实际绑定在 useHotkeys） */
  hint?: string
  /** 额外匹配词（如英文别名），面板按 title+keywords 过滤 */
  keywords?: string
  /** 执行动作；面板激活后自动收起再调用 */
  run: () => void | Promise<void>
}

export const useCommandRegistry = defineStore('commands', () => {
  const commands = ref<Command[]>([])

  /** 注册命令；id 重复时覆盖旧命令（插件热更新语义） */
  function register(command: Command): void {
    unregister(command.id)
    commands.value = [...commands.value, command]
  }

  function registerAll(list: Command[]): void {
    list.forEach(register)
  }

  function unregister(id: string): void {
    commands.value = commands.value.filter((command) => command.id !== id)
  }

  function get(id: string): Command | undefined {
    return commands.value.find((command) => command.id === id)
  }

  return { commands, register, registerAll, unregister, get }
})
