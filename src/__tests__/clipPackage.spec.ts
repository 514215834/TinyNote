import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import {
  CLIP_FORMAT,
  buildClipZip,
  clipZipName,
  collectImageUrls,
  extByMime,
  parseClipManifest,
  relinkImages,
  sanitizeAssetName,
  type ClipManifest,
} from '../../extension/src/clip'

const VALID: ClipManifest = {
  format: 'tinynote-clip',
  schemaVersion: 1,
  url: 'https://example.com/a',
  siteName: 'Example',
  title: '标题',
  mode: 'article',
  clippedAt: '2026-10-31T00:00:00.000Z',
}

describe('extension/clip 打包纯函数（F-901 契约面）', () => {
  it('parseClipManifest：合法通过，format/version/字段缺失拒绝', () => {
    expect(parseClipManifest(VALID)).toEqual(VALID)
    expect(parseClipManifest({ ...VALID, format: 'other' })).toBeNull()
    expect(parseClipManifest({ ...VALID, schemaVersion: 2 })).toBeNull()
    expect(parseClipManifest({ ...VALID, mode: 'unknown' })).toBeNull()
    expect(parseClipManifest({ ...VALID, url: 1 })).toBeNull()
    expect(parseClipManifest(null)).toBeNull()
    expect(parseClipManifest('x')).toBeNull()
  })

  it('clipZipName：tinynote-clip-YYYYMMDD-HHMM.zip（Windows 文件名安全）', () => {
    const name = clipZipName(new Date(2026, 9, 31, 9, 7))
    expect(name).toBe('tinynote-clip-20261031-0907.zip')
  })

  it('sanitizeAssetName：非法字符净化、无扩展名回落 mime 扩展、空名回退 stem', () => {
    expect(sanitizeAssetName('/img/my photo (1).png', 'png')).toBe('my_photo_1.png')
    expect(sanitizeAssetName('', 'jpg')).toBe('image.jpg')
    expect(sanitizeAssetName('hero', 'png')).toBe('hero.png')
    expect(sanitizeAssetName('../../../etc.png', 'png')).toBe('etc.png')
    // 超长截断（保留尾部）
    const long = sanitizeAssetName('x'.repeat(100) + '.png', 'png')
    expect(long.length).toBeLessThanOrEqual(68)
    expect(long.endsWith('.png')).toBe(true)
  })

  it('extByMime：jpeg→jpg、svg+xml→svg、未知→bin', () => {
    expect(extByMime('image/jpeg')).toBe('jpg')
    expect(extByMime('image/svg+xml')).toBe('svg')
    expect(extByMime('image/webp;charset=utf-8')).toBe('webp')
    expect(extByMime('')).toBe('bin')
  })

  it('collectImageUrls：仅收集 http(s) 与 data:image 引用，内部附件引用/相对路径不参与', () => {
    const md = [
      '![a](https://cdn.example.com/x.png)',
      '![b](data:image/png;base64,AAAA)',
      '![c](tinynote-attachment://abc)',
      '![d](assets/local.png)',
      '![e](https://cdn.example.com/y.png)', // 去重
    ].join('\n')
    expect(collectImageUrls(md)).toEqual(['https://cdn.example.com/x.png', 'data:image/png;base64,AAAA', 'https://cdn.example.com/y.png'])
  })

  it('relinkImages：命中重链、未命中保留原文', () => {
    const md = '![a](https://x/1.png) ![b](https://x/2.png)'
    const out = relinkImages(md, (url) => (url.endsWith('1.png') ? 'assets/1-a.png' : null))
    expect(out).toBe('![a](assets/1-a.png) ![b](https://x/2.png)')
    expect(relinkImages('无图片', () => 'assets/x')).toBe('无图片')
  })

  it('buildClipZip：manifest 可被 parseClipManifest 回读，资源字节二进制无损', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251])
    const zip = buildClipZip(VALID, '# 标题', [{ path: 'assets/1-x.png', name: '1-x.png', mime: 'image/png', bytes }])
    const entries = unzipSync(zip)
    expect(parseClipManifest(JSON.parse(strFromU8(entries['manifest.json']!)))?.format).toBe(CLIP_FORMAT)
    expect(strFromU8(entries['note.md']!)).toBe('# 标题')
    expect(entries['assets/1-x.png']).toEqual(bytes)
  })
})
