# worklog: plan

| | |
|---|---|
| Status | Phases 1 and 2 built (0.2.0); see Appendices A and B for what changed on the way |
| Author | Aseem Upadhyay, drafted with Claude |
| Date | 2026-10-10 |
| Lives in | `plugins/worklog/` in qol-mods |
| Built against | Claude Code 2.1.295 plugin API (function hooks) |

## 1. Summary

worklog answers "what did I do yesterday?" from the logs already on the machine. It reads every project's Claude Code transcripts and the user's own git history, groups the work by repo, then pull request (or branch when there's no PR), and works out the time spent from timestamps. `/standup` prints a ready-to-paste standup for the last working day. `/worklog` opens a pane with a day view and a week timesheet that can be copied as Markdown or CSV.

worklog is read-only and on-demand. It shows the user their own work when they ask with `/standup` or `/worklog`, and does nothing else: it never posts, sends or shares an update anywhere, and draws nothing unasked. Copy and Save CSV are how the user takes it elsewhere, by hand.

Everything works offline. `gh` adds PR titles and states when it's installed and signed in. Those calls only read from GitHub.

## 2. Goals and non-goals

**Goals**

- A standup in one command: yesterday, today so far, open PRs. Monday shows Friday.
- Cover every repo, not just the session's own, worktrees folded into their repo.
- Group by PR first, branch second, with the PR title as the label when one is known.
- Time per group that adds up to the real wall-clock day. Parallel sessions must not double-count (§6.3).
- Good enough to fill a timesheet: a week grid, rounding, CSV.
- Keep finished days after Claude Code deletes old logs (30 days by default).

**Non-goals**

- Exact time tracking. These are estimates from activity, and the UI says so.
- Tracking anything outside git and Claude Code (meetings, browser, editor time without commits).
- Posting, sending or sharing updates anywhere: Slack, Jira, email, or a prompt to Claude. Output is shown to the user only, only when they ask (§8.4).
- Showing anything unasked: no band above the prompt, no status-line entry, no toasts, no reminders.
- Judging how much anyone worked. No targets, no streaks, no comparisons.

## 3. What the prototype showed

A throwaway script over 2026-10-09's logs (one day, 34 project folders) settled four things:

1. **Transcripts have what we need.** Every record carries `timestamp`, `cwd`, `gitBranch` and `sessionId`. `pr-link` records carry `prNumber`, `prUrl` and `prRepository`, so PRs Claude opened or touched are known with no network. `custom-title` gives a session's name.
2. **Summing per-branch time overcounts by about half.** Per-branch spans (15-minute idle gap) summed to 8.2 h. The union across all of them was 5.4 h. The user runs sessions in parallel, so overlap allocation (§6.3) is required, not a nicety.
3. **`cwd` is often a subfolder** (`plugins/coach/hooks`) and is sometimes a scratch folder outside any repo (`/private/tmp/...`). Records must be resolved to a repo root, and non-repo folders dropped.
4. **One session can produce several PRs** (session `384a…` linked PR 1 then PR 2). Map PRs by (repo, branch) at the time of the `pr-link` record, not by session.

`gh` is installed and signed in here, so the enrichment path in §5.3 is realistic for the author. It stays optional.

## 4. The experience

### 4.1 `/standup`

Prints into the transcript as a command result, no turn started (repos and titles below are illustrative):

```
Standup since Fri 9 Oct

Fri 9 Oct · 5h 18m
- qol-mods · 4h 16m
  - #2 coach · 2h · A weekly coach for how you use Claude Code
    - 13:53–16:47 · 4 commits · 42 files · 42 test runs · Claude alone 14m
  - main · 2h 16m · README previews
    - 12:16–13:54 · 1 file
- api · 1h 2m
  - master · 1h 2m · Rate limit the search endpoint
    - 10:08–12:05 · 1 commit · 3 files · 4 test runs

Today so far (Mon 12 Oct) · 45m
- qol-mods · 45m
  - worklog · 45m · Standup and worklog plugin
    - 10:15–11:00 · 13 files · 31 test runs
```

A command's output is text with no buttons, so copying is an argument: `/standup copy` puts the same text on the clipboard as well.

Arguments: `/standup` (last working day + today), `/standup today`, `/standup yesterday`, `/standup 2026-10-07`, each with `full` (the details under each branch, Appendix A.6) and `copy`. `/standup week` comes with the timesheet in phase 2.

"Last working day" skips Saturday and Sunday by default, set by `workDays`. The standup covers every day from it up to yesterday, so Monday's shows weekend work too. Days with nothing are left out.

### 4.2 `/worklog` pane

A pane opened with `$.ui.open`, two tabs:

- **Day.** Date header with ← → buttons and a total. Repos, then PR/branch groups, each with its time, its first and last activity ("10:05–12:40"), and what went into it: PR title and state, commit subjects, session titles. Expand a group to see its sessions and commits. A thin 24-hour strip at the top shows when the user was active, coloured by repo.
- **Week.** The timesheet: one row per repo › PR/branch, one column per day, hours in cells, totals on the right and the bottom. Rounded per `roundTo` (§6.5). Week starts per `weekStartsOn`.

Buttons: **Copy Markdown**, **Copy CSV**, **Save CSV** (to `~/Documents/worklog/2026-W41.csv` by default), **Refresh**.

A footer note: "Estimated from Claude Code and git activity. 15-minute idle gap." The settings name is a link to the setting.

### 4.3 First run

The first `/standup` or `/worklog` scans everything, which can take a while on a big `~/.claude/projects`. The pane shows "Reading your logs… 120 of 517 files". `/standup` says "Still reading your logs. Try again in a moment, or open /worklog to watch." After that, scans are incremental and fast (§5.2).

Nothing is drawn outside these two commands: no band above the prompt, no status line, no toasts.

## 5. Data sources

### 5.1 Claude Code transcripts (primary)

`~/.claude/projects/*/*.jsonl`, plus `*/<session>/subagents/*.jsonl`. Records used:

| Record | Used for |
|---|---|
| any record with `timestamp` + `cwd` | an activity event at that time, in that repo, on `gitBranch` |
| `user` with a typed prompt (coach §6.3's rule for human prompts) | a **human** event |
| `permissionDecision`, interrupts | **human** events |
| `assistant`, tool results, `isSidechain` | **agent** events (same session, not counted separately) |
| `pr-link` | PR number, URL and repo for that (repo, branch) |
| `custom-title` | the session's label, used as a "what" line |
| `entrypoint` | `sdk-*` / `-p` runs are unattended: shown, but not counted as the user's time |

### 5.2 git (secondary, catches work done outside Claude)

For every repo seen in the transcripts, plus those under `extraRoots` (the folder itself, its children and grandchildren), git's reflogs are read from disk (`gitlog.py`, Appendix B.1). No git command runs.

- `.git/logs/refs/heads/<branch>`: each commit made on the branch on this machine, with its subject and minute ("commit", "commit (amend)", "commit (merge)", "cherry-pick"), and the branch's other moves (created, reset, rebased, pulled).
- `.git/logs/HEAD` and each worktree's: the switches between branches ("checkout: moving from a to b").

A commit or a switch is the user's own, outside Claude, when no session was at work in that repo within two minutes of it and no session ran a commit with the same subject within five. Those are human events: a lone commit yields a span of its own (§6.2's lead-in), so an evening of hand-coding shows up, as short spans. The rest are Claude's: their commits join the session's group, and they add no time.

### 5.3 GitHub via `gh` (optional enrichment)

When `useGitHub` is on, one read-only GraphQL call per scan window (`ghsearch.py`), two searches in one request (`gh search prs --json` has no `headRefName`):

```
gh api graphql -f query=… -f authored="is:pr author:@me updated:>=<from>" -f reviewed="is:pr reviewed-by:@me -author:@me updated:>=<from>"
```

It gives each PR's number, title, state, draft flag, head branch and repo, and for reviewed PRs the user's own reviews with their times.

- `pr-link` PRs get GitHub's title and state. A branch with no link gets its PR by `headRefName` in the repo whose `origin` it is (never a default branch); with several, the latest.
- Each review goes on the day it was submitted, as a "Reviewed" line with no time attached.
- Open PRs are listed at the end of the standup.

Results are cached in the scan cache for 10 minutes; a failed call falls back to the last answer, however old. No `gh`, signed out or offline: PRs keep what the transcripts say and the rest is left out. `gh` is looked for on PATH, then in Homebrew's and the usual places, as an app started from the dock may not have Homebrew on its PATH. The call never waits more than 5 s.

### 5.4 Resolving a record to a repo

1. `cwd` → repo root via `git -C <cwd> rev-parse --show-toplevel --git-common-dir`, cached per `cwd`. A worktree resolves to its main repo through the common dir.
2. If the folder is gone (Claude worktrees are often removed), fall back to the project-folder slug: strip `--claude-worktrees-…`, as repo-spend's `WORKTREE` does.
3. Not inside a repo (scratchpads, `/tmp`, `$HOME`) → dropped. Opt in with `includeNonRepo` to get an "Other" group.
4. Display name: the GitHub `owner/repo` from `origin` when there is one, else the folder name.

## 6. Time

### 6.1 Events

An event is `(ts, repo, branch, sessionId, kind)`, where `kind` is `human` or `agent`. A day is local time, starting at `dayStartsAt` (default 04:00, so a 1 a.m. push counts toward the evening before).

### 6.2 Spans per stream

Spans are worked out per **session**, across its branch switches, and each minute then goes to the (repo, branch) the session was on at that minute (Appendix A.1). Within a session:

- Sort events. Join consecutive events closer than `idleGapMin` (default 15) into a span.
- Add a `leadInMin` (default 5) before a span's first human event. The prompt's timestamp is when it was sent, not when the user started thinking about it.
- **Unattended cap.** Agent-only activity counts for at most `maxUnattendedMin` (default 30) after the last human event. A two-hour autonomous run started at 18:00 doesn't fill the user's evening. The rest is reported as "Claude ran for another 1h 30m" and is not in the total.

### 6.3 Parallel sessions: allocation

The prototype's 8.2 h vs 5.4 h means this is the core of the plugin.

- The **day total** is the union of all streams' spans: the user's wall-clock active time.
- Each minute of the union is split evenly among the streams active in that minute. Three parallel sessions in one minute each get ⅓ of it.
- Per-group times therefore always sum to the day total.
- A finer weighting (more weight to the stream with the human event in that minute) is a phase 2 option. Start with the even split, which is easy to explain and test.

Each group also keeps its raw, unallocated span time ("2h 40m, 1h 55m after overlaps"), shown on hover/expand. That way a user who wants "time the branch was open" still has it.

### 6.4 Grouping

Day → repo → PR (when a branch maps to one) or branch → sessions and commits.

- Branch → PR mapping, in order: `pr-link` records → `gh` by `headRefName` → none. A `pr-link` takes the branch of the session's next prompt, and a PR keeps the branch of its first link (Appendix A.2).
- The default branch (`main`, `master`, the remote's HEAD) is labelled "on main" and its "what" lines lean on session titles and commit subjects, since there's no PR title.
- Detached `HEAD` joins the nearest branch in the same session, or "detached".

### 6.5 Timesheet rounding

`roundTo` (off, 5, 15, 30 minutes; default 15). Cells are rounded with the largest-remainder method, so each day's rounded cells add up to that day's rounded total, and no cell is rounded away to zero when it had over half a step.

## 7. Architecture

The same split as repo-spend and coach: a standard-library Python scanner that's unit-testable, and a TypeScript hooks module that draws and wires commands.

### 7.1 Files

```
plugins/worklog/
  .claude-plugin/plugin.json
  README.md
  SPEC.md
  hooks/
    hooks.json            { "modules": ["./register.tsx"] }
    register.tsx          commands, scans, pane and row drawing, copy/save: everything that touches $
    pane.tsx              the pane's Day and Week views
    view.tsx              how a day, a standup and a week look, on each surface
    art.ts                the Svg pictures: repo share, timeline rows, hour axis, dots
    standup.ts            the words: headlines, counts, details, the standup's text
    labels.ts             a branch's label and headline, shared by the words and the timesheet
    timesheet.ts          the week: rows, rounding, Markdown, text and CSV
    days.ts               dates and durations
    settings.ts           userConfig and scan.py's argv
    scan.py               transcripts, git and GitHub → per-day summaries (JSON out), cache, archive
    timeline.py           spans, unattended cap, allocation (pure functions)
    facts.py              what a record says: asks, commits, PR titles, edits, tests
    gitlog.py             commits and branch switches from the reflogs on disk
    ghsearch.py           PR titles and states, reviews, open PRs through gh
  types/index.d.ts        $.state contract and the scan's types
  tests/
    test_timeline.py      spans, gaps, lead-in, cap, overlap split
    test_facts.py         asks, commits from commands, here-documents, folders
    test_gitlog.py        reflogs, repo discovery, the GitHub answer and its cache
    test_scan.py          fixture transcripts and repos → expected days, end to end
    standup.test.ts       the words
    timesheet.test.ts     rounding sums, the three formats
    commands.test.ts      /standup and /worklog, settings into argv
    look.test.ts          rows and the pane drawn on both surfaces
    pane.test.ts          the Day view's buttons
    week.test.ts          the Week view, /standup week, copy and save
    helpers.ts, fixtures.ts
```

If the slug → repo logic ends up identical to repo-spend's, move it to `shared/` and copy it in with `scripts/sync-shared.py`, as `pricing.py` is.

### 7.2 Scanning

- `register.tsx` runs `python3 scan.py --from <date> --to <date> …` through `$.process.run` (10-minute ceiling on first run) and reads one JSON object back.
- **Per-file cache** keyed by (path, size, mtime) in `~/.cache/claude-worklog/`. Each entry holds that file's events, reduced to per-minute buckets per stream (a minute, a stream, a human flag). That keeps the cache small and the allocation exact to the minute.
- **Archive** in `$XDG_DATA_HOME/claude-worklog/days/YYYY-MM-DD.json`: a day is frozen once it's over and older than 2 days (late-arriving logs settle first). Frozen days are read from the archive, so last month's timesheet survives Claude Code deleting the logs. Same durability idea as repo-spend's archive and coach's weekly rows.
- Rescan on `/standup`, on `/worklog` open, and on Refresh. No background timer in v1: nothing is drawn until asked, so there's nothing to keep fresh.
- One scan at a time, guarded by a lock file (repo-spend's `fcntl` pattern).

### 7.3 Output JSON (scanner → module)

```json
{
  "days": [{
    "date": "2026-10-09",
    "totalMin": 325,
    "unattendedMin": 40,
    "activity": [[600, 3], [601, 3]],
    "repos": [{
      "repo": "aseem-upadhyay/qol-mods",
      "path": "/Users/…/claude-mods-repo",
      "groups": [{
        "branch": "coach",
        "pr": { "number": 1, "title": "Coach plugin", "state": "open", "url": "…" },
        "allocatedMin": 160,
        "rawMin": 230,
        "first": "2026-10-09T10:05:00+05:30",
        "last": "2026-10-09T17:40:00+05:30",
        "what": ["Coach plugin", "Add weekly report pane", "…"],
        "sessions": [{ "id": "384a…", "title": "…", "min": 95 }],
        "commits": [{ "sha": "3cfea17", "subject": "…", "at": "…" }]
      }]
    }]
  }],
  "reviews": [{ "repo": "…", "number": 415, "title": "…" }],
  "openPrs": [ … ],
  "coverage": { "oldestLog": "2026-09-10", "archivedDays": 12 },
  "warnings": ["gh not signed in: PR titles from transcripts only"]
}
```

### 7.4 Plugin API used

| Need | API |
|---|---|
| `/standup`, `/worklog` | `$.command.register` in `session.start`, `command.run` hooks returning `{ text }` |
| The pane | `$.ui.open({ id, title })` + `ui.render` on `{ component: 'Pane', requestId }` |
| Pane state (tab, date, expanded groups) | `atom` / `read` / `update`, declared in `types/index.d.ts` |
| Running the scanner, `git`, `gh` | `$.process.run` |
| Copy | `$.ui.copy({ text, surface: press.surface })` |
| Save CSV | `$.fs.write` |
| Settings | `userConfig` in `plugin.json` |

## 8. Output formats

### 8.1 Standup (Markdown)

As in §4.1. `standupStyle` option: `grouped` (default), or `classic` (Yesterday / Today / Blockers headings, with Blockers left blank for the user to fill in).

### 8.2 Timesheet Markdown

A table the same shape as the Week tab, for the user to paste wherever they keep timesheets.

### 8.3 CSV

One row per (date, repo, group), so it pivots in any spreadsheet:

```
date,repo,pr,branch,title,hours,raw_hours,first,last
2026-10-09,aseem-upadhyay/qol-mods,1,coach,Coach plugin,2.75,3.83,10:05,17:40
```

### 8.4 Nothing leaves without the user

worklog shows; it never sends. The only ways out are Copy (to the clipboard) and Save CSV (a file in `csvFolder`), each a button the user presses. There is no Slack, Jira or email integration, and no button that hands the standup to Claude to rewrite or post. A user who wants that can paste it into a prompt themselves.

## 9. Settings (`userConfig`)

| Key | Default | |
|---|---|---|
| `idleGapMin` | 15 | Gap that ends a span |
| `leadInMin` | 5 | Time added before a span's first human event |
| `maxUnattendedMin` | 30 | Agent-only time counted after the last human event |
| `dayStartsAt` | `"04:00"` | When a day rolls over |
| `workDays` | `"mon-fri"` | For "last working day" |
| `weekStartsOn` | `monday` | Week tab and `/standup week` |
| `roundTo` | 15 | Timesheet rounding, minutes: 0 (none), 5, 6, 10, 15, 30 or 60 |
| `useGitHub` | true | Use `gh` for PR titles, states, reviews and open PRs when signed in |
| `extraRoots` | `""` | Folders to look for repos worked on without Claude (two levels down) |
| `excludeProjects` | `""` | Folders never read (client work), same as coach's |
| `includeNonRepo` | false | Count work outside any repo as "Other" |
| `csvFolder` | `"~/Documents/worklog"` | Where Save CSV writes |

## 10. Privacy

- Reads only local files plus, when `useGitHub` is on, GitHub through the user's own `gh` login, about PRs GitHub already has. Nothing is written anywhere but the cache, the archive and a CSV the user saves.
- No model calls, ever. The "what" lines are built from PR titles, commit subjects and session titles as they are.
- The archive (`$XDG_DATA_HOME/claude-worklog/days`, else `~/.local/share`) holds each settled day as shown: repos, branches, titles, commit subjects, folders, times and, with `includePrompts` on, the quoted prompts. With it off, none are kept, and any kept earlier are left out when read back.
- `excludeProjects` folders are skipped before any file is opened.

## 11. Phases

**Phase 1 (0.1.0): the standup** (done)

- `scan.py` + `timeline.py` over transcripts, with repo resolution, spans, unattended cap, allocation, `pr-link` mapping.
- `/standup` with Copy.
- `/worklog` Day tab.
- Tests: timeline unit tests, fixture transcripts covering the four prototype findings (§3).

**Phase 2 (0.2.0): the timesheet** (done)

- `gitlog.py`: commits and branch switches from the reflogs on disk, `extraRoots`. (`authorEmails` was dropped: a reflog is this machine's alone.)
- `ghsearch.py`: titles, states, reviews, open PRs, branch → PR for PRs Claude didn't open.
- Week tab, rounding, Copy (Markdown) / Copy CSV / Save CSV; `/standup week`, `/worklog week`, and `last week` for each.
- Archive of settled days.

**Phase 3 (0.3.0): polish**

- Weighted allocation (§6.3).

## 12. Testing

- **Timeline**: a gap of exactly `idleGapMin`; lead-in at the start of the day straddling `dayStartsAt`; a 2-hour autonomous run capped at 30 minutes; three overlapping streams summing to the union; daylight-saving days.
- **Scan**: fixture transcripts for a subfolder `cwd`, a deleted worktree, a scratchpad `cwd`, one session with two PRs, a branch switch mid-session, a `-p` run.
- **Timesheet**: rounded cells sum to rounded day totals; CSV quoting of titles with commas and quotes.
- **Standup**: Monday picks Friday; empty day says so; open PRs listed once.
- **Manual check**: run against the author's own logs for a week and compare with memory and calendar. Note anything off by more than 30 minutes a day, and tune the defaults.

Check before each commit, as the repo README says:

```
claude plugin validate . && claude plugin validate plugins/worklog && claude plugin test plugins/worklog
```

## 13. Open questions

1. **Name.** `worklog` (with `/standup` as a command) or `standup`? This plan uses `worklog` because the timesheet outlives the standup.
2. **Does git-only work count toward the total?** Built as counting: a lone commit or switch outside Claude gives a 6-minute span, close ones join. Revisit if it reads as too little or too much.
3. **Default `idleGapMin`.** 15 minutes matches how long Claude often works between prompts. Some people read a long diff for 20+ minutes. Tune it from the manual check.
4. **Review time.** Reviewing a PR in the browser leaves no local trace. Built as listing reviews with no time. A manual "add 30m" would need editable state and moves away from "estimated from logs".

## Appendix A. What changed in phase 1

Built and checked against the author's own logs for 9 and 10 October 2026.

### A.1 Attendance is a session's, not a branch's

Spans per (repo, branch) marked work as unattended the moment a session switched branch: the new branch had no human event yet, so everything Claude did there fell past the cap. Spans are now worked out per session across its branches, and each attended minute is credited to the branch the session was on then (`scan.py`, step 3). Two sessions on one branch still count that branch once per minute.

### A.2 A PR's branch comes from the next prompt

A record's `gitBranch` is the branch as its turn started. Claude usually creates the branch and opens the PR in one turn, so the `pr-link` record carries the previous branch. `pr-link` records also repeat later, each time the PR's status is checked, from whatever branch the session is on by then. Taking the branch at the link put 3 of the author's 8 PRs on the wrong branch. Now a link waits for the session's next human prompt and takes its branch (the session's last branch when no prompt follows), and each PR keeps its first link. All 8 matched the merge commits. A branch with several PRs shows its latest.

### A.3 Smaller changes

- Repos resolve by reading `.git` on disk (a folder, or a worktree's `gitdir:` file and its `commondir`), not by running `git`. It is faster, needs no `git`, runs nothing from the repo, and still finds the repo of a deleted `<repo>/.claude/worktrees/<name>` by walking up. `$HOME` never counts as a repo, so a dotfiles repo can't swallow everything.
- Temp folders (`/tmp`, `/private/tmp`, `/var/folders`) are left out even when they hold a git repo: Claude makes throwaway repos in its scratchpads.
- Session titles "New session" and "Untitled" are dropped from the "what" lines.
- Only transcripts modified since a day before the window are opened, so the first scan reads days, not months. On the author's machine it takes 0.6 s cold and 0.07 s cached.
- `scan.py` takes days relative to today (`--from=-8 --to=0`) and reports `today`, so the hooks module never needs the local timezone.
- The pane's Day view has no expandable groups yet. Each group shows its session titles, its time before sharing with parallel sessions, and Claude's time alone.

### A.4 How it looks

- One drawing for both commands (`view.tsx`): a summary (heading, total, what the day held, the day split by repo), then each repo's PRs and branches with a timeline of their stretches. The pane shows it all; `/standup`'s row leaves out the timeline and the time before sharing.
- `/standup`'s reply is drawn from data, not from its text: the reply is kept in `$.state` under its text, and a `CommandOutput` hook draws the row from it. The row's text leads with the plugin's name ("worklog: …"), which the lookup strips. A row from before a `/clear` or a resume has no data and draws as its text, which is a Markdown list.
- Desktop: the bars are Svg in the dataviz reference palette (validated in light and dark; three light slots under 3:1, so every mark is labelled beside it), stepped by the operating system's scheme since an Svg is drawn as an image. Every word is Text or Markdown, in the app's theme.
- Terminal: theme colors per repo (`suggestion`, `claude`, `success`, …), `━` for the share bar, `█ ▄ ░ ·` for worked, partly worked, Claude alone and nothing. A pane docked at about 48 columns puts each timeline under its name; under about 20 it drops them.
- A repo's color comes from its name, so it stays the same from day to day.

### A.5 Summaries from facts

Session titles alone said too little. Each group now carries facts read straight from its sessions' records (`hooks/facts.py`), each attributed to the group its session was on at that minute and to that day:

- **asks**: the user's prompts, one line each, up to 160 characters. Replies with nothing in them ("yes", "go ahead"), slash commands, interrupts and tagged text (task notices, subagent reports) are skipped. Queued messages are not quoted from the queue, which also carries the engine's own notices; the prompt is quoted from its user record. Three per group per day: the longest, in the order asked. `includePrompts` off (`--no-asks`) leaves them out.
- **commits**: Claude commits with `-q`, so git's `[branch sha] subject` line is rarely there. The subject is read from the command itself (`-m`, `-am`, `-F -` with a here-document, `-m "$(cat <<'EOF' …)"`), and from git's line when it is. A command that runs a script (`python3 - <<…`) is skipped, since a `git commit` in it is the script's text.
- **PR title**: the `--title` of the `gh pr create` before a `pr-link`.
- **files**: Edit, Write, MultiEdit and NotebookEdit paths, relative to the repo (a worktree's included), with edit counts. Temp files and `~/.claude/` are dropped.
- **tests**: Bash commands that run a test runner.

The cache is keyed by `PARSER_VERSION`; it must go up whenever what `read_file` keeps changes, or old entries are served.

### A.6 Three layers, details on demand

Every fact under every branch at once was a wall: seven rows a branch, long values joined with ";" and "·". Each branch now reads in three layers (`standup.ts`):

1. Name and time (and the timeline in the pane).
2. A headline: the PR's title, else the busiest session's name, else the first commit, else the longest ask.
3. One dim line of counts: when, commits, files, test runs, Claude alone.

Details are lists, one item to a line under a dim label (Time, Asked, Commits, Changed, Sessions), shown by `/standup full`, a press on a branch's name in the pane (▸ ▾), or Show details (**d**) for all. Changed files are grouped by folder, three levels deep, instead of listed by path. A standup folds branches under 10 minutes with no PR and no commit into one "Also" line. A blank line separates branches.

Commands are now read as the shell reads them (`facts.shell_lines`): a here-document's body is taken out of the command before looking for `git commit`, `gh pr create` or a test runner, so text written into a file isn't counted as one.

## Appendix B. What changed in phase 2

Built and checked against the author's own logs and repos for 5–10 October 2026.

### B.1 git from its reflogs, not from `git log`

The plan ran `git log --author` and `git reflog` in each repo. Reading the reflogs from `.git/logs` does the same with no git command: a branch's own reflog has every commit made on it on this machine, with its exact branch and minute (which `git log --source` only hints at), and HEAD's has the switches. It needs no author email, since a reflog is this machine's alone, so `authorEmails` was dropped. It runs nothing from the repo, and reading all of the author's five repos' reflogs takes 0.05 s.

Claude makes most commits, and they're in the reflogs too. Counting them as the user's would make a two-hour autonomous run look attended, a commit every twenty minutes resetting the cap. So a reflog entry is Claude's when a session was at work in that repo within two minutes, or when a session ran a commit with that subject within five (a session can commit in another repo: `cd ../app && git commit`). Claude's commits join the group of the session that made them, which also catches commits Claude made with `-q` or from a script, which the transcripts don't show; the same subject from both sources is listed once.

### B.2 GitHub in one GraphQL call

`gh search prs --json` has no `headRefName`, which is what maps a branch to its PR. One `gh api graphql` request runs both searches (authored, reviewed) and returns the head branch, the draft flag and the user's own reviews with their times, in about 1.4 s. On the author's logs it named four PRs the transcripts never linked, gave PR #2 the title its `pr-link` lacked, and marked each PR's state.

### B.3 The archive keeps the best day it has seen

A day is archived once it is two days old (`--archive`, `--today` for tests). Reading back, the computed day wins while it has at least as much time as the archived one, and is written over it, so a settings change still reaches days whose logs exist. Once Claude Code has deleted a day's logs, the computed day comes up short or empty and the archived one is used, marked `source: "archive"`; folders excluded since are taken out of it, and its prompts too with `includePrompts` off.

### B.4 The week

`timesheet.ts`: a row per repo and PR or branch, a column per day, totals both ways. Each day's total is rounded to `roundTo`, then its cells: each down to a step, the steps left over to the cells nearest the next one, and a cell of more than half a step never rounded to nothing. On the terminal it is a grid of seven columns while the names get at least 14 columns (the names shrink to fit; about 71 columns in all), else two lists; on the desktop a Markdown table. Copy gives the Markdown table, Copy CSV and Save CSV a row per day and branch (§8.3), to `csvFolder/week-of-<first day>.csv`.

### B.5 Smaller changes

- The counts line says the PR's state ("PR merged", "draft PR"); a commit made by hand says "outside Claude" among the details; a day read from the archive says so.
- A day with only reviews counts as a day with work, so a standup shows it.
- The pane's Day and Week views are two buttons (**1**, **2**), the active one in the accent color.
- `$.state` survives a reload, so drawings read fields new in 0.2.0 (`reviews`, `openPrs`, `handCommits`) as possibly missing, for days kept from 0.1.0.

