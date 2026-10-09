# coach: implementation spec

| | |
|---|---|
| Status | Implemented in 0.1.0; see Appendix D for what changed on the way |
| Author | Aseem Upadhyay, drafted with Claude |
| Date | 2026-10-09 |
| Lives in | `plugins/coach/` in qol-mods |
| First release | 0.1.0, with every phase in it |
| Built against | Claude Code 2.1.293 plugin API (function hooks) |

## 1. Summary

coach reads the Claude Code transcripts already on the user's machine and turns them into a weekly report: what they did, the one habit that would help them most, tips matched to their level, and how they're doing over the weeks. It is written for beginners first and stays useful for experienced users. An optional line above the prompt keeps the current habit in view. coach also suggests `CLAUDE.md` lines for what Claude keeps rediscovering and the user keeps correcting, and suggests turning prompts the user keeps typing into skills. coach never writes them itself. Two buttons fill the prompt box for the user to send or not: "Make it a skill" asks Claude to create a suggested skill, and "Ask Claude about this week" asks about the report.

Version 1 works entirely offline. Grading prompts with a model is opt-in and arrives in phase 2.

## 2. Goals and non-goals

**Goals**

- Help a beginner improve one habit at a time, with evidence from their own sessions.
- Keep a weekly history that survives Claude Code deleting old logs.
- Track cost and how it moves: per prompt, input vs output, by model.
- Suggest features and advanced tips that fit what the user already does.
- Suggest `CLAUDE.md` lines for what Claude rediscovers in every session and for the corrections the user keeps repeating. Suggest turning prompts typed again and again into skills.
- Work in the terminal and in the desktop app's Code tab, with or without repo-spend installed.

**Non-goals**

- A single overall score, a leaderboard, or any comparison with other people.
- Sending anything off the machine by default.
- Blocking or rewriting prompts. coach never changes what the user sends.
- Writing files itself, `CLAUDE.md` and skills included. Beyond suggestions, two buttons fill the prompt box for the user to send: "Make it a skill" and "Ask Claude about this week" (§3, decision 9). Nothing in coach ever asks Claude to edit `CLAUDE.md`.
- Exact billing. Costs are estimates at API list prices, the same as repo-spend.

## 3. Decisions already made

These came out of the design discussion. Reopen them only with new evidence.

1. **A coach, not a scorecard.** Each report leads with one habit and a concrete example, not a grid of numbers.
2. **Input tokens per prompt don't measure clarity.** On the author's logs the median typed prompt is 55 characters (about 14 tokens), while the median model call reads about 265,000 input tokens. The typed words are under 0.01% of the input, which is driven by session length, files read and tool output. coach reports context size as a habit signal ("start fresh between topics"), never as prompt precision.
3. **Outcomes first, model grading second.** Corrections, interrupts, rejected tool calls and checks that ran are measured from the logs. A model-scored rubric is an opt-in extra.
4. **Habits and tips are different things.** A habit is a repeated behaviour measured every week and kept active for at least two weeks. A tip is a one-off change (a setting, a skill, a line in `CLAUDE.md`) that is retired once adopted.
5. **Weekly cadence, no live score.** A live number invites writing for the number.
6. **Its own line above the prompt.** It stacks with repo-spend's line and never depends on it.
7. **Local-first, frozen weekly rows.** Logs are deleted after 30 days by default, so each finished week is written once and kept.
8. **Python scanner plus TypeScript hooks module**, the same split as repo-spend: the scanner is standard-library Python and unit-testable; the module draws and talks to the engine.
9. **Suggestions, plus two buttons.** coach never writes `CLAUDE.md`, skills or any other file. A card shows what could be added and where, with the evidence, and the user decides whether to act. `CLAUDE.md` cards go no further than "Copy". Two buttons fill the prompt box, and nothing else does:
   - "Make it a skill" on a skill card, with a request for Claude to create the skill
   - "Ask Claude about this week" in the report, with a question about the week

   Either way the user reads what's in the box and sends it or not. A skill Claude then creates is approved like any other edit.
10. **Repeated prompts become skill suggestions.** A prompt typed again and again is suggested as a skill, not a slash command, with the "Make it a skill" button.

## 4. The experience

### 4.1 First run

1. The user installs coach (`/plugin install coach --marketplace aseem-upadhyay/qol-mods`).
2. On the next `session.start`, coach starts a background scan of every project's logs. Nothing is drawn while it runs. If the user types `/coach` meanwhile, the pane shows "Reading your sessions… 120 of 517 files".
3. When the scan ends, a toast says "Coach: your first report is ready, based on your last 23 days. Type /coach." and the bar shows the report-ready line.
4. The first report covers the last complete week if logs cover at least 5 of its days; otherwise the last 7 days, labelled "early read".

### 4.2 The weekly loop

- The first session after the week rolls over (Monday 00:00 local by default) scans, freezes last week's row, and picks the habit and tips.
- The bar shows "Coach: your week in review is ready" until the user opens the report, for at most 7 days.
- After that the bar shows the active habit with this week's progress.
- Expected use: about two minutes a week.

### 4.3 The report

A pane opened by `/coach`. Sections, top to bottom:

1. **Header.** "Your week with Claude", the date range, "week 4" (counted from the first report), and a coverage note when the week is partial. Buttons: previous week, next week, this week so far, and "Ask Claude about this week" (§4.5).
2. **Headline.** Four tiles: sessions, prompts, spent (estimated), typical cost per prompt (median). Each shows the change against the average of the 4 weeks before. A change under 10% gets no colour.
3. **Habit of the week.** Title, one evidence paragraph built from a real session with a dollar figure where there is one, a "Try this" line, this week's progress, and buttons: "See the session", the glossary entry it relies on ("What is context?"), "Pick another habit", "Not right?".
4. **Your prompt, rewritten.** Phase 2, only with grading on: one real prompt, a clearer version, and what happened after the original. With grading off, a "Your best prompt this week" card shows the user's own strongest opening prompt (§10.1) and why it worked.
5. **Teach Claude this project.** Phase 2, shown only when there's a candidate. The top `CLAUDE.md` card: up to 3 suggested lines for one project, the file they belong in, the evidence behind each, and "Copy" (§9.6). "See all" opens `/coach claude-md`.
6. **Could be a skill.** Phase 2, shown only when there's a candidate. The top repeated prompt and the skill it could become: a name, a template, where it would live, "Make it a skill" and "Copy template" (§9.7). "See all" opens `/coach skills`.
7. **Progress.** 6 to 12 weekly sparklines: the active habit's metric first, then cost per prompt, corrections per 10 prompts, oversized sessions, and, from phase 2, the steps Claude spent rediscovering your projects. A change of metric definitions shows as a gap.
8. **Features you've used.** Chips for the user's current level and the next one (§9.2), plus one "Up next" feature and the reason for suggesting it.
9. **Level up.** Phase 2: one or two more tips (§9.3).
10. **Also noticed.** Up to three short items, safety first (§9.4).
11. **Footer.** "Estimated at API list prices. On Pro or Max, this is what your usage would have cost on the API." The coverage dates. "Nothing in this report left your computer." Links to the settings and to how it's computed.

Glossary entries (one plain sentence each, expandable inline): token, context, cache, compaction, subagent, plan mode, effort.

### 4.4 The bar

One line above the prompt. States, shown at most one at a time:

```
●  Coach: your week in review is ready                                   /coach
Coach · this week: /clear when you switch topics                ●●○ 2 of 3
●  Coach: new topic? This session is 310k tokens deep. /clear starts fresh   (phase 3)
```

With repo-spend installed the two lines stack:

```
my-app · about $1,284 in 3 months · $12.30 today          $4.12 ▂▃▅▃▂ $6.04/h
Coach · this week: /clear when you switch topics                ●●○ 2 of 3
```

Details in §11.3.

### 4.5 Asking Claude

- coach registers a deferred tool, `mcp__coach__report`, that returns the stored weekly data, so the user can ask "why did my cost jump on Tuesday?" in any session.
- The report's "Ask Claude about this week" button fills the prompt box with a question about the week on screen, which the user can edit before sending. It never sends on its own.

### 4.6 Live hints (phase 3)

Off by default. Rate-limited short hints at the moment they apply: a big session meeting a new topic, a vague first prompt, resuming a huge session after a long break, a prompt the user has typed many times before. See §11.4.

### 4.7 Teaching Claude and saving typing (phase 2)

Two kinds of card point out repetition that a one-time change would remove. Both work offline from the logs, and neither writes anything (§3, decision 9). The examples are made up.

**Teach Claude this project** gathers what Claude rediscovers session after session, and the corrections the user keeps making, into suggested lines for `CLAUDE.md`, which Claude reads at the start of every session:

```
Teach Claude this project · my-app
Claude rediscovers these in most sessions here. Two lines in my-app/CLAUDE.md
would save it the trip:

  - Test: `pnpm test` (one file: `pnpm test <path>`)
  - Use `pnpm`, not `npm`.

  In 6 of your last 9 sessions here, Claude searched for how to run the tests
  (31 steps in all, about $2.10) and twice tried `npm test` first.

  [ Copy ]  [ Not right? ]  [ Dismiss ]
```

**Could be a skill** finds prompts typed in nearly the same words many times and suggests making each one a skill:

```
Could be a skill
You've typed this 12 times in 8 sessions over the last 4 weeks:

  Write release notes for <version> from the merged PRs, grouped by area,
  with a one-line summary at the top.

  You usually follow up with "also link each PR" (7 of 12).
  As a skill in ~/.claude/skills/release-notes/, you'd type: /release-notes 2.4

  [ Make it a skill ]  [ Copy template ]  [ Not right? ]  [ Dismiss ]
```

For `CLAUDE.md`, the user copies what's useful and makes the change themselves, or dismisses the card. For a skill, "Make it a skill" fills the prompt box with a request for Claude to create it (§11.6). The user reads the request, sends it or not, and approves the new skill file like any other edit. A later report notices when a suggestion has been taken up and checks whether it helped: "Since you added `pnpm test` to CLAUDE.md, Claude went straight to it in 5 of 5 sessions."

## 5. Architecture

```
~/.claude/projects/**/*.jsonl  (read only)
            │
            ▼
   hooks/scan.py  (python3, standard library)
   extract → metrics → rules → suggest
            │
            ├──► <data>/history.json      frozen weekly rows (durable)
            ├──► <data>/scan-cache.json   per-file facts (disposable)
            ├──► <data>/report.json       latest output (read by other sessions)
            │
            ▼  NDJSON on stdout: progress lines, then the report
   hooks/register.tsx  (hooks module)
            │
   $.state.report ──► Pane "coach-report" (/coach)
                  ──► AbovePrompt line
                  ──► mcp__coach__report tool
                  ──► prompt.submit hints (phase 3)
   $.store ─────────► the user's choices: habit log, dismissed tips, bar hidden, …
```

### 5.1 Files

```
plugins/coach/
  .claude-plugin/plugin.json   manifest, with the userConfig settings of §12.1
  README.md
  SPEC.md                      this file
  assets/                      README previews (drawn by scripts/coach-assets.py)
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           every call to the engine: hooks, $.state values, scans, grading calls, hints
  hooks/select.ts              what to show: the week, habit, tips, cards, wins, bar state (pure)
  hooks/pane.tsx               the report pane, drawn from data and action callbacks (pure)
  hooks/bar.tsx                the line above the prompt (pure)
  hooks/copy.ts                every user-facing string, glossary included
  hooks/hints.ts               which live hint applies, and the limits (pure)
  hooks/grading.ts             rubric, estimate, parsing, summary (pure)
  hooks/normalize.ts           B.12 for live hints, sharing test vectors with patterns.py
  hooks/scanner.ts             scan.py's argv and settings, and its NDJSON reader (pure)
  hooks/state.ts               the $.store keys and caps (pure)
  hooks/summary.ts             /coach in words, and the report tool's answer (pure)
  hooks/scan.py                CLI entry: arguments, lock, cache, history, report
  hooks/extract.py             one log file → facts
  hooks/metrics.py             facts → weekly rows
  hooks/rules.py               habits, features, levels, tips, notices, best prompt
  hooks/suggest.py             CLAUDE.md and skill suggestions
  hooks/patterns.py            the regex lists of Appendix B
  hooks/pricing.py             copy of shared/pricing.py
  types/index.d.ts             the $.state contract and the report's types
  tests/*.test.ts              the hooks against the engine's test kit, on terminal and desktop
  tests/test_*.py              the scanner, end to end and per module
  tests/transcripts.py         a builder for Claude Code transcripts
  tests/beginner.py            a made-up beginner's month, for both suites
  tests/make_fixtures.py       writes the TS fixtures from the Python side
  tests/fixtures/              report.ts, normalize.json and normalize.ts
```

The engine follows `$` only into functions declared at the top of the hooks module, so every engine call lives in `register.tsx` and every other TS module is plain: the drawings get the element table and callbacks for their buttons instead of `$`.

`scan.py` puts its own folder on `sys.path` before importing its siblings. It needs Python 3.9 or later and nothing outside the standard library.

### 5.2 Process and cadence

| When | What runs |
|---|---|
| `session.start` | Start a scan in the background (`void`, never awaited by the start hook). |
| Every 10 minutes while a session is open | Incremental scan. |
| `session.end` with `reason: 'clear'` | Record a live fresh start, then rescan. |
| `/coach` with data older than 2 minutes | Rescan. The pane draws the stale data meanwhile, marked "Updating…". |
| `/coach rescan` | Full rescan, ignoring the per-file cache. |

Scans run through `$.process.spawn` so progress streams in. If streaming turns out to be unsuitable, `$.process.run` with the final report on stdout is the fallback. The pattern is the same as repo-spend's.

### 5.3 Data directory

`${CLAUDE_CONFIG_DIR:-~/.claude}/coach/`, created with mode 0700; files 0600 because they hold prompt excerpts.

| File | Holds | If lost |
|---|---|---|
| `history.json` | Frozen weekly rows; `history.json.bak` keeps the previous version | Weeks whose logs are gone can't be rebuilt |
| `scan-cache.json` | Per-file facts keyed by path, size, mtime and `PARSER_VERSION` | Rebuilt by the next scan |
| `report.json` | The last full report | Rebuilt by the next scan |
| `scan.lock` | Held during a scan | None |

The user's choices live in `$.store`, which is under 4 MiB of JSON (§12.2).

### 5.4 Locking and atomic writes

- A scan takes `fcntl.flock(LOCK_EX | LOCK_NB)` on `scan.lock`.
- If another session holds the lock, the scanner polls for up to 3 seconds, then exits with code 2 after printing the existing `report.json`.
- Every write goes to a `.tmp` file followed by `os.replace`.
- Before replacing `history.json`, the current file is copied to `history.json.bak`.

## 6. Reading the logs

### 6.1 Where they are

| Path under `<config>/projects/` | What it is |
|---|---|
| `<slug>/<sessionId>.jsonl` | A session's main transcript |
| `<slug>/<sessionId>/subagents/*.jsonl` | Its subagents |
| `<slug>/<sessionId>/subagents/workflows/<runId>/*.jsonl` | Workflow agents |

- `<slug>` is the session's working directory with `/` and `.` turned into `-` (repo-spend's `slugOf`).
- A worktree's slug is `<repo slug>--claude-worktrees-<name>`. coach strips that suffix, so a worktree counts as its repo.
- The project's display name is the last segment of the first `cwd` found in its records.
- Claude Code deletes logs after `cleanupPeriodDays`, 30 days by default.

### 6.2 Records used

Every field below has been seen in the author's logs. Those logs all come from the desktop app (`entrypoint: "claude-desktop"`), so terminal logs must be sampled in phase 0.

| Record `type` | Fields read | For |
|---|---|---|
| `user` | `origin.kind`, `message.content`, `isMeta`, `isSidechain`, `isCompactSummary`, `isVisibleInTranscriptOnly`, `permissionMode`, `timestamp`, `cwd`, `entrypoint`, `version`, `imagePasteIds`, `toolDenialKind`, `permissionDecision`, `uuid`, `parentUuid` | Prompts, modes, rejections, approvals, tool results |
| `assistant` | `message.id`, `message.model`, `message.usage` (including `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` and `speed`), `message.content[]` `tool_use` blocks, `effort`, `perTurnEffort`, `isApiErrorMessage`, `apiErrorStatus`, `attributionSkill`, `attributionPlugin`, `attributionMcpServer`, `requestId`, `timestamp` | Cost, context size, tools, effort, errors, features |
| `system` | `subtype` among `compact_boundary`, `api_error`, `local_command`, `stop_hook_summary` | Compactions, errors, hooks in use |
| `cost-state` | `totalCostUSD` | Claude Code's own per-session total, used to scale estimates as repo-spend does |
| `custom-title` | `customTitle` | Session names in evidence |

Every other record type is ignored, including `attachment`, `queue-operation`, `last-prompt` and `mode`.

Values seen so far:

- **`toolDenialKind`:** `user-rejected`, `automode-blocked`, `automode-unavailable`.
- **`permissionDecision.source`:** `config` (with `reasonType` `mode` or `classifier`) and `user_temporary`.
- **`effort`:** `max`, `high`, `medium`.
- **`origin.kind`:** `human`, `task-notification`.

### 6.3 Human prompts

A `user` record is a human prompt when all of these hold:

1. None of `isSidechain`, `isMeta`, `isCompactSummary`, `isVisibleInTranscriptOnly` is true.
2. If `origin` is present, `origin.kind == "human"`. Records from older versions have no `origin`; for those, rules 3 and 4 decide.
3. The content is a string, or a list with at least one `text` block and no `tool_result` block.
4. The text does not start with a machine marker (Appendix B.1).

Records that start with `<command-name>/name</command-name>`, or with a `<…-command>` wrapper (the desktop app's `<create-pr-command>`), are **command requests**:

- They count toward cost and request metrics, but not toward prompt-craft checks.
- The command name feeds the feature detectors.

A list's text blocks are joined with newlines. Images are counted from `image` blocks or from `imagePasteIds`.

### 6.4 Requests

A request is what the user sees as "one prompt": the human prompt or command, plus everything that follows it in the same main transcript until the next prompt or command.

- **Order:** file order, which is append order. Timestamps can tie, so they aren't used for ordering.
- **Background turns:** a turn started by a task notification (`origin.kind == "task-notification"`) is not a request. Its cost goes into a per-session background bucket, which counts toward totals but not per-prompt metrics.
- **What's stored:** the per-file cache keeps facts about each request, never the full prompt text:

```ts
type RequestFacts = {
  id: string                  // `${sessionId}:${uuid}`
  session: string
  project: string
  index: number               // 0 for the session's first request
  kind: 'prompt' | 'command'
  command?: string            // '/model', '/clear', 'create-pr', …
  startedAt: number           // epoch ms
  endedAt: number             // time of the last record before the next request
  words: number
  chars: number
  flags: PromptFlags          // §10.1, computed from the text, which is then dropped
  excerpt?: string            // ≤ 200 chars, scrubbed (§13); only when storeExcerpts is on
  calls: number               // deduplicated model calls in the main transcript
  subagentCalls: number
  usd: number                 // main + subagents, ledger-scaled (§6.5)
  inputUsd: number
  outputUsd: number
  contextStart: number        // context tokens of the first call
  contextMax: number
  contextAtFirstEdit?: number
  tools: Record<string, number>  // tool_use counts by name
  searchStepsBeforeEdit: number  // Grep/Glob/Read/LS-like Bash calls before the first edit
  areas: string[]             // first two path segments, relative to the project, of files read or edited
  filesEdited: number         // distinct paths edited successfully
  checkedAfterEdit: boolean   // a check command (B.4) ran after the last edit
  committed: boolean          // a `git commit` Bash call returned without error
  interrupted: boolean        // B.1 interrupt marker inside the request
  rejections: number          // toolDenialKind == 'user-rejected'
  classifierBlocks: number    // toolDenialKind == 'automode-blocked'
  approvals: { key: string; n: number }[]  // permissionDecision.source starts with 'user'; key = tool + command prefix
  planMode: boolean           // prompt's permissionMode == 'plan', or an ExitPlanMode tool use
  permissionMode?: string
  apiErrors: number
  models: Record<string, number>  // usd by model
  effort?: string             // most common effort value across calls
  fastUsd: number
  rewarmUsd: number           // §7.1
  compacted: boolean          // a compact_boundary fell inside the request
  // Phase 2, for §9.6 and §9.7
  checkRuns: CheckRun[]       // Bash calls of the kinds in B.8; command normalized and scrubbed
  discovery: Discovery[]      // §9.6 S1 episodes that started in this request
  substitutions: Substitution[]  // §9.6 S2; command words only, never arguments
  clauses: Clause[]           // §9.6 S4–S6; only with storeExcerpts
  shape?: PromptShape         // §9.7; prompts of 4 words or more
  invoked?: string            // the command or skill this request ran (`<command-name>`, the Skill tool, attributionSkill)
}

type Task = 'test' | 'build' | 'lint' | 'typecheck' | 'format' | 'dev' | 'install'
type CheckRun = { task: Task; command: string; dir: string; ok: boolean; hadPathArg: boolean }
type Discovery = { task: Task; steps: number; failed: number; tokens: number; outcome: 'found' | 'gave-up'; command?: string }
type Substitution = { from: string; to: string; kind: 'replace' | 'prefix'; failure: 'missing-binary' | 'wrong-package-manager' | 'missing-script' | 'missing-module' | 'wrong-version' }
type Clause = { kind: 'correction' | 'instruction' | 'preference'; text: string }  // ≤ 120 chars, scrubbed
type PromptShape = {
  opener: string              // first 6 normalized words (B.12)
  grams: number[]             // hashed word 3-grams of the first 60 normalized words
  rare: number[]              // hashed rarer words, for candidate pairs
  template?: string           // normalized text, ≤ 400 chars; only with storeExcerpts
}
```

Tool results are matched to their `tool_use` by `tool_use_id`. The result's `is_error`, its `toolDenialKind` and its `permissionDecision` give the outcome of each call.

- **Failed commands:** desktop logs mark a failed Bash call with `is_error: true`. The author's logs hold 220 of them, 196 of which also say `Exit code N` in the text; terminal logs are checked in phase 0.
- **Failed command output** is matched against B.10 in memory, and only the category is kept.

### 6.5 Model calls and cost

- **Deduplication:** assistant records are deduplicated by `message.id`, falling back to `requestId` and then `uuid`. Claude Code writes one line per content block; coach keeps the last line's usage, as repo-spend does, and collects `tool_use` blocks from every line.
- **Pricing:** each call is priced with the shared `pricing.py` (`message_cost`: per-model prices, 5-minute and 1-hour cache writes, fast mode ×2).
  - **Input cost:** `input × p_in + cache_read × p_read + writes × p_write`.
  - **Output cost:** `output × p_out`.
- **Context tokens of a call:** `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- **Ledger scaling:** when a session has a `cost-state` record, every call's cost in that session is scaled by `ledger / estimate`, so weekly totals agree with Claude Code's own `/cost`. Input and output keep their proportions.
- **Unpriced and error records:**
  - A model missing from the price table costs 0 and is listed in `unpriced`, and the footer then says the total is a floor.
  - `<synthetic>` records are API error placeholders, counted as errors and never as calls.

### 6.6 Subagents

- Calls in subagent and workflow files are priced the same way.
- Each call is attributed to the parent session's request whose window `[startedAt, next request's startedAt)` contains its timestamp. If no window contains it, for example a background agent finishing after the last prompt, the session's last request gets it.
- Their tool uses count in `subagentCalls`, not in the request's own tool counts. They don't fill the main context, so they don't count toward the search-steps signal either.

### 6.7 Session facts

```ts
type SessionFacts = {
  id: string; project: string; title: string   // custom-title's last value, else the first prompt's excerpt, else "Untitled session"
  startedAt: number; endedAt: number
  entrypoint?: string; versions: string[]
  contextMaxAtEnd: number
  compactions: { auto: number; manual: number; unknown: number }
  permissionModes: string[]
  ledger?: number
  backgroundUsd: number
  root: string                // the nearest folder above cwd holding .git, worktree paths folded into their repo
  orientation: { path: string; tokens: number }[]  // phase 2: §9.6 S3 reads, after its exclusions; tokens ≈ result length / 4
}
```

### 6.8 Format drift

- Any change to extraction bumps `PARSER_VERSION`, which invalidates the per-file cache.
- Unknown record types are ignored.
- A missing field makes the fact unknown (`null`), never guessed. A detector that depends on a field it can't find stays silent.
- Each weekly row records the Claude Code `version` values it saw, so a jump in a metric can be checked against a format change.
- `tests/fixtures/` keeps one small transcript per log shape seen: desktop 2.1.x now, terminal from phase 0, plus an older shape without `origin`.

## 7. Metrics

All metrics are per week (§8.1). In the interface "prompt" means request: what the user typed, plus everything Claude did until the next prompt. Any per-10-prompts rate is hidden in a week with fewer than 10 prompts, with "Not enough prompts this week".

### 7.1 Cost and volume

| Metric | Definition |
|---|---|
| `sessions` | Main transcripts with at least one request this week |
| `prompts`, `commands` | Requests by kind |
| `activeDays` | Days with at least one request |
| `usd` | Sum of call costs timestamped in the week: main, subagents and background turns, ledger-scaled |
| `inputUsd`, `outputUsd` | `usd` split by §6.5 |
| `usdByModel`, `usdByProject` | Top 5, plus "other" |
| `costPerPrompt` | Median and 90th percentile of request `usd` |
| `callsPerPrompt` | Median of request `calls` |
| `contextPerCall` | Median and 90th percentile of context tokens per main-transcript call |
| `cacheHitRate` | `cache_read / (cache_read + cache_creation + input)` over all calls |
| `rewarm` | Cache re-warms: calls whose cache write is ≥ 20,000 tokens and whose gap since the session's previous call is longer than the cache TTL. The TTL is 1 hour when the previous call's write was `ephemeral_1h`, else 5 minutes. `usd` = write cost − what reading the same tokens from cache would have cost. |
| `fast` | Cost of calls with `speed == "fast"`; the premium is half of it |
| `effortShare` | Share of calls by `effort` value |

### 7.2 Sessions and context

| Metric | Definition |
|---|---|
| `oversizedSessions` | Sessions whose largest context reached `contextThresholdK` thousand tokens (default 300) |
| `compactions` | `compact_boundary` records; split into auto and manual when the record says which (to verify in phase 0) |
| `topicSwitches.fresh`, `.stale` | Habit H1 in §9.1 |

### 7.3 Working together

| Metric | Definition |
|---|---|
| `interrupts` | Requests holding an interrupt marker (B.1), per 10 prompts |
| `rejections` | `user-rejected` denials, per 10 prompts |
| `classifierBlocks` | `automode-blocked` denials (information only; not the user's doing) |
| `corrections` | Requests whose next prompt in the same session, within 30 minutes, starts with a correction cue (B.2), per 10 prompts. Counted on the corrected request. |
| `approvals` | User approvals (`permissionDecision.source` starting with `user`), grouped by tool and command prefix |
| `apiErrors` | API error records |
| `endedBadly` | Sessions whose last request was interrupted or ended in an API error |

### 7.4 Work and checks

| Metric | Definition |
|---|---|
| `codePrompts` | Requests that edited at least one file successfully |
| `checked` | Code prompts where a check command (B.4) ran after the last edit |
| `commits` | Requests with a successful `git commit` |
| `bigChanges` | Requests that edited ≥ 8 distinct files, or edited at least one and cost ≥ $3 or made ≥ 40 calls |
| `bigChangesPlanned` | Big changes with `planMode` |

### 7.5 Prompt craft (deterministic)

| Metric | Definition |
|---|---|
| `openingPrompts` | A session's first prompt, the first after `/clear`, or a stale topic switch (§9.1) |
| `namesPlace` | Share of opening prompts that point at a file, folder, symbol or @mention (B.3) |
| `saysDone` | Share of opening prompts that say what done looks like (B.3) |
| `vague` | Opening prompts that are short and vague (B.3) |
| `bigPastes` | Prompts over 4,000 characters where at least half the lines look like logs or stack traces (B.3) |
| `medianWords` | Over all prompts; shown for information only, never scored |
| `images` | Prompts carrying an image |

### 7.6 Safety

| Metric | Definition |
|---|---|
| `bypassSessions` | Sessions with any prompt in `bypassPermissions` mode |

### 7.7 Rediscovery and repetition (phase 2)

| Metric | Definition |
|---|---|
| `discoveryEpisodes`, `discoverySteps` | §9.6 S1 episodes that started this week, and their steps |
| `wrongToolFirst` | §9.6 S2 pairs this week |
| `repeatedCorrections` | Correction clauses this week that belong to a qualifying S4 cluster |
| `repeatedPrompts`, `promptClusters` | Prompts this week in a qualifying §9.7 cluster, and the number of such clusters |

## 8. Weekly history

### 8.1 Weeks

- A week runs from Monday 00:00 to the next Monday 00:00 in the machine's local time zone. Setting `weekStartsOn` can make it Sunday.
- A week's id is its start date, `YYYY-MM-DD`. ISO week numbers are avoided because they break with a Sunday start.
- Request metrics belong to the week in which the request started.
- Cost belongs to each call's own timestamp. Totals add up exactly, even for a request that spans midnight on Sunday.
- Tests run with `TZ` set: `Asia/Kolkata`, and `America/Los_Angeles` across a daylight-saving change.

### 8.2 Row

```ts
type WeekRow = {
  week: string                 // '2026-10-05'
  start: number; end: number   // epoch ms, local boundaries
  frozen: boolean
  metricsVersion: number
  coverage: { partial: boolean; firstLogAt: number | null }
  versionsSeen: string[]       // Claude Code versions in this week's records
  volume: { sessions: number; prompts: number; commands: number; activeDays: number }
  cost: {
    usd: number; inputUsd: number; outputUsd: number
    byModel: Record<string, number>; byProject: Record<string, number>
    unpriced: string[]
    perPrompt: { median: number; p90: number }
    fastUsd: number; rewarmUsd: number; rewarmEvents: number
  }
  usage: { callsPerPrompt: number; contextPerCall: { median: number; p90: number }; cacheHitRate: number; effortShare: Record<string, number> }
  context: { oversizedSessions: number; compactions: { auto: number; manual: number; unknown: number }; fresh: number; stale: number }
  together: { interrupts: number; rejections: number; classifierBlocks: number; corrections: number; apiErrors: number; endedBadly: number }
  work: { codePrompts: number; checked: number; commits: number; bigChanges: number; bigChangesPlanned: number }
  prompts: { opening: number; namesPlace: number; saysDone: number; vague: number; bigPastes: number; images: number; medianWords: number }
  features: Record<FeatureId, number>      // uses this week (§9.2)
  safety: { bypassSessions: number }
  memory: { discoveryEpisodes: number; discoverySteps: number; wrongToolFirst: number; repeatedCorrections: number }  // phase 2, §7.7
  repeats: { prompts: number; clusters: number }                                                                  // phase 2, §7.7
  habits: Record<HabitId, HabitWeek>       // §9.1: value, sample, impactUsd, evidence
  tips: TipCandidate[]                     // §9.3: candidates, before the user's choices are applied
  notices: Notice[]                        // §9.4
  evidence: Record<string, Evidence>       // keyed by evidence id; §9.5
  sessionIds: string[]                     // for recompute checks (§8.3)
}
```

A row is 5–15 KB with evidence attached, which comes to under 1 MB a year.

### 8.3 Freezing and versions

- **When a row freezes:** once `now ≥ end + 6 h` and a scan has run after `end`, so every file written during the week has been seen. A frozen row is copied into `history.json` and never recomputed by routine scans.
- **When metric definitions change:** a change bumps `METRICS_VERSION`.
  - On the next scan, every frozen row whose `sessionIds` all still have their main transcript on disk is recomputed.
  - The rest keep their old version. Trend charts break the line between rows of different versions instead of joining them.
- **Partial weeks:** the first week of coverage is `partial` when the oldest log starts after the week's start. It is labelled "partial" and left out of change-against-average comparisons.

### 8.4 Retention

- Frozen rows are kept indefinitely.
- Evidence excerpts in rows older than 12 weeks are dropped; counts are kept. This limits how much prompt text stays on disk.
- `scan-cache.json` drops entries for deleted files once every week they touch is frozen.

## 9. Coaching logic

The detectors and their numbers live in `rules.py`. The final choice, which also applies the user's dismissals and the habit log from `$.store`, lives in `select.ts`. Both are pure functions with fixture tests.

### 9.1 Habits

| Id | Title in the report | Metric (this week) | Target | Min sample | Impact in $ | Evidence picked | Try this |
|---|---|---|---|---|---|---|---|
| H1 `fresh-start` | Start fresh when you switch topics | `fresh / (fresh + stale)` | ≥ 0.7 | 3 switches | Carried context cost of the stale switches | The stale switch with the highest carried cost | Type `/clear` or start a new session when you move to something unrelated. |
| H2 `point-to-place` | Point Claude at the right place | Opening prompts on file work with `namesPlace` | ≥ 0.5 | 5 | Search steps before the first edit × average call cost | The opening prompt without a place that had the most search steps ("Claude took 14 steps to find the file") | Name the file or folder, or type `@` to mention it. |
| H3 `say-done` | Say what done looks like | Opening prompts with `saysDone` | ≥ 0.4 | 5 | Cost of requests corrected twice or more whose opening had no criteria | The one with the most corrections | End with "Done when…": tests pass, the page shows X, the command prints Y. |
| H4 `check-work` | Ask Claude to check its work | `checked / codePrompts` | ≥ 0.6 | 5 | Cost of corrections that followed unchecked edits | An unchecked edit followed by "it doesn't work"-style feedback | Ask "run the tests before you finish", or put it in `CLAUDE.md`. |
| H5 `plan-big` | Plan big changes first | `bigChangesPlanned / bigChanges` | ≥ 0.5 | 2 | Cost of unplanned big changes that were corrected | The biggest unplanned change | Press shift+tab to switch to plan mode before a change across many files. |

**H1 in detail.**

- **Stale switch:** a request that isn't a session's first, with `contextStart ≥ 100k`, no continuation cue at its start (B.2), and either of:
  - (a) at least 45 minutes since the previous request ended, or
  - (b) its `areas` and the previous 3 requests' areas are both non-empty and share nothing.
- **Fresh switch:** a session (or `/clear`) whose first request starts within 4 hours of the end of the user's previous request in the same project, when that earlier session ended with at least 100k tokens of context.
- **Carried context cost:** for each call from the switch to the end of that session, `contextStart(switch) × that call's cache-read price`.

**Choosing the habit** (`select.ts`):

1. **Eligible:** the minimum sample was met in the last full week and the metric is below target.
2. **Ranked:** by impact in dollars.
3. **Sticky:** the active habit stays for at least 2 weeks. It changes earlier only when the user presses "Pick another habit", or when it has no sample 2 weeks in a row.
4. **Learned:** meeting the target 2 weeks in a row marks the habit learned. The next report celebrates it once ("You've got this one: starting fresh between topics"), and it isn't picked again for 8 weeks.
5. **Nothing eligible:** the report says "Nothing to fix this week" and promotes the best tip into the habit slot.
6. **Log:** every week's choice and outcome go into `$.store.habitLog`.

**Bar progress text:**

| Habit | Example |
|---|---|
| H1 | "2 of 3 switches" |
| H2 | "4 of 7 first prompts" |
| H3 | "2 of 6 first prompts" |
| H4 | "5 of 8 changes checked" |
| H5 | "1 of 2 big changes" |

### 9.2 Features and levels

Each feature counts as adopted the first time it is seen, and stays adopted.

| Id | Level | Name in the report | Detected when |
|---|---|---|---|
| `claude-md` | 1 | `CLAUDE.md` | `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists at the root of a project used in the last 4 weeks, or `~/.claude/CLAUDE.md` exists |
| `at-mention` | 1 | @ mentions | A prompt mentions a path with `@` (B.3) |
| `image` | 1 | Screenshots | A prompt carries an image |
| `interrupt` | 1 | Stopping Claude with Esc | An interrupt marker |
| `fresh-start` | 1 | A fresh session per topic | `/clear` used, or H1 met its target in some week |
| `ask-checks` | 1 | Asking for checks | A prompt asks for tests or a build (B.4 words), or H4 met its target |
| `plan-mode` | 2 | Plan mode | `permissionMode == "plan"` on a prompt, or an `ExitPlanMode` tool use |
| `rewind` | 2 | Rewind | `/rewind` used; whether double Esc leaves a trace is a phase-0 question |
| `model-choice` | 2 | Choosing the model | `/model` used, or 2 model families in one week |
| `subagents` | 2 | Subagents | An `Agent` or `Task` tool use |
| `commands-skills` | 2 | Your own commands and skills | A slash command that isn't built in, a `Skill` tool use, or `attributionSkill` |
| `mcp` | 2 | Connectors (MCP) | A tool use whose name starts with `mcp__` |
| `allow-rules` | 2 | Allow rules | A settings file has `permissions.allow` entries |
| `compact` | 2 | `/compact` | `/compact` used |
| `hooks` | 3 | Hooks | `stop_hook_summary` records, or `hooks` in a settings file |
| `parallel` | 3 | Parallel sessions | Requests from two sessions within the same 10 minutes |
| `worktrees` | 3 | Worktrees | A worktree slug or a `cwd` under `.claude/worktrees/` |
| `headless` | 3 | Scripting with `claude -p` | A headless `entrypoint` (value to confirm in phase 0) |
| `automation` | 3 | Scheduled and looping tasks | `/loop` or `/schedule` used, or a `CronCreate` or scheduled-task tool use |
| `plugins` | 3 | Plugins and mods | `attributionPlugin`, or a plugin's command |
| `workflows` | 3 | Multi-agent workflows | A `Workflow` tool use, or a `subagents/workflows/` folder |

- **Settings files read:** `~/.claude/settings.json`, plus `.claude/settings.json` and `.claude/settings.local.json` in each project root. coach reads only whether `permissions.allow`, `hooks` and `outputStyle` exist and how long they are; it never stores their values.
- **The user's level:** the highest L such that at least 60% of every level up to L is adopted. Below 60% of level 1, the level is 0.
- **Up next:** the first unadopted feature of the next level that has evidence this week (plan mode after a big change, say). Failing that, the first unadopted feature in table order.

### 9.3 Tips (phase 2)

A tip shows when its trigger fires in the last full week, or in the last 4 weeks where the table says so. Ids and wording are for review.

| Id | Level | Category | Shows when | Estimate | Try this | Retired when |
|---|---|---|---|---|---|---|
| `rewarm-after-break` | 2 | Cost | `rewarmEvents ≥ 2` and `rewarmUsd ≥ $2` | 90% of `rewarmUsd` | Before a long break on a big session, ask for a short handoff summary and start the next session from it. | `rewarmUsd < $1` for 2 weeks |
| `newer-model` | 1 | Cost | ≥ 30% of cost on a model with a newer, cheaper model of the same family (`pricing.SUCCESSOR`) | Cost × (1 − new price / old price), blended input and output | Switch with `/model`. | Share under 10% for 2 weeks |
| `smaller-model` | 2 | Cost | ≥ 10 small requests (≤ 1,500 output tokens, ≤ 3 tool calls, no edits) on an Opus or Fable model | The difference at Sonnet prices | Try Sonnet for quick questions. | Under half of small requests on the top tier |
| `effort-match` | 2 | Cost | ≥ 70% of calls at `max` effort and ≥ 10 small requests | Small requests' output above the user's own high-effort median × output price | Use a lower effort level for routine work. | `max` share under 50% |
| `fast-premium` | 2 | Cost | Fast-mode premium ≥ $5 | The premium | Keep fast mode for when you're waiting on it; `/fast` toggles it. | Premium under $1 |
| `claude-md-too-long` | 2 | Setup | The `CLAUDE.md` files Claude loads for a project come to over 300 lines or about 5k tokens | Their tokens × calls a week × cache-read price | Trim it: Claude reads all of it in every session. Keep what it can't work out by itself. | Back under the limit |
| `approvals-to-allowlist` | 2 | Flow | ≥ 10 approvals of one tool and command prefix in a week | The count | Run the `/fewer-permission-prompts` skill, or add an allow rule. | That prefix under 3 a week |
| `bypass-to-auto` | 1 | Safety | Any `bypassSessions` | — | Use auto mode or allow rules instead of turning checks off. | No bypass sessions for 2 weeks |
| `undo-with-rewind` | 1 | Flow | ≥ 2 undo cues (B.2) in a week and `rewind` not adopted | — | `/rewind` (or Esc twice) goes back to an earlier point, code included. | `rewind` adopted |
| `screenshot-for-ui` | 1 | Prompt | ≥ 2 interface requests (B.7) with corrections and no image | — | Paste a screenshot of what looks wrong. | An image used in an interface request |
| `explore-with-subagent` | 2 | Context | ≥ 3 requests whose context grew ≥ 100k before the first edit | The growth | Ask Claude to explore with a subagent so the main session stays small. | Subagents used in such requests |
| `compaction-pressure` | 2 | Context | ≥ 2 automatic compactions in a week | — | Use `/clear` between topics, or `/compact` with a note on what to keep. | Under 1 a week for 2 weeks |
| `polling-to-loop` | 3 | Automation | ≥ 3 polling cues (B.2) in one session | — | Ask Claude to keep watching it (`/loop` or a background check). | `/loop` or a monitor used |
| `parallel-worktrees` | 3 | Flow | ≥ 5 requests of 10 minutes or longer, and no parallel sessions | — | While a long task runs, start a second session in a worktree. | `parallel` adopted |

**Eligibility.**

- A tip shows when its level ≤ the user's level + 1.
- Safety tips (`bypass-to-auto`) ignore levels.
- A tip never repeats the active habit's advice: each tip lists the habits it conflicts with, for example `compaction-pressure` conflicts with H1.
- `CLAUDE.md` lines and skills are tips too, with richer cards and detectors of their own (§9.6, §9.7). They join this pool as families `claude-md` (level 1) and `skill` (level 2). The best card of each family gets its own report section (§4.3); the rest compete here.

**Ranking.**

- `score = impact × confidence`.
- **Impact, cost tips:** `min(1, weekly saving / max($5, 10% of weekly spend))`.
- **Impact, other tips:** `0.5 × min(1, evidence count / threshold)`.
- **Confidence:** a fixed value per tip in the catalogue: 1.0, 0.7 or 0.5, according to the detector's measured precision (§15.3).
- **Selection:** the top two tips with `score ≥ 0.3`, from different categories.

**The user's controls.**

- **Dismiss:** hides a tip for good. It can be reset in settings.
- **Snooze:** a tip shown in two reports in a row with no change in its trigger is hidden for 4 weeks.

### 9.4 Also noticed

There are at most three items a week, in this order:

1. **`bypass`:** "You ran 3 sessions with permission checks turned off. Claude could run any command without asking."
2. **`cost-spike`:** a day costing at least 3× the median active day, and at least $5. "Tuesday cost $14.20, 4 times a usual day. Most of it was 'Fix login refresh'."
3. **`api-errors`:** 5 or more API errors in a week. "Claude Code hit 7 API errors this week, mostly 529 (overloaded). That's on the service's side, not yours."
4. **`unpriced`:** "Some usage is on models coach has no price for, so the total is a floor."

### 9.5 Evidence

Every habit, tip and notice carries at least one evidence item:

```ts
type Evidence = {
  id: string                  // stable: detector + request id
  detector: string
  session: string; project: string; title: string
  at: number                  // when the request started
  excerpt?: string            // ≤ 200 chars, scrubbed; absent when storeExcerpts is off
  usd?: number
  numbers: Record<string, number>   // the figures the sentence quotes
}
```

- **"See the session":** opens a detail view in the pane with:
  - the session's title, date and project
  - the excerpt
  - the figures behind the finding
  - "Copy resume command" (`cd <project> && claude --resume <id>` via `$.ui.copy`). Where copying fails (`isCopied: false`, as on remote surfaces today), the command is shown as text to select.
- **"Not right?":**
  - It records `{ detector, evidenceId }` in `$.store.notRight`, hides that item, and lets the next-best item take its place.
  - After 3 such flags on one detector within 4 weeks, coach turns that detector off for this user and says so in settings.
  - Nothing about it leaves the machine.

### 9.6 CLAUDE.md suggestions (phase 2)

Claude reads `CLAUDE.md` at the start of every session. Anything it has to rediscover each time, and anything the user keeps correcting, belongs there. coach finds both in the logs and suggests lines, each with its evidence and the file it belongs in. It never writes the file and never asks Claude to (§3, decision 9). The user decides what to add.

**Sources.** Each source looks at the last 28 days, per project:

| Source | What counts | Qualifies when | Suggested line |
|---|---|---|---|
| S1 How to run things | Discovery episodes (below) for a task: test, build, lint, typecheck, format, dev server, install (B.8) | Episodes in ≥ 3 sessions, and ≥ 60% of the found ones end with the same normalized command | "- Test: `pnpm test`", plus "(one file: `pnpm test <path>`)" when at least half the successful runs passed a path. A `cd` prefix names the folder: "- Test (apps/web): `cd apps/web && pnpm test`" |
| S2 Wrong tool first | A failed Bash call whose output matches a B.10 failure, followed within 3 Bash calls by a successful one that swaps or prefixes the command word (B.10) | The same pair in ≥ 2 sessions | "- Use `pnpm`, not `npm`." · "- Use `python3`; `python` isn't available here." · "- Run Python tools through `uv run` (for example `uv run pytest`)." |
| S3 Files read first | Orientation reads: files Claude reads in a session's first 10 tool calls, before its first edit, that the first prompt didn't name and the session didn't edit | The same file in ≥ 40% of the project's sessions with file work, and in ≥ 3 sessions | No line text, since coach doesn't know what the files say. The card names the files and suggests a line on what each one is for. |
| S4 Repeated corrections | Correction clauses (B.11) | One cluster with clauses from ≥ 2 sessions | The clause, cleaned by B.11: "no, use pnpm" → "- Use pnpm." |
| S5 Repeated instructions | Instruction and fact clauses (B.6) | One cluster from ≥ 3 sessions | The clause, cleaned: "the API lives in services/api" → "- The API lives in `services/api`." |
| S6 Reply preferences | Form-feedback clauses (B.6), in any project | One cluster from ≥ 3 sessions | The clause, cleaned, for `~/.claude/CLAUDE.md`: "- Keep answers short; skip the closing summary." |

**Discovery episodes (S1).**

- **Start:** the first exploration step (B.9) in a session toward a task that hasn't yet succeeded in that session. A user prompt asking how to do the task (B.9) starts one too.
- **End:** the first successful run of that task (B.8) within 30 calls, `found`; otherwise `gave-up`.
- **Steps:** exploration steps plus failed attempts at the task. An episode with fewer than 2 steps and no failed attempt doesn't count: Claude went straight to it.
- **Command:** normalized by B.8, which drops path and test-name arguments and output plumbing (`2>&1`, `| tail`) and keeps the runner, the script, and any `cd` or environment prefix.
- **Mostly gave up:** when most of a task's episodes ended `gave-up`, there's no command to suggest. The card says so instead: "Claude often couldn't find how to run the tests here. Once you know the command, a line in CLAUDE.md would save it the search."

**Wrong tool first (S2).**

- `cd … &&`, `export …;` and environment assignments are stripped first, and an absolute path to a binary counts as its name.
- A pair then needs one of:
  - both command words in the same role (B.10: package managers, Python interpreters, and so on)
  - an error naming the missing command, plus at least 50% of the arguments in common
- Appendix C shows why looser rules don't work.

**Clusters (S4–S6).**

- **Clauses:** extracted at scan time by B.11: one sentence each, cue words stripped, at most 120 characters, scrubbed. They're kept only while `storeExcerpts` is on. With it off, S4–S6 are off, and the settings row says so.
- **Similarity:** clauses are similar when either holds:
  - Jaccard over content words of at least 0.6 (stopwords dropped, lowercased, a trailing "s" dropped)
  - a shared rare term (a command, path or name found in at most 3 clusters) with Jaccard of at least 0.4

  Clustering is single-link.
- **Wording:** the line uses the cluster's shortest clause.

**Which file the card names.** Each line says where it belongs; where it actually goes is the user's call.

| Kind | Suggested file |
|---|---|
| S1; S2 for project tools; S3; S4 or S5 in one project | That project's `CLAUDE.md` |
| S2 machine facts seen in ≥ 2 projects (`python` → `python3`); S4 or S5 clusters spanning ≥ 2 projects; S6 | `~/.claude/CLAUDE.md` |

**Already covered.**

- **What's checked:** before suggesting a line, the scanner reads the `CLAUDE.md` files Claude would load for that project:
  - the project's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`
  - those in parent folders
  - `~/.claude/CLAUDE.md`
  - files they import with `@path`, one level deep

  The contents are used for this check only and never stored. The read is cached by file mtime.
- **When a line counts as covered:**
  - S1: its normalized command appears
  - S2: both command words appear in one line
  - S3: the file's path appears
  - S4–S6: some line shares at least 60% of the clause's content words
- **Covered lines aren't suggested.** A covered S4 cluster that keeps growing becomes a note instead: "CLAUDE.md already says to use pnpm, yet you corrected Claude about it 3 times this month. A more specific line might help."
- **No `CLAUDE.md` yet:** the card starts "This project has no CLAUDE.md yet. Start one with these lines, or run /init to have Claude write a fuller one."

**Limits.** Every line in `CLAUDE.md` is read in every session, so:

- at most 10 suggested lines per project at a time, each at most 120 characters
- when the files Claude loads for a project already exceed 300 lines or about 5k tokens, the card offers the `claude-md-too-long` tip (§9.3) instead of more lines

**Ranking.** Each project's open lines form one candidate in the tip pool (family `claude-md`, level 1).

- **Impact, in dollars a week:** the sum of
  - (discovery steps + failed attempts) × the project's average call cost
  - the carried cost of orientation reads, computed as for H1
  - the cost of requests the user corrected (S4)
- **Sources with no cost** (S5, S6) add `0.5 × min(1, sessions / 4)`.
- **Display:** the report draws the top project's card in "Teach Claude this project" (§4.3); `/coach claude-md` lists every project's cards.

**Did it help.**

- **When it starts:** when a suggestion's coverage check first passes, coach records `adoptedAt` and a baseline in `$.store.adoptions`.
- **What's compared:** for the next 4 weeks, the source's rate before and after: episodes per session for S1, pairs for S2, corrections for S4.
- **What the report says:** it reports the result once: "Since you added `pnpm test` to CLAUDE.md, Claude went straight to it in 5 of 5 sessions." If the rate doesn't fall, it says that too, without blame.

### 9.7 Skill suggestions (phase 2)

A prompt typed in nearly the same words again and again is a skill waiting to be made: the user would type `/release-notes 2.4`, and the skill would hold the steps they kept re-typing. coach suggests the skill, with a name, a template and where it would live. Its "Make it a skill" button fills the prompt box with a request for Claude to create it (§11.6); coach never creates it itself (§3, decisions 9 and 10).

**Candidates.**

- Prompts (kind `prompt`) of at least 4 words from the last 28 days, after the B.5 exclusions.
- Big pastes are left out. So are prompts whose clauses are corrections or form feedback: those belong to §9.6.

**Near-identical.**

- **Normalized** by B.12: variable parts (paths, URLs, numbers, versions, issue keys, quoted text) become slots, and the first 60 words are kept.
- **Candidate pairs** come from an inverted index over each prompt's rarer words (those in at most 5% of prompts) and over its first 3 normalized words.
- **A pair is near-identical** when Jaccard over word 3-grams is at least 0.5, or when the first 6 normalized words match and Jaccard is at least 0.35.
- **Clusters** are single-link. One qualifies with at least 4 prompts from at least 3 sessions. The same prompt repeated within one session is a correction, not a template.

**Template.**

- **Base:** the cluster's medoid, the prompt most similar to the rest.
- **Slots:** words of the medoid found in under 60% of the members become slots, and neighbouring slots merge into one `<…>`. Slots from normalization keep their names (`<version>`, `<path>`, `<url>`).
- **Name:** the template's two most distinctive words by tf-idf against all prompts, joined with `-` (`release-notes`). A clash with an existing command, skill or built-in gets a suffix.
- **Suggested location**, shown on the card:
  - one project: that project's `.claude/skills/<name>/`
  - two or more projects: `~/.claude/skills/<name>/`
- **Stored:** at most 400 characters, normalized so the slot contents are gone, and only while `storeExcerpts` is on.
- **With `storeExcerpts` off:** the card shows the counts only: "You've typed a similar prompt 12 times. It could be a skill. Turn on prompt excerpts in settings to see it."

**Follow-ups.**

- For each member, the next prompt in the same session within 30 minutes is its follow-up.
- Follow-ups are clustered the same way. One present after at least 40% of the members becomes a suggested extra step ("also link each PR", 7 of 12).
- The share of members followed by a correction is shown too, since a skill that already holds what the user always adds should reduce it.

**Already have one.**

- **What's read:** the scanner reads local skill and command definitions, names and bodies, for this check only and never stored:
  - `.claude/skills/*/SKILL.md` and `.claude/commands/*.md` in each project
  - the same under `~/.claude/`
- **What counts as a match:** the template's content words overlap a definition's body by at least 50%, or the names match. Plugin commands are matched by name only, from the commands seen in the logs.
- **A match turns the card into a reminder:** "You already have /release-notes for this, but typed it out by hand 6 times since you made it." "Since" is the definition file's mtime.

**Ranking.**

- **Level:** family `skill`, level 2. Level-1 users see it too, under the +1 rule (§9.3).
- **Impact:** `min(1, typed per week / 3) × (0.6 + 0.4 × share followed by a follow-up or a correction)`.
- **Display:** the report draws the top card in "Could be a skill"; `/coach skills` lists them all.

**Did it help.**

- **What's counted:** once the skill or command exists:
  - its uses (`<command-name>/name`, the Skill tool, `attributionSkill`)
  - the members still typed by hand
  - corrections after uses, compared with before
- **What the report says:** "You've used /release-notes 6 times since you made it. Corrections afterwards dropped from 4 to 1."

## 10. Prompt craft

### 10.1 Deterministic checks (phase 1)

`extract.py` computes `PromptFlags` from the text using the patterns in B.3. The text is then discarded.

```ts
type PromptFlags = {
  namesPlace: boolean     // a path, a file name with an extension, an @mention, or a `backticked` identifier
  saysDone: boolean       // "done when", "should", "make sure", "until", "so that", "expect", tests pass…
  vague: boolean          // ≤ 6 words, a vague pattern, and no place
  bigPaste: boolean
  continuationCue: boolean
  correctionCue: boolean
  undoCue: boolean
  pollingCue: boolean
  uiWords: boolean
  formFeedback: boolean
  asksForChecks: boolean
}
```

"Your best prompt this week" is drawn only when `storeExcerpts` is on:

- **Pick:** among opening prompts with `namesPlace` and `saysDone`, no corrections and no interrupt, the one with the fewest follow-ups. Ties go to the lowest cost.
- **Why it worked:** a sentence built from its flags, for example "You named the file and said what done looks like. Claude finished in one go."

### 10.2 Model grading (phase 2, opt-in)

- **Switch:** the `promptGrading` setting, off by default. The first time it's turned on, the pane says what is sent and what it costs.
- **When:** once per completed week, after the row freezes, from the hooks module. `$.model.complete` is on `$`, not in Python.
- **Sample:**
  - The scanner writes up to 20 opening prompts of 5 words or more to `<data>/grading-input.json`, but only when grading is on. Each is cut to 2,000 characters and scrubbed (§13).
  - Half are a seeded random pick (seeded by the week id, so a rerun picks the same ones). The other half are the 3 to 10 with the most follow-ups.
  - The file is deleted after grading.
- **Request:**
  - `$.model.complete({ model: gradingModel ('haiku' by default), system: [{ text: RUBRIC_V1, cache: true }], prompt, maxTokens: 1500, effort: 'low' })`, 5 prompts per call.
  - It sends the prompt text, the project's name, and the outcome counts (follow-ups, corrections). No file contents and no Claude replies.
- **Rubric v1:** five criteria scored 0–2:
  - goal stated
  - place named
  - done criteria
  - one task in scope
  - constraints or context given

  The answer is strict JSON. A malformed answer is dropped, never retried more than once.
- **Rewrite:**
  - For the lowest-scoring prompt that had 2 or more follow-ups, a second call asks for a rewrite of at most 60 words.
  - The call includes up to 3 of the follow-up prompts (300 characters each). The rewrite adds only what the user said later, so it is never invented.
- **Cost guard:**
  - Before sending, the module estimates the cost and skips the week if it is over `gradingCapUsd` (default $0.25).
  - The footer shows what grading actually cost; the expected figure is about $0.01 a week with Haiku.
- **Stored:** in `$.store.grading[week]` as `{ model, rubricVersion, n, criteria averages, shareAtLeast7, rewrite }`, capped at 52 weeks. Trend lines join only rows graded with the same rubric version.
- **Validation (§15.3):**
  - On 100 labelled prompts, the rubric score correlates negatively with corrections.
  - Grading the same prompt twice gives scores within 1 point in at least 90% of cases.

## 11. Surfaces

### 11.1 Command

`/coach [tips | claude-md | skills | bar | hints | rescan | help]` is registered in `session.start` with `$.command.register({ name: 'coach', description, argumentHint })`. A `command.run` hook answers it from `e.args`.

| Arguments | Does | Replies |
|---|---|---|
| none | Opens the report pane on the last full week, or "this week so far" before the first full week | "Opened the coach report." |
| `tips` | Opens the pane at Level up, listing every eligible tip (phase 2) | "Opened coach tips." |
| `claude-md` | Opens the pane on every project's `CLAUDE.md` cards (§9.6, phase 2) | "Opened CLAUDE.md suggestions." |
| `skills` | Opens the pane on every skill card (§9.7, phase 2) | "Opened skill suggestions." |
| `bar` | Toggles the line above the prompt; persisted in `$.store.barHidden` | "Coach line hidden." / "Coach line shown." |
| `hints` | Toggles live hints (phase 3) | "Live hints on." / "Live hints off." |
| `rescan` | Rescans, ignoring the per-file cache | "Rescanning your sessions." |
| `help` | — | One paragraph on what coach does and the arguments |

The reply text is read by the model too, so it stays short and neutral. Where the pane can't be placed (`$.ui.open` resolves `isPlaced: false` for a reason other than width, as on a surface without panes, or under `-p`), the command replies with a plain-text summary of the report instead.

### 11.2 Report pane

- **Opening:** `$.ui.open({ id: 'coach-report', title: 'Coach' })`. Opened by the user's command, it is placed at any width.
- **Drawing:**
  - A `ui.render` hook on `{ component: 'Pane', requestId: 'coach-report' }` draws it from `$.state.report` and `$.state.view`.
  - Elements come from `$.ui.resolve(e)`: Box, Text, Button and Markdown on both surfaces.
  - Sparklines and progress dots are `Svg` on desktop and text glyphs (`▁▂▃▅▇`, `●○`) on the terminal, as repo-spend's `sparkGlyphs` does. `Raster` is a later option.
- **Width:** sized to `e.props.bodyColumns`. Under 60 columns, the tiles become lines and the evidence wraps.
- **Keys:** `p` previous week, `n` next week, `w` this week so far, `t` tips, `c` `CLAUDE.md` suggestions, `s` skills, Esc closes. Buttons work by click or focus as well.
- **States:**
  - no data yet: "Reading your sessions…" with progress
  - failed: the reason, and "Rescan"
  - python3 missing: "coach needs python3. On macOS, run `xcode-select --install`."
  - fewer than 3 days of logs: "Come back in a few days. coach needs a little history first."

### 11.3 Bar

**States, highest priority first:**

1. **Hidden:** a survey holds the band (`e.props.hasSurvey`), `barHidden` is on, there is no report yet, or `e.props.maxRows < 2` while another band is drawn.
2. **Nudge** (phase 3): live, expires after 2 minutes or at the next prompt.
3. **Report ready:** a frozen week the user hasn't opened yet, for at most 7 days.
4. **Habit:** the active habit, with this week's progress.
5. **Nothing:** no active habit.

**Layouts by width, richest first:** title + habit + dots + count; title + habit + count; title + habit; "Coach: /clear on topic switch". The width is `e.props.bodyColumns`, measured as repo-spend's `fits()` does.

**Living alongside other bands.** A `ui.render` hook that returns its own tree without calling `next(e)` hides every band beneath it in the chain. coach always calls `next(e)` and stacks:

```tsx
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  const below = await next(e)                 // other plugins' bands, then the engine's
  const line = await coachLine($, e)          // null when coach has nothing to say
  if (line === null) return below
  const { Box } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {below}
      {line}
    </Box>
  )
})
```

`next(e)` resolves a `RenderElement`, possibly `{ type: 'engine', ref }`. Phase 0 confirms that it can sit as a child on both surfaces. repo-spend currently returns its own tree without calling `next(e)` ([register.tsx](../repo-spend/hooks/register.tsx)), so it changes to the same pattern in phase 0.

### 11.4 Live hints (phase 3)

All hints are off unless `liveHints` is on.

| Hint | Fires on | Condition | Shows as |
|---|---|---|---|
| `topic-switch` | `prompt.submit` | Context (`$.session.usage().context`) ≥ the threshold, no continuation cue, and either 45 minutes idle or low word overlap with the last 5 prompts | A bar nudge: "New topic? This session is 310k tokens deep. /clear starts fresh." |
| `vague-first` | `prompt.submit` | The session's first prompt is `vague` | A toast: "Tip: name the file and say what done looks like." |
| `resume-after-break` | `session.start` with a resumed session | Context ≥ 200k and more than 1 hour since its last call | A toast: "Resuming a 400k-token session re-sends it at full price, about $2.50. A short handoff to a new session is cheaper." |
| `repeat-prompt` | `prompt.submit` | The prompt matches a qualifying §9.7 cluster: B.12-normalized, its rarer words overlap the cluster's by at least 0.6 | A toast: "You've typed this 12 times. It could be a skill: see /coach skills." |
| `skill-exists` | `prompt.submit` | The prompt matches a cluster an existing skill or command already covers | A toast: "You have /release-notes for this." |

`normalize.ts` must give the same results as `patterns.py` for the two prompt hints to agree with the report. Both test suites run the vectors in `tests/fixtures/normalize.json`.

**Limits:**

- At most one hint per 30 minutes and 3 a day.
- Each kind at most once a day.
- A "Don't show this again" button on the nudge turns that kind off.

**Never slow the prompt.** The `prompt.submit` hook calls `next(e)` first and computes the hint afterwards, without awaiting it, so submission is never delayed. It never adds `context` and never rewrites the text.

### 11.5 Tool for Claude (phase 2)

- **Registration:** `$.tool.register({ name: 'report', description, inputSchema })`, deferred, listed as `mcp__coach__report`. A `tool.call` hook with the matcher `{ tool: 'mcp__coach__report' }` answers it.
- **Input:** `{ week?: 'current' | 'previous' | 'YYYY-MM-DD', part?: 'summary' | 'habits' | 'tips' | 'claude-md' | 'skills' | 'cost' | 'all' }`.
- **Output:** the matching rows as compact JSON, at most 20 KB, plus one line explaining each metric's definition.
- Excerpts are included only when `storeExcerpts` is on.

### 11.6 Actions

coach never writes a file (§3, decision 9). The actions:

- **`$.ui.copy`:** resume commands, suggested `CLAUDE.md` lines (copied exactly as shown, a leading `-` on each), and skill templates. The user pastes them wherever they choose.
- **`$.prompt.fill({ text, mode: 'replace' })`:** used by two buttons only. "Make it a skill" fills the box with the skill request, and "Ask Claude about this week" with the week question, both below. Sending is the user's choice. Where the API can tell that the box already holds a draft, coach appends after a blank line (`mode: 'append'`) instead of replacing it.
- **`$.store`:** dismiss, snooze, pick another habit, "Not right?".

**When the button shows.** Only on a skill card that has its template. It isn't shown:

- on the existing-skill reminder, because the skill already exists
- with `storeExcerpts` off, because there's no template to send

**The skill request.** It lives in `copy.ts`. The path is absolute, so the request works from a session in any project; creating a file outside the session's folder asks for permission as usual. The request carries:

- the suggested name and location
- the template, with its slots
- any follow-up the user adds at least 40% of the time

The example is made up:

```
Turn this prompt, which I keep typing, into a skill I can run as /release-notes <version>,
saved in /Users/me/.claude/skills/release-notes/. The parts in angle brackets change each
time and come from the arguments. Also include the step I usually add afterwards: link
each PR.

Write release notes for <version> from the merged PRs, grouped by area, with a one-line
summary at the top.
```

**The week question.** Also in `copy.ts`. It names the week shown in the pane and points Claude at the report tool (§11.5), so the answer draws on the stored data. The example is made up:

```
Look at my coach report for the week of 5 October (the mcp__coach__report tool) and
walk me through it: what changed from the week before, and what should I work on first?
```

### 11.7 Copy rules

- **Tone:** sentence case, contractions, and plain words a beginner knows. No "please", no exclamation marks, and coach never says "I".
- **No blame.** "Claude re-read 280k tokens of the earlier topic", not "you wasted".
- **Estimates:**
  - prefixed "about" in sentences
  - money with 2 decimals under $100 and none above
  - token counts as "280k"
- **Strings in one place:** `copy.ts` holds every string, so wording can be reviewed in one file.

## 12. Settings and state

### 12.1 Settings (`userConfig`)

The fields are declared in `plugin.json`. Each non-secret field is also a row in the config menu.

| Field | Type | Default | Phase |
|---|---|---|---|
| `excludeProjects` | string: comma-separated path prefixes | `""` | 1 |
| `storeExcerpts` | boolean | `true` | 1 |
| `contextThresholdK` | number | `300` | 1 |
| `weekStartsOn` | string, options `monday`, `sunday` | `monday` | 1 |
| `promptGrading` | boolean | `false` | 2 |
| `gradingModel` | string, options `haiku`, `sonnet` | `haiku` | 2 |
| `gradingCapUsd` | number | `0.25` | 2 |
| `liveHints` | boolean | `false` | 3 |

The exact `userConfig` field syntax follows the manifest schema of the build coach targets. The TS module passes the phase-1 fields to `scan.py` as arguments.

Turning `storeExcerpts` off also turns off the suggestion sources that need the user's own words: §9.6 S4–S6 and the §9.7 templates. Its settings row says so.

### 12.2 `$.store` keys

| Key | Shape | Cap |
|---|---|---|
| `v` | Schema version of these keys | — |
| `firstReportWeek`, `lastSeenWeek` | Week ids | — |
| `habitLog` | `{ week, habit, status: 'active' \| 'learned' \| 'skipped' }[]` | 104 |
| `tips` | `{ [id]: { dismissedAt?, snoozedUntil?, shownWeeks: string[] } }` | — |
| `notRight` | `{ detector, evidenceId, at }[]` | 200 |
| `barHidden` | boolean | — |
| `hints` | `{ lastShownAt: { [kind]: number }, day: string, count: number, off: string[] }` | — |
| `grading` | `{ [week]: GradingResult }` | 52 |
| `adoptions` | `{ [suggestionId]: { at: number; baseline: Record<string, number> } }`: §9.6 and §9.7 "Did it help" | 200 |

Dismissing and snoozing suggestions use `tips`, with ids `claude-md:<project>:<source>:<key>` and `skill:<scope>:<opener>`. The key is the task, the command-word pair, the file path or the clause hash. The opener is the cluster medoid's first 6 normalized words. These ids stay stable from week to week, so a dismissal sticks.

The whole store stays well under its 4 MiB limit.

### 12.3 `$.state` contract (`types/index.d.ts`)

```ts
declare module 'claude-code' {
  interface PluginState {
    coach: {
      report: Report | null                 // Appendix A
      scan: { status: 'idle' | 'scanning' | 'failed'; progress?: [number, number]; error?: string; at?: number }
      view: { week: string | null; detail: string | null; section: string | null }
      nudge: Nudge | null                   // phase 3
      barHidden: boolean                    // mirrors $.store for drawing
    }
  }
}
```

## 13. Privacy and safety

- **Reads:** coach reads only local files:
  - transcripts
  - settings files, only to see whether the fields named in §9.2 exist
  - from phase 2, the contents of the `CLAUDE.md` files Claude loads and of local skill and command definitions, for the coverage checks in §9.6 and §9.7; these are never stored
- **Network:** phase 1 makes no network calls. Phase 2 grading, when switched on, sends sampled prompt text to Anthropic through the session's own client and nothing else.
- **What's stored:** derived data goes in `<data>`, mode 0700/0600. Stored text is limited to:
  - excerpts of at most 200 characters, only while `storeExcerpts` is on, and dropped after 12 weeks
  - from phase 2, with `storeExcerpts` on: correction and instruction clauses of at most 120 characters, and normalized prompt templates of at most 400 characters whose variable parts are already slots
  - normalized commands of the kinds in B.8 (tests, builds and the like), scrubbed
  - for wrong-tool pairs, only the command words, never their arguments
  - the transient grading input file
- **Failed command output** is matched against B.10 in memory; only the category is kept.
- **Scrubbing:** excerpts and grading input are scrubbed before they're written. These are replaced with `[redacted]`:
  - `sk-…` and `ghp_…` style keys
  - `AKIA…`
  - JWT-like `eyJ…`
  - `password=` / `token:` values
  - any hex or base64 run of 32 or more characters
- **Excluded projects** are skipped entirely, before any record is parsed.
- **Uninstalling:** the README tells users to delete `~/.claude/coach/` to remove everything. `$.store` goes with the plugin.
- **Never acts on its own:** coach never changes what the model reads (no `context`, no `prompt.compose`), never blocks anything, and never runs a tool by itself. It never writes `CLAUDE.md`, skills or any file outside its data folder. It prepares only two things for Claude, the skill request and the week question (§11.6), and both wait in the prompt box for the user to send or not.

## 14. Performance and failures

| Budget | Target, on the author's machine (about 600 MB of logs, M-series Mac) |
|---|---|
| First full scan | ≤ 60 s, in the background |
| Incremental scan | ≤ 2 s typical |
| Scanner memory | ≤ 300 MB resident; files are streamed line by line |
| `report.json` | ≤ 200 KB (current week, last full week, 26 summary rows, candidates) |
| Clustering prompts and clauses (phase 2) | ≤ 5 s for 5,000 prompts, using the candidate-pair index of §9.7 rather than comparing every pair |
| Coverage reads (phase 2) | Cached by file mtime; a scan rereads only the `CLAUDE.md` and skill files that changed |
| Bar draw | No I/O; reads `$.state` only |

**Keeping scans fast:**

- A line is parsed only if it contains one of the needed `"type":` markers, the same prefilter repo-spend uses.
- `tool_result` records, the bulk of `user` lines, are parsed only for the fields in §6.2.
- If profiling shows they dominate, they are reduced by targeted substring checks before `json.loads`.

| Failure | Behaviour |
|---|---|
| python3 missing | No bar; `/coach` explains how to install it |
| Scanner error | Logged with `$.ui.log(text, { to: 'debug' })`; the pane shows the reason; the last good `report.json` stays in use |
| Corrupt `scan-cache.json` | Rebuilt |
| Corrupt `history.json` | Restored from `.bak`. If that fails too: moved aside as `history.json.broken-<ts>`, rebuilt from the logs still on disk, and the pane says older weeks were lost |
| Lock busy | Use the existing `report.json` |
| A file vanishes mid-scan | Skipped; facts from earlier scans are kept until §8.4 drops them |

## 15. Testing and validation

### 15.1 Python (`python3 -m unittest discover -s tests`)

The fixture builders follow repo-spend's `test_scan.py`. Test cases:

- **Prompt detection:**
  - `origin.kind` human versus task-notification
  - older records without `origin`
  - every B.1 marker
  - command wrappers
  - image prompts
- **Requests:**
  - boundaries
  - streaming deduplication
  - subagent and workflow attribution, including after the last prompt
  - background turns
- **Outcomes:**
  - interrupts (both marker texts)
  - `toolDenialKind` values
  - `permissionDecision` approvals
  - commit success versus failure
  - check commands before and after the last edit
- **Context and cost:**
  - context sizes
  - re-warm with 5-minute and 1-hour writes
  - fast mode
  - ledger scaling
  - unpriced models
- **H1:**
  - stale switches by idle gap
  - stale switches by area change
  - fresh switches
  - carried cost
- **Weeks:**
  - bucketing with `TZ`, across midnight on Sunday and a daylight-saving change
  - freezing
  - `METRICS_VERSION` recompute with and without the logs on disk
  - partial first week
- **History:**
  - deleted logs
  - corrupt files
  - lock contention (two processes)
  - excluded projects
  - scrubbing
- **Suggestions (phase 2):**
  - **S1 episodes:** `found`, `gave-up`, fewer than 2 steps, `cd` prefixes, path arguments, output plumbing
  - **S2 pairs:**
    - `npm` → `pnpm` after `ERR_PNPM_`
    - `python` → `python3` after "command not found"
    - a `uv run` prefix
    - the false pairs from Appendix C (`mkdir` → `cd`, `ls` → `markitdown`) must not match
  - **S3:** files named in the first prompt and files edited later are excluded; worktree paths are folded
  - **S4–S6:** three phrasings of "use pnpm" cluster together; "no, that's wrong" is dropped
  - **Coverage:** commands, pairs, paths and clauses already in a `CLAUDE.md`, including through an `@path` import
  - **Suggested file:** the project's `CLAUDE.md` or `~/.claude/CLAUDE.md`, per §9.6
  - **Templates:** slots from a 5-member cluster, follow-up mining, name clashes, project vs user scope, a match with an existing skill
  - **Stability and storage:** ids stay the same across weeks, and nothing is stored beyond B.8 commands and command words
- **Golden test:** a synthetic "beginner week" fixture compared against its expected `WeekRow` snapshot.
- **Shared code:** `pricing.py` must stay byte-identical to `shared/pricing.py` (a drift test).
- **Python versions:** runs on 3.9 and on the current release.

### 15.2 TypeScript (`claude plugin test plugins/coach`)

Every UI test loops over `['terminal', 'desktop'] as const`, like repo-spend's `band.test.ts`.

- **Bar:**
  - each state and its priority
  - each width fallback
  - `hasSurvey`
  - `barHidden` persistence
  - **stacking:** the test registers a second `AbovePrompt` hook that returns its own line, standing for repo-spend, and asserts both lines are drawn
- **Pane:**
  - each section with and without data
  - every empty and failure state
  - week navigation
  - "Ask Claude about this week" fills the week question for the week on screen
  - the detail view
  - "Not right?"
  - "Pick another habit"
  - dismiss and snooze
- **`select.ts`:**
  - habit stickiness, learned and none-eligible
  - tip eligibility, level gating, conflicts, ranking, snoozing
- **Command:**
  - each argument
  - the plain-text fallback when no pane is placed
  - the scanner's argv
  - NDJSON parsing, including partial lines
- **Suggestion cards (phase 2):**
  - "Copy" puts exactly the suggested lines or template on the clipboard
  - per-line dismiss and "Not right?"
  - the existing-skill reminder
  - the excerpts-off variant
  - "Make it a skill" fills the skill request (§11.6) with the right name, location, template and follow-up steps, and is absent on the reminder and with excerpts off
  - **no writes:** the test asserts that no card action writes through `$.fs`, and that nothing but "Make it a skill" and "Ask Claude about this week" calls `$.prompt.fill`. A `CLAUDE.md` card never does.
- **Phase 3 hints:** limits hold over a simulated week on the mocked clock, and `prompt.submit` resolves before any hint work finishes. `normalize.ts` passes the shared vectors in `tests/fixtures/normalize.json`.

### 15.3 Detector quality

- **Label set:** 150 requests from the author's logs, labelled by hand for each detector that produces evidence. The labels stay outside the repository because they contain prompt text. `tests/eval/run.py` reports precision and recall per detector against a labels file passed on the command line.
- **Gate:** a detector shows evidence to users only at precision ≥ 0.8. Below that, it may still feed counts that are labelled "about", or it stays off.
- **Stricter gate for `CLAUDE.md`:** §9.6 needs precision ≥ 0.9 for every source, because a wrong line reaches every later session. §9.7 clusters need ≥ 0.8.
- **Phase 2 labels:** the label set adds 50 discovery episodes, 30 failed commands, 50 clauses and 40 prompt pairs.
- **A second person's logs:** an experienced user's projects already have `CLAUDE.md` files, so S2 and S3 stay almost silent on the author's logs (Appendix C). These detectors can only be judged on a beginner's logs.
- **Before phase 2 ships:** repeat with a second person's logs, ideally a beginner's, shared with consent and labelled locally.

### 15.4 Cross-check with repo-spend

For the same repo and window, coach's cost total must match repo-spend's within 1%. They use the same pricing module and the same ledger rule. This runs as a manual check in phase 1 and as a scripted check in `scripts/` once both scanners can be run against one fixture folder.

### 15.5 Manual QA

Check each of these:

- terminal at 80, 120 and 200 columns
- fullscreen on and off
- desktop in light and dark
- with repo-spend installed and without
- a fresh install with no logs
- a machine whose logs are older than 30 days in part
- `-p` (no pane, text summary)

## 16. Phases

### Phase 0: groundwork (repo-spend 0.3.1 and spikes)

**Deliverables:**

1. **Shared pricing:** `shared/pricing.py` holds the price table and `message_cost`, plus a new `SUCCESSOR` map for `newer-model`. `scripts/sync-shared.py` copies it into each plugin's `hooks/`, and a test fails on drift. repo-spend's `scan.py` imports its copy with no change in output; its tests stay green.
2. **repo-spend's band** composes with `next(e)` (§11.3), with a stacking test on both surfaces. Version 0.3.1.
3. **Spikes**, with answers written back into this spec:
   - what `/clear` writes to the logs, in the terminal and in the desktop app
   - whether `compact_boundary` records say auto or manual
   - whether double Esc or `/rewind` leaves a trace
   - the headless `entrypoint` value
   - whether `$.model.complete` calls appear in transcripts
   - whether an `{ type: 'engine' }` element can be nested in `AbovePrompt` on both surfaces
   - `$.ui.copy` on desktop
   - how a Pane looks on desktop
   - how a failed Bash call is recorded in terminal logs (desktop logs mark it `is_error: true`, mostly with `Exit code N`)
   - which `CLAUDE.md` files Claude Code loads in a monorepo, and how `@path` imports resolve
   - which records show a skill or custom command being used: `<command-name>`, the Skill tool's input, `attributionSkill`
   - whether `$.prompt.fill` can tell that the box holds a draft
4. **Fixtures:** a terminal-session fixture set, trimmed and scrubbed.
5. **Labels:** the label set for §15.3, kept outside the repository.

**Done when:**

- repo-spend 0.3.1 is released.
- Every spike has an answer in §6, §9.2 or §11.

### Phase 1: coach 0.1.0, the offline coach

**Deliverables:**

- **Scanner:** extract, metrics, rules, history, freezing, lock, NDJSON progress.
- **Coverage:** every metric in §7, habits H1–H5, features and levels, and the §9.4 notices.
- **Pane:** sections 1–3, 5, 6, 8 and 9, plus the best-prompt card.
- **Bar:** the report-ready and habit states.
- **Commands:** `/coach`, `/coach bar`, `/coach rescan`, `/coach help`.
- **First run:** the §4.1 flow.
- **Settings:** the phase-1 fields.
- **Docs:** the README with previews (`scripts/coach-assets.py`), the marketplace entry, and the root README's Mods section.

**Done when:**

- The §14 budgets hold on the author's machine.
- The §15.4 cross-check is within 1%.
- Detectors showing evidence pass §15.3.
- Python and TS tests pass, and `claude plugin validate plugins/coach` is clean.
- §15.5 passes.

### Phase 2: coach 0.2.0, Level up, CLAUDE.md, skills and grading

**Deliverables:**

- **Tips:** the §9.3 catalogue with ranking, retiring, snoozing and dismissing, and `/coach tips`.
- **CLAUDE.md suggestions:** §9.6 sources S1–S6, coverage checks, suggested files, cards with "Copy", `/coach claude-md`.
- **Skill suggestions:** §9.7 clusters, templates, follow-ups, suggested locations, the existing-skill check, cards with "Make it a skill" and "Copy template", the skill request (§11.6), `/coach skills`.
- **Did it help:** the before-and-after follow-up for adopted lines and skills.
- **Metrics:** §7.7 and its sparkline.
- **Asking Claude:** the `mcp__coach__report` tool and the "Ask Claude about this week" button.
- **Grading:** opt-in prompt grading and the rewrite card.

**Done when:**

- Every tip and suggestion source has show, hide and retire fixture tests.
- §9.6 passes its 0.9 precision gate and §9.7 its 0.8 gate (§15.3), on the author's logs and on a second person's.
- Grading costs ≤ $0.05 a week on the author's data.
- Rubric stability reaches ≥ 90% within ±1.

Phase 2 is the largest. If it runs long, it ships in two releases: first everything that works offline (tips, §9.6, §9.7, the tool), then grading.

### Phase 3: coach 0.3.0, live hints

**Deliverables:**

- The five hints in §11.4, including the two that spot a repeated prompt.
- The nudge state in the bar.
- `/coach hints`.

**Done when:**

- The limits hold in the simulated-week test.
- Prompt submission waits on no hint work.

Every change raises `version` in `plugins/coach/.claude-plugin/plugin.json`, as the repository README requires.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Heuristics are wrong, and users stop trusting the report | Evidence on every finding, the 0.8 precision gate, "Not right?" with per-detector shut-off, "about" on estimates |
| It nags | One habit, at most two tips, hints off by default and rate-limited, bar hideable |
| Goodhart: people write for the metric | No overall score; habits retire once learned; the metrics are behaviours, not grades |
| Claude Code's log format changes | `PARSER_VERSION`, tolerant parsing, per-version fixtures, `versionsSeen` on each row |
| Prompt text leaks into places it shouldn't | Short excerpts only, scrubbing, a switch to turn excerpts off, the 12-week drop, 0600 files |
| First scan is slow on large histories | Background scan with progress, prefiltering, a per-file cache |
| Bands from different plugins hide each other | coach always calls `next(e)`; repo-spend is fixed in phase 0 |
| English-only cues | Language detection: cue-based detectors switch off for prompts that are mostly non-Latin text. Documented as a limit of v1. |
| Prices go stale | One shared price table, a drift test, and the `PRICES_UPDATED` habit repo-spend already has |
| A wrong suggested line, once added, misleads every later session | The 0.9 precision gate, evidence on every line, per-line "Not right?"; coach never adds a line itself |
| `CLAUDE.md` grows until it costs more than it saves | At most 10 suggested lines of 120 characters per project, the coverage check, the `claude-md-too-long` tip |
| A suggested template misses a step | It's built from the user's own prompts and shows the follow-ups they usually add. Claude creates the skill only if the user sends the request, and the user approves the file. |

## 18. Open questions

1. **Name.** `coach` and `/coach` are short but generic; a clash with another plugin's command is possible. Alternatives: `claude-coach`, `habit-coach`.
2. **Scope.** v1 covers all projects, with only cost and prompts split per project. Should the pane offer "this repo only" in v1?
3. **Data location.** `~/.claude/coach/` (next to `$.store`) or `~/.local/share/claude-coach/`?
4. **Excerpts on by default?** They make the report concrete, and they keep prompt text on disk.
5. **First report.** Last complete week, or rolling last 7 days, when the install lands mid-week?
6. **Desktop deep links.** A session can't be opened from a link today, so evidence shows the title and a resume command. Is that enough?
7. **Grading model.** Haiku by default, with Sonnet as an option. Should Sonnet be the default for better rewrites, at roughly 20× the cost (still cents)?
8. **Thresholds.** 100k context for H1, 300k for oversized sessions, and 8 files / $3 / 40 calls for big changes are first guesses, to be tuned on the label set.
9. **Interface language.** English only in v1; keep `copy.ts` ready for translation?

## Appendix A: report.json

```ts
type Report = {
  generatedAt: number
  parserVersion: number
  metricsVersion: number
  coverage: { since: number | null; files: number; sessions: number }
  current: WeekRow                 // this week so far
  previous: WeekRow | null         // last full week: what the weekly report shows
  history: WeekSummary[]           // up to 26 rows for sparklines (headline numbers and habit metrics only)
  features: Record<FeatureId, { firstSeen: number | null; lastSeen: number | null; count: number }>
  level: 0 | 1 | 2 | 3
  live: { lastRequestAt: number | null }
  suggestions: { claudeMd: ClaudeMdCard[]; skills: SkillCard[] }   // phase 2; rolling 28 days, never frozen
  errors: string[]                 // non-fatal: unreadable files, unknown shapes
}

type ClaudeMdCard = {
  id: string; project: string; root: string
  hasClaudeMd: boolean
  loadedLines: number              // lines of every CLAUDE.md Claude loads here, imports included
  lines: {
    id: string
    source: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'
    text?: string                  // absent for S3 and gave-up S1, which the card describes instead
    file: 'project' | 'user'       // the suggested file: the project's CLAUDE.md or ~/.claude/CLAUDE.md
    evidence: string[]             // Evidence ids (§9.5)
  }[]
  pointers?: { files: string[]; task?: Task }   // S3 files and gave-up S1 tasks, named on the card without line text
  notes: string[]                  // covered but still corrected; too long
  impact: number
}

type SkillCard = {
  id: string; name: string
  scope: 'project' | 'user'; project?: string
  count: number; sessions: number
  template?: string                // with storeExcerpts only
  followUps: { text?: string; share: number }[]
  correctedShare: number
  existing?: { name: string; since: number; handTyped: number }   // the reminder variant
  evidence: string[]
  impact: number
}
```

## Appendix B: patterns

Starting points. They are tuned on the label set; every list lives in `patterns.py` with a test per entry.

**B.1 Machine markers** (text that starts with any of these is not a prompt):

- **Command wrappers:** `<command-name>`, `<command-message>`, `<command-args>`, `<local-command-stdout>`, `<local-command-caveat>`, `<local-command-stderr>`
- **Engine tags:** `<task-notification>`, `<system-reminder>`, `<bash-input>`, `<bash-stdout>`, `<bash-stderr>`
- **Other machine text:** `Caveat:`, `Stop hook feedback`
- **Interrupt markers:** `[Request interrupted by user]` and `[Request interrupted by user for tool use]`. These two also count as interrupts.
- **Desktop command wrappers:** the regex `^<[a-z-]+-command>`

**B.2 Cues** (case-insensitive, matched at the start of the prompt after trimming):

- **Correction:** `no\b`, `nope`, `wrong`, `not (quite|what|that)`, `that's (not|wrong)`, `you (didn't|forgot|missed|broke)`, `still (not|broken|failing|the same)`, `it (still|doesn't|didn't)`, `(doesn't|didn't) work`, `same (error|issue|problem)`, `why did you`, `i (meant|said)`, `actually,? (i|we|it|that|the)`, `your (response|answer) (above|was)`
- **Undo:** `undo`, `revert`, `roll ?back`, `go back to`, `put it back`
- **Polling:** `is it done`, `check again`, `any update`, `status\??$`, `still running`, `has it finished`
- **Continuation** (cancels a topic switch): `it\b`, `this`, `that`, `these`, `those`, `also`, `again`, `still`, `same`, `continue`, `go ahead`, `yes`, `ok`, `do it`, `looks good`, `and\b`

**B.3 Prompt checks**

- **Path:** `[\w.-]+/[\w./-]+`, or a name with a known extension (`\.(ts|tsx|js|py|go|rs|java|kt|swift|md|json|ya?ml|css|html|sql|sh)\b`)
- **@mention:** `(^|\s)@[\w./-]+`
- **Identifier:** a `` `backticked` `` word, or a camelCase or snake_case token of 6 or more characters
- **Done:** `done when`, `should (now )?(show|return|pass|print|work)`, `make sure`, `until`, `so that`, `expect(ed)?`, `tests? pass`, `verify`, `acceptance`
- **Vague:** at most 6 words and one of `fix (it|this|that)`, `make it work`, `(doesn't|not) work(ing)?`, `broken( again)?`, `do the thing`, `same as before`, `clean (it|this) up`
- **Big paste:** over 4,000 characters, with at least half the lines matching a stack frame (`^\s+at `, `File ".*", line \d+`, `Traceback`), a log line (`^\d{4}-\d\d-\d\d`, `^\[?(INFO|WARN|ERROR|DEBUG)`), or a shell prompt

**B.4 Check commands** (a Bash `command` that matches): `\b(npm|pnpm|yarn|bun) (run )?(test|build|lint|typecheck|check)\b`, `\b(pytest|jest|vitest|mocha|rspec|phpunit|ctest)\b`, `\b(go|cargo|swift|dotnet|mvn|gradle|make) (test|build|check)\b`, `\btsc\b`, `\bmypy\b`, `\bruff\b`, `\beslint\b`, `\bxcodebuild\b.*\btest\b`, `claude plugin (test|validate)`, `python3? -m (unittest|pytest)`

**B.5 Repeat exclusions:**

- prompts under 3 words
- B.1 markers
- `^reply with just`
- prompts that are only a URL
- hook feedback

**B.6 Instructions and form feedback**

- **Instruction-like:** `\b(we|i) (use|prefer|don't use)\b`, `\balways\b`, `\bnever\b`, `\bdon't\b .* \b(use|add|write)\b`, `\binstead of\b`
- **Form feedback:** `too (long|short|verbose)`, `shorter`, `(no|without) (emojis|bullet points|headers)`, `don't explain`, `just (the|give me) (code|answer)`, `your (response|answer) (above )?was`
- **Facts about the project:** `\b(lives|is|are) (in|under|at)\b`, `\bis located\b`, `\bour \w+ (is|are|uses)\b`, `\bthe (api|backend|frontend|server|database|db|app) (is|lives|runs)\b`

**B.7 Interface words:** `button`, `layout`, `css`, `style`, `align`, `margin`, `padding`, `color`, `font`, `looks`, `screen`, `page`, `modal`, `responsive`, `dark mode`

**B.8 Tasks and command normalization** (§9.6 S1). A Bash command is classified after stripping `cd … &&`, `export …;` and environment assignments:

- **test:** `(npm|pnpm|yarn|bun) (run )?test`, `pytest`, `jest`, `vitest`, `mocha`, `rspec`, `phpunit`, `go test`, `cargo test`, `ctest`, `swift test`, `xcodebuild .* test`, `python3? -m (pytest|unittest)`, `claude plugin test`
- **build:** `(npm|pnpm|yarn|bun) (run )?build`, `cargo build`, `go build`, `xcodebuild( build)?`, `gradle (build|assemble)`, `mvn (package|install)`, a bare `make` or `make build`
- **lint:** `(npm|pnpm|yarn|bun) (run )?lint`, `eslint`, `ruff( check)?`, `flake8`, `golangci-lint`, `cargo clippy`, `swiftlint`
- **typecheck:** `tsc`, `(npm|pnpm|yarn|bun) (run )?(typecheck|type-check)`, `mypy`, `pyright`
- **format:** `prettier`, `black`, `gofmt`, `cargo fmt`, `(npm|pnpm|yarn|bun) (run )?format`
- **dev:** `(npm|pnpm|yarn|bun) (run )?(dev|start|serve)`, `uvicorn`, `flask run`, `rails s(erver)?`, `python3? manage.py runserver`
- **install:** `(npm|pnpm|yarn|bun) (i|install)`, `pip3? install`, `uv (sync|pip install)`, `bundle install`, `poetry install`, `go mod download`

**Normalizing the command:**

- **Kept:** the `cd` folder (shown in the line's label), environment assignments, the runner and the script.
- **Dropped, setting `hadPathArg`:** arguments that are paths, file names or test selectors (`-k …`, `-t …`, `--grep …`, `--testNamePattern …`, `file::name`).
- **Dropped:** output plumbing: pipes to `head`, `tail` or `grep`, `2>&1`, and a trailing `; echo …` or `&& echo …`.

**B.9 Exploration steps** (§9.6 S1):

- **Reads** (the Read tool, or `cat`, `head`, `tail`, `less`, `sed -n`, `jq` in Bash) of any of:
  - package and build files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `Makefile`, `justfile`, `Taskfile.yml`
  - Python: `pyproject.toml`, `setup.cfg`, `tox.ini`, `noxfile.py`, `requirements*.txt`
  - other languages: `Cargo.toml`, `go.mod`, `build.gradle*`, `pom.xml`, `Gemfile`, `Rakefile`
  - docs: `README*`, `CONTRIBUTING*`, `docs/**/*.md`
  - CI and containers: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Dockerfile`, `docker-compose*.yml`
- **Bash:** `ls` of the root or one level down, `npm run` with no script (it lists them), `make help`, `make -n`, `which <tool>`, `<tool> --version`, and `grep` or `rg` for `scripts|test|jest|vitest|pytest`
- **Grep and Glob** for test files or test config: `*.test.*`, `jest.config*`, `vitest.config*`, `pytest.ini`, `conftest.py`
- **User questions** that start an episode: `how (do|can|should) (i|we|you) (run|start|build|test|lint|deploy)`, `what('s| is) the (command|script) (to|for)`

**B.10 Wrong tool first** (§9.6 S2):

- **Failure categories**, matched against the first 2,000 characters of a failed Bash result:
  - **missing-binary:** `command not found`, `not recognized as an internal or external command`, `No such file or directory` naming the command word, `env: .*: No such file`
  - **wrong-package-manager:** `ERR_PNPM_`, `This project is configured to use (\w+)`, `packageManager` with `Usage Error`, `Unsupported URL Type "workspace:"`
  - **missing-script:** `Missing script`, `Unknown command`, `ERR_PNPM_NO_SCRIPT`, `error Command ".*" not found`
  - **missing-module:** `ModuleNotFoundError: No module named`, `Cannot find module`
  - **wrong-version:** `requires (Python|Node|node) (>=|version)`, `Unsupported engine`, `engine .* is incompatible`
- **Roles** (a replace pair needs both words in one role, or the rule in §9.6):
  - `npm` `pnpm` `yarn` `bun`
  - `npx` `pnpx` `bunx`
  - `python` `python3` `py`
  - `pip` `pip3`
  - `docker-compose` `docker`
  - `node` `nodejs`
- **Prefixes** (a prefix pair is the failed command with one of these in front):
  - `uv run`, `poetry run`, `pipenv run`
  - `bundle exec`
  - `npx`, `pnpm exec`, `yarn exec`
  - `. .venv/bin/activate &&`, `source venv/bin/activate &&`
- **Line templates:**
  - package managers: "- Use `pnpm`, not `npm`."
  - interpreters: "- Use `python3`; `python` isn't available here."
  - prefixes: "- Run Python tools through `uv run` (for example `uv run pytest`)."

**B.11 Clause cleanup** (§9.6 S4–S6):

1. **Split** the prompt into sentences on `.`, `!`, `?` and line breaks. Keep the sentences with a correction cue (B.2), an instruction or fact pattern (B.6), or a form-feedback pattern (B.6).
2. **Strip leading cue words:** `no`, `nope`, `wrong`, `actually`, `again`, `i (said|meant|told you)`, `please`, `you should`, `you need to`, `you have to`, `remember( that)?`, `as i said`.
3. **Strip trailing words:** `again`, `please`, `!`.
4. **Format:** capitalize, end with a period, and wrap commands, paths and file names in backticks.
5. **Drop** the clause if fewer than 3 words remain, or nothing remains but a cue ("no, that's wrong").

**B.12 Prompt normalization** (§9.7). `patterns.py` and `normalize.ts` share the test vectors in `tests/fixtures/normalize.json`:

1. Lowercase, and collapse whitespace.
2. Replace with slots:
   - URLs → `<url>`
   - paths and file names → `<path>`
   - versions → `<version>`
   - numbers and issue keys (`#123`, `PROJ-123`) → `<n>`
   - quoted or backticked text → `<x>`
   - hex ids and hashes → `<id>`
3. Keep the first 60 words.
4. Stopwords stay in for 3-grams, since they carry the template's shape. They're left out of the rarer-word index.

## Appendix C: the author's logs, 2026-10-09

These are aggregates only, with no prompt text and no project names. They show what the detectors see on real data, and they serve as a rough sanity check for phase 1.

| Figure | Value |
|---|---|
| Main transcripts / all transcript files | 148 / 517 (subagent and workflow files make up the rest) |
| Typed prompts | 523; median 55 characters, 90th percentile 358 |
| Context per model call | Median about 265k tokens, 90th percentile about 590k |
| Cache hit rate | 98.9% |
| Tokens re-cached after more than 1 hour idle | About 14.5M (about $90 at Opus 5's 5-minute write price) |
| Plan mode | 1 prompt |
| Compactions | 3 |
| Interrupt markers | 61 |
| `user-rejected` denials | 13 |
| Effort | `max` on about 80% of calls |
| Model mix | About 75% of replies from Opus 5 |
| Most repeated opener | 15 times across sessions |
| Most sessions running at once | 3 |
| `/clear` in the logs | Never: the author starts new sessions in the desktop app instead, which is why §16's phase 0 checks what `/clear` writes |
| Failed Bash calls | 220, all marked `is_error: true`; 196 of them also say `Exit code N` |
| Wrong tool first (S2) | 17 failed calls had a wrong-tool style error. Three rules for pairing them with the call that worked: <br>• Command word alone: 7 pairs, all wrong (`mkdir` → `cd` and the like). <br>• Matching arguments added: 1 pair, still wrong (`ls` → `markitdown`). <br>• B.10 rule: 1 pair, right: `python3` failed on a missing module and `python` worked. That's a real environment fact. It was seen in one session, so it stays below the 2-session threshold. |
| Files read first (S3) | In the busiest project (102 sessions), the file most often read early appears in 3% of sessions, and in 20% for a 15-session project. Both are well under the 40% threshold. That silence is right for projects that already have `CLAUDE.md` files; S3 needs a beginner's logs to judge (§15.3). |
| Repeated prompts (§9.7) | Several openers repeat 4 to 15 times. Some may already be covered by the author's own commands, which the existing-skill check decides. One repeated opener is feedback on the form of replies, which belongs to §9.6 S6 rather than §9.7. |

## Appendix D: implementation notes (0.1.0)

What building it settled, and where the code departs from the draft above.

**Shipped together.** Every phase is in 0.1.0: the offline report, tips, CLAUDE.md and skill suggestions, the report tool, opt-in grading and live hints. Grading and hints stay off by default, as specified.

**Phase 0 questions, answered:**

- **Compactions:** `compact_boundary` records carry `compactMetadata.trigger`, `auto` or `manual`.
- **Failed commands:** desktop logs mark a failed Bash call `is_error: true`; most also say `Exit code N`. Terminal logs weren't sampled.
- **A draft in the prompt box:** `$.prompt.read()` returns it, so the two buttons append after a draft instead of replacing it.
- **Bands:** both coach and repo-spend stack the bands of plugins beneath them, and leave the engine's own band drawing out, as repo-spend always did. Nesting an engine element is never needed.
- **`/clear`:** the hooks see it as `session.end` with `reason: 'clear'` and rescan; in a log, the next prompt after a `/clear` command counts as a fresh start.
- **Copying:** `$.ui.copy` can fail on remote surfaces; the pane then says to select the text instead, and the resume command is always shown as text too.
- **Still open:** whether double Esc leaves a trace (only `/rewind` is detected), the headless `entrypoint` value (`sdk-cli` assumed), and whether `$.model.complete` calls appear in transcripts.

**Departures from the draft:**

- **Big changes** need at least one edited file: on heavy usage nearly every prompt costs over $3, so cost or calls alone flagged everything (§7.4).
- **Files read first (S3)** leave out manifests and READMEs (B.9's files). Those are how-to-run lookups, which S1 covers.
- **Repeated corrections and instructions (S4, S5)** are dropped when a line already suggested says the same thing ("use pnpm" next to S2's line).
- **A bare correction** ("no, the other one") makes no clause; one counts only when it names a command, path or file.
- **Skill candidates** leave out follow-ups that lean on the prompt before them ("also link each PR"), and corrections.
- **Skill names** are the template's first two shared, meaningful words, skipping generic ones like "run" and "keep". tf-idf picked rare words over the task.
- **Matching command words** is whole-word: "npm" no longer matches inside "pnpm".
- **An over-long CLAUDE.md** keeps a card holding only a "too long" note, so the `claude-md-too-long` tip can find it; the pane doesn't draw such a card.
- **Week ranges** are drawn from the week's id, the scanner's local date, so the pane and the scanner agree whatever the time zone.
- **The report** carries the last six full weeks whole (`weeks`) for paging, each week's first activity (`firstAt`), and the last activity and context size of recent sessions (`live.sessions`) for the resume hint.
- **A busy lock** makes `scan.py` print the last report with `"busy": true` and exit 0, not 2: one less case for the hooks module.

**Measured on the author's logs** (148 sessions, 529 MB): a first scan takes 9.2 s and 77 MB, a rescan 0.4 s, and the report is about 60 KB.

