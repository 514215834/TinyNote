/** F-207 统计口径：CJK（汉字/假名/谚文）逐字计，连续拉丁字母与数字串记一个词 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const WORD_RE = /[A-Za-z0-9\u00C0-\u024F]+/g

export function countWords(text: string): number {
  const cjk = text.match(CJK_RE)
  const words = text.match(WORD_RE)
  return (cjk?.length ?? 0) + (words?.length ?? 0)
}

/** 字符数：含空白与换行（编辑器内容原样统计） */
export function countChars(text: string): number {
  return text.length
}
