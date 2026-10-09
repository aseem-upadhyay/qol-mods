/**
 * Live hints (SPEC.md §11.4), off unless turned on: which hint a moment calls
 * for, and whether one may show. At most one every 30 minutes and three a day,
 * each kind once a day. The hooks module shows them, after the prompt has
 * gone on, so a hint never delays or changes what the person sent.
 */
import type { Choices, Report } from '../types'
import { money, tokensK } from './copy'
import { contentWords, continues, isVague, overlap } from './normalize'

const MINUTE = 60 * 1000
const SPACING = 30 * MINUTE
const PER_DAY = 3
const IDLE = 45 * MINUTE
const RESUME_GAP = 60 * MINUTE
const RESUME_CONTEXT = 200_000
const MATCH = 0.6

export type HintKind = 'topic-switch' | 'vague-first' | 'resume-after-break' | 'repeat-prompt' | 'skill-exists'
export type Hint = { kind: HintKind; text: string }

/** What this session has seen so far: its prompts and when the last one came. */
export type SessionMemory = { prompts: string[]; lastAt: number | null }

export function today(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function allowed(choices: Choices, kind: HintKind, now: number, enabled: boolean): boolean {
  if (!enabled) return false
  const h = choices.hints
  if (h.off.includes(kind)) return false
  const count = h.day === today(now) ? h.count : 0
  if (count >= PER_DAY) return false
  const last = Math.max(0, ...Object.values(h.lastShownAt))
  if (now - last < SPACING) return false
  const mine = h.lastShownAt[kind]
  return !(mine && today(mine) === today(now))
}

/** The choices with one more hint of `kind` counted against today's limits. */
export function markShown(choices: Choices, kind: HintKind, now: number): Choices {
  const day = today(now)
  return {
    ...choices,
    hints: {
      ...choices.hints,
      lastShownAt: { ...choices.hints.lastShownAt, [kind]: now },
      day,
      count: (choices.hints.day === day ? choices.hints.count : 0) + 1,
    },
  }
}

/** Which hint, if any, a prompt just submitted calls for. */
export function hintFor(
  text: string,
  report: Report | null,
  memory: SessionMemory,
  contextTokens: number,
  thresholdK: number,
  now: number,
): Hint | null {
  for (const cluster of report?.hints.clusters ?? []) {
    if (overlap(text, cluster.signature) >= MATCH) {
      return cluster.existing
        ? { kind: 'skill-exists', text: `You have /${cluster.existing.split(':').pop()} for this.` }
        : { kind: 'repeat-prompt', text: `You've typed this ${cluster.count} times. It could be a skill: see /coach skills.` }
    }
  }
  if (memory.prompts.length === 0 && isVague(text)) {
    return { kind: 'vague-first', text: 'Tip: name the file and say what done looks like.' }
  }
  if (memory.prompts.length > 0 && contextTokens >= thresholdK * 1000 && !continues(text)) {
    const idle = memory.lastAt !== null && now - memory.lastAt >= IDLE
    const mine = contentWords(text)
    const before = new Set<string>()
    for (const p of memory.prompts.slice(-5)) for (const w of contentWords(p)) before.add(w)
    const shared = [...mine].filter(w => before.has(w)).length
    const unrelated = mine.size >= 3 && shared / mine.size < 0.1
    if (idle || unrelated) {
      return {
        kind: 'topic-switch',
        text: `New topic? This session is ${tokensK(contextTokens)} tokens deep. /clear starts fresh`,
      }
    }
  }
  return null
}

/** Records a prompt in the session's memory, after the hint was worked out. */
export function remember(memory: SessionMemory, text: string, now: number): void {
  memory.prompts.push(text)
  if (memory.prompts.length > 20) memory.prompts.shift()
  memory.lastAt = now
}

/**
 * At a resumed session's start: a big session left idle past its cache
 * re-sends its context at full price. About $5 per million tokens, a cache
 * write on Opus less the read it replaces.
 */
export function resumeHint(report: Report | null, sessionId: string, now: number): Hint | null {
  const facts = report?.live.sessions?.[sessionId]
  if (!facts) return null
  const [last, context] = facts
  if (now - last < RESUME_GAP || context < RESUME_CONTEXT) return null
  const usd = (context * 5) / 1e6
  return {
    kind: 'resume-after-break',
    text: `Resuming a ${tokensK(context)}-token session re-sends it at full price, about ${money(usd)}. A short handoff to a new session is cheaper.`,
  }
}
