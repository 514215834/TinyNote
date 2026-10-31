/** turndown-plugin-gfm 无官方类型（社区包），最小声明：GFM 聚合插件与三个子插件 */
declare module 'turndown-plugin-gfm' {
  export function gfm(service: unknown): void
  export function tables(service: unknown): void
  export function strikethrough(service: unknown): void
  export function taskListItems(service: unknown): void
}
