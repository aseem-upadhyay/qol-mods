/**
 * B.12 prompt normalization, the same rules as patterns.py's normalize(), so a
 * prompt typed now matches the repeated prompts scan.py found (SPEC.md §11.4).
 * Both test suites run the vectors in tests/fixtures/normalize.json.
 */

const EXTENSIONS =
  'ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|md|json|ya?ml|toml|css|scss|html|sql|sh|txt|ini|cfg|lock|env'
const URL_RE = /https?:\/\/\S+/g
const QUOTED = /`[^`]*`|"[^"]*"/g
const PATH = new RegExp(`(?:[\\w.~-]+/[\\w./-]+|\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:${EXTENSIONS})\\b)`, 'g')
const VERSION = /\bv?\d+\.\d+(?:\.\d+)*(?:[-+][\w.]+)?\b/g
const ISSUE = /#\d+\b|\b[A-Z][A-Z0-9]+-\d+\b/g
const HEX = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/g
const NUMBER = /\b\d+\b/g
const TOKEN = /<\w+>|[a-z0-9][a-z0-9'_-]*/g

export const STOPWORDS = new Set(
  `a an the and or but if then so to of in on at for from by with as is are was were be been being it
its this that these those i me my we our you your he she they them their what which who whom how
why when where can could should would will shall may might must do does did done have has had not no
yes just also very too please some any all each every there here than into over under about up down
out off again more most such only own same other let lets get got make made use using go going`.split(/\s+/),
)

export function plain(text: string): string {
  return text
    .replace(/’/g, "'")
    .replace(/‘/g, "'")
    .replace(/“/g, '"')
    .replace(/”/g, '"')
}

export function normalize(text: string): string[] {
  let t = plain(text)
  t = t.replace(URL_RE, ' <url> ')
  t = t.replace(QUOTED, ' <x> ')
  t = t.replace(PATH, ' <path> ')
  t = t.replace(VERSION, ' <version> ')
  t = t.replace(ISSUE, ' <n> ')
  t = t.toLowerCase()
  t = t.replace(HEX, ' <id> ')
  t = t.replace(NUMBER, ' <n> ')
  return (t.match(TOKEN) ?? []).slice(0, 60)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** zlib.crc32 of the UTF-8 bytes: patterns.py's stable_hash. */
export function stableHash(text: string): number {
  const bytes = new TextEncoder().encode(text)
  let crc = 0xffffffff
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The hashed words of a prompt that say what it's about: no slots, no stopwords. */
export function rareHashes(tokens: string[]): Set<number> {
  const out = new Set<number>()
  for (const t of tokens) if (!STOPWORDS.has(t) && !t.startsWith('<')) out.add(stableHash(t))
  return out
}

/** How much of a repeated prompt's signature a new prompt carries, 0 to 1. */
export function overlap(text: string, signature: number[]): number {
  if (!signature.length) return 0
  const mine = rareHashes(normalize(text))
  return signature.filter(h => mine.has(h)).length / signature.length
}

// -- the few prompt checks the live hints need (patterns.py, B.2 and B.3)

const VAGUE = /\b(?:fix (?:it|this|that)|make it work|(?:doesn'?t|not) work(?:ing)?|broken(?: again)?|do the thing|same as before|clean (?:it|this) up)\b/i
const AT_MENTION = /(?:^|\s)@[\w./-]+/
const IDENTIFIER =
  /`[^`\n]+`|\b(?=\w{6,}\b)[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b|\b(?=\w{6,}\b)[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b|\b(?=\w{6,}\b)[a-z0-9]+(?:_[a-z0-9]+)+\b/
const CONTINUATION =
  /^\W*(?:it\b|this\b|that\b|these\b|those\b|also\b|again\b|still\b|same\b|continue\b|go ahead\b|yes\b|yep\b|ok\b|okay\b|do it\b|looks good\b|and\b)/i

export function words(text: string): string[] {
  return text.match(/[\w'’-]+/g) ?? []
}

export function namesPlace(text: string): boolean {
  const path = new RegExp(PATH.source)
  return path.test(text) || AT_MENTION.test(text) || IDENTIFIER.test(text)
}

export function isVague(text: string): boolean {
  const t = plain(text)
  return words(t).length <= 6 && VAGUE.test(t) && !namesPlace(t)
}

export function continues(text: string): boolean {
  return CONTINUATION.test(plain(text))
}

/** Content words, for telling a new topic from more of the same. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of plain(text).toLowerCase().match(/[a-z0-9][a-z0-9_./-]*/g) ?? []) {
    if (STOPWORDS.has(w)) continue
    out.add(w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
  }
  return out
}
