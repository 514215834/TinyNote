/**
 * 附件内部引用协议（F-303/F-305）：
 * 正文中的图片以 `tinynote-attachment://<附件id>` 形式引用，
 * 预览/导出时由渲染层与备份层负责把它解析为真实数据。
 * 本文件属于 lib 层（无 Vue / 无 IndexedDB 依赖），渲染管线与编辑器功能共用。
 */
export const ATTACHMENT_SCHEME = 'tinynote-attachment://'

/** 附件 id → 正文引用串 */
export function attachmentRef(id: string): string {
  return `${ATTACHMENT_SCHEME}${id}`
}

/** 从正文中提取全部附件 id（按出现顺序去重） */
export function extractAttachmentIds(content: string): string[] {
  const pattern = new RegExp(`${ATTACHMENT_SCHEME}([\\w-]+)`, 'g')
  const ids: string[] = []
  for (const match of content.matchAll(pattern)) {
    if (!ids.includes(match[1])) ids.push(match[1])
  }
  return ids
}
