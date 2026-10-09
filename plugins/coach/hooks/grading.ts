/**
 * Opt-in prompt grading (SPEC.md §10.2). Once a week, after the week freezes,
 * a sample of opening prompts is scored against a fixed rubric through the
 * session's own client, and the weakest prompt that needed follow-ups is
 * rewritten from what those follow-ups said. Off unless `promptGrading` is on.
 * The calls themselves are made in register.tsx, where `$` is.
 */
import type { ModelUsage } from 'claude-code'

import type { Grading, GradingInput } from '../types'

export const RUBRIC_VERSION = 1
const BATCH = 5
const CRITERIA = ['goal', 'place', 'done', 'scope', 'context'] as const

/** $ per million tokens: input, output, cache read, cache write (claude-*-5-5). */
const PRICES: Record<'haiku' | 'sonnet', [number, number, number, number]> = {
  haiku: [0.1, 0.5, 0.01, 0.125],
  sonnet: [2, 10, 0.2, 2.5],
}

export const RUBRIC = `You grade prompts a person wrote to Claude Code, an AI coding assistant, to start a task.
Score each prompt on five criteria, 0 (missing), 1 (partly there) or 2 (clear):
- goal: says what outcome is wanted
- place: names the files, folders, functions or area to work in
- done: says how to tell the task is done (tests pass, output looks like X)
- scope: asks for one coherent task, not several unrelated ones
- context: gives what Claude can't find by itself (errors seen, constraints, preferences)
You also get how many follow-up prompts and corrections the task needed; use them only to judge, never as a criterion.
Reply with JSON only: an array with one object per prompt, in order, like
[{"id": "<id>", "goal": 2, "place": 0, "done": 1, "scope": 2, "context": 1}]`

export const REWRITE = `Rewrite the first prompt below so Claude could have done the task without the follow-ups.
Add only what the follow-ups say; never invent files, names or requirements.
Keep the person's own words where you can. At most 60 words. Reply with the rewritten prompt only.`

export type Score = { id: string } & Record<(typeof CRITERIA)[number], number>

export function cost(model: 'haiku' | 'sonnet', u: ModelUsage | undefined): number {
  if (!u) return 0
  const p = PRICES[model]
  return (
    (u.input_tokens * p[0] + u.output_tokens * p[1] + u.cache_read_input_tokens * p[2] + u.cache_creation_input_tokens * p[3]) / 1e6
  )
}

/** What grading `input` would cost at most, before anything is sent. */
export function estimate(input: GradingInput, model: 'haiku' | 'sonnet'): number {
  const p = PRICES[model]
  const chars = input.prompts.reduce((n, x) => n + x.text.length + x.next.join(' ').length, 0)
  const batches = Math.ceil(input.prompts.length / BATCH)
  const inTokens = chars / 4 + batches * (RUBRIC.length / 4) + 600
  const outTokens = input.prompts.length * 60 + 200
  return (inTokens * p[0] + outTokens * p[1]) / 1e6
}

export function parseScores(text: string): Score[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: Score[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string') continue
    const score = { id: r.id } as Score
    let ok = true
    for (const c of CRITERIA) {
      const v = r[c]
      if (typeof v !== 'number' || v < 0 || v > 2) ok = false
      else score[c] = Math.round(v)
    }
    if (ok) out.push(score)
  }
  return out
}

export const total = (s: Score): number => CRITERIA.reduce((n, c) => n + s[c], 0)

/** The sample in batches of five, each the JSON one rubric call is sent. */
export function batches(input: GradingInput): string[] {
  const out: string[] = []
  for (let i = 0; i < input.prompts.length; i += BATCH) {
    out.push(
      JSON.stringify(
        input.prompts.slice(i, i + BATCH).map(p => ({
          id: p.id,
          project: p.project,
          prompt: p.text,
          followUps: p.followUps,
          corrections: p.corrections,
        })),
      ),
    )
  }
  return out
}

/** The weakest prompt that needed two follow-ups or more: the one rewritten. */
export function rewriteSource(scores: Score[], input: GradingInput): GradingInput['prompts'][number] | null {
  const byId = new Map(input.prompts.map(p => [p.id, p]))
  const weakest = [...scores].filter(s => (byId.get(s.id)?.followUps ?? 0) >= 2).sort((a, b) => total(a) - total(b))[0]
  return weakest ? (byId.get(weakest.id) ?? null) : null
}

export function rewritePrompt(source: GradingInput['prompts'][number]): string {
  return `Prompt:\n${source.text}\n\nFollow-ups:\n${source.next.map(n => `- ${n}`).join('\n')}`
}

/** What a week's grading comes to, once the calls are made. */
export function summarize(
  input: GradingInput,
  model: 'haiku' | 'sonnet',
  scores: Score[],
  rewritten: { source: GradingInput['prompts'][number]; text: string } | null,
  spent: number,
): Grading | null {
  if (!scores.length) return null
  const criteria: Record<string, number> = {}
  for (const c of CRITERIA) criteria[c] = Math.round((scores.reduce((n, s) => n + s[c], 0) / scores.length) * 100) / 100
  const atLeast7 = scores.filter(s => total(s) >= 7).length / scores.length
  const source = rewritten?.source
  return {
    week: input.week,
    model,
    rubricVersion: RUBRIC_VERSION,
    n: scores.length,
    criteria,
    shareAtLeast7: Math.round(atLeast7 * 1000) / 1000,
    costUsd: Math.round(spent * 10000) / 10000,
    rewrite:
      source && rewritten?.text.trim()
        ? {
            before: source.text.length > 400 ? `${source.text.slice(0, 399)}…` : source.text,
            after: rewritten.text.trim().slice(0, 600),
            followUps: source.followUps,
            project: source.project,
          }
        : null,
  }
}
