#!/usr/bin/env python3
"""Draws the README images for coach: plugins/coach/assets/*.svg.

Run: python3 scripts/coach-assets.py (needs bun, https://bun.sh)

The figures are made up: the tests' beginner month, given eight weeks of
history by scripts/coach-art.ts, which runs the plugin's own drawing code
and hands this script the desktop pictures and the words beside them.

The terminal images lay text on a fixed character grid (textLength pins every
run to its cells), so they line up whatever monospace font a viewer has. The
desktop image sets the plugin's pictures as they are drawn, and its own words
in the system sans, wrapped with room to spare for a wider font.
"""
import json
import os
import re
import subprocess
import sys
import textwrap
from xml.sax.saxutils import escape

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "plugins", "coach", "assets")

CW = 7.8  # cell width, px
LH = 20  # line height, px
FS = 13  # font size, px
FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

BG = "#16161a"
CHROME = "#222228"
EDGE = "#2e2e36"
TEXT = "#e6e6e6"
DIM = "#8a8a93"
CLAUDE = "#d97757"
GREEN = "#4eba65"
AMBER = "#e2a33a"
CAPTION = "#8b949e"
TONE = {"good": GREEN, "bad": AMBER, "flat": DIM, "claude": CLAUDE}

# The desktop app's dark theme.
D_BG = "#171717"
D_CHROME = "#1f1f1f"
D_PANEL = "#262626"
D_EDGE = "#333333"
D_TEXT = "#ececec"
D_DIM = "#9b9b9b"

PANE = 700  # the desktop pictures' width, px


def art():
    """What coach draws for the made-up month: scripts/coach-art.ts, run with bun."""
    try:
        done = subprocess.run(["bun", os.path.join(HERE, "coach-art.ts"), str(PANE)],
                              check=True, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("coach-assets.py needs bun (https://bun.sh): it runs the plugin's own drawing code.")
    except subprocess.CalledProcessError as error:
        sys.exit(f"scripts/coach-art.ts failed:\n{error.stderr}")
    return json.loads(done.stdout)


# ---------------------------------------------------------------- the terminal


def run(x0, y, col, text, color=TEXT, bold=False):
    """`text` in its cells. SVG collapses runs of spaces, so a gap of two or
    more starts a new run at its own column, each pinned to its width."""
    out = []
    weight = ' font-weight="700"' if bold else ""
    for piece in re.finditer(r"\S+(?: \S+)*", text):
        body = piece.group(0)
        x = x0 + (col + piece.start()) * CW
        out.append(f'<text x="{x:.1f}" y="{y}" textLength="{len(body) * CW:.1f}" lengthAdjust="spacingAndGlyphs" '
                   f'fill="{color}"{weight}>{escape(body)}</text>')
    return "".join(out)


def line(x0, y, parts, col=0):
    """(text, color, bold) parts, left to right from `col`."""
    out = []
    for part in parts:
        text, color, bold = (part + (TEXT, False))[:3] if len(part) == 1 else (part + (False,))[:3]
        out.append(run(x0, y, col, text, color, bold))
        col += len(text)
    return "".join(out)


def width_of(parts):
    return sum(len(p[0]) for p in parts)


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{escape(title)}" font-family="{FONT}" font-size="{FS}">'
            f"<title>{escape(title)}</title>{body}</svg>\n")


def window(w, h, title):
    return (f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="10" fill="{BG}" stroke="{EDGE}"/>'
            f'<rect x="0.5" y="0.5" width="{w - 1}" height="30" rx="10" fill="{CHROME}"/>'
            f'<rect x="0.5" y="20" width="{w - 1}" height="11" fill="{CHROME}"/>'
            + "".join(f'<circle cx="{18 + i * 18}" cy="16" r="5.5" fill="{c}"/>'
                      for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")))
            + f'<text x="{w / 2}" y="20" text-anchor="middle" fill="{DIM}" font-family="{SANS}" font-size="12">'
              f"{escape(title)}</text>")


def buttons(labels, room):
    """`[ label ]`s two cells apart, wrapped at `room` as the pane's row wraps them."""
    rows, row = [], []
    for label in labels:
        cell = f"[ {label} ]"
        if row and width_of(row) + 2 + len(cell) > room:
            rows.append(row)
            row = []
        row += [("  ", DIM)] if row else []
        row.append((cell, DIM))
    return rows + [row] if row else rows


def boxed(rows, inner, color):
    """Rows of parts in a rounded frame `inner` cells wide inside, padded a cell each side."""
    out = [[("╭" + "─" * (inner + 2) + "╮", color)]]
    for parts in rows:
        out.append([("│ ", color)] + parts + [(" " * (inner - width_of(parts)),), (" │", color)])
    out.append([("╰" + "─" * (inner + 2) + "╯", color)])
    return out


def preview_cli(data):
    cols = 86
    x0 = 18
    room = cols - 2
    rows = []
    when = data["when"]
    rows.append([(data["title"], TEXT, True), (" " * (room - len(data["title"]) - len(when)),), (when, DIM)])
    rows.append([])
    rows += buttons(["Previous week", "Next week", "This week so far", "Ask Claude about this week"], room)
    rows.append([])

    # The four tiles, framed, as wide as the pane allows.
    tile = (cols - 5) // 4 - 4
    def cut(text):
        return text if len(text) <= tile else text[: tile - 1] + "…"
    tiles = data["tiles"]
    frame = [("╭" + "─" * (tile + 2) + "╮ ", DIM)] * 4
    rows.append(frame)
    label_row, value_row = [], []
    for t in tiles:
        label = cut(t["label"])
        label_row += [("│ ", DIM), (label, DIM), (" " * (tile - len(label)),), (" │ ", DIM)]
        value = [(t["value"], TEXT, True)] + ([(" " + t["delta"], TONE[t["tone"]])] if t["delta"] else [])
        value_row += [("│ ", DIM)] + value + [(" " * (tile - width_of(value)),), (" │ ", DIM)]
    rows += [label_row, value_row, [("╰" + "─" * (tile + 2) + "╯ ", DIM)] * 4, []]

    # The habit of the week in its card.
    habit = data["habit"]
    inner = room - 4
    full = round(habit["share"] * 10)
    card = [
        [("◆ ", CLAUDE), ("Habit of the week", CLAUDE, True)],
        [(habit["title"], TEXT, True), ("  ",), ("█" * full, CLAUDE), ("░" * (10 - full), DIM), ("  ",), (habit["score"], DIM)],
    ]
    card += [[(text, TEXT)] for text in textwrap.wrap(habit["evidence"], inner)]
    card += [[(text, TEXT)] for text in textwrap.wrap(habit["tryThis"], inner)]
    n = min(habit["liveTotal"], 8)
    filled = round(habit["liveDone"] / habit["liveTotal"] * n)
    card += [[], [("●" * filled, CLAUDE), ("○" * (n - filled) + " ", DIM), (habit["live"], DIM)], []]
    card += buttons(["See the session", f"What is {habit['glossary']}?", "Pick another habit", "Not right?"], inner)
    rows += boxed(card, inner, CLAUDE)
    rows.append([])

    # A CLAUDE.md card, unframed, as the terminal draws it.
    md = data["md"]
    rows.append([("◆ ", CLAUDE), (md["title"], CLAUDE, True)])
    rows += [[(text, TEXT)] for text in textwrap.wrap(md["lead"], room)]
    rows += [[("  " + text, GREEN)] for text in md["text"].split("\n")]
    rows += [[(text, DIM)] for why in md["why"] for text in textwrap.wrap(why, room)]
    rows.append([])
    rows += buttons(["Copy", "Not right?", "Dismiss"], room)

    top = 52
    body = [line(x0, top + i * LH, parts) if parts else "" for i, parts in enumerate(rows)]
    bar_y = top + len(rows) * LH + 18
    body.append(f'<line x1="{x0}" x2="{x0 + cols * CW}" y1="{bar_y - 15}" y2="{bar_y - 15}" stroke="{EDGE}"/>')
    body.append(line(x0, bar_y, [("Coach · this week: ", DIM), (data["bar"], TEXT, True)]))
    live = [("●" * filled, GREEN), ("○" * (n - filled) + " ", DIM), (f"{habit['liveDone']} of {habit['liveTotal']} switches", DIM)]
    body.append(line(x0, bar_y, live, col=cols - width_of(live)))
    prompt_y = bar_y + 16
    body.append(f'<rect x="{x0 - 6}" y="{prompt_y}" width="{cols * CW + 12}" height="30" rx="6" fill="none" '
                f'stroke="{DIM}" stroke-opacity="0.6"/>')
    body.append(run(x0, prompt_y + 20, 0, ">", DIM))
    w = int(cols * CW + 2 * x0)
    h = prompt_y + 46
    title = ("A Claude Code terminal with the coach report open: last week's sessions, prompts and spend in four "
             "framed tiles, spend up 40% on the four weeks before; the habit of the week, start fresh when you "
             "switch topics, 1 of 3 switches against a goal of 70%, with the session it came from; and two "
             "CLAUDE.md lines to copy. Above the prompt, the coach line keeps the habit in view: 2 of 3 switches "
             "this week.")
    return svg(w, h, window(w, h, "claude — my-app") + "".join(body), title)


def preview_bar():
    cols = 86
    x0 = 18
    states = [
        ("Report ready", [("● ", CLAUDE), ("Coach: your week in review is ready", TEXT)], [("/coach", DIM)]),
        ("Habit, with this week so far",
         [("Coach · this week: ", DIM), ("/clear when you switch topics", TEXT, True)],
         [("●●", GREEN), ("○ ", DIM), ("2 of 3 switches", DIM)]),
        ("A live hint (off by default)",
         [("● ", AMBER), ("Coach: New topic? This session is 310k tokens deep. /clear starts fresh", TEXT)], []),
        ("Narrow", [("Coach: /clear on topic switch", TEXT)], []),
    ]
    body = []
    y = 40
    for label, left, right in states:
        body.append(f'<text x="{x0}" y="{y}" fill="{CAPTION}" font-family="{SANS}" font-size="12">{escape(label)}</text>')
        body.append(f'<rect x="{x0 - 8}" y="{y + 8}" width="{cols * CW + 16}" height="30" rx="6" fill="{BG}" stroke="{EDGE}"/>')
        body.append(line(x0, y + 28, left))
        if right:
            width = sum(len(p[0]) for p in right)
            body.append(line(x0, y + 28, right, col=cols - width))
        y += 64
    w = int(cols * CW + 2 * x0)
    title = ("The coach line above the prompt in four states: a report ready to read; the habit of the week with "
             "this week's progress, 2 of 3; a live hint about a topic change in a big session; and the short form "
             "it falls back to when the terminal is narrow.")
    return svg(w, y, "".join(body), title)


# ---------------------------------------------------------------- the desktop app


def text_width(text, size, bold=False):
    """About how wide `text` sets in the system sans: art.ts's own estimate."""
    em = 0.0
    for ch in text:
        if ch in " .,:;'!|ijlIft()[]":
            em += 0.3
        elif ch in "mwMW@%":
            em += 0.86
        elif "A" <= ch <= "Z":
            em += 0.66
        elif ch.isdigit() or ch == "$":
            em += 0.6
        elif ord(ch) > 0x2000:
            em += 0.92
        else:
            em += 0.54
    return em * size * (1.07 if bold else 1)


def wrap(text, size, room):
    """Words in lines no wider than 90% of `room`, so a wider font still fits."""
    lines, cur = [], ""
    for word in text.split(" "):
        test = f"{cur} {word}" if cur else word
        if cur and text_width(test, size) > room * 0.9:
            lines.append(cur)
            cur = word
        else:
            cur = test
    return lines + [cur] if cur else lines


def place(source, x, y):
    """One of the plugin's pictures, set at (x, y) as it was drawn."""
    return source.replace('<svg xmlns="http://www.w3.org/2000/svg" ', f'<svg x="{x}" y="{y}" ', 1)


def say(x, y, text, size=13.5, fill=D_TEXT, weight=None):
    bold = f' font-weight="{weight}"' if weight else ""
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}"{bold}>{escape(text)}</text>'


def desk_buttons(x0, y, labels, room, primary=None):
    """The desktop's buttons: rounded, one the primary; wrapped at `room`. Returns (markup, bottom)."""
    out, x, h = [], x0, 30
    for label in labels:
        w = text_width(label, 12.5) + 30
        if x > x0 and x + w > x0 + room:
            x, y = x0, y + h + 8
        main = label == primary
        out.append(f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{h}" rx="8" '
                   f'fill="{CLAUDE if main else D_PANEL}" stroke="{CLAUDE if main else D_EDGE}"/>')
        out.append(f'<text x="{x + w / 2:.1f}" y="{y + 19.5}" font-size="12.5" text-anchor="middle" '
                   f'fill="{"#ffffff" if main else D_TEXT}" font-weight="{600 if main else 500}">{escape(label)}</text>')
        x += w + 10
    return "".join(out), y + h


def preview_desktop(data):
    w = PANE + 2 * 24 + 2 * 16
    cut = 1010  # the window's height: the report goes on below, faded out
    x0 = 16 + 24
    body = []
    y = 48 + 38 + 22

    hero = data["hero"]
    body.append(place(hero["source"], x0, y))
    y += hero["height"] + 14
    nav, y = desk_buttons(x0, y, ["← Previous week", "Next week →", "This week so far", "Ask Claude about this week"],
                          PANE, primary="Ask Claude about this week")
    body.append(nav)
    y += 20

    # The habit of the week: a card framed in Claude's colour.
    habit = data["habit"]
    top = y
    start = len(body)
    inner = PANE - 44
    ix = x0 + 22
    yy = top + 22
    body.append(say(ix, yy + 13, "Habit of the week", 16, weight=600))
    yy += 13 + 16
    body.append(place(habit["ring"], ix, yy))
    body.append(say(ix + 96 + 18, yy + 42, habit["title"], 15, weight=600))
    body.append(say(ix + 96 + 18, yy + 64, habit["score"], 13, D_DIM))
    yy += 96 + 12
    for text in wrap(habit["evidence"], 13.5, inner):
        yy += 21
        body.append(say(ix, yy, text))
    yy += 10
    for text in wrap(habit["tryThis"], 13.5, inner):
        yy += 21
        body.append(say(ix, yy, text))
    yy += 18
    dots_w = float(re.search(r'width="([\d.]+)"', habit["dots"]).group(1))
    body.append(place(habit["dots"], ix, yy))
    body.append(say(ix + dots_w + 10, yy + 10.5, habit["live"], 13, D_DIM))
    yy += 12 + 18
    row, yy = desk_buttons(ix, yy, ["See the session", f"What is {habit['glossary']}?", "Pick another habit", "Not right?"], inner)
    body.append(row)
    yy += 22
    card = (f'<rect x="{x0 + 0.5}" y="{top + 0.5}" width="{PANE - 1}" height="{yy - top}" rx="14" '
            f'fill="{CLAUDE}" fill-opacity="0.035" stroke="{CLAUDE}" stroke-opacity="0.9"/>')
    body.insert(start, card)
    y = yy + 26

    # Progress, then the features: the plugin's pictures under Markdown headings.
    progress = data["progress"]
    body.append(say(x0, y + 14, progress["title"], 16, weight=600))
    y += 14 + 16
    body.append(place(progress["source"], x0, y))
    y += progress["height"] + 26
    body.append(say(x0, y + 14, "Features you've used", 16, weight=600))
    y += 14 + 16
    body.append(place(data["features"]["source"], x0, y))

    h = cut
    panel_h = h - 48 - 16
    fade = 150
    chrome = (
        f'<rect width="{w}" height="{h}" rx="12" fill="{D_BG}"/>'
        f'<path d="M0 12a12 12 0 0 1 12-12h{w - 24}a12 12 0 0 1 12 12v24H0z" fill="{D_CHROME}"/>'
        f'<circle cx="22" cy="18" r="6" fill="#ff5f57"/>'
        f'<circle cx="42" cy="18" r="6" fill="#febc2e"/>'
        f'<circle cx="62" cy="18" r="6" fill="#28c840"/>'
        f'<text x="{w / 2:.0f}" y="23" text-anchor="middle" fill="{D_DIM}" font-size="12">Claude · my-app</text>'
        # the pane, its title row and close mark
        f'<rect x="16.5" y="48.5" width="{w - 33}" height="{panel_h}" rx="12" fill="{D_CHROME}" stroke="{D_EDGE}"/>'
        f'<text x="36" y="72" font-size="13" font-weight="600" fill="{D_TEXT}">Coach</text>'
        f'<path d="M{w - 44} 62l8 8m0-8l-8 8" stroke="{D_DIM}" stroke-width="1.6" stroke-linecap="round"/>'
        f'<line x1="17" x2="{w - 17}" y1="86.5" y2="86.5" stroke="{D_EDGE}"/>'
    )
    defs = (
        '<defs>'
        f'<clipPath id="pane"><rect x="17" y="87" width="{w - 34}" height="{panel_h - 40}"/></clipPath>'
        '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{D_CHROME}" stop-opacity="0"/><stop offset="1" stop-color="{D_CHROME}"/>'
        '</linearGradient>'
        '</defs>'
    )
    shade = (f'<rect x="17" y="{48 + panel_h - fade}" width="{w - 34}" height="{fade - 1}" fill="url(#fade)"/>'
             f'<rect x="16.5" y="48.5" width="{w - 33}" height="{panel_h}" rx="12" fill="none" stroke="{D_EDGE}"/>'
             f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="12" fill="none" stroke="{D_EDGE}"/>')
    title = ("The coach report in the Claude desktop app. A coral card: your week with Claude, 28 Sep to 4 Oct, "
             "week 4; 10 sessions, 18 prompts, $6.14 spent, up 40% on the four weeks before, and $0.25 for a "
             "typical prompt, down 15%; beside them, spend by day, highest on Wednesday at $2.33. Below, the habit "
             "of the week, start fresh when you switch topics, with a ring at 33% against a goal of 70% and two "
             "of three switches done this week; then eight weeks of progress as small charts.")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{escape(title)}" font-family="{SANS}">'
        f'<title>{escape(title)}</title>{defs}{chrome}<g clip-path="url(#pane)">{"".join(body)}</g>{shade}</svg>\n'
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    data = art()
    outputs = (
        ("preview-desktop.svg", lambda: preview_desktop(data)),
        ("preview-cli.svg", lambda: preview_cli(data)),
        ("preview-bar.svg", preview_bar),
    )
    for name, make in outputs:
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(make())
        print("wrote", os.path.relpath(os.path.join(OUT, name)))


if __name__ == "__main__":
    main()
