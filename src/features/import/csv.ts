/**
 * 最小 RFC 4180 CSV 解析（F-804 Notion 数据库 csv 用）：引号字段、引号内逗号/换行、
 * 双引号转义、CRLF。不引入 papaparse 量级依赖（E-01 打包纪律）。
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // 去 BOM
  let i = 0
  while (i < src.length) {
    const char = src[i]!
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += char
      i++
      continue
    }
    if (char === '"') {
      inQuotes = true
      i++
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (char === '\r' || char === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      if (char === '\r' && src[i + 1] === '\n') i++
      i++
      // 连续换行 = 空行，跳过（不产生空行记录）
      while (i < src.length && (src[i] === '\r' || src[i] === '\n')) i++
      continue
    }
    field += char
    i++
  }
  // 收尾：有字段或行未空时入表
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
}
