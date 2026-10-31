/**
 * 剪藏页（F-901，右键菜单入口）：读取 ?tab=<来源标签页>，自动以正文模式剪藏。
 * 独立页面承载右键菜单流程——popup 无法从 background 打开，页面上下文
 * 也让 blob 下载与状态展示更从容。成功后自动关闭。
 */

import { runClip } from '../orchestrator'

function setStatus(text: string, kind: '' | 'error' | 'ok'): void {
  const status = document.getElementById('status')!
  status.textContent = text
  status.className = `status ${kind}`
}

async function clipSourceTab(tabId: number): Promise<void> {
  const retry = document.getElementById('retry') as HTMLButtonElement
  try {
    await runClip(tabId, 'article', (progress) => {
      if (progress.step === 'extract') setStatus('正在提取页面正文…', '')
      else if (progress.step === 'convert') setStatus('正在转换为 Markdown…', '')
      else if (progress.step === 'images') setStatus(`正在抓取图片 ${progress.done}/${progress.total}…`, '')
      else if (progress.step === 'package') setStatus('正在打包…', '')
      else if (progress.step === 'done') setStatus(`已下载 ${progress.outcome.filename}（图片 ${progress.outcome.images} 张）`, 'ok')
    })
    setTimeout(() => window.close(), 1500)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error')
    retry.hidden = false
  }
}

async function main(): Promise<void> {
  const tabId = Number(new URLSearchParams(location.search).get('tab') ?? '')
  if (!Number.isInteger(tabId) || tabId <= 0) {
    setStatus('缺少来源标签页参数（请从页面右键菜单进入）', 'error')
    return
  }
  const retry = document.getElementById('retry') as HTMLButtonElement
  retry.addEventListener('click', () => {
    retry.hidden = true
    void clipSourceTab(tabId)
  })
  document.getElementById('close')?.addEventListener('click', () => window.close())
  await clipSourceTab(tabId)
}

void main()

export {}
