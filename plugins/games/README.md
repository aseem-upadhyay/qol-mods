<div align="center">

# games

**A quick game while Claude works.**

Snake, 2048, Minesweeper and Wordle in a side pane, with milestones to chase and your progress saved between sessions.

[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757?style=flat-square)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](../../LICENSE)

</div>

```
Games                                 ★ 4 of 29
Arcade
▸ ■ Snake            best 61   ★ 2/6  ● resume
Puzzles
  ◆ 2048             best 2,048 ★ 1/8
  ✸ Minesweeper      best 0:48 ★ 1/7
Words
  ▣ Wordle           streak 6  ★ 0/8  ● today

↑↓ choose · ⏎ play · t milestones · T all · q close
```

## Features

- 🎮 **Four games you already know.** Snake, 2048, Minesweeper and Wordle, played with the arrow keys or the mouse. Each has one line of score above the board and one line of controls below it, and nothing else.
- ★ **Milestones.** 29 small goals across the games, from "eat once" to "make 2048 in under 1,000 moves". A toast says when you get one, and each shows how close you are: "12 of 25".
- 💾 **Progress that stays.** Bests, streaks, milestones and the game you left halfway are kept between sessions. Arcade games come back paused, right where you left them.
- 📅 **A daily Wordle.** One puzzle a day, the same all day, with a daily streak; practice games as many as you like.
- ⏸️ **Out of the way.** Typing in the prompt, or Claude starting or finishing a turn, pauses an arcade game. A toast says when Claude is done.
- 🖥️ **At home on both.** In the desktop app the pane sits beside the conversation; in the terminal it fits the strip above the prompt, with smaller tiles where it has to.
- 🔀 **Parallel sessions are fine.** Two sessions playing at once add to each other's stats instead of overwriting them.
- 🔒 **All local.** Nothing is sent anywhere; no game calls a model.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install games --marketplace aseem-upadhyay/qol-mods
```

Answer `y` to add the marketplace and pick the **user** scope.

## Use

| Command | What it does |
| --- | --- |
| `/games` | Opens the pane on the list of games |
| `/games snake`, `/games 2048`, `/games mines`, `/games wordle` | Opens that game, resuming one you left |
| `/games milestones` | Every game's milestones |
| `/games close` | Closes the pane; a game in progress is saved first |
| `/games reset <game>`, `/games reset all` | Resets stats and saved games, and milestones too if you choose |

`/games` works while Claude is in the middle of a turn.

### Keys

| Key | In every game |
| --- | --- |
| **p** | Pause (arcade games and Minesweeper) |
| **r** | New game; asks first if one is under way |
| **h** | Back to the list |
| **t** | This game's milestones |
| **q** | Close the pane |
| **Esc** | Hand the keyboard back to the prompt; the pane stays |

Wordle's letters are your guesses, so its commands are capitals: **H**, **T**, **Q**, and **N** for a practice game.

| Game | Controls |
| --- | --- |
| Snake | Arrows or WASD. Starts on your first key; speeds up as it grows |
| 2048 | Arrows or WASD, or drag across the board |
| Minesweeper | Click to reveal, shift+click (or **f**) to flag, click a satisfied number to open around it. Arrows and space work too. **1** **2** **3** pick the size before your first click; Medium and Hard show only where they fit |
| Wordle | Type and press Enter, or click the keyboard |

## Settings

Open `/config` and find games, or set them under `pluginConfigs.games.options` in `~/.claude/settings.json`.

| Setting | Default | |
| --- | --- | --- |
| Tell me when Claude finishes | on | A toast when Claude finishes a turn while a game is open, and an arcade game pauses |
| High contrast colors | off | Orange and blue in Wordle instead of green and yellow |
| Wordle hard mode | off | Hints you've found must be used in later guesses |

## Where your progress is kept

In Claude Code's own store for this plugin, under `~/.claude/plugins/store/`. `/games reset` clears it from the pane.

Wordle's answers are 2,011 common five-letter words written for this mod. Accepted guesses are every five-letter word in ENABLE, a public-domain word list.

## Requirements

- Claude Code with mod (hooks module) support
- The desktop app's Code tab or a terminal. The mobile app and the VS Code extension show your stats but can't draw the board.

More games are on the way: [SPEC.md](SPEC.md) has the plan for all 14.
