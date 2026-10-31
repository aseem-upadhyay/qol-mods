<div align="center">

# worktrees

**Which of these worktrees can I delete?**

Every git worktree of the repo in one pane: a dot for how stale it is, its size and a bar of where your disk goes, who's using it, and a button to remove it.

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757?style=flat-square)](#install)
[![macOS | Linux](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-555?style=flat-square)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](../../LICENSE)

</div>

## Features

- 🌳 **Every worktree, one pane.** Type `/worktree` and every worktree of the session's repo is listed: the main one, Claude's own under `.claude/worktrees/`, and any you made elsewhere.
- 🕰️ **How stale each is.** Active, Idle, Stale or Very stale, from the newest of its last commit, its last edit to an uncommitted file and the last Claude session that ran there. You set the number of days (14 by default).
- 💾 **What it takes on disk.** Each folder measured with `du`, the main one without the worktrees nested in it, plus a total and how much of it is in stale ones. Sort by stalest or largest.
- ◉ **Who is using it.** A callout on the worktree this session runs in, and on any other worktree a Claude Code session is running in right now.
- 🧹 **Remove, safely.** Remove asks once more and says what goes: the folder and the space it frees, any uncommitted changes, and whether a Claude session would lose its folder. It runs `git worktree remove`, so the branch and its commits stay. The main worktree and this session's can't be removed. Folders deleted by hand are pruned from git's list with one press.
- 🧭 **What it holds.** Clean or how many uncommitted changes, commits not yet in `origin/main`, commits not pushed, and whether the remote branch was deleted (merged, usually).
- 🔒 **Local only.** It runs `git`, `du` and `lsof` on your machine and sends nothing anywhere. Nothing changes until you press Remove twice.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install worktrees --marketplace aseem-upadhyay/qol-mods
```

Answer `y` to add the marketplace (only the first time), then pick the **user** scope so the mod loads in every session. Installing from a terminal also makes the mod load in the desktop app's Code tab.

## Use

```
/worktree
```

opens the pane. Press a worktree's name for its details: path, last commit, edit and Claude session, and what it holds. **Refresh** (`r`) reads everything again and measures every folder anew; **By size** / **By staleness** (`s`) changes the order; **Prune** (`p`) appears when git lists a worktree whose folder is gone. Where no pane can be drawn, `/worktree` answers with the same list as text.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Stale after (days) | 14 | No commit, edit or Claude session for this long marks a worktree stale; four times this marks it very stale |

## Requirements

- `git`.
- `lsof`, to see which worktrees a Claude session is running in (macOS has it; on Linux install it if it's missing). Without it everything else still works.

## How it works

- **Staleness** is the newest of: HEAD's commit time, the newest change to a file with uncommitted changes, and the newest write to a transcript in `~/.claude/projects` for a session started in that folder. Reading `git status` is done without optional locks, so looking never touches a worktree's index.
- **Live sessions** are the `claude` processes whose working directory is inside the worktree (`lsof -d cwd`), checked again when you press Remove.
- **Sizes** are `du -sk`, three at a time, shown as they come in.
- **Remove** is `git worktree remove <path>`, with `--force` only when you confirm discarding uncommitted changes. Ignored files in the folder (build output, `node_modules`, `.env`) are deleted with it.
