/** markdown-it-task-lists 无官方类型，本项目用法：默认 options（复选框只读、不包 label） */
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'

  interface TaskListsOptions {
    /** true 时复选框可交互（需要持久化勾选态，本项目不启用） */
    enabled?: boolean
    /** 是否用 <label> 包裹文本 */
    label?: boolean
    /** label 文本放复选框之后 */
    labelAfter?: boolean
  }

  export default function taskLists(md: MarkdownIt, options?: TaskListsOptions): void
}
