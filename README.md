<div align="center">

# qol-mods

**Quality-of-life mods for [Claude Code](https://claude.com/claude-code).**

Add-ons that make Claude Code better to use.
Each one adds something the built-in experience doesn't give you.

[![Claude Code plugins](https://img.shields.io/badge/Claude%20Code-plugins-D97757?style=flat-square)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)
[![Website](https://img.shields.io/badge/website-qolmods.dev-D97757?style=flat-square)](https://qolmods.dev/)

</div>

## Mods

| Mod | What it does | |
| --- | --- | --- |
| **[worklog](plugins/worklog)** <sup>new</sup> | What you did, day by day, across every repo, by PR and branch with the time spent: `/standup` for the meeting, `/worklog` for any day or a week's timesheet | [Website](https://qolmods.dev/worklog/) |
| **[coach](plugins/coach)** | A weekly coach built from your own sessions: one habit at a time, tips at your level, CLAUDE.md lines and skills worth making | [Website](https://qolmods.dev/coach/) |
| **[repo-spend](plugins/repo-spend)** | A live bar above the prompt with what the repo has cost you: running total, today, the last 7 days, and this session's burn rate | [Website](https://qolmods.dev/repo-spend/) |

More are on the way. Each mod's README has the full details.

### [worklog](plugins/worklog)

What did I do yesterday? worklog reads the sessions you've already had and your repos' git, and lays out your work day by day: every repo, grouped by PR and branch, with the time spent, what each was, and its commits, files and test runs. `/standup` covers the last work day (Monday covers Friday and the weekend), `/worklog` shows any day with a timeline of when you worked, and `/worklog week` makes the week's timesheet, rounded to 15 minutes, to copy or save as CSV.

<img src="plugins/worklog/assets/preview-desktop.svg" alt="The worklog pane in the Claude desktop app, on Thursday 22 October 2026: 6h 19m across 3 repos, 5 branches, 2 PRs and 1 review, the day split by repo in one bar. Under it each branch has a timeline of its stretches from 09:00 to 18:00: my-app's #42 checkout-redesign, Redesign the checkout page, 2h 58m, PR open, opened to show what was asked, its three commits and the folders it changed; main, 1h 15m; api's #118 rate-limit, merged, 1h 32m; and docs, 28m, committed by hand." width="100%">
<p><sub><code>/worklog</code> in the Claude desktop app</sub></p>

<img src="plugins/worklog/assets/preview-cli.svg" alt="A Claude Code terminal after /standup: Standup for Thu 22 Oct. Thursday, 6h 19m across 3 repos, split in a colored bar: my-app 4h 19m, with #42 checkout-redesign, Redesign the checkout page, 2h 58m, PR open, 3 commits, 14 files, 18 test runs, and main, Fix the flaky cart test, 1h 15m; api 1h 32m, #118 rate-limit merged; docs 28m. Then the PR reviewed, today so far, 3h 25m, and the open PRs." width="100%">
<p><sub><code>/standup</code> in the terminal</sub></p>

```
/plugin install worklog --marketplace aseem-upadhyay/qol-mods
```

### [coach](plugins/coach)

How well are you using Claude Code, and what's the one thing to get better at next? coach reads the sessions you've already had and picks the habit that would help you most, shows you the session it came from, and tracks how you're doing week by week. It also suggests CLAUDE.md lines for what Claude keeps rediscovering, and skills for prompts you keep typing.

<img src="plugins/coach/assets/preview-desktop.svg" alt="The coach report in the Claude desktop app. A coral card: your week with Claude, 28 Sep to 4 Oct, week 4; 10 sessions, 18 prompts, $6.14 spent, up 40% on the four weeks before, and $0.25 for a typical prompt, down 15%; beside them, spend by day. Below, the habit of the week, start fresh when you switch topics, with a ring at 33% against a goal of 70% and two of three switches done this week; then eight weeks of progress as small charts." width="100%">
<p><sub>The weekly report in the Claude desktop app</sub></p>

```
/plugin install coach --marketplace aseem-upadhyay/qol-mods
```

### [repo-spend](plugins/repo-spend)

How much have you burned on this repo, and how much value are you getting from your plan? A live bar above the prompt shows the repo's total over the time your logs cover ("last 3 months"), today, the last 7 days, and this session's cost and burn rate. On an API key that's the credits you've spent; on Pro or Max, what your usage would have cost at API prices.

<img src="plugins/repo-spend/assets/preview-desktop.svg" alt="The Claude desktop app. Above the message box, a rounded bar reads: my-app, about $1,284.50 in the last 3 months, $12.30 today, $96.75 in the last 7 days; on the right, $4.12 this session, a small green bar chart, and $6.04 an hour." width="100%">
<p><sub>The bar in the Claude desktop app</sub></p>

```
/plugin install repo-spend --marketplace aseem-upadhyay/qol-mods
```

## Install

Every mod installs the same way. Type this at the prompt of a Claude Code terminal session, replacing `<mod>` with the mod's name:

```
/plugin install <mod> --marketplace aseem-upadhyay/qol-mods
```

Answer `y` to add the marketplace (only the first time), then pick the **user** scope so the mod loads in every session. Installing from a terminal also makes the mod load in the desktop app's Code tab.

To pick up new versions:

```bash
claude plugin marketplace update qol-mods && claude plugin update <mod>@qol-mods
```

Then type `/reload-plugins` in any session that was already open.

## Layout

```
.claude-plugin/marketplace.json   the catalogue: every mod in this repo
plugins/<mod>/                    one self-contained plugin per mod, with its own README
shared/                           code more than one mod uses; each keeps a copy (scripts/sync-shared.py)
scripts/                          helpers for maintaining the mods, such as drawing README images
docs/                             the website, qolmods.dev: a home page with a card per mod, and docs/<mod>/ for each mod's page
```

## Adding or changing a mod

1. Put the plugin in `plugins/<mod>/`, with a `.claude-plugin/plugin.json` and a README, and list it in `.claude-plugin/marketplace.json`.
2. When it launches, add it to the table and a section under [Mods](#mods), give it a card in `docs/index.html` and a page at `docs/<mod>/index.html` (copy an existing one), put its images in `docs/assets/<mod>/`, and list the page in `docs/sitemap.xml`.
3. Raise `version` in its `plugin.json` with every change. Installed copies are cached by version, so a change under the same version never reaches anyone, including your own desktop sessions.
4. Check it, then commit:

```bash
claude plugin validate . && claude plugin validate plugins/<mod> && claude plugin test plugins/<mod>
```

## License

[MIT](LICENSE)
