/**
 * 扩展用到的 chrome.* API 最小类型面（避免引入 @types/chrome 全量）。
 * 只声明本项目实际调用的成员，形状以 MV3 文档为准。
 */

interface ChromeRuntimeMessageSender {
  tab?: { id?: number }
}

interface ChromeRuntime {
  onMessage: {
    addListener(
      listener: (message: unknown, sender: ChromeRuntimeMessageSender, sendResponse: (response: unknown) => void) => void,
    ): void
  }
  onInstalled: {
    addListener(listener: (details: { reason: string }) => void): void
  }
  getURL(path: string): string
  sendMessage(message: unknown): Promise<unknown>
}

interface ChromeTabs {
  sendMessage(tabId: number, message: unknown): Promise<unknown>
  create(createProperties: { url: string; active?: boolean }): void
  query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; url?: string }>>
}

interface ChromeScripting {
  executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown>
}

interface ChromeContextMenus {
  create(createProperties: { id: string; title: string; contexts: string[] }): void
  onClicked: {
    addListener(listener: (info: { menuItemId: string }, tab?: { id?: number }) => void): void
  }
}

interface ChromeDownloads {
  download(options: { url: string; filename?: string; saveAs?: boolean }): Promise<number>
}

interface ChromeStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

interface ChromeStorage {
  local: ChromeStorageArea
}

interface ChromeAction {
  setBadgeText(details: { text: string }): void
  setBadgeBackgroundColor(details: { color: string }): void
}

interface ChromeGlobal {
  runtime: ChromeRuntime
  tabs: ChromeTabs
  scripting: ChromeScripting
  contextMenus: ChromeContextMenus
  downloads: ChromeDownloads
  storage: ChromeStorage
  action: ChromeAction
}

declare const chrome: ChromeGlobal
