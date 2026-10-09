#!/usr/bin/env python3
"""Draws the README images for coach: plugins/coach/assets/*.svg.

Run: python3 scripts/coach-assets.py

Text sits on a fixed character grid (textLength pins every run to its cells),
so the images line up whatever monospace font a viewer has. The figures are
made up, the same made-up month the tests use.
"""
import os
import re
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(__file__), "..", "plugins", "coach", "assets")

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


def preview_cli():
    cols = 86
    x0 = 18
    rows = [
        [("Your week with Claude", TEXT, True), ("                                  28 Sep to 4 Oct · week 4", DIM)],
        [],
        [("Sessions      Prompts       Spent           Typical cost per prompt", DIM)],
        [("10 ", TEXT, True), ("+25%", DIM), ("      18 ", TEXT, True), ("+20%", DIM), ("      $6.14 ", TEXT, True),
         ("+40%", AMBER), ("      $0.25 ", TEXT, True), ("−4%", DIM)],
        [],
        [("Habit of the week", CLAUDE, True)],
        [("Start fresh when you switch topics", TEXT, True)],
        [("On Wednesday, \"Refactor auth middleware\" moved on to something new while", TEXT)],
        [("it already held about 330k tokens of the earlier topic. Over the next 3", TEXT)],
        [("prompts, re-reading that context cost about $1.16.", TEXT)],
        [("Try this: Type /clear or start a new session when you move on.", TEXT)],
        [("[ See the session ]  [ What is context? ]  [ Pick another habit ]  [ Not right? ]", DIM)],
        [],
        [("Teach Claude this project · my-app", CLAUDE, True)],
        [("my-app has no CLAUDE.md yet. Start one with these lines, or run /init.", TEXT)],
        [("  - Test: `pnpm test` (one file: `pnpm test <path>`)", GREEN)],
        [("  - Use `pnpm`, not `npm`.", GREEN)],
        [("In 4 of your last 24 sessions here, Claude searched for how to run the tests.", DIM)],
        [("[ Copy ]  [ Not right? ]  [ Dismiss ]", DIM)],
        [],
        [("Could be a skill", CLAUDE, True)],
        [("You've typed this 5 times in 5 sessions over the last 4 weeks:", TEXT)],
        [("  Write release notes for <version> from the merged prs grouped by area…", GREEN)],
        [("[ Make it a skill ]  [ Copy template ]  [ Not right? ]  [ Dismiss ]", DIM)],
    ]
    top = 52
    body = []
    for i, parts in enumerate(rows):
        body.append(line(x0, top + i * LH, parts) if parts else "")
    bar_y = top + len(rows) * LH + 18
    body.append(f'<line x1="{x0}" x2="{x0 + cols * CW}" y1="{bar_y - 15}" y2="{bar_y - 15}" stroke="{EDGE}"/>')
    body.append(line(x0, bar_y, [("Coach · this week: ", DIM), ("/clear when you switch topics", TEXT, True)]))
    body.append(line(x0, bar_y, [("●●", GREEN), ("○ ", DIM), ("2 of 3 switches", DIM)], col=cols - 18))
    prompt_y = bar_y + 16
    body.append(f'<rect x="{x0 - 6}" y="{prompt_y}" width="{cols * CW + 12}" height="30" rx="6" fill="none" '
                f'stroke="{DIM}" stroke-opacity="0.6"/>')
    body.append(run(x0, prompt_y + 20, 0, ">", DIM))
    w = int(cols * CW + 2 * x0)
    h = prompt_y + 46
    title = ("A Claude Code terminal with the coach report open: last week's sessions, prompts and spend; the habit "
             "of the week, start fresh when you switch topics, with the session it came from; two CLAUDE.md lines "
             "to copy; and a prompt typed five times that could be a skill. Above the prompt, the coach line keeps "
             "the habit in view: 2 of 3 switches this week.")
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


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, make in (("preview-cli.svg", preview_cli), ("preview-bar.svg", preview_bar)):
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(make())
        print("wrote", os.path.relpath(os.path.join(OUT, name)))


if __name__ == "__main__":
    main()
