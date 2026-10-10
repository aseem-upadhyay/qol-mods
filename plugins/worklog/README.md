<div align="center">

# worklog

**What did I do yesterday?**

Your work day by day, across every repo, grouped by PR and branch, with the time spent. Ready for standup, good enough for a timesheet.

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757?style=flat-square)](#install)
[![macOS | Linux](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-555?style=flat-square)](#requirements)
[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-3776AB?style=flat-square&logo=python&logoColor=white)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](../../LICENSE)

</div>

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

## Features

- 🗂️ **Every repo at once.** Sessions in any repo on your machine, worktrees counted toward their main checkout.
- 🔀 **By PR, then branch.** PRs come from your sessions' own logs, so it works offline.
- ⏱️ **Time that adds up.** Parallel sessions share the minutes they overlap, so a day's groups add up to the time you were actually at it.
- 🤖 **Your time, not Claude's.** Claude working alone counts for 30 minutes after your last message. Anything longer is shown apart, not added to your day.
- 🌙 **Late nights stay on the right day.** A day runs 04:00 to 04:00 by default.
- 🎨 **At home on both.** In the desktop app the day is split by repo in one bar and each branch gets a timeline of its stretches (hover for times); in the terminal the same is drawn in theme colors with block characters, beside each name or, in a docked pane, under it.
- 🔒 **Shows, never sends.** It reads the logs Claude Code already keeps and shows you what it finds when you ask. Nothing is posted or sent anywhere. Copy it if you want it elsewhere.
- ⚡ **Cheap.** Only logs written since the day asked for are read, and unchanged ones come from a cache.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install worklog --marketplace aseem-upadhyay/qol-mods
```

Answer `y` to add the marketplace and pick the **user** scope.

## Use

| Command | What it shows |
| --- | --- |
| `/standup` | Since your last work day (Monday shows Friday and the weekend), and today so far |
| `/standup today`, `/standup yesterday`, `/standup 2026-10-07` | That day |
| `/standup full` | With what you asked, committed and changed under each branch |
| `/standup copy` | Any of the above, put on your clipboard as well |
| `/worklog` | Today in a pane, with when in the day you worked. Press a branch for its details or **d** for all; move a day at a time with **p** and **n**; copy the day with **c** |
| `/worklog yesterday`, `/worklog 2026-10-07` | That day in the pane |

## How time is counted

Each session's log has a timestamp on everything that happened. From those:

1. **Stretches of work.** Activity with gaps of 15 minutes or less is one stretch. A stretch that starts with your message gets 5 minutes before it, for the reading and thinking before you typed.
2. **You or Claude.** Your messages, slash commands, interrupts, messages queued while Claude worked and permissions you answered are you. The rest is Claude. Claude's work counts for 30 minutes after your last message; past that it's "Claude alone", shown but not in your total. Headless runs (`claude -p`, the SDK) are always Claude alone.
3. **Repo and branch.** Each minute goes to the repo and branch its session was on. A session that switches branch moves its time with it.
4. **Overlaps.** A minute two sessions share is split between them, so the day's total is wall-clock time.

All of these are settings. Work in folders outside a git repo, and in temp folders, is left out unless you turn on **Count work outside repos**.

PR numbers come from Claude Code's own PR links in the logs. A PR is matched to the branch the session is on at the start of the turn after it's opened, because Claude usually makes the branch and the PR in the same turn.

## What the summaries say

Each PR or branch reads in three layers, so a day scans quickly:

1. **Its name and time**, and in `/worklog` its stretches of the day.
2. **A headline**: the PR's title, else the name of the session that spent most time on it, else its first commit, else the longest thing you asked.
3. **One line of counts**: when, commits, files changed, test runs, and Claude's time alone when there was some.

The details come only when you want them: `/standup full`, a press on a branch's name in `/worklog` (or **d** for every branch). Each is a list, one item to a line, from one place in the logs:

| Section | From |
| --- | --- |
| **Time** | (`/worklog`) The branch's own time, and how much of it counted once parallel sessions shared it |
| **Asked** | Up to three of your own prompts, quoted, the longest, in the order you asked them. Replies like "yes" and slash commands are skipped |
| **Commits** | The messages of commits Claude made, read from the `git commit` it ran |
| **Changed** | The folders Claude's edits were in, with how many files. Scratch files and Claude's own files are left out |
| **Sessions** | The other sessions on that branch |

In a standup, a branch under 10 minutes with no PR and no commit folds into one "Also" line. Nothing is summarised by a model. Turn off **Quote your prompts** to leave the Asked lines out.

## Settings

Open `/config` and find worklog, or set them under `pluginConfigs.worklog.options` in `~/.claude/settings.json`.

| Setting | Default | |
| --- | --- | --- |
| Idle gap | 15 min | A gap this long ends a stretch of work |
| Lead-in | 5 min | Added before a stretch that starts with your message |
| Claude working alone | 30 min | How long after your last message Claude's work still counts |
| Day starts at | 04:00 | Work before this counts toward the day before |
| Work days | mon–fri | `/standup` reports since the last one |
| Folders to leave out | none | Never read, such as client work |
| Count work outside repos | off | Show it as "Other" |
| Quote your prompts | on | Up to three of your prompts per branch in the summaries |

## Accuracy

These are estimates from activity, not a timer. Time spent reading code in your editor, in meetings or in a browser with no session running isn't seen. Claude Code deletes logs after 30 days by default (`cleanupPeriodDays`), so older days come up empty.

## Requirements

- Claude Code with mod (hooks module) support
- `python3` 3.9 or later on `PATH`
- macOS or Linux

## Coming next

A week timesheet with CSV export, commits made outside Claude, PR titles and states from `gh`, and days kept after the logs are deleted. See [SPEC.md](SPEC.md).
