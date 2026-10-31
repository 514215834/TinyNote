/**
 * 剪藏扩展构建（F-901）：esbuild 四入口 + 静态资源拷贝到 extension/dist。
 * - background：ESM（manifest 声明 type: module）
 * - content/extract：IIFE（content script 不支持 ES module），内联 @mozilla/readability
 * - popup / clipper：ESM 页面脚本，内联 turndown（复用应用 htmlToMarkdown 内核的动态 import）
 *
 * 用法：npm run ext:build（根 package.json）
 */

import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outdir = join(root, 'dist')
const common = {
  bundle: true,
  target: 'chrome120',
  logLevel: 'info',
  minify: true,
}

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

await Promise.all([
  build({
    ...common,
    entryPoints: [join(root, 'src/background.ts')],
    outfile: join(outdir, 'background.js'),
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/content/extract.ts')],
    outfile: join(outdir, 'content/extract.js'),
    format: 'iife',
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/popup/main.ts')],
    outfile: join(outdir, 'popup/popup.js'),
    format: 'esm',
  }),
  build({
    ...common,
    entryPoints: [join(root, 'src/clipper/main.ts')],
    outfile: join(outdir, 'clipper/clipper.js'),
    format: 'esm',
  }),
])

// 静态资源：manifest / 页面 HTML / 样式 / 图标
cpSync(join(root, 'manifest.json'), join(outdir, 'manifest.json'))
cpSync(join(root, 'src/popup/popup.html'), join(outdir, 'popup/popup.html'))
cpSync(join(root, 'src/popup/popup.css'), join(outdir, 'popup/popup.css'))
cpSync(join(root, 'src/clipper/clipper.html'), join(outdir, 'clipper/clipper.html'))
mkdirSync(join(outdir, 'icons'), { recursive: true })
cpSync(join(root, '../public/pwa-192x192.png'), join(outdir, 'icons/icon.png'))

console.log('[tinynote-ext] built → extension/dist')
