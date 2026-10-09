/**
 * Every word coach shows, in one place (SPEC.md §11.7): sentence case, plain
 * words, contractions, no "I", estimates said with "about", and never blame.
 */
import type { ClaudeMdCard, Evidence, HabitId, Notice, SkillCard, Tip, WeekRow } from '../types'

// -- numbers

export function money(n: number | null | undefined): string {
  const v = n ?? 0
  if (v >= 100) return `$${Math.round(v).toLocaleString('en-US')}`
  return `$${v.toFixed(2)}`
}

export function tokensK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayName(ms: number): string {
  return DAYS[new Date(ms).getDay()] ?? ''
}

export function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`
}

/**
 * "5 to 11 Oct" for the week whose id (its first day, as scan.py's local
 * date) is `week`: read as a date, never through a time zone.
 */
export function weekRange(week: string): string {
  const [y, m, d] = week.split('-').map(Number)
  const a = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const b = new Date(a.getTime() + 6 * 24 * 3600 * 1000)
  const day = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()] ?? ''}`
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} to ${day(b)}`
  return `${day(a)} to ${day(b)}`
}

/** "5 Oct" for a week id: the week's first day. */
export function weekStartDay(week: string): string {
  const [y, m, d] = week.split('-').map(Number)
  const a = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()] ?? ''}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// -- the glossary (one plain sentence or two each)

export const GLOSSARY: Record<string, string> = {
  token:
    "A token is a small piece of text, about three quarters of a word. Claude reads and writes in tokens, and they're what usage is measured in.",
  context:
    "Context is everything Claude reads before it answers: the instructions, your messages, the files it opened and the tool output so far. It's read again on every step, so a long session costs more per step.",
  cache:
    'The cache keeps a conversation Claude has just read, so the next step rereads it at a tenth of the price. It lasts a few minutes, or up to an hour; after a longer break the whole conversation is sent again at full price.',
  compaction:
    'When a session gets too long, Claude Code summarizes the conversation so far and carries on from the summary. Details can get lost on the way.',
  subagent:
    'A subagent is a helper Claude starts for a side task, such as searching the code. It works in its own context, so the main session stays small.',
  'plan mode':
    "In plan mode Claude reads and plans but changes nothing until you approve the plan. Switch to it with shift+tab.",
  effort:
    'Effort is how much thinking Claude does before it answers. Higher effort helps with hard problems and costs more output.',
  'CLAUDE.md':
    'CLAUDE.md is a file of notes Claude reads at the start of every session: how to run things, what to avoid, where things live.',
  skill:
    'A skill is a saved set of instructions you can run by name, like /release-notes, instead of typing the same prompt again.',
}

// -- habits (SPEC.md §9.1)

export const HABIT: Record<
  HabitId,
  { title: string; tryThis: string; glossary: string; bar: string; short: string; unit: string }
> = {
  'fresh-start': {
    title: 'Start fresh when you switch topics',
    tryThis: 'Type /clear or start a new session when you move to something unrelated.',
    glossary: 'context',
    bar: '/clear when you switch topics',
    short: '/clear on topic switch',
    unit: 'switches',
  },
  'point-to-place': {
    title: 'Point Claude at the right place',
    tryThis: 'Name the file or folder, or type @ to mention it.',
    glossary: 'context',
    bar: 'name the file you mean',
    short: 'name the file',
    unit: 'first prompts',
  },
  'say-done': {
    title: 'Say what done looks like',
    tryThis: 'End with "Done when…": the tests pass, the page shows X, the command prints Y.',
    glossary: 'context',
    bar: 'say what done looks like',
    short: 'say what done is',
    unit: 'first prompts',
  },
  'check-work': {
    title: 'Ask Claude to check its work',
    tryThis: 'Ask "run the tests before you finish", or put it in CLAUDE.md.',
    glossary: 'CLAUDE.md',
    bar: 'ask Claude to run the checks',
    short: 'ask for checks',
    unit: 'changes checked',
  },
  'plan-big': {
    title: 'Plan big changes first',
    tryThis: 'Press shift+tab to switch to plan mode before a change across many files.',
    glossary: 'plan mode',
    bar: 'plan big changes first',
    short: 'plan big changes',
    unit: 'big changes planned',
  },
}

export function habitEvidence(habit: HabitId, e: Evidence): string {
  const n = e.numbers
  const where = `"${e.title}"`
  switch (habit) {
    case 'fresh-start':
      return `On ${dayName(e.at)}, ${where} moved on to something new while it already held about ${n.contextK}k tokens of the earlier topic. Over the next ${plural(Number(n.promptsAfter ?? 1), 'prompt')}, re-reading that context cost about ${money(e.usd)}.`
    case 'point-to-place':
      return `In ${where}, Claude took ${plural(Number(n.steps ?? 0), 'step')} to find where to start, because the first prompt didn't name a file.`
    case 'say-done':
      return `In ${where}, ${plural(Number(n.corrections ?? 0), 'correction')} followed a first prompt that didn't say what done looks like.`
    case 'check-work':
      return `In ${where}, Claude changed ${plural(Number(n.files ?? 0), 'file')} without running a check, and the next prompt was a correction.`
    case 'plan-big':
      return `${where} changed ${plural(Number(n.files ?? 0), 'file')} for about ${money(e.usd)}, without a plan first.`
  }
}

export function learned(habit: HabitId): string {
  return `You've got this one: ${HABIT[habit].title.toLowerCase()}. It stays retired for the next 8 weeks.`
}

// -- tips (SPEC.md §9.3)

export function tipText(t: Tip): { title: string; body: string } {
  const n = t.numbers
  const saving = t.impactUsd ? ` That's about ${money(t.impactUsd)} a week.` : ''
  switch (t.id) {
    case 'rewarm-after-break':
      return {
        title: 'Hand off before a long break',
        body: `After breaks, ${plural(Number(n.events), 'session')} sent their whole context again at full price, about ${money(Number(n.usd))} this week. Before a long break on a big session, ask for a short handoff summary and start the next session from it.`,
      }
    case 'newer-model':
      return {
        title: `Switch to ${n.newer}`,
        body: `${percent(Number(n.share))} of this week's usage was on ${n.model}. ${n.newer} is newer and costs less per token.${saving} Switch with /model.`,
      }
    case 'smaller-model':
      return {
        title: 'Try a smaller model for quick questions',
        body: `${plural(Number(n.small), 'short request')} ran on the biggest models. Sonnet handles questions like these well.${saving}`,
      }
    case 'effort-match':
      return {
        title: 'Lower the effort for routine work',
        body: `${percent(Number(n.share))} of replies used max effort, including ${plural(Number(n.small), 'small request')}. Keep max for hard problems.${saving}`,
      }
    case 'fast-premium':
      return {
        title: 'Keep fast mode for when you wait on it',
        body: `Fast mode costs twice as much, about ${money(Number(n.usd))} extra this week. /fast turns it on and off.`,
      }
    case 'approvals-to-allowlist':
      return {
        title: 'Stop approving the same command',
        body: `You approved "${n.command}" ${n.count ?? t.count} times this week. Run the /fewer-permission-prompts skill, or add an allow rule for it.`,
      }
    case 'bypass-to-auto':
      return {
        title: 'Keep the safety checks on',
        body: `${plural(Number(n.sessions), 'session')} ran with permission checks turned off, so Claude could run any command without asking. Auto mode or allow rules skip the prompts and keep the checks.`,
      }
    case 'undo-with-rewind':
      return {
        title: 'Rewind instead of asking to undo',
        body: `You asked Claude to undo its changes ${plural(t.count, 'time')}. /rewind (or Esc twice) goes back to an earlier point, code included.`,
      }
    case 'screenshot-for-ui':
      return {
        title: 'Show Claude what looks wrong',
        body: `${plural(t.count, 'interface fix', 'interface fixes')} needed corrections. Paste a screenshot of what you see.`,
      }
    case 'explore-with-subagent':
      return {
        title: 'Explore with a subagent',
        body: `In ${plural(t.count, 'request')}, Claude read over 100k tokens before its first change. Ask it to explore with a subagent so the main session stays small.`,
      }
    case 'compaction-pressure':
      return {
        title: 'Clear before the conversation fills up',
        body: `Claude Code compacted ${plural(t.count, 'session')} automatically this week. /clear between topics, or /compact with a note on what to keep.`,
      }
    case 'polling-to-loop':
      return {
        title: 'Let Claude keep watching',
        body: `You asked for an update ${plural(t.count, 'time')} in one session. Ask Claude to keep watching it with /loop or a background check.`,
      }
    case 'parallel-worktrees':
      return {
        title: 'Run a second session while you wait',
        body: `${plural(t.count, 'request')} ran for 10 minutes or more. While a long task runs, start a second session in a worktree.`,
      }
    case 'claude-md-too-long':
      return {
        title: `Trim ${n.project}'s CLAUDE.md`,
        body: `The CLAUDE.md files Claude loads for ${n.project} come to ${n.lines} lines, about ${tokensK(Number(n.tokens))} tokens, read in every session. Keep what Claude can't work out by itself.${saving}`,
      }
    default:
      return { title: t.id, body: '' }
  }
}

// -- notices (SPEC.md §9.4)

export function noticeText(n: Notice): string {
  switch (n.id) {
    case 'bypass':
      return `You ran ${plural(n.n ?? 0, 'session')} with permission checks turned off. Claude could run any command without asking. Auto mode or allow rules skip the prompts and keep the checks.`
    case 'cost-spike':
      return `${n.day ? dayName(Date.parse(`${n.day}T12:00:00`)) : 'One day'} cost ${money(n.usd)}, ${n.ratio} times a usual day.${n.title ? ` Most of it was "${n.title}".` : ''}`
    case 'api-errors':
      return `Claude Code hit ${plural(n.n ?? 0, 'API error')} this week. That's on the service's side, not yours.`
    case 'unpriced':
      return `Some usage is on models coach has no price for (${(n.models ?? []).join(', ')}), so the total is a floor.`
  }
}

// -- features (SPEC.md §9.2)

export const FEATURE_NAME: Record<string, string> = {
  'claude-md': 'CLAUDE.md',
  'at-mention': '@ mentions',
  image: 'Screenshots',
  interrupt: 'Stopping Claude with Esc',
  'fresh-start': 'A fresh session per topic',
  'ask-checks': 'Asking for checks',
  'plan-mode': 'Plan mode',
  rewind: 'Rewind',
  'model-choice': 'Choosing the model',
  subagents: 'Subagents',
  'commands-skills': 'Your own commands and skills',
  mcp: 'Connectors (MCP)',
  'allow-rules': 'Allow rules',
  compact: '/compact',
  hooks: 'Hooks',
  parallel: 'Parallel sessions',
  worktrees: 'Worktrees',
  headless: 'Scripting with claude -p',
  automation: 'Scheduled and looping tasks',
  plugins: 'Plugins and mods',
  workflows: 'Multi-agent workflows',
}

export const UP_NEXT_REASON: Record<string, (row: WeekRow) => string> = {
  'claude-md': () => 'Claude spent steps this week rediscovering how your projects work.',
  'at-mention': row =>
    `${row.prompts.opening - row.prompts.namesPlace} of your first prompts didn't name a file.`,
  image: () => 'Some fixes this week needed corrections a screenshot might have saved.',
  interrupt: () => 'Esc stops Claude mid-step when it heads the wrong way.',
  'fresh-start': row => `${plural(row.context.stale, 'topic change')} happened inside big sessions.`,
  'ask-checks': row => `${row.work.codePrompts - row.work.checked} changes finished without a check.`,
  'plan-mode': row => `Your biggest changes this week touched many files without a plan.`,
  compact: row => `${plural(row.context.oversizedSessions, 'session')} grew past the size where /compact helps.`,
  subagents: () => 'Some steps read a lot before changing anything; a subagent keeps that out of the session.',
  'allow-rules': () => 'You turned down some tool calls; allow rules decide the safe ones for you.',
  parallel: () => 'With several sessions a week, running two at once saves waiting.',
}

// -- CLAUDE.md and skill cards (SPEC.md §9.6, §9.7)

const TASK_WORD: Record<string, string> = {
  test: 'run the tests',
  build: 'build',
  lint: 'lint',
  typecheck: 'type-check',
  format: 'format the code',
  dev: 'start the dev server',
  install: 'install the dependencies',
}

export function claudeMdLead(card: ClaudeMdCard): string {
  if (card.project === 'All projects')
    return 'These keep coming up in every project. Lines in ~/.claude/CLAUDE.md would say them once for all of them.'
  const n = card.lines.length
  const lead = !card.hasClaudeMd
    ? `${card.project} has no CLAUDE.md yet. Start one with ${n === 1 ? 'this line' : 'these lines'}, or run /init to have Claude write a fuller one.`
    : `Claude rediscovers ${n === 1 ? 'this' : 'these'} in most sessions here. ${n === 1 ? 'A line' : `${n} lines`} in ${card.project}/CLAUDE.md would save it the trip.`
  return n ? lead : `Notes for ${card.project}'s CLAUDE.md.`
}

export function claudeMdWhy(line: ClaudeMdCard['lines'][number]): string {
  const n = line.numbers
  const key = line.id.split(':').pop() ?? ''
  switch (line.source) {
    case 'S1':
      return `In ${n.sessions} of your last ${n.of} sessions here, Claude searched for how to ${TASK_WORD[key] ?? key} (${plural(n.steps ?? 0, 'step')} in all, about ${money(n.usd)}).`
    case 'S2':
      return `Claude tried \`${key.split('>')[0] ?? ''}\` first in ${plural(n.sessions ?? 0, 'session')}.`
    case 'S4':
      return `You corrected Claude about this ${plural(n.times ?? 0, 'time')}, in ${plural(n.sessions ?? 0, 'session')}.`
    case 'S5':
      return `You told Claude this in ${plural(n.sessions ?? 0, 'session')}.`
    case 'S6':
      return `You asked for this ${plural(n.times ?? 0, 'time')} across your projects.`
    default:
      return ''
  }
}

export function pointerFiles(files: string[]): string {
  return `Claude reads ${files.map(f => `\`${f}\``).join(', ')} at the start of most sessions here. A line on what ${files.length === 1 ? 'it is' : 'each is'} for would save the re-reading.`
}

export function pointerTask(task: string): string {
  return `Claude often couldn't find how to ${TASK_WORD[task] ?? task} here. Once you know the command, a line in CLAUDE.md would save it the search.`
}

export function noteText(note: ClaudeMdCard['notes'][number]): string {
  if (note.id === 'covered-but-corrected')
    return `CLAUDE.md already says "${note.text ?? ''}", yet you corrected Claude about it ${plural(note.times ?? 0, 'time')} this month. A more specific line might help.`
  return ''
}

export function skillLead(card: SkillCard): string {
  if (card.existing)
    return `You already have /${card.existing.name} for this, but typed it out by hand ${plural(card.existing.handTyped, 'time')} since you made it.`
  return `You've typed this ${plural(card.count, 'time')} in ${plural(card.sessions, 'session')} over the last 4 weeks:`
}

export function skillUsage(card: SkillCard): string {
  const example = card.slots.length ? ' <…>' : ''
  return `As a skill in ${card.location}, you'd type: /${card.name}${example}`
}

/** The request "Make it a skill" puts in the prompt box (SPEC.md §11.6). */
export function skillRequest(card: SkillCard): string {
  const args = card.slots.length ? ' <…>' : ''
  const steps = card.followUps.filter(f => f.text).map(f => f.text)
  const extra = steps.length
    ? ` Also include the step${steps.length > 1 ? 's' : ''} I usually add afterwards: ${steps.join('; ')}.`
    : ''
  const slots = card.slots.length
    ? ' The parts in angle brackets change each time and come from the arguments.'
    : ''
  return `Turn this prompt, which I keep typing, into a skill I can run as /${card.name}${args}, saved in ${card.location}.${slots}${extra}\n\n${card.template ?? ''}`
}

/** The question "Ask Claude about this week" puts in the prompt box. */
export function weekQuestion(row: WeekRow): string {
  const when = row.week === 'recent' ? 'the last 7 days' : `the week of ${weekStartDay(row.week)}`
  return `Look at my coach report for ${when} (the mcp__coach__report tool) and walk me through it: what changed from the week before, and what should I work on first?`
}

// -- the bar (SPEC.md §4.4, §11.3)

export const BAR = {
  ready: 'Coach: your week in review is ready',
  first: (days: number) =>
    `Coach: your first report is ready, based on your last ${plural(days, 'day')}`,
  habit: (text: string) => `Coach · this week: ${text}`,
  short: (text: string) => `Coach: ${text}`,
}

export const COMMAND = {
  opened: 'Opened the coach report.',
  tips: 'Opened coach tips.',
  claudeMd: 'Opened CLAUDE.md suggestions.',
  skills: 'Opened skill suggestions.',
  barHidden: 'Coach line hidden.',
  barShown: 'Coach line shown.',
  hintsOn: 'Live hints on.',
  hintsOff: 'Live hints off.',
  rescan: 'Rescanning your sessions.',
  help:
    'coach reads your Claude Code sessions on this machine and keeps a weekly report: one habit to work on, tips at your level, CLAUDE.md lines and skills worth making, and your progress. /coach opens it; /coach tips, /coach claude-md and /coach skills open those pages; /coach bar hides or shows the line above the prompt; /coach hints turns live hints on or off; /coach rescan reads everything again.',
  python: 'coach needs python3. On macOS, run `xcode-select --install`.',
}
