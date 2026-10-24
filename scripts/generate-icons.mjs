// 【遗留备用】T 字 logo 图标生成（F-401 初版）：零依赖，手写 PNG 编码（zlib + CRC32）+ SDF 光栅化。
// 自 v0.5.1 起应用图标改用封面图生成：powershell -File scripts/generate-icons.ps1 -Source <图片>，
// 本脚本仅在需要还原「T 字 logo」时运行，会覆盖 public/ 下的同名图标文件。
// 产出：public/pwa-192x192.png、public/pwa-512x512.png（purpose any，圆角）、
//       public/pwa-maskable-512.png（purpose maskable，满幅）、public/apple-touch-icon.png（180，满幅）。
// 运行：node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public')
mkdirSync(outDir, { recursive: true })

const BG = [79, 70, 229] // indigo-600
const FG = [255, 255, 255]

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, data.length)
  const body = new Uint8Array(4 + data.length)
  body.set(new TextEncoder().encode(type), 0)
  body.set(data, 4)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(body))
  const out = new Uint8Array(12 + data.length)
  out.set(length, 0)
  out.set(body, 4)
  out.set(crc, 8 + data.length)
  return out
}

/** RGBA 像素 → PNG Buffer（filter 0，zlib deflate） */
function encodePng(width, height, rgba) {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/* ---------- 形状（SDF，单位坐标 0..1，y 向下） ---------- */

/** 圆角矩形：负值在内部 */
function sdRoundRect(px, py, halfW, halfH, r) {
  const qx = Math.abs(px) - (halfW - r)
  const qy = Math.abs(py) - (halfH - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

function sdRect(px, py, halfW, halfH) {
  return Math.max(Math.abs(px) - halfW, Math.abs(py) - halfH)
}

/** TinyNote 的「T」标：横杠 + 竖笔，整体以 (0.5, 0.5) 为中心、scale 控制大小 */
function sdT(px, py, scale = 1) {
  const cx = px - 0.5
  const cy = (py - 0.5) / scale
  const bar = sdRect(cx, cy + 0.19, 0.23, 0.05)
  const stem = sdRect(cx, cy + 0.05, 0.0575, 0.19)
  return Math.min(bar, stem)
}

/**
 * 光栅化：SDF 覆盖度 × 3×3 超采样抗锯齿。
 * shape(u, v) 返回该点背景覆盖度（0/1），icon(u, v) 返回前景覆盖度。
 */
function rasterize(size, shape, icon) {
  const rgba = new Uint8Array(size * size * 4)
  const S = 3
  const at = (coverage, x, y, channel) => {
    let acc = 0
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size
        const v = (y + (sy + 0.5) / S) / size
        acc += coverage(u, v) ? 1 : 0
      }
    }
    return acc / (S * S)
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const bgAlpha = at(shape, x, y)
      const fgAlpha = at(icon, x, y) * bgAlpha
      rgba[i] = Math.round(BG[0] * (1 - fgAlpha) + FG[0] * fgAlpha)
      rgba[i + 1] = Math.round(BG[1] * (1 - fgAlpha) + FG[1] * fgAlpha)
      rgba[i + 2] = Math.round(BG[2] * (1 - fgAlpha) + FG[2] * fgAlpha)
      rgba[i + 3] = Math.round(255 * bgAlpha)
    }
  }
  return rgba
}

/** 圆角「any」图标：底为圆角矩形，T 稍大 */
function drawRounded(size) {
  return rasterize(
    size,
    (u, v) => sdRoundRect(u - 0.5, v - 0.5, 0.5, 0.5, 0.22) < 0,
    (u, v) => sdT(u, v, 1.08) < 0,
  )
}

/** 满幅图标（maskable / apple-touch）：T 收缩进安全区（maskable 安全区为中央 80% 圆） */
function drawFullBleed(size, tScale) {
  return rasterize(
    size,
    () => true,
    (u, v) => sdT(u, v, tScale) < 0,
  )
}

const files = [
  ['pwa-192x192.png', 192, drawRounded(192)],
  ['pwa-512x512.png', 512, drawRounded(512)],
  ['pwa-maskable-512.png', 512, drawFullBleed(512, 0.92)],
  ['apple-touch-icon.png', 180, drawFullBleed(180, 1)],
]

for (const [name, size, rgba] of files) {
  writeFileSync(join(outDir, name), encodePng(size, size, rgba))
  console.log(`generated public/${name}`)
}
