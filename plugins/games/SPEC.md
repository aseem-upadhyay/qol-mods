# games: implementation spec

| | |
|---|---|
| Status | Phases 1 and 2 built: 0.2.0 with nine games (Appendices B and C); phase 3 not started |
| Author | Aseem Upadhyay, drafted with Claude |
| Date | 2026-10-11 |
| Lives in | `plugins/games/` in qol-mods |
| First release | 0.1.0 with phases 0–1; later phases ship as minor versions |
| Built against | Claude Code 2.1.295 plugin API (function hooks) |

## 1. Summary

games puts small, good-looking games inside Claude Code. `/games` opens a picker in a side pane; `/games snake` goes straight to a game. There are 14 games in four groups: arcade (Snake, Tetris, Breakout, Dino Run, Pong), puzzles (2048, Minesweeper, Lights Out, Memory), versus (Connect Four, Tic-tac-toe) and words (Wordle, Hangman, 20 Questions).

Every game has milestones, small goals that unlock as you play, and every game saves your progress: your stats, your milestones, and the game you left half-finished, so closing the pane or the session never loses a game.

The screen shows the board, one line of score above it and one line of controls below it, and nothing else.

## 2. Goals and non-goals

**Goals**

- Easy to pick up: every game is one you already know, playable with arrow keys or the mouse, with its controls shown on one line.
- Good-looking: colored tiles and blocks on a dark board, the same look in a light or dark theme, smooth enough motion for the arcade games.
- Uncluttered: one pane, no status-line entry, no line above the prompt unless the user turns it on.
- Progress that lasts: stats, milestones and in-progress games survive closing the pane, ending the session and restarting Claude Code.
- Safe with parallel sessions: two sessions playing at once never wipe each other's progress (§7.4).
- Works offline. Only 20 Questions calls a model, and only after the user agrees (§10.14).

**Non-goals**

- Multiplayer, leaderboards, or anything that leaves the machine.
- The mobile app and the VS Code extension as places to play in 0.1.0. They can't draw the board (§4.1); they show the hub's stats and milestones only.
- Sound in 0.1.0 (§14).
- Changing anything about how Claude Code works. games never touches prompts, tools or the transcript.

## 3. Decisions already made

1. **One command, one pane.** `/games` with an optional game name. The hub and every game share one pane, `games`, which is retitled as you move between them.
2. **Boards draw in a `Client` surface module.** It is the only element with keys, pointer and a frame clock (§4.1). It can't hold `Svg`, so boards are drawn from `Box` cells with background colors on both surfaces, and from half-blocks in a terminal pane too short for them (§9.3, §4.3).
3. **The board is a dark card in both themes.** Game colors are raw hex on the board's own background, so contrast doesn't depend on the theme. Text around the board uses theme keys.
4. **The hooks module owns progress.** The board posts events; `register.tsx` evaluates milestones, writes `$.store`, and raises toasts. Milestones are worked out in one place only.
5. **Writes are deltas on a fresh read.** Every store write re-reads the game's record, applies the change and writes it back in the same hook, never from a copy held in memory (§7.4).
6. **Seeded randomness.** Every game draws from a seeded generator whose state is part of the save, so a resumed game continues exactly, and tests are deterministic.
7. **Milestones are visible, not secret.** Each one says how to get it. A locked milestone shows dimmed with its goal; a count-based one shows progress ("12 of 25").
8. **20 Questions is opt-in per user.** It is the one game that spends the user's Claude usage, so the first time it's opened it asks, and remembers the answer.

## 4. Platform

### 4.1 What each surface can do

From the 2.1.295 types:

| | terminal | desktop | vscode | mobile |
|---|---|---|---|---|
| `Client` (keys, pointer, frame clock) | yes | yes | no | no |
| `Svg` | no | yes, outside a `Client` | yes | yes |
| `Box`, `Text`, `Button` | yes | yes | yes | yes |
| `Input` | yes | yes | yes | no |

- **Where you can play:** terminal and desktop. vscode and mobile show the hub read-only with "Open Claude Code on your computer to play."
- **Inside a `Client`:** `Box`, `Text`, `Button`, `Input`, `Select`, `Link`, `Code`, `Markdown`. No `Svg`, `Raster` or `Image`.
- **`Svg`:** not used. The hub and every card are inside the board's `Client`, so the look is the same everywhere: colored glyph tiles (§9.1).

### 4.2 Client mechanics this spec relies on

- `surface.onKey(fn)`: keys while the `Client` has focus. Escape never arrives; it returns focus to the prompt.
- `surface.onPointer(fn)`: `down`/`move`/`up` with cell coordinates and which button.
- `surface.every(ms, fn)`: the frame clock. Started once per instance, guarded by a module-level `WeakSet` of surfaces: the module can be called again (a resize, new props) before its first `setState`, so checking `state === undefined` alone starts the timer twice and the game runs at double speed (found in phase 0).
- `surface.setState(next)`: local state; redraws on the next frame. Three renders in a row with no tick, key or pointer between them unmount the instance, so every `setState` follows an input or a tick.
- `surface.post(data)`: one message per frame to the hooks module as `ui.message`, and **a later post in the same frame replaces an undelivered one**. Leaving a game posts a save and a navigation in one frame, so the board sends through an outbox that repeats every unacknowledged post (§6.2; found in phase 1).
- Bounds: 20,000 nodes, 32 deep, 100,000 characters per tree; `props` at most 100,000 characters serialized.
- `Box` `top`, `left`, `width` and `height` are whole cells: the engine refuses a fractional position.
- The `Pane` render props carry `isFocused`, `bodyColumns`, `scroll.bodyRows` and `placement`, and the pane redraws when they change. `isFocused` does not say whether the board has the keys: in a terminal a click on the board sets it false (§4.3 P4).

### 4.3 Phase 0: what was checked

Phase 0 ran a throwaway mod, `games-probe`, on 2026-10-11: two rounds in the desktop app (Claude Code 2.1.295) and two in a terminal (2.1.296, a 91×58 terminal, where the pane sat inline above the prompt). Measurements are in Appendix A.

| # | Question | Desktop | Terminal | What it changes |
|---|---|---|---|---|
| P1 | Can a board draw solid, roughly square colored cells? | Not from text: the font is proportional with tall lines, so a text cell is about 11×38 px and `▀` half-blocks fill only a thin strip. Yes from `Box`: 2 columns × 1 row is about 31×38 px, solid. | Yes, all three ways: text cells, `Box` cells and `▀` half-blocks, the half-blocks giving two square pixels per cell. | Boards are `Box` cells; the terminal can also draw them as half-blocks when rows are short (§9.3). |
| P2 | Can a surface module `import` sibling files? | Yes. | Yes. | Game logic lives in its own files (§6.1). |
| P3 | Does `$.ui.open({ focus: true })` give the board the keyboard? | Yes, when the prompt box is empty; otherwise the first click does. | Not seen: the first key came after a click. A click always gives the board the keys. | The board shows "Click to play" until it has received a key or a click. |
| P4 | Is there a signal when the player leaves the board? | The pane redraws with `isFocused: false` on Escape. | No: a click on the board itself sets `isFocused: false`, and keys keep arriving. Escape changes nothing a plugin sees. | `isFocused` is not a pause signal. Pausing follows what the player does next instead (§7.2). |
| P5 | Does `surface.every(50, …)` hold 20 frames a second? | Yes: 19.9–20.1. | Mostly: 15–19.5. | Arcade speeds are set in ticks and run up to a quarter slower in a terminal. Accepted. |
| P6 | How much room does the pane give? | Docked: 42 columns × 45 rows at the default width, 149 columns widened. | Inline above the prompt: 87 columns × 17 rows. It docks beside the transcript only in fullscreen at 110 columns or more. | Boards fit 42 columns and, in a terminal, 15 rows plus the two lines of chrome (§9.3, §10). |
| P7 | Does a hidden pane's board keep running? | Not caught. | Not caught. | Arcade games pause when the pane closes or hides (§7.2). |
| P8 | Does `position: absolute` place a `Box` inside its parent? | No: from the board's corner, ignoring the parent. | Yes. | Nothing is absolutely positioned; moving pieces are painted into the grid (§9.3). |
| P9 | Which clicks reach the board? | Left, with shift, alt, ctrl. Right-click never arrives. | Left, with shift. No right-click seen. | Minesweeper flags with shift+click or `f` (§10.7). |
| P10 | Can the player close the board? | The pane's close mark. | The close mark; Escape doesn't. The person couldn't find a way during the probe. | `q` closes the pane after saving, and `/games close` does too (§5.3, §12). |
| P11 | Does text on a colored tile read well? | Yes: bold white on the tile color. | No: the same text drew dim gray. | Tile text colors are checked on both surfaces in phase 1; dark text on light tiles where white fails. |

## 5. The experience

### 5.1 First run

1. The user installs games (`/plugin install games --marketplace aseem-upadhyay/qol-mods`).
2. Nothing appears until they type `/games`.
3. The pane opens on the hub, focused. Every game shows "New".

### 5.2 The hub

```
 Games                                         ★ 32 of 93
 Arcade
 ▸ Snake           best 61         ★ 3/6
   Tetris          best 12,400     ★ 4/7     ● resume
   Breakout        —               ★ 0/6     New
   Dino Run        best 1,204      ★ 3/6
   Pong            3 wins          ★ 2/6
 Puzzles
   2048            best 2,048      ★ 5/8     ● resume
   Minesweeper     best 0:48       ★ 2/7
   Lights Out      level 14        ★ 2/6
   Memory          best 22 flips   ★ 1/6
 Versus
   Connect Four    5 wins          ★ 2/6
   Tic-tac-toe     4 draws         ★ 3/5
 Words
   Wordle          streak 6        ★ 3/8     ● today
   Hangman         18 solved       ★ 2/6
   20 Questions    —               ★ 0/5     uses Claude
 ↑↓ choose · enter play · t milestones
```

- One row per game: name, its headline stat (§10, each game's "Headline"), milestones unlocked, and one marker:
  - `● resume`: a game in progress is saved.
  - `● today`: Wordle's daily puzzle isn't played yet.
  - `New`: never played.
  - `uses Claude`: 20 Questions, until the user has agreed (§10.14).
- **Keys:** ↑/↓ move, Enter plays, `t` opens the milestones of the selected game, `T` opens all milestones. Clicking a row plays it.
- **Icons:** a tile 2 columns wide in the game's color with a glyph on it (`■` Snake, `◆` 2048, ...), on both surfaces (§9.1).
- **Which games:** only the playable ones; the hub grows as phases ship. Its milestone total counts those games alone.
- **Header:** total milestones unlocked across games.
- **Narrow panes:** the rows are flex layouts, not fixed columns. Below 50 columns (the default desktop pane is 42) the headline stat is dropped and the milestone count and marker stay.
- **Mobile and vscode:** the same list, without the keys or the play action, and a line saying where to play.

### 5.3 A game

```
 Snake                  score 14 · best 61
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓██████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▓▓▓▓▓▓▓▓▓▓▓▓●●▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
 ←↑→↓ move · p pause · r restart · h hub
```

`▓` is the dark board, `█` the snake, `●` the food: every cell a `Box` 2 columns wide (§9.3).

- **Above the board:** the game's name on the left; on the right its live numbers (score, best; or time, mines left; or level, moves).
- **Below the board:** one dim line of controls. It never wraps: on a narrow pane the least important controls drop off the end.
- **Common keys** in every game: `p` pause, `r` restart (asks "Restart? y/n" over the board if a game is under way), `h` back to the hub, `t` this game's milestones, `q` close the pane (the game is saved first). Escape gives the keyboard back to the prompt and leaves the pane open. Each game adds its own (§10).
- **Pausing:** a paused game dims the board and shows "Paused · p to resume" in its middle.
- **Game over:** the board stays, undimmed, so the final position can be read, and the controls line becomes the result: a bold title ("You win!", "Cleared!"), a detail or two ("new best!"), and two plain `Button`s, `r: again` (or `next level`, `next word`, `practice`) and `h: hub`. As Buttons they take a click, and their hotkeys work while the pane has the keys even when the board doesn't; on desktop the board seemed to lose them after a redraw (Appendix C). Once a word game is over, plain `h` and `r` work in it too. Milestones unlocked show as toasts. Only pausing and "Start a new game?" cover the board with a card.

### 5.4 Milestones

- **On unlock:**
  - A toast: `★ Snake: Fifty (eat 50 in one game)`.
  - The game-over card lists it.
  - Several at once share one toast: `★ 3 milestones in Snake`.
- **The milestone view** (`t` in a game or the hub) covers the board:
  - Every milestone of that game, in order.
  - Unlocked ones show a ★ and the date.
  - Locked ones are dimmed, with their goal.
  - Count-based ones show a progress bar and "12 of 25".
- `T` from the hub lists every game's milestones, grouped.
- Milestones never re-lock, not even when stats are reset; "Reset this game" asks separately whether to clear its milestones (§8.3).

### 5.5 While Claude works

Two optional touches, both off unless the setting says otherwise (§11):

- **When Claude finishes** (`notifyTurnEnd`, on by default): if a game is open and a turn completes, games raises a toast, "Claude finished", and pauses an arcade game. Turn-based games stay as they are.
- **Long turns** (`suggestDuringLongTurns`, off by default): when a turn has run for 60 seconds and no game is open, the line above the prompt shows `Claude is still working · /games dino for a quick run` until the turn ends. It never shows twice in one turn.

Playing a full game between a turn's start and its end counts toward the "Coffee break" milestone (§10.15).

## 6. Architecture

```
 /games [name]         prompt.edit / prompt.submit / turn.start / turn.complete
      │                        │
      ▼                        ▼
 hooks/register.tsx ── every $ call: command, pane, store, toasts
      │   ▲
props │   │ ui.message (a Batch of posts)
      ▼   │
 hooks/board.tsx ── the Client surface module: the hub, each game, milestones, reset
      │
      ├── hooks/catalog.ts         the 14 games, the playable ones, names and aliases
      ├── games/<id>/logic.tsx     one game: rules, milestones, drawing (pure)
      └── core/*                   game interface, canvas, palette, rng, store, milestones (pure)

 $.store ── schema, profile, one record per game (§8)
 $.state ── records, the screen asked for, the pause signal, the last post handled (§8.4)
```

### 6.1 Files

```
plugins/games/
  .claude-plugin/plugin.json      manifest, userConfig of §11
  README.md
  SPEC.md                         this file
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              every engine call: /games, the pane, posts, store, toasts, pause signals
  hooks/board.tsx                 the Client surface module: screens, input, the clock, the outbox
  hooks/catalog.ts                the 14 games: id, name, group, glyph, color, aliases; which are playable; hub headlines
  core/game.ts                    the GameDef interface every game implements, and key helpers
  core/canvas.tsx                 the cell canvas: Box cells or half-blocks, packed into runs (§9.3)
  core/palette.ts                 board colors and each game's colors (§9.2)
  core/rng.ts                     mulberry32 with a one-number state
  core/store.ts                   record shapes, reading, and every change: outcome, save, unlock, reset (pure)
  core/milestones.ts              the Milestone type, evaluate, progress (pure)
  games/<id>/logic.tsx            one per game: state, rules, its milestone table, drawing
  words/wordle-answers.ts         the answers, five letters a word in one string, order fixed at release
  words/wordle-guesses.ts         accepted guesses, sorted, in one string
  types/index.d.ts                record types, board props and posts, the $.state contract
  tests/logic.test.ts             each game's rules, the store's merges, milestones
  tests/pane.test.ts              /games and the board through the engine, on terminal and desktop
  tests/helpers.ts                boots the mod against a test engine
```

A game is one `GameDef` (`core/game.ts`): `init`, `key`, `pointer`, `tick`, `over`, `facts`, `isUnderway`, `size`, `draw`, `status`, `controls`, `card`, plus its `milestones` and save version `v`. Its state is plain JSON, so a save is the state itself.

The engine follows `$` only into functions declared at the top of the hooks module, so every engine call lives in `register.tsx`. Every other module is pure and takes the element table as an argument.

### 6.2 Messages between the board and the hooks module

The board posts (`types/index.d.ts`):

```ts
type BoardPost =
  | { type: 'save'; game: GameId; save: Save | null; facts: Facts; daily?: string }  // §7.2; facts check mid-game milestones
  | { type: 'over'; game: GameId; outcome: Outcome }                              // a game ended
  | { type: 'nav'; screen: Screen }                                               // where the board went
  | { type: 'reset'; target: GameId | 'all'; milestones: boolean }
  | { type: 'stale'; game: GameId }                                               // a save of another version (§7.3)
  | { type: 'close' }                                                             // q
```

A post that lands in the frame of another replaces it (§4.2), so posts go out in a `Batch`: `{ type: 'batch', inst, items: [{ id, post }] }`, every post not yet acknowledged, up to 50. The hooks module handles each id once per board instance (`inst`) and writes the last one handled to `$.state` as `ack`; the next props carry it, and the board drops what was handled.

The hooks module draws the board with these props:

```ts
type BoardProps = {
  records: Records      // the store, read whole
  request: Request      // a screen asked for by /games; n changes on every ask
  pause: number         // changes when the player does something else (§7.2)
  settings: Settings
  room: Room            // surface, the pane's body columns and rows, dock or inline
  today: string         // local date, for Wordle's daily
  now: number
  ack: Ack
}
```

## 7. Progress and saving

### 7.1 What is saved

| What | Where | When it's written |
|---|---|---|
| Stats (played, won, best, streaks, totals) | the game's record | on every `over` |
| Milestones unlocked, with dates | the game's record | as they unlock |
| The game in progress | the game's record, `save` | §7.2 |
| Last game played, setting choices, 20 Questions consent | `profile` | when they change |

### 7.2 Saving a game in progress

- **Turn-based games** (2048, Minesweeper, Lights Out, Memory, Connect Four, Tic-tac-toe, Wordle, Hangman, 20 Questions): after every move.
- **Arcade games** (Snake, Tetris, Breakout, Dino Run, Pong): every 2 seconds while running, and at once on pause, on `h` and on game over.
- **Leaving pauses.** The pane's `isFocused` can't be trusted for this (§4.3 P4), so the hooks module passes `paused: true` when the player does something else:
  - edits or submits a prompt (`prompt.edit`, `prompt.submit`; whether `prompt.edit` fires on each keystroke is checked first thing in phase 1)
  - a turn starts or completes (`turn.start`, `turn.complete`)
  - the pane closes, or another pane is shown in its place
  - on desktop, the pane redraws with `isFocused: false` and the board has had no key or click for 500 ms (a click on the board itself comes with one)

  An arcade game pauses and saves at once; a turn-based game just saves.
- **A finished game** clears its `save`; the next open starts fresh.
- **Resuming:** opening a game that has a `save` restores it.
  - Turn-based games continue at once.
  - Arcade games open paused, with "p or click to resume".
- **Lost seconds:** an arcade game closed between saves loses at most 2 seconds of play. That's accepted.
- **Save format:** each game's `serialize` returns plain JSON, including the generator state, and stays under 8 KB (Tetris, the largest, is about 1 KB).

### 7.3 Versions

- Each save carries `v`, the game's save version.
- A change to a game's state shape bumps its version.
- A save whose `v` doesn't match is dropped, with a toast: "Your saved Tetris game was from an older version and couldn't be restored." Stats and milestones are never dropped.
- The store as a whole carries `schema`; `core/store.ts` migrates older records forward on read.

### 7.4 Parallel sessions

The user often runs several sessions in one checkout, and `$.store` is one JSON file with no version check on write. So:

- **Fresh reads.** Every write happens inside one hook: `get` the record, apply the change, `set` it. No hook holds a record across an `await` of anything else.
- **Merges that can't lose.** Changes are deltas merged into what was read:
  - counters add
  - bests take the larger
  - milestones union, keeping the earlier date
  - streaks take the value carried by the newer `at`
- **Saves.** The last writer wins. If a game is open in two sessions, the one played last owns the save; the other's next save overwrites it. Accepted: a person plays one at a time.
- The remaining window is two hooks in two processes interleaving `get` and `set` within milliseconds. A lost increment there is accepted.

## 8. Data

### 8.1 Store keys

| Key | Value |
|---|---|
| `schema` | `1` |
| `profile` | `Profile` |
| `game:<id>` | `GameRecord`, one per game |

Fourteen records of a few KB each stay far below the store's 4 MiB limit.

### 8.2 Shapes

```ts
type GameId =
  | 'snake' | 'tetris' | 'breakout' | 'dino' | 'pong'
  | '2048' | 'mines' | 'lights' | 'memory'
  | 'connect4' | 'tictactoe'
  | 'wordle' | 'hangman' | 'twenty'

type Profile = {
  firstPlayedAt: number          // epoch ms
  lastGame?: GameId
  twentyConsent?: boolean        // §10.14
  seenLongTurnHint?: number      // epoch ms of the last turn the hint showed
}

type GameRecord = {
  stats: {
    played: number
    won: number                  // games with a win condition; 0 for score-only games
    lost: number
    totalMs: number              // time played, paused time excluded
    lastPlayedAt?: number
    best: Record<string, number> // per game: 'score', 'time', 'level', 'flips', …; per difficulty where there is one ('time.easy')
    streak: { current: number; best: number; at: number }
    extra: Record<string, number>  // the game's own counters: 'tetrises', 'cactiJumped', …
  }
  milestones: Record<string, number>   // id → when it unlocked (epoch ms)
  save?: Save
  daily?: { date: string; save?: Save; result?: GameResult }  // Wordle only
}

type Save = { v: number; at: number; state: unknown }   // state is the game's serialize() output
```

### 8.3 Reset

- `/games reset <name>` opens a confirm card in the pane, with two choices:
  - "Reset stats and save"
  - "Reset everything, milestones too"
- `/games reset all` does the same for every game.
- Nothing is reset without a press in the pane.

### 8.4 Session state

`$.state` holds what the pane draws from and survives a hot reload; the store is the durable copy. Which screen is on show is the board's own state.

```ts
interface PluginState {
  games: {
    records: Records   // read from the store at start, after every write, and on /games
    request: Request   // the screen /games asked for
    pause: number      // bumped by the pause signals of §7.2
    ack: Ack           // the last post handled (§6.2)
  }
}
```

## 9. Look

### 9.1 Icons and glyphs

Each game's icon is a `Box` 2 columns × 1 row in its color with a dark glyph on it: `■ ▦ ▤ ♣ ▮ ◆ ✸ ◼ ♠ ● ✕ ▣ ☐ ?`. The same on both surfaces, since the hub is drawn inside the board's `Client`, which can't hold `Svg`. A milestone on the game-over card is a yellow border on the card.

### 9.2 Palette

- **The board:** `#1b1d23`, with no border: a border would cost 2 of the pane's 42 columns, and the dark background sets the board apart. Colors in a game sit on it, so they're picked once for both themes.
- **Text around the board:** theme keys only (`text`, `inactive`, `success`, `warning`).

| Use | Color |
|---|---|
| Snake body, Wordle correct, Lights Out lit | `#5fbf6a` |
| Food, mines, Connect Four red, Hangman miss | `#e5534b` |
| Wordle present, Connect Four yellow | `#e3b341` |
| Wordle absent, empty cells | `#3a3d46` |
| Paddles, ball, dino, text on tiles | `#e6e6e6` |
| Tetris I O T S Z J L | `#4fc1e9` `#f6c445` `#a77de8` `#5fbf6a` `#e5534b` `#4a8fe7` `#f08c3a` |
| 2048 tiles, 2 to 2048 | `#3f4350` `#4a5060` `#e4a04b` `#ea8a3e` `#ec6f3e` `#e9573f` `#e8c34f` `#e8bd3e` `#e7b82f` `#e6b31f` `#e5ae10`; 4096 and up `#c06bd8` |
| Minesweeper 1–8 | `#4a8fe7` `#5fbf6a` `#e5534b` `#a77de8` `#d9822b` `#3fb8af` `#e6e6e6` `#9aa0a6` |

- **`highContrast`** (§11) swaps Wordle's green and yellow for orange `#f08c3a` and blue `#4fc1e9`, and adds a glyph to every colored state that would otherwise rely on color alone.

### 9.3 Drawing the board

Phase 0 settled this (§4.3 P1, P6, P8): nothing is absolutely positioned, and every board is a grid of cells drawn one of two ways.

- **Box cells:** each cell a `Box` 2 columns wide and 1 row tall with a `backgroundColor`, about 31×38 px on desktop and about 28×30 px in a terminal. A game paints a frame into a plain array of colors; the canvas (`core/canvas.ts`) turns each row into one row `Box` of runs, neighbouring cells of the same color becoming one `Box` of width 2 × n. A row of a typical frame comes to 3–10 nodes, so a whole board is a few hundred, far inside the 20,000 bound.
- **Half-blocks** (terminal only): each cell is 1 column and half a row, drawn as `▀` with the top cell's color as foreground and the bottom cell's as background. A board takes half the columns and half the rows of Box cells, at the same square shape. The desktop can't draw them (§4.3 P1).
- **Which one:** Box cells whenever the board fits the pane's body (`bodyColumns`, `scroll.bodyRows`, less the two lines of chrome). Otherwise, in a terminal, half-blocks. A board with text in its cells (Minesweeper's numbers, every tile game) can't use half-blocks; it uses its compact layout (§10) or, failing that, offers only the sizes that fit.
- **Moving pieces** (the snake, the ball, paddles, the dino, a falling piece) are painted into the frame like everything else. Positions are kept in fractional cells for the physics and rounded when painted, so motion is one cell at a time.
- **Tiles** (2048, Wordle, Memory, Connect Four, Tic-tac-toe, the keyboards) are `Box`es with a `backgroundColor` and a centered bold `Text`, laid out with `gap`. Connect Four's discs and Memory's cards use `borderStyle="round"`, which both surfaces draw with rounded corners. Text colors on tiles are picked per surface (§4.3 P11).
- **Text on the board** (the pause note, the game-over card) is a centered `Box` with its own background, drawn in the frame's place for those rows, never over it.
- **Room:** every board fits 42 columns, so at most 21 Box cells across. In a terminal's inline pane, every game also fits 15 board rows, through half-blocks or its compact layout. Bigger layouts (Minesweeper Medium and Hard, Memory 6×4) are offered only when they fit.

## 10. The games

Each game below lists its board, controls beyond the common ones (§5.3), rules, what it saves, its headline in the hub, and its milestones. Board sizes are in cells (§9.3) and fit the default 42-column pane. Where a board is taller than 15 rows, the game says how it fits a terminal's inline pane, which leaves 15 rows for the board (§4.3 P6).

### 10.1 Snake

- **Board:** 20×14 cells (40 columns × 14 rows).
- **Controls:** arrows or WASD. A reverse into yourself is ignored.
- **Rules:**
  - The snake starts 3 long, moving right. Eating food grows it by 1 and scores 1.
  - Walls and your own body end the game.
  - Speed starts at 8 moves a second and gains 0.25 per food, up to 16.
  - Food never appears on the snake.
- **Saves:** body, direction, food, score, speed, rng.
- **Headline:** best score.

| Milestone | Goal |
|---|---|
| First bite | Eat once |
| Twenty-five | Score 25 in one game |
| Fifty | Score 50 in one game |
| Centurion | Score 100 in one game |
| Half the board | Fill half the board |
| Regular | Play 25 games |

### 10.2 Tetris

- **Board:** 10×20 cells (20 columns × 20 rows). The next piece, the held piece and the level sit in a column 5 cells wide beside it. In a terminal's inline pane: half-blocks, 10 columns × 10 rows.
- **Controls:**
  - ←→ move, ↓ soft drop, space hard drop
  - ↑ or `x` rotate clockwise, `z` counter-clockwise
  - `c` hold
- **Rules:**
  - 7-bag randomizer, SRS rotation with wall kicks, a ghost piece.
  - Gravity follows the guideline curve by level; the level goes up every 10 lines.
  - Score per clear: 100, 300, 500, 800 × level; soft drop 1 a cell, hard drop 2.
- **Saves:** grid, piece, next, hold, bag, level, lines, score, rng.
- **Headline:** best score.

| Milestone | Goal |
|---|---|
| Line | Clear a line |
| Tetris | Clear 4 lines at once |
| Forty | Clear 40 lines in one game |
| Level 5 | Reach level 5 |
| Level 10 | Reach level 10 |
| Ten thousand | Score 10,000 in one game |
| Clean sweep | Clear the whole board |

### 10.3 Breakout

- **Board:** 20×16 cells: 5 rows of 10 bricks, each brick 2 cells wide; a paddle 4 cells wide; a ball of 1 cell. In a terminal's inline pane: half-blocks, 20 columns × 8 rows.
- **Controls:** ←→ or the mouse (the paddle follows the pointer's column). Space launches.
- **Rules:**
  - 3 lives. The ball speeds up at 4 and 12 hits and when it first reaches the top rows.
  - Where the ball hits the paddle sets its angle.
  - Levels 1–5 have their own brick layouts and loop after level 5, a little faster each time.
  - Top-row bricks are worth 7, the next two rows 5 and 3, the last two 1.
- **Saves:** bricks, ball, paddle, lives, level, score, rng.
- **Headline:** best score.

| Milestone | Goal |
|---|---|
| Breakthrough | Clear level 1 |
| Level 3 | Clear level 3 |
| All five | Clear level 5 |
| Flawless | Clear a level without losing a life |
| Combo | Break 8 bricks between two paddle hits |
| Thousand | Score 1,000 in one game |

### 10.4 Dino Run

- **Board:** 21×10 cells, the ground on the bottom row. The dino is 1 cell wide and 2 tall (1 tall ducking); cacti are 1 cell wide and 1–2 tall; a bird is 1 cell.
- **Controls:** space or ↑ jump (hold for a higher jump), ↓ duck. A click anywhere on the board jumps.
- **Rules:**
  - The ground scrolls left one cell a step, starting at 8 steps a second and gaining speed over time, up to 20.
  - Cacti come in 1–3; birds start at 400 points and fly at three heights.
  - Score is distance, about 10 a second at the start.
  - At 700 the board's colors invert for 100 points ("night"), then every 700 after that.
- **Saves:** obstacles, dino, speed, score, rng.
- **Headline:** best score.

| Milestone | Goal |
|---|---|
| Hop | Jump your first cactus |
| Five hundred | Score 500 |
| Night run | Reach the first night (700) |
| Two thousand | Score 2,000 |
| Fifty jumps | Clear 50 obstacles in one run |
| Regular | Play 25 runs |

### 10.5 Pong

- **Board:** 21×13 cells, a paddle 1 cell wide and 3 tall at each side, a 1-cell ball, a dotted net down the middle column.
- **Controls:** ↑↓ or `w`/`s`, or the mouse. You play the left paddle against the bot.
- **Rules:**
  - First to 7.
  - The ball speeds up a little on every return, up to a cap.
  - The bot tracks the ball with a reaction delay and an error that depend on difficulty: Easy, Normal, Hard. Press `1` `2` `3` before serving.
- **Saves:** score, ball, paddles, difficulty, rng.
- **Headline:** wins.

| Milestone | Goal |
|---|---|
| First point | Score a point |
| First win | Win a match |
| Normal | Win on Normal |
| Hard | Win on Hard |
| Rally | A 20-hit rally |
| Shutout | Win 7–0 |

### 10.6 2048

- **Board:** 4×4 tiles, each 7 columns × 3 rows with 1-cell gaps (33 × 17). Compact, for a terminal's inline pane: tiles 6 columns × 2 rows, gaps of 1 column and no gap rows (27 × 8).
- **Controls:** arrows or WASD. On desktop, a swipe (pointer drag of at least 3 cells) works too.
- **Rules:**
  - The standard game: tiles slide and merge, and a new tile (2, or 4 one time in ten) appears after each move that changed the board.
  - Reaching 2048 says "2048!" in the score line and play goes on; the game ends when no move is left, as a win if 2048 was made.
  - The game ends when no move changes the board.
- **Animation:** tiles slide over 3 frames and a merged tile pops for 2. This is the one turn-based game that uses the frame clock.
- **Saves:** grid, score, moves, won flag, rng.
- **Headline:** best score.

| Milestone | Goal |
|---|---|
| 256 | Make a 256 tile |
| 512 | Make a 512 tile |
| 1024 | Make a 1024 tile |
| 2048 | Make a 2048 tile |
| 4096 | Make a 4096 tile |
| Twenty thousand | Score 20,000 in one game |
| Efficient | Make 2048 in under 1,000 moves |
| Regular | Play 25 games |

### 10.7 Minesweeper

- **Board:** Easy 9×9 with 10 mines, Medium 16×16 with 40. Medium needs 16 board rows, so a terminal's inline pane offers Easy alone. Hard (30×16, 99 mines) is offered only when the region has at least 62 columns.
- **Controls:**
  - Click to reveal, shift+click to flag. Right-click never reaches the board (§4.3 P9).
  - Click a satisfied number to chord.
  - Keys: arrows move a cursor, space reveals, `f` flags.
  - `1` `2` `3` pick a difficulty before the first click.
- **Rules:**
  - The first click is never a mine, and opens an area.
  - Numbers have colors and digits.
  - The timer starts on the first click; the mine counter shows mines minus flags.
- **Saves:** mines, revealed, flags, elapsed time, difficulty, rng.
- **Headline:** best Easy time.

| Milestone | Goal |
|---|---|
| Cleared | Win on Easy |
| Quick | Win Easy in under 60 seconds |
| Medium | Win on Medium |
| Medium quick | Win Medium in under 3 minutes |
| No flags | Win without placing a flag |
| Streak | Win 5 games in a row |
| Hard | Win on Hard |

### 10.8 Lights Out

- **Board:** 5×5 cells, each 4 columns × 2 rows (20 × 10).
- **Controls:** click a cell, or arrows and space. `u` undoes one press; the undo counts as a move, so par stays honest. `r` after a clear goes to the next level.
- **Rules:**
  - Pressing a cell toggles it and its four neighbours. Turn every light off to clear the level.
  - Level n starts from n + 2 random presses from the solved board, seeded by the level, so every level is solvable and the same for everyone.
  - Par is the number of presses used to build it, minus any that cancel out.
- **Saves:** level, lights, moves.
- **Headline:** highest level cleared.

| Milestone | Goal |
|---|---|
| Lights off | Clear level 1 |
| Ten | Clear level 10 |
| Twenty-five | Clear level 25 |
| Fifty | Clear level 50 |
| On par | Clear a level at par |
| Ten on par | Clear 10 levels at par |

### 10.9 Memory

- **Board:** 4×4 cards (8 pairs), each 6 columns × 3 rows. 6 across × 4 down (12 pairs) is offered when the region has at least 41 columns. Compact: cards 6 columns × 2 rows (11 rows in all).
- **Controls:** click a card, or arrows and space.
- **Rules:**
  - Flip two cards. A match stays face up; a miss turns back after 0.8 seconds.
  - Faces are colored glyphs: `♠ ♥ ♦ ♣ ★ ● ▲ ■ ◆ ✿ ☀ ☾`.
  - The score is flips; fewer is better.
- **Saves:** layout, matched, flips, time, rng.
- **Headline:** best flips on 4×4.

| Milestone | Goal |
|---|---|
| Matched | Clear a 4×4 board |
| Sharp | Clear 4×4 in 24 flips or fewer |
| Sharper | Clear 4×4 in 20 flips or fewer |
| Speedy | Clear 4×4 in under 40 seconds |
| Big board | Clear 4×6 |
| Regular | Clear 25 boards |

### 10.10 Connect Four

- **Board:** 7 columns × 6 rows of discs, each 4 columns × 2 rows, on a blue `#2f5fb3` frame.
- **Controls:** click a column, or ←→ and space. `1` `2` `3` pick difficulty before the first move.
- **Rules:**
  - You're red and move first; the bot is yellow.
  - Bot strength: Easy plays a random legal move, but takes any immediate win and blocks any immediate loss. Normal is negamax to depth 4. Hard is depth 7 with alpha-beta and a center-first move order: the bot thinks on the drawing thread, and depth 7 stays well under a second (tested).
  - A disc falls a row a frame. The winning four are drawn brighter. The bot waits 0.4 seconds before it moves, so its move can be seen.
- **Saves:** grid, turn, difficulty.
- **Headline:** wins.

| Milestone | Goal |
|---|---|
| Four | Win a game |
| Normal | Win on Normal |
| Hard | Win on Hard |
| Diagonal | Win with a diagonal |
| Quick four | Win in 10 or fewer of your moves |
| Streak | Win 3 games on Hard in a row |

### 10.11 Tic-tac-toe

- **Board:** 3×3 cells, each 7 columns × 3 rows, with thin lines between them.
- **Controls:** click, or `1`–`9` as a phone keypad, or arrows and space. `d` switches Easy and Perfect before your first move.
- **Rules:**
  - Turns alternate between you and the bot, and you swap who starts every game.
  - Easy plays randomly but takes wins; Perfect plays minimax and never loses.
- **Saves:** grid, turn, who started, difficulty.
- **Headline:** wins and draws.

| Milestone | Goal |
|---|---|
| Three | Win on Easy |
| Second | Win on Easy when the bot starts |
| Unbeaten | Draw against Perfect |
| Ten draws | Draw against Perfect 10 times |
| Patient | Play 25 games |

### 10.12 Wordle

- **Board:** 6 rows of 5 tiles, each 3 columns × 1 row with 1-column gaps. A 3-row on-screen keyboard, keys 3 columns wide with 1-column gaps (39 columns for the top row), shows each letter's best state.
- **Controls:** type letters, Backspace, Enter. Clicking the on-screen keyboard works too. `n` starts a practice game.
- **Rules:**
  - Standard Wordle.
  - **Daily:** one puzzle per local date. It is the same for everyone using this mod: answer index = days since 2026-01-01, modulo the list's length, with the list's order fixed at release.
  - **Practice:** unlimited puzzles from the same list, random, never today's.
  - **Hard mode:** a setting in the manifest, off by default. Revealed hints must be used in later guesses.
  - **Word lists:** guesses not in the accepted list shake the row and don't count. Answers are 2,011 common words written for this mod and checked against ENABLE, shuffled once with a fixed seed so the dailies don't run alphabetically. Accepted guesses are every five-letter word in ENABLE (public domain) plus the answers: 8,636. Both are checked into `words/`.
  - **Commands:** letters are guesses, so Wordle's commands take shift: `H` hub, `T` milestones, `Q` close, `N` a practice game.
- **Saves:** daily and practice games separately; guesses, mode, date.
- **Headline:** daily streak.

| Milestone | Goal |
|---|---|
| Solved | Solve a puzzle |
| In three | Solve in 3 guesses |
| In two | Solve in 2 guesses |
| Week | A 7-day daily streak |
| Month | A 30-day daily streak |
| Hard mode | Solve a daily in hard mode |
| Fifty | Solve 50 puzzles |
| Hole in one | Solve in 1 guess |

The daily streak counts consecutive dates solved; a missed date resets it, and a loss resets it too.

### 10.13 Hangman (coding words)

- **Board:** the gallows drawn in 7 rows of line characters; the word in slots below; a 3-row keyboard.
- **Controls:** type letters, or click the keyboard.
- **Rules:**
  - 6 misses allowed. The category is shown: Languages, Tools, Concepts, Commands.
  - Words come from `words/hangman.ts`, about 400, all coding terms: `typescript`, `rebase`, `closure`, `grep`, `kubernetes`, ...
  - No repeats until the list is used up.
- **Saves:** word index and guesses. No repeats comes from the deal: every word in one fixed shuffle, and a counter (`extra.dealt`) of words finished; a word given up on comes back next.
- **Commands:** letters are guesses, so like Wordle its commands take shift; `N` deals the next word.
- **Headline:** words solved.

| Milestone | Goal |
|---|---|
| Saved | Solve a word |
| Clean | Solve with no misses |
| Streak | Solve 10 in a row |
| Fifty | Solve 50 words |
| Every category | Solve a word in each of the 4 categories |
| Long one | Solve a word of 12 letters or more |

### 10.14 20 Questions (with Claude)

The one game that calls a model, so it works differently:

- **Consent:** on first open, the pane says "20 Questions asks Claude about 20 short questions a game, which counts toward your Claude usage." Buttons: "Play" and "Not now". "Play" stores `twentyConsent: true`. Until then the hub row says `uses Claude`.
- **Mode, Claude asks:**
  - You think of something in a category you pick: animal, object, place, person, food.
  - Claude asks yes-or-no questions and you answer with buttons or keys: `y` Yes, `n` No, `s` Sort of, `?` Don't know.
  - Claude may guess at any point. A wrong guess costs a question.
  - After 20 questions, or at a correct guess, the game ends. Ending with no correct guess is a win for you ("You stumped Claude"). No typing is needed.
- **Model calls:**
  - `$.model` with Haiku 5.5 (`claude-haiku-5-5`), from `register.tsx` only.
  - One call per question. The input holds a short system prompt, the category, and the questions and answers so far.
  - The answer is one JSON object: `{ "kind": "question" | "guess", "text": "..." }`, at most 120 characters. A malformed answer is retried once, then the game ends with "Claude lost its train of thought" and no result.
  - While a call runs the board shows a spinner. Esc or `h` abandons the game with no result.
- **Board:** the question in large text, the question number, the history as a short list of dimmed lines, and the four answer buttons. It is drawn from the hooks module through props, since only that module can call the model.
- **Saves:** category, history, question count. A resumed game continues from the next question.
- **Headline:** times you stumped Claude.

| Milestone | Goal |
|---|---|
| First game | Finish a game |
| Stumped | Stump Claude |
| Five stumps | Stump Claude 5 times |
| Every category | Finish a game in each category |
| Mind reader | Claude guesses yours in 7 questions or fewer |

### 10.15 Across all games

| Milestone | Goal |
|---|---|
| Sampler | Play 5 different games |
| Everything | Play all 14 games |
| Hundred | Play 100 games in total |
| Collector | Unlock 50 milestones |
| Coffee break | Finish a game while Claude works on a turn |

These live in the `profile` record's own `milestones`, and show at the top of the `T` view.

## 11. Settings

`userConfig` in the manifest, each a row in the config menu:

| Key | Type | Default | What it does |
|---|---|---|---|
| `notifyTurnEnd` | boolean | `true` | Toast and pause an arcade game when Claude finishes a turn while a game is open (§5.5) |
| `suggestDuringLongTurns` | boolean | `false` | The line above the prompt during a turn longer than 60 seconds (§5.5) |
| `highContrast` | boolean | `false` | Orange and blue in Wordle, glyphs for every colored state (§9.2) |
| `wordleHardMode` | boolean | `false` | Wordle hard mode (§10.12) |

## 12. Commands

| Typed | Does |
|---|---|
| `/games` | Opens the pane on the hub, focused |
| `/games <name>` | Opens that game; resumes a save if there is one |
| `/games milestones` | Opens the all-games milestone view |
| `/games close` | Saves any game in progress and closes the pane |
| `/games reset <name>` or `/games reset all` | Opens the reset card (§8.3) |

- **Names:** each game takes its id and a few aliases: `snake`; `tetris`; `breakout`; `dino` and `dino-run`; `pong`; `2048`; `mines` and `minesweeper`; `lights` and `lights-out`; `memory`; `connect4`, `connect-four` and `c4`; `tictactoe`, `ttt` and `xo`; `wordle`; `hangman`; `twenty`, `20q` and `20-questions`.
- **Matching:** case and hyphens are ignored.
- **Unknown names:** open the hub with a toast, `No game called "tetirs". Did you mean Tetris?`, using the closest name by edit distance when it is 2 or less.
- **`argumentHint`:** `[game]`.

## 13. Testing

- **Logic** (`tests/<id>.logic.test.ts`), per game, from seeded states:
  - each rule in §10
  - `serialize` then `restore` gives an identical game
  - the game ends where it should
  - Tetris rotation checked against the SRS kick tables; Lights Out levels checked solvable; Connect Four's Hard bot checked to never miss a win in one
- **Milestones** (`tests/milestones.test.ts`): every row of every table in §10, from the events and stats that should unlock it and the near misses that shouldn't.
- **Store** (`tests/store.test.ts`):
  - the merge rules of §7.4, including two interleaved writers
  - migration from each older `schema`
  - an old save version dropped with stats kept
- **Pane** (`tests/pane.test.ts`), looped over `['terminal', 'desktop']`:
  - the hub draws all 14 rows
  - Enter on a row opens that game
  - `h` returns
  - a posted `over` updates the hub's headline and raises a toast for a new milestone
  - `/games tetirs` suggests Tetris
- **20 Questions** with a mocked `$.model`: a question, a guess, a malformed answer and its retry, and the consent gate.
- **Size:** a test draws every game's busiest frame and checks it stays under 2,000 nodes and that every row fits the region's columns.

## 14. Phases

| Phase | Ships | Contents |
|---|---|---|
| 0 | nothing | Done 2026-10-11, desktop and terminal: the platform checks of §4.3, measurements in Appendix A |
| 1 | 0.1.0 | Built 2026-10-11 (Appendix B): hub, store, milestones, saves, settings, commands; Snake, 2048, Minesweeper, Wordle |
| 2 | 0.2.0 | Built 2026-10-11 (Appendix C): Lights Out, Memory, Connect Four, Tic-tac-toe, Hangman |
| 3 | 0.3.0 | Tetris, Breakout, Dino Run, Pong; `notifyTurnEnd` pausing; the long-turn line |
| 4 | 0.4.0 | 20 Questions; the "Coffee break" milestone |
| Later | — | Sound on milestones (`$.audio.play`, off by default); the mobile app once it can draw a `Client`; a "You ask" mode for 20 Questions |

Phase 1's four games cover the cell canvas, tiles, keys, the pointer, the frame clock, words and every kind of save, so later phases add games without new framework.

## 15. Open questions

1. Should Wordle's daily puzzle be shared with the public game's word for the day? No: that would need a network call and a list we can't ship. The daily here is the mod's own.
2. Should milestones show in the status line or a band? No (§2: uncluttered). A toast is enough.
3. Where should the best scores of different difficulties show in the hub? Proposal: the hub shows the default difficulty's; the milestone view lists the others.

## Appendix A. Phase 0 results

The answers and decisions are in §4.3. These are the measurements behind them. Pixel sizes are from Retina screenshots, so they are twice CSS pixels.

**Desktop round 1** (Claude Code 2.1.295, docked side pane): text cells, keys, pointer, clock.

- Viewport 106×52; pane body 42×45, docked; `Client` region 42×23.
- Frame clock at `every(50)`: 30 one-second samples between 19.9 and 20.1 ticks a second.
- Keys arrived before any click (arrows), and after one (arrows, letters).
- Pointer: `enter`, `leave`, `down`, `up`, `move`; button `left` only; no `fine` position.
- Focus: Escape left the pane with `isFocused: false` and a redraw; the board's timer ticked 49 more times, unpaused. A click back raised `ui.focus` with origin `person`.
- A text cell of two spaces on a background color: about 11 px wide and 38 px tall per column pair, since the desktop's text is proportional. `▀` with a foreground and a background color drew as a thin strip of the foreground at the top of a full-height background, not two half-cells.
- `import` from a sibling file inside a surface module: worked.
- In the test kit, the module was called twice before its first `setState`, starting two timers (40 ticks in a second); a `WeakSet` guard fixed it.

**Desktop round 2:** Box cells, sprites, tiles.

- A `Box` 2 columns × 1 row with a `backgroundColor`: about 31×38 px, solid, rows touching with no gap.
- A tile `Box` 7 columns × 3 rows with centered bold text: about 111×114 px. Letter tiles 3×1, a `round` border: drawn as expected, the border with rounded corners.
- `position="absolute"` children of a `position="relative"` board were placed from the `Client` region's top-left corner, over the rows above the board, not inside it.
- A fractional `top` (2.5) was refused by the engine: positions are whole cells.
- shift+click arrived as `down`/`up` with `shift: true`; right-click arrived as nothing.

**Terminal rounds** (Claude Code 2.1.296 started with `--plugin-dir`, a 91×58 terminal, not fullscreen):

- The pane sat inline above the prompt: body 87×17, `Client` region 87×28, so the rows past 17 were cut off. Moving the input lines and the later sections to the top was the second round; the `--plugin-dir` folder reloaded on its own after the edit.
- Frame clock at `every(50)`: 30 samples between 15 and 19.5 ticks a second.
- Text cells (two spaces on a background color), Box cells (2×1) and `▀` half-blocks all drew solid. Two half-block pixels make one square, about 14×15 px.
- Two `position="absolute"` blocks inside a `position="relative"` board moved inside that board.
- Tiles drew at their sizes and the `round` border with rounded corners, but bold white text on the 2048, green and yellow tiles drew dim gray.
- Keys: arrows and letters, every one after a click on the board. Pointer: `enter`, `leave`, `down`, `up`, `move`; button `left` only; shift reported; no `fine` position (the terminal tab was the desktop app's own terminal panel).
- Focus: the pane opened focused; the first click on the board set the pane's `isFocused` to false, and keys kept arriving at the board for the rest of the run (86 ticks counted while "unfocused"). No `ui.focus` event fired.
- Escape gave no sign a plugin could see, and the person found no way to close the board besides the pane's close mark.

The probe was a throwaway mod outside the repo and was deleted after these were recorded.

## Appendix B. Phase 1 notes

Built on 2026-10-11 and played in the desktop app: two Snake games recorded with their best and "First bite", a 2048 game saved mid-way with "256" unlocked on a save, two Minesweeper games, and a Wordle daily started. 40 tests pass in the test engine on terminal and desktop.

What changed from the plan while building it:

- **Posts are batched.** A board's posts in one frame replace each other (§4.2), which lost the save posted when leaving a game for the hub. Every post now goes out in a `Batch` with the ones not yet acknowledged (§6.2).
- **`h` is reserved.** JSX compiles to the global `h`, so a local named `h` (2048's tile height) hid it and the board crashed when drawing. The tests caught it; no module names a local `h`.
- **No `Svg`.** The hub lives in the board's `Client`, so icons are glyph tiles on both surfaces (§9.1).
- **The hub lists playable games only**, and its milestone total counts them: 29 for phase 1.
- **The cards** (paused, game over, restart) are absolutely positioned children of the board's root `Box`, the one place both surfaces agree on (§4.3 P8).
- **2048 doesn't stop at 2048** (§10.6). **Wordle's commands take shift** (§10.12).
- **Minesweeper is a turn game with a clock** (`isTimed`): it saves on every move and pauses like an arcade game.
- **The across-all-games milestones** (§10.15) wait for phase 4, when every game exists.
- Not yet looked at by a person: the terminal (the tests cover it), and whether tile text reads well there (§4.3 P11).

## Appendix C. Phase 2 notes

Built on 2026-10-11. 54 tests pass in the test engine: each new game's rules, Connect Four's bot taking wins and blocking at every level and thinking at Hard in well under a second, Tic-tac-toe's Perfect never losing against every line of play, and all nine boards drawn in the pane on terminal and desktop.

What changed from the plan while building it:

- **Results sit under the board** (§5.3). A card over the middle hid what mattered in the new games: the winning four, the last Hangman word, where the mines were. The finished board stays bright and the controls line becomes the result, for every game.
- **Milestones get the game's time.** The hooks module adds `seconds`, from the board's clock, to an ended game's facts, so Memory's "Speedy" needs no timer of its own.
- **Hangman deals from a counter** instead of a saved set of used words (§10.13), and its 404 words were written for this mod.
- **Played in a terminal** (Claude Code 2.1.296, started with `--plugin-dir`, the pane docked about 75 columns wide): Snake, Minesweeper, Connect Four and Hangman games recorded, into the same store as the desktop app's, so progress carries between them. The hub drew whole there.
- **Connect Four's Hard looks 7 moves ahead**, not 8 (§10.10).
- **Memory has no rounded borders:** a border inside a card 2 rows tall leaves no room for its face. Cards are colored blocks.
- The hub's milestone total is 58 across the nine games. In a terminal's inline pane the hub takes 16 of its 17 rows.
- **Going on after a game.** In play, `h` at the end of a Tic-tac-toe game did nothing, though `r` had worked between games; the test engine couldn't reproduce it. The likely cause is the board losing the keyboard when the pane redraws after a game is recorded, with a click on a square giving it back. The result line's controls became Buttons with hotkeys (§5.3). Hangman's `h` and `r` at the end were letters; a finished word game now takes plain commands. Both confirmed in play on desktop after the change.
- A JSX gotcha came back: Memory's card height was named `h` as in 2048 (Appendix B), and was caught before a test ran. Locals named `h` stay banned.

