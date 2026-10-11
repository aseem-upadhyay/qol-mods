#!/usr/bin/env python3
"""Draws the README images for games: plugins/games/assets/*.svg.

Run: python3 scripts/games-assets.py (needs bun, https://bun.sh)

The positions are made up, but every board is the game's own drawing:
scripts/games-art.ts runs each game's `draw` and the board module's list of
games, lays the trees out on the character grid, and hands this script
rectangles and runs of text in columns and rows. This script only sets them
in a picture: a desktop app window, a gallery of boards, and a terminal.

The desktop pictures set a grid cell 8 px wide and 16 tall, so a board's
cell of 2 columns by 1 row is square, as it is in the app. The terminal
picture pins every run of text to its cells (textLength), so it lines up in
whatever monospace font a viewer has.
"""
import json
import os
import subprocess
import sys
from xml.sax.saxutils import escape

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "plugins", "games", "assets")

FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

# The desktop app's dark theme.
D_BG = "#171717"
D_CHROME = "#1f1f1f"
D_PANEL = "#1b1b1b"
D_EDGE = "#333333"
D_TEXT = "#ececec"
D_DIM = "#9b9b9b"
D_BUBBLE = "#2a2a2a"
CLAUDE = "#d97757"

# The terminal.
T_BG = "#16161a"
T_CHROME = "#222228"
T_EDGE = "#2e2e36"
T_DIM = "#8a8a93"

INK = "#e6e6e6"
CAPTION = "#8b949e"


def art():
    """What games draws for the made-up positions: scripts/games-art.ts, run with bun."""
    try:
        done = subprocess.run(["bun", os.path.join(HERE, "games-art.ts")], check=True, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("games-assets.py needs bun (https://bun.sh): it runs the plugin's own drawing code.")
    except subprocess.CalledProcessError as error:
        sys.exit(f"scripts/games-art.ts failed:\n{error.stderr}")
    return json.loads(done.stdout)


def svg(w, h, body, title, font=SANS):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{escape(title)}" font-family="{font}">'
            f"<title>{escape(title)}</title>{body}</svg>\n")


# ---------------------------------------------------------------- setting a drawing


def cells(prims, x0, y0, cw, lh, size, pin=False, dim=T_DIM):
    """The art's rectangles and text at (x0, y0), `cw` × `lh` px a cell.

    A one-glyph run is centered in its cell (a tile's letter, a mine's number);
    a longer one starts at its first cell, pinned to its cells when `pin`."""
    out = []
    for p in prims:
        x = x0 + p["x"] * cw
        y = y0 + p["y"] * lh
        if p["kind"] == "rect":
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{p["w"] * cw:.1f}" height="{p["h"] * lh:.1f}" fill="{p["color"]}" shape-rendering="crispEdges"/>')
            continue
        text = p["text"]
        n = len(text)
        if p.get("bg"):
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{n * cw:.1f}" height="{lh}" fill="{p["bg"]}"/>')
        if text and set(text) == {"▀"}:
            # A half-block: the top half in the text's color, the bottom in its background.
            out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{n * cw:.1f}" height="{lh / 2:.1f}" fill="{p.get("color") or INK}"/>')
            continue
        if not text.strip():
            continue
        color = dim if p.get("dim") else (p.get("color") or INK)
        weight = ' font-weight="700"' if p.get("bold") else ""
        base = y + lh * 0.72
        if n == 1:
            out.append(f'<text x="{x + cw / 2:.1f}" y="{base:.1f}" text-anchor="middle" font-size="{size}" fill="{color}"{weight}>{escape(text)}</text>')
        elif pin:
            body = text.rstrip()
            lead = len(text) - len(text.lstrip())
            out.append(f'<text x="{x + lead * cw:.1f}" y="{base:.1f}" textLength="{len(body.strip()) * cw:.1f}" lengthAdjust="spacingAndGlyphs" '
                       f'font-size="{size}" fill="{color}"{weight} xml:space="preserve">{escape(body.strip())}</text>')
        else:
            lead = len(text) - len(text.lstrip())
            out.append(f'<text x="{x + lead * cw:.1f}" y="{base:.1f}" font-size="{size}" fill="{color}"{weight}>{escape(text.strip())}</text>')
    return "".join(out)


# The desktop's grid: a board cell (2 columns × 1 row) is 16 px square.
CW = 8
LH = 16


def game_card(board, x0, y0, width_cols=42):
    """One game as the pane shows it: its name and status, the board, its controls."""
    w = width_cols * CW
    out = [
        f'<text x="{x0}" y="{y0 + 12}" font-size="13" font-weight="700" fill="{D_TEXT}">{escape(board["name"])}</text>',
        f'<text x="{x0 + w}" y="{y0 + 12}" font-size="12" text-anchor="end" fill="{D_DIM}">{escape(board["status"])}</text>',
        cells(board["prims"], x0, y0 + LH + 4, CW, LH, 11),
    ]
    foot = y0 + LH + 4 + board["rows"] * LH + 16
    result = board.get("result")
    if result:
        # The result line: a bold title, a detail, and the two buttons at the right.
        lead = escape(result["title"])
        detail = escape(" · ".join(result["lines"][:1]))
        color = "#e3b341" if result["isWon"] else D_TEXT
        out.append(f'<text x="{x0}" y="{foot}" font-size="12"><tspan fill="{color}" font-weight="700">{lead}</tspan>'
                   f'<tspan fill="{D_TEXT}">{" · " + detail if detail else ""}</tspan></text>')
        again = escape(result.get("again") or "again")
        # Two buttons, set apart: SVG would collapse the spaces between them in one text.
        out.append(f'<text x="{x0 + w}" y="{foot}" font-size="12" text-anchor="end" fill="{D_TEXT}">'
                   f'<tspan fill="{CLAUDE}">h</tspan>: hub</text>')
        out.append(f'<text x="{x0 + w - 56}" y="{foot}" font-size="12" text-anchor="end" fill="{D_TEXT}">'
                   f'<tspan fill="{CLAUDE}">r</tspan>: {again}</text>')
    else:
        out.append(f'<text x="{x0}" y="{foot}" font-size="11.5" fill="{D_DIM}">{escape(" · ".join(fit(board["controls"], 46)))}</text>')
    return "".join(out), foot + 6 - y0


def fit(items, width):
    """As many controls as fit, most important first, as the board's footer does."""
    out = []
    for item in items:
        if len(" · ".join(out + [item])) > width:
            break
        out.append(item)
    return out


# ---------------------------------------------------------------- the desktop app


def desktop_window(w, h):
    return (f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="12" fill="{D_BG}" stroke="{D_EDGE}"/>'
            f'<rect x="0.5" y="0.5" width="{w - 1}" height="38" rx="12" fill="{D_CHROME}"/>'
            f'<rect x="0.5" y="26" width="{w - 1}" height="13" fill="{D_CHROME}"/>'
            + "".join(f'<circle cx="{20 + i * 20}" cy="19" r="6" fill="{c}"/>' for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")))
            + f'<text x="{w / 2}" y="24" text-anchor="middle" font-size="12.5" fill="{D_DIM}">my-app · Add retries to the upload client</text>')


def say(x, y, text, size=13.5, color=D_TEXT, weight=None, anchor=None):
    w = f' font-weight="{weight}"' if weight else ""
    a = f' text-anchor="{anchor}"' if anchor else ""
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}"{w}{a}>{escape(text)}</text>'


def preview_desktop(data):
    tetris = data["boards"]["tetris"]
    pane_cols = 42
    pane_w = pane_cols * CW + 2 * 22
    convo_w = 560
    w = convo_w + pane_w + 1
    h = 48 + 30 + tetris["rows"] * LH + 120
    body = [desktop_window(w, h)]

    # The conversation: Claude at work on the left.
    x = 28
    y = 74
    bubble = "Add retries to the upload client, then run the tests"
    body.append(f'<rect x="{convo_w - 28 - 372}" y="{y - 20}" width="372" height="34" rx="17" fill="{D_BUBBLE}"/>')
    body.append(say(convo_w - 28 - 356, y + 2, bubble, 13.5))
    y += 44
    body.append(say(x, y, "I'll add exponential backoff to uploadChunk, then run the suite.", 13.5))
    y += 32
    for verb, what, note in (("Read", "src/upload/client.ts", "212 lines"),
                             ("Edit", "src/upload/client.ts", "+38 −6"),
                             ("Bash", "npm test", "running…")):
        body.append(f'<circle cx="{x + 4}" cy="{y - 4}" r="3.5" fill="{CLAUDE if note == "running…" else "#4eba65"}"/>')
        body.append(say(x + 16, y, verb, 13, D_TEXT, 600))
        body.append(say(x + 56, y, what, 13, D_DIM))
        body.append(say(convo_w - 28, y, note, 12, D_DIM, anchor="end"))
        y += 26
    y += 8
    body.append(say(x, y, "✻", 14, CLAUDE))
    body.append(say(x + 18, y, "Running 412 tests… 1m 48s", 13, D_DIM))
    prompt_y = h - 66
    body.append(f'<rect x="{x - 6}" y="{prompt_y}" width="{convo_w - 2 * x + 12}" height="44" rx="12" fill="{D_CHROME}" stroke="{D_EDGE}"/>')
    body.append(say(x + 10, prompt_y + 27, "Reply to Claude…", 13.5, D_DIM))

    # The pane, docked beside it: Tetris.
    px = convo_w
    body.append(f'<rect x="{px}" y="39" width="{pane_w}" height="{h - 40}" fill="{D_PANEL}"/>')
    body.append(f'<line x1="{px + 0.5}" x2="{px + 0.5}" y1="39" y2="{h - 1}" stroke="{D_EDGE}"/>')
    card, _ = game_card(tetris, px + 22, 62, pane_cols)
    body.append(card)

    title = ("The Claude desktop app. On the left Claude is at work: it read and edited the upload client and is "
             "running the tests. Docked on the right, the games pane shows a Tetris game: a T piece falling over its "
             "ghost toward a stack with a gap, the next and held pieces beside the well, level 2, 18 lines, a score "
             "of 4,804 against a best of 12,400, and the controls on one line below.")
    return svg(w, h, "".join(body), title)


def preview_games(data):
    order = [["tetris", "2048", "wordle"], ["snake", "mines", "connect4"]]
    card_cols = 42
    card_w = card_cols * CW
    gap = 28
    pad = 22
    w = 3 * card_w + 2 * gap + 2 * pad
    # Cards in a row share the tallest one's height.
    framed = []
    y = pad
    for row in order:
        tallest = max(game_card(data["boards"][k], 0, 14)[1] for k in row) + 26
        for i, key in enumerate(row):
            x = pad + i * (card_w + gap)
            framed.append(f'<rect x="{x - 12}" y="{y}" width="{card_w + 24}" height="{tallest}" rx="12" fill="{D_PANEL}" stroke="{D_EDGE}"/>')
            framed.append(game_card(data["boards"][key], x, y + 14, card_cols)[0])
        y += tallest + gap
    h = y - gap + pad
    title = ("Six of the games as the pane draws them. Tetris: a stack with a gap and a T piece above its ghost. "
             "2048: a 2048 tile made, scoring 23,640. Wordle: today's puzzle, ARISE and CRAMP tried, A and R "
             "yellow then C, R and A green, CRA typed on the third row, the keyboard colored below. Snake: fifteen "
             "long, food ahead. Minesweeper: an easy board half open, numbers in color, two flags placed, 41 "
             "seconds in. Connect Four: red has four on a diagonal against the Normal bot, and the line under the board "
             "says You win! with r: again and h: hub.")
    return svg(w, h, f'<rect width="{w}" height="{h}" rx="14" fill="{D_BG}"/>' + "".join(framed), title)


# ---------------------------------------------------------------- the terminal


TCW = 7.8
TLH = 20


def preview_cli(data):
    hub = data["hubTerminal"]
    cols = hub["columns"] + 6
    x0 = 18
    w = int(cols * TCW + 2 * x0)
    top = 52
    body = []
    mono = lambda x, y, text, color=INK, bold=False: (  # noqa: E731
        f'<text x="{x:.1f}" y="{y:.1f}" textLength="{len(text) * TCW:.1f}" lengthAdjust="spacingAndGlyphs" '
        f'font-size="13" fill="{color}"{" font-weight=\"700\"" if bold else ""}>{escape(text)}</text>')
    body.append(mono(x0, top, "> /games"))
    body.append(mono(x0, top + TLH, "  ⎿  games: Opened games.", T_DIM))
    # The pane, inline above the prompt, in its rounded frame.
    fy = top + TLH * 2
    fh = (hub["rows"] + 1) * TLH + 8
    body.append(f'<rect x="{x0 - 4}" y="{fy}" width="{(cols - 1) * TCW + 8:.1f}" height="{fh}" rx="8" fill="none" stroke="{T_DIM}" stroke-opacity="0.7"/>')
    body.append(cells(hub["prims"], x0 + 2 * TCW, fy + 12, TCW, TLH, 13, pin=True))
    py = fy + fh + 18
    body.append(f'<rect x="{x0 - 6}" y="{py}" width="{cols * TCW + 12:.1f}" height="30" rx="6" fill="none" stroke="{T_DIM}" stroke-opacity="0.6"/>')
    body.append(mono(x0, py + 20, ">", T_DIM))
    h = py + 46
    frame = (f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="10" fill="{T_BG}" stroke="{T_EDGE}"/>'
             f'<rect x="0.5" y="0.5" width="{w - 1}" height="30" rx="10" fill="{T_CHROME}"/>'
             f'<rect x="0.5" y="20" width="{w - 1}" height="11" fill="{T_CHROME}"/>'
             + "".join(f'<circle cx="{18 + i * 18}" cy="16" r="5.5" fill="{c}"/>' for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")))
             + f'<text x="{w / 2}" y="20" text-anchor="middle" fill="{T_DIM}" font-family="{SANS}" font-size="12">claude — my-app</text>')
    title = ("A Claude Code terminal after /games. Above the prompt, the pane lists all thirteen games, each with a "
             "colored glyph, its best score or streak, and its milestones so far: Snake best 61 with a game to "
             "resume, Tetris best 12,400, 2048 best 23,640, Wordle on a 6-day streak with today's puzzle waiting, "
             "and the rest. The keys to choose, play and see milestones are on the last line.")
    return svg(w, h, frame + "".join(body), title, font=FONT)


def main():
    data = art()
    os.makedirs(OUT, exist_ok=True)
    for name, draw in (("preview-desktop.svg", preview_desktop), ("preview-games.svg", preview_games), ("preview-cli.svg", preview_cli)):
        with open(os.path.join(OUT, name), "w") as f:
            f.write(draw(data))
        print(f"wrote plugins/games/assets/{name}")


if __name__ == "__main__":
    main()
