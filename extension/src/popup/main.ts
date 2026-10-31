/**
 * 剪藏弹窗（F-901，工具栏按钮入口）：模式三选（记忆上次选择，chrome.storage.local），
 * 点击剪藏 → runClip 编排。当前标签页即剪藏来源（activeTab 由按钮点击授予）。
 */

import { runClip, type ClipProgress } from '../orchestrator'
import type { ClipMode } from '../clip'

const MODES: ClipMode[] = ['article', 'full', 'selection']

function statusText(progress: ClipProgress): string {
  switch (progress.step) {
    case 'extract':
      return '正在提取页面…'
    case 'convert':
      return '正在转换为 Markdown…'
    case 'images':
      return `正在抓取图片 ${progress.done}/${progress.total}…`
    case 'package':
      return '正在打包…'
    case 'done':
      return `已下载 ${progress.outcome.filename}（图片 ${progress.outcome.images} 张）`
  }
}

async function main(): Promise<void> {
  const status = document.getElementById('status')!
  const button = document.getElementById('clip') as HTMLButtonElement
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')]

  const saved = (await chrome.storage.local.get('mode')).mode as ClipMode | undefined
  const initial = saved !== undefined && MODES.includes(saved) ? saved : 'article'
  for (const radio of radios) radio.checked = radio.value === initial

  button.addEventListener('click', async () => {
    const mode = (radios.find((radio) => radio.checked)?.value ?? 'article') as ClipMode
    void chrome.storage.local.set({ mode })
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined) {
      status.textContent = '未找到可剪藏的标签页'
      status.className = 'status error'
      return
    }
    button.disabled = true
    status.className = 'status'
    try {
      await runClip(tab.id, mode, (progress) => {
        status.textContent = statusText(progress)
        if (progress.step === 'done') status.className = 'status ok'
      })
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.className = 'status error'
    } finally {
      button.disabled = false
    }
  })
}

void main()

export {}
