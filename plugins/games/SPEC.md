# games: implementation spec

| | |
|---|---|
| Status | Draft, not started |
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
2. **Boards draw in a `Client` surface module.** It is the only element with keys, pointer and a frame clock (§4.1). It can't hold `Svg`, so boards are drawn from colored text cells.
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
- **`Svg` on desktop:** used only outside the board: game icons in the hub and the badge on a milestone card. The terminal draws a glyph instead (§9.1).

### 4.2 Client mechanics this spec relies on

- `surface.onKey(fn)`: keys while the `Client` has focus. Escape never arrives; it returns focus to the prompt.
- `surface.onPointer(fn)`: `down`/`move`/`up` with cell coordinates and which button.
- `surface.every(ms, fn)`: the frame clock. Started once, while `state` is undefined.
- `surface.setState(next)`: local state; redraws on the next frame. Three renders in a row with no tick, key or pointer between them unmount the instance, so every `setState` follows an input or a tick.
- `surface.post(data)`: one message per frame to the hooks module as `ui.message`. A hook answering `{ props }` hands the board new props.
- Bounds: 20,000 nodes, 32 deep, 100,000 characters per tree; `props` at most 100,000 characters serialized.

### 4.3 Phase 0: things to check before building

| # | Question | If the answer is no |
|---|---|---|
| P1 | Does the desktop draw `Text` `backgroundColor` inside a `Client` as solid cells with no gaps between rows? | Draw with block glyphs (`█`, `▀`, `▄`) in the foreground color instead. |
| P2 | Can a surface module `import` sibling files (`../games/snake/logic.ts`)? | Bundle each game's logic into `board.tsx` with a build script, `scripts/games-bundle.ts`. |
| P3 | Does `$.ui.open({ focus: true })` give the `Client` the keyboard, or does it need a click? | The board shows "Click to play" until its first pointer `down`. |
| P4 | Is there a signal when the `Client` loses focus (Escape, a click on the prompt)? `ui.focus` in the hooks module is the first place to look. | Arcade games pause when no key has arrived for 3 seconds and the pointer has left the region. |
| P5 | Does `surface.every(50, …)` hold close to 20 frames a second on desktop and in the terminal? | Lower the arcade games' tick rates; Dino Run and Breakout move 2 pixels a frame. |
| P6 | How many columns and rows does a desktop side pane give at its default width? | Pick the smaller board sizes in §10 and scale up only when room allows. |
| P7 | Does a `Client` unmount when the pane is hidden behind another tab, or keep running? | If it keeps running, arcade games pause on `ui.close` and when the pane reports `isShown: false`. |

Phase 0 is a throwaway mod that draws a 32×16 colored grid with a moving block, logs keys and pointer events, and posts every frame. It is deleted once each answer is recorded in Appendix A.

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
- **Desktop:** a 20×20 `Svg` icon at the start of each row (§9.1). Terminal: a one-character colored glyph (`■` Snake, `▦` Tetris, ...).
- **Header:** total milestones unlocked across games.
- **Mobile and vscode:** the same list, without the keys or the play action, and a line saying where to play.

### 5.3 A game

```
 Snake                         score 14 · best 61
╭────────────────────────────────────────────────╮
│                                                │
│        ██████████                              │
│                 ██             ●               │
│                 ██                             │
│                                                │
╰────────────────────────────────────────────────╯
 ←↑→↓ move · p pause · r restart · h hub
```

- **Above the board:** the game's name on the left; on the right its live numbers (score, best; or time, mines left; or level, moves).
- **Below the board:** one dim line of controls. It never wraps: on a narrow pane the least important controls drop off the end.
- **Common keys** in every game: `p` pause, `r` restart (asks "Restart? y/n" over the board if a game is under way), `h` back to the hub, `t` this game's milestones. Each game adds its own (§10).
- **Pausing:** a paused game dims the board and shows "Paused · p to resume" in its middle.
- **Game over:** the board stays and a card covers its middle: the result, "New best!" when it is, any milestones unlocked this game, and `r again · h hub`.

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
 /games [name]         turn.start / turn.complete
      │                        │
      ▼                        ▼
 hooks/register.tsx ── every $ call: command, pane, store, toasts, model
      │   ▲
props │   │ ui.message (post)
      ▼   │
 hooks/board.tsx ── the Client surface module: one per open game
      │
      ├── games/<id>/logic.ts      rules and state (pure)
      ├── games/<id>/view.ts       draws state with the element table (pure)
      └── core/*                   canvas, palette, rng, keys (pure)

 $.store ── profile, one record per game (§8)
 $.state ── which screen the pane shows, for redraws (§8.4)
```

### 6.1 Files

```
plugins/games/
  .claude-plugin/plugin.json      manifest, userConfig of §11
  README.md
  SPEC.md                         this file
  assets/                         README previews
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              every engine call: /games, the pane, ui.message, store, toasts, turn hooks, 20 Questions model calls
  hooks/board.tsx                 the Client surface module: picks the game by props.game, runs its loop, posts events
  hooks/hub.tsx                   the hub and milestone views, drawn from data and callbacks (pure)
  hooks/catalog.ts                the 14 games: id, name, group, glyph, icon SVG, headline stat (pure)
  core/rng.ts                     mulberry32 with a serializable state
  core/canvas.ts                  cell and half-block canvases, packed into runs of Text (§9.3)
  core/palette.ts                 board colors and each game's colors (§9.2)
  core/keys.ts                    key names to actions, shared controls (§5.3)
  core/store.ts                   record shapes, defaults, merge, migration (pure)
  core/milestones.ts              evaluate(game, event, record) → unlocked ids (pure)
  games/<id>/logic.ts             one per game: init, step, input, isOver, serialize, restore
  games/<id>/view.ts              one per game: draw(state, elements, region)
  games/<id>/milestones.ts        one per game: the table of §10 as data and predicates
  words/wordle-answers.ts         curated answer list, exported as one string
  words/wordle-guesses.ts         accepted guesses, exported as one string
  words/hangman.ts                coding words by category
  types/index.d.ts                $.state contract and record types
  tests/*.test.ts                 logic, milestones, store merge, and the pane on terminal and desktop
```

The engine follows `$` only into functions declared at the top of the hooks module, so every engine call lives in `register.tsx`. Every other module is pure and takes the element table and callbacks as arguments.

### 6.2 Messages between the board and the hooks module

The board posts:

```ts
type BoardPost =
  | { type: 'save'; game: GameId; save: Save }                 // §8.2; throttled (§7.2)
  | { type: 'event'; game: GameId; event: GameEvent }          // scored, won, lost, ...
  | { type: 'over'; game: GameId; result: GameResult }         // a game ended
  | { type: 'nav'; to: 'hub' | 'milestones' | GameId }         // h, t, a hub row
  | { type: 'ask'; game: 'twenty'; answer: TwentyAnswer }      // 20 Questions only (§10.14)
```

The hooks module answers with new props:

```ts
type BoardProps = {
  game: GameId
  save?: Save                    // given once, when the game opens with a save
  best: Record<string, number>   // what the score line shows
  unlocked: string[]             // milestone ids, for the game-over card
  justUnlocked?: string[]        // shown on the game-over card, then cleared
  paused?: boolean               // set by turn.complete or a lost focus (§4.3 P4)
  settings: { highContrast: boolean }
  twenty?: TwentyView            // 20 Questions only
}
```

`GameEvent` and `GameResult` are each game's own union, declared beside its `logic.ts`, carrying only what its milestones and stats need.

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
- **A finished game** clears its `save`; the next open starts fresh.
- **Resuming:** opening a game that has a `save` restores it.
  - Turn-based games continue at once.
  - Arcade games open paused, with "p to resume" and a 3-2-1 countdown once pressed.
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

`$.state` holds only what the pane draws from: `screen` (`hub`, `milestones`, `all-milestones`, a `GameId`, or `reset`) and `selected` (the hub's highlighted row). It survives a hot reload; the store is the durable copy.

```ts
interface PluginState {
  games: {
    screen: Screen
    selected: number
  }
}
```

## 9. Look

### 9.1 Icons and glyphs

- **Desktop hub:** each game has a hand-written 20×20 SVG icon in `catalog.ts`: a snake's curve, a T piece, a brick row, a cactus, two paddles, a 2048 tile, a mine, a lit cell, two cards, a red disc, an X and O, a green letter tile, a noose, a question mark. Flat shapes in the game's main color, no text, no strokes thinner than 2px.
- **Terminal:** one colored glyph per game: `■ ▦ ▤ ♣ ▮ ◆ ✸ ◼ ♠ ● ✕ ▣ ☐ ?`.
- **Milestone badge** on desktop's game-over card: a 32×32 SVG star with the game's color.

### 9.2 Palette

- **The board:** `#1b1d23` with a one-cell border in `#2b2e37`. Colors in a game sit on it, so they're picked once for both themes.
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

`core/canvas.ts` gives each game one of two canvases:

- **Cell canvas:** each cell is 2 columns × 1 row, close to a square on screen. Used by Snake, Minesweeper, Tetris (when the region has ≥ 22 rows) and Lights Out.
- **Pixel canvas:** each terminal cell holds two square pixels, top and bottom, drawn as `▀` with the top pixel as foreground and the bottom as background. Used by Breakout, Pong, Dino Run, and Tetris on short regions.

Either way a row is packed into runs: neighbouring cells with the same colors become one `Text`. A 48-column row of a typical frame comes to 5–15 nodes, so a whole board is a few hundred, far inside the 20,000 bound.

Tiles (2048, Wordle, Memory, Connect Four, Tic-tac-toe) are `Box`es with a `backgroundColor` and centered text.

## 10. The games

Each game below lists its board, controls beyond the common ones (§5.3), rules, what it saves, its headline in the hub, and its milestones. Sizes are the defaults for a pane of at least 50 columns × 22 rows; §4.3 P6 may shrink them.

### 10.1 Snake

- **Board:** 22×13 cells on the cell canvas (44 × 13 columns and rows).
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

- **Board:** 10×20, on the cell canvas when the region has ≥ 22 rows, else the pixel canvas. A next-piece box sits beside it, and the level beside that.
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

- **Board:** 48×28 pixels (48 columns × 14 rows): 6 rows of 8 bricks, a paddle 8 pixels wide.
- **Controls:** ←→ or the mouse (the paddle follows the pointer's column). Space launches.
- **Rules:**
  - 3 lives. The ball speeds up at 4 and 12 hits and when it first reaches the top rows.
  - Where the ball hits the paddle sets its angle.
  - Levels 1–5 have their own brick layouts and loop after level 5, a little faster each time.
  - Top-row bricks are worth 7, the next two rows 5 and 3, the rest 1.
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

- **Board:** 64×24 pixels (64 columns × 12 rows), the ground 4 pixels from the bottom.
- **Controls:** space or ↑ jump (hold for a higher jump), ↓ duck. A click anywhere on the board jumps.
- **Rules:**
  - The ground scrolls left, starting at 1 pixel a frame and gaining speed over time.
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

- **Board:** 48×28 pixels, a paddle at each side, a dotted net down the middle.
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

- **Board:** 4×4 tiles, each 7 columns × 3 rows with 1-cell gaps (33 × 17).
- **Controls:** arrows or WASD. On desktop, a swipe (pointer drag of at least 3 cells) works too.
- **Rules:**
  - The standard game: tiles slide and merge, and a new tile (2, or 4 one time in ten) appears after each move that changed the board.
  - Reaching 2048 offers "Keep going?".
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

- **Board:** Easy 9×9 with 10 mines, Medium 16×16 with 40, on the cell canvas. Hard (30×16, 99 mines) is offered only when the region has at least 62 columns.
- **Controls:**
  - Click to reveal, right-click to flag.
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
- **Controls:** click a cell, or arrows and space. `u` undoes one move.
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

- **Board:** 4×4 cards (8 pairs), each 6 columns × 3 rows. 4×6 (12 pairs) is offered when the region allows.
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
  - Bot strength: Easy plays a random legal move, but takes any immediate win and blocks any immediate loss. Normal is minimax to depth 4. Hard is depth 8 with alpha-beta and a center-first move order.
  - A disc drops over 4 frames. The winning four flash.
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
- **Controls:** click, or `1`–`9` as a phone keypad, or arrows and space.
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

- **Board:** 6 rows of 5 tiles, each 3 columns × 1 row with 1-column gaps. A 3-row on-screen keyboard shows each letter's best state.
- **Controls:** type letters, Backspace, Enter. Clicking the on-screen keyboard works too. `n` starts a practice game.
- **Rules:**
  - Standard Wordle.
  - **Daily:** one puzzle per local date. It is the same for everyone using this mod: answer index = days since 2026-01-01, modulo the list's length, with the list's order fixed at release.
  - **Practice:** unlimited puzzles from the same list, random, never today's.
  - **Hard mode:** a setting in the manifest, off by default. Revealed hints must be used in later guesses.
  - **Word lists:** guesses not in the accepted list shake the row and don't count. Answers are a curated list of common words (about 2,300); accepted guesses are a larger list (about 13,000). Both are public-domain lists, checked into `words/`.
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
- **Saves:** word index, guesses, the used-word set (a bitset string).
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
| 0 | nothing | The platform checks of §4.3; answers in Appendix A |
| 1 | 0.1.0 | Hub, store, milestones, saves, settings, commands; Snake, 2048, Minesweeper, Wordle |
| 2 | 0.2.0 | Lights Out, Memory, Connect Four, Tic-tac-toe, Hangman |
| 3 | 0.3.0 | Tetris, Breakout, Dino Run, Pong; `notifyTurnEnd` pausing; the long-turn line |
| 4 | 0.4.0 | 20 Questions; the "Coffee break" milestone |
| Later | — | Sound on milestones (`$.audio.play`, off by default); the mobile app once it can draw a `Client`; a "You ask" mode for 20 Questions |

Phase 1's four games cover both canvases, keys, the pointer, the frame clock, words and every kind of save, so later phases add games without new framework.

## 15. Open questions

1. Should Wordle's daily puzzle be shared with the public game's word for the day? No: that would need a network call and a list we can't ship. The daily here is the mod's own.
2. Should milestones show in the status line or a band? No (§2: uncluttered). A toast is enough.
3. Where should the best scores of different difficulties show in the hub? Proposal: the hub shows the default difficulty's; the milestone view lists the others.

## Appendix A. Phase 0 results

To be filled in from §4.3: each question, what was seen on terminal and desktop, and the decision taken.
