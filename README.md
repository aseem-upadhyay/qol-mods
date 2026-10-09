<div align="center">

# qol-mods

**Quality-of-life mods for [Claude Code](https://claude.com/claude-code).**

Small add-ons that make Claude Code nicer to use and help newcomers get good at it faster.
Each one fixes a small annoyance or builds a good habit.

[![Claude Code plugins](https://img.shields.io/badge/Claude%20Code-plugins-D97757?style=flat-square)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](LICENSE)

</div>

## Mods

### [repo-spend](plugins/repo-spend)

How much have you burned on this repo, and how much value are you getting from your plan? A live bar above the prompt shows the repo's total over the time your logs cover ("last 3 months"), today, the last 7 days, and this session's cost and burn rate. On an API key that's the credits you've spent; on Pro or Max, what your usage would have cost at API prices.

<img src="plugins/repo-spend/assets/preview-desktop.svg" alt="The Claude desktop app. Above the message box, a rounded bar reads: my-app, about $1,284.50 in the last 3 months, $12.30 today, $96.75 in the last 7 days; on the right, $4.12 this session, a small green bar chart, and $6.04 an hour." width="100%">
<p><sub>In the Claude desktop app</sub></p>

<img src="plugins/repo-spend/assets/preview-cli.svg" alt="A Claude Code terminal. Above the prompt, a one-line bar reads: my-app, about $1,284.50 in the last 3 months, $12.30 today, $96.75 in the last 7 days; on the right, $4.12 this session, a green sparkline, and $6.04 an hour." width="100%">
<p><sub>In the terminal (<code>claude</code>)</sub></p>

```
/plugin install repo-spend --marketplace aseem-upadhyay/qol-mods
```

### [coach](plugins/coach)

How well are you using Claude Code, and what's the one thing to get better at next? A weekly report built from your own sessions: one habit to work on, with the session it came from; CLAUDE.md lines for what Claude keeps rediscovering; prompts you keep typing that could be skills; tips at your level; and your progress over the weeks. Everything stays on your machine.

<img src="plugins/coach/assets/preview-desktop.svg" alt="The coach report in the Claude desktop app. A coral card: your week with Claude, 28 Sep to 4 Oct, week 4; 10 sessions, 18 prompts, $6.14 spent, up 40% on the four weeks before, and $0.25 for a typical prompt, down 15%; beside them, spend by day. Below, the habit of the week, start fresh when you switch topics, with a ring at 33% against a goal of 70% and two of three switches done this week; then eight weeks of progress as small charts." width="100%">
<p><sub>In the Claude desktop app</sub></p>

<img src="plugins/coach/assets/preview-cli.svg" alt="A Claude Code terminal with the coach report open: last week's sessions, prompts and spend in four framed tiles; the habit of the week, start fresh when you switch topics, 1 of 3 switches against a goal of 70%, with the session it came from; and two CLAUDE.md lines to copy. Above the prompt, the coach line keeps the habit in view: 2 of 3 switches this week." width="100%">
<p><sub>In the terminal (<code>claude</code>)</sub></p>

```
/plugin install coach --marketplace aseem-upadhyay/qol-mods
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
```

## Adding or changing a mod

1. Put the plugin in `plugins/<mod>/`, with a `.claude-plugin/plugin.json` and a README, and list it in `.claude-plugin/marketplace.json`.
2. Raise `version` in its `plugin.json` with every change. Installed copies are cached by version, so a change under the same version never reaches anyone, including your own desktop sessions.
3. Check it, then commit:

```bash
claude plugin validate . && claude plugin validate plugins/<mod> && claude plugin test plugins/<mod>
```

## License

[MIT](LICENSE)
