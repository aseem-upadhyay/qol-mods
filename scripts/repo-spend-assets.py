#!/usr/bin/env python3
"""Draws the README images for repo-spend: plugins/repo-spend/assets/*.svg.

Run: python3 scripts/repo-spend-assets.py

The terminal images lay text on a fixed character grid (textLength pins every
run to its cells), so they line up the same whatever monospace font a viewer
has. The desktop image uses the system sans font, as the app does: its left
group flows from the left edge and its right group is anchored to the right
edge, so no font can make them collide. The example figures are made up.
"""
import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(__file__), "..", "plugins", "repo-spend", "assets")

CW = 7.8  # cell width, px
LH = 22  # line height, px
FS = 13  # font size, px
FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

BG = "#16161a"
CHROME = "#222228"
EDGE = "#2e2e36"
TEXT = "#e6e6e6"
DIM = "#8a8a93"
CLAUDE = "#d97757"
LEVEL = {"idle": "#8a8a93", "calm": "#4eba65", "warm": "#e2a33a", "hot": "#e5534b"}
CAPTION = "#8b949e"  # GitHub's muted grey: legible on its light and dark themes
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
# A full bar stands for at least one 3-minute slice at $15/hr, as in the band.
SPARK_FLOOR = 15 * 3 / 60

# The desktop app's dark theme.
D_BG = "#171717"
D_CHROME = "#1f1f1f"
D_PANEL = "#262626"
D_EDGE = "#333333"
D_TEXT = "#ececec"
D_DIM = "#9b9b9b"

# ---------------------------------------------------------------- primitives


def run(x0, y, col, text, color=TEXT, bold=False):
    """One run of text in its cells, its width pinned to len(text) cells."""
    lead = len(text) - len(text.lstrip(" "))
    body = text.strip(" ")
    if not body:
        return ""
    x = x0 + (col + lead) * CW
    weight = ' font-weight="700"' if bold else ""
    return (
        f'<text x="{x:.1f}" y="{y}" textLength="{len(body) * CW:.1f}" '
        f'lengthAdjust="spacingAndGlyphs" fill="{color}"{weight}>{escape(body)}</text>'
    )


def spark(x0, y, col, bars, color):
    """Block-glyph bars, one per cell, as the terminal draws them."""
    top, full = y - 13, 17
    peak = max(max(bars), SPARK_FLOOR)
    out = []
    for i, v in enumerate(bars):
        eighths = 1 if v <= 0 else 2 + round(v / peak * 6)
        h = full * eighths / 8
        fill, opacity = (color, 1) if v > 0 else (DIM, 0.6)
        out.append(
            f'<rect x="{x0 + (col + i) * CW + 0.6:.1f}" y="{top + full - h:.1f}" '
            f'width="{CW - 1.2:.1f}" height="{h:.1f}" fill="{fill}" fill-opacity="{opacity}"/>'
        )
    return "".join(out)


def spans(x0, y, col, parts):
    """Lays (text, color, bold) parts left to right from `col`; returns svg, end col."""
    out = []
    for part in parts:
        if part[0] == "SPARK":
            _, bars, color = part
            out.append(spark(x0, y, col, bars, color))
            col += len(bars)
            continue
        text = part[0]
        color = part[1] if len(part) > 1 else TEXT
        bold = part[2] if len(part) > 2 else False
        out.append(run(x0, y, col, text, color, bold))
        col += len(text)
    return "".join(out), col


def width(parts):
    return sum(len(p[1]) if p[0] == "SPARK" else len(p[0]) for p in parts)


def band(x0, y, cols, left, right):
    """A band: `left` from column 0, `right` flush with column `cols`."""
    a, _ = spans(x0, y, 0, left)
    b, _ = spans(x0, y, cols - width(right), right)
    return a + b


# ---------------------------------------------------------------- the band

BARS = [0, 0, 0.42, 0, 0.18, 1.1, 0, 0.3, 0, 0.75]


def left_full():
    return [
        ("◆", CLAUDE), (" ",), ("my-app", TEXT, True), ("  ",),
        ("≈", DIM), ("$1,284.50", CLAUDE, True), (" last 3 months", DIM),
        ("  ·  ", DIM), ("$12.30",), (" today", DIM),
        ("  ·  ", DIM), ("$96.75",), (" last 7d", DIM),
    ]


def left_medium():
    return left_full()[:10]


def left_compact():
    return [
        ("◆", CLAUDE), (" ",), ("my-app", TEXT, True), ("  ",),
        ("≈", DIM), ("$1.28k", CLAUDE, True), (" last 3mo", DIM),
        ("  ·  ", DIM), ("$12.30",), (" today", DIM),
    ]


def right_spark(rate="$6.04/hr", level="calm", bars=BARS, session="$4.12"):
    return [
        (session, TEXT, True), (" this session", DIM), ("  ",),
        ("SPARK", bars, LEVEL[level]), ("  ",), (rate, LEVEL[level], True),
    ]


def right_compact():
    return [("$4.12", TEXT, True), (" session", DIM), ("  ·  ", DIM), ("$6.04/hr", LEVEL["calm"], True)]


# ---------------------------------------------------------------- images


def svg(w, h, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{escape(title)}" font-family="{FONT}" font-size="{FS}">'
        f"<title>{escape(title)}</title>{body}</svg>\n"
    )


def preview_cli():
    cols, pad = 116, 24
    w = round(cols * CW + 2 * pad)
    x0 = pad
    rows = []
    y = 66

    def line(parts):
        nonlocal y
        s, _ = spans(x0, y, 0, parts)
        rows.append(s)
        y += LH

    line([(">", DIM), (" add retry with backoff to the API client", TEXT)])
    y += 10
    line([("●", TEXT), (" I'll add exponential backoff to src/api/client.ts and cover it with a test.",)])
    y += 10
    line([("●", LEVEL["calm"]), (" ",), ("Update", TEXT, True), ("(src/api/client.ts)",)])
    line([("  └  Updated src/api/client.ts with 18 additions and 3 removals", DIM)])
    y += 10
    line([("●", TEXT), (" Done. Requests now retry up to 3 times (250ms → 1s → 4s), and the new test passes.",)])
    y += 18

    band_y = y
    rows.append(band(x0, band_y, cols, left_full(), right_spark()))

    box_top = band_y + 16
    box_h = 38
    rows.append(
        f'<rect x="{pad - 8}" y="{box_top}" width="{w - 2 * pad + 16}" height="{box_h}" rx="6" '
        f'fill="none" stroke="{EDGE}" stroke-width="1.5"/>'
    )
    py = box_top + 24
    s, end = spans(x0, py, 0, [(">", TEXT, True)])
    rows.append(s)
    rows.append(f'<rect x="{x0 + 2 * CW:.1f}" y="{py - 12}" width="{CW:.1f}" height="16" fill="{TEXT}" fill-opacity="0.85"/>')
    hint_y = box_top + box_h + 22
    s, _ = spans(x0, hint_y, 0, [("? for shortcuts", DIM)])
    rows.append(s)

    h = hint_y + 18
    chrome = (
        f'<rect width="{w}" height="{h}" rx="12" fill="{BG}"/>'
        f'<path d="M0 12a12 12 0 0 1 12-12h{w - 24}a12 12 0 0 1 12 12v22H0z" fill="{CHROME}"/>'
        f'<circle cx="22" cy="17" r="6" fill="#ff5f57"/>'
        f'<circle cx="42" cy="17" r="6" fill="#febc2e"/>'
        f'<circle cx="62" cy="17" r="6" fill="#28c840"/>'
        f'<text x="{w / 2:.0f}" y="21" text-anchor="middle" fill="{DIM}" font-size="12">claude · ~/code/my-app</text>'
        f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="12" fill="none" stroke="{EDGE}"/>'
    )
    title = "repo-spend: a bar above the Claude Code prompt showing $1,284.50 spent on my-app in the last 3 months, $12.30 today, $96.75 in the last 7 days, and $4.12 this session burning $6.04 an hour"
    return svg(w, h, chrome + "".join(rows), title)


def tspans(parts):
    """(text, color, bold) parts as tspans that flow in one <text>."""
    out = []
    for part in parts:
        text = part[0]
        color = part[1] if len(part) > 1 else D_TEXT
        weight = ' font-weight="600"' if len(part) > 2 and part[2] else ""
        out.append(f'<tspan fill="{color}"{weight}>{escape(text)}</tspan>')
    return "".join(out)


def desktop_spark(x, bottom, bars, color):
    """The desktop sparkline as the band draws it: 4px rounded bars, 2px apart,
    scaled to the busiest slice (SPARK_FLOOR at least), empty slices a faint stub."""
    peak = max(max(bars), SPARK_FLOOR)
    out = []
    for i, v in enumerate(bars):
        h = max(3, round(v / peak * 12)) if v > 0 else 2
        fill, opacity = (color, 1) if v > 0 else (LEVEL["idle"], 0.45)
        out.append(
            f'<rect x="{x + i * 6}" y="{bottom - h}" width="4" height="{h}" rx="1" '
            f'fill="{fill}" fill-opacity="{opacity}"/>'
        )
    return "".join(out)


def preview_desktop():
    w, h = 920, 392
    pad = 48
    rows = []

    # The prompt in a right-aligned bubble; its text is centred, so a wider or
    # narrower font shares the difference between both sides.
    ask = "add retry with backoff to the API client"
    bubble_w = round(len(ask) * 6.4) + 36
    bubble_x = w - pad - bubble_w
    rows.append(f'<rect x="{bubble_x}" y="62" width="{bubble_w}" height="40" rx="14" fill="{D_PANEL}"/>')
    rows.append(f'<text x="{bubble_x + bubble_w / 2:.0f}" y="87" text-anchor="middle" fill="{D_TEXT}" font-size="14">{escape(ask)}</text>')

    # The reply, an edit, and the wrap-up.
    rows.append(f'<text x="{pad}" y="140" fill="{D_TEXT}" font-size="14">'
                f"I'll add exponential backoff to src/api/client.ts and cover it with a test.</text>")
    rows.append(f'<rect x="{pad}" y="158" width="232" height="32" rx="8" fill="{D_CHROME}" stroke="{D_EDGE}"/>')
    rows.append(f'<text x="{pad + 14}" y="179" font-size="13" xml:space="preserve">'
                + tspans([("Edited", D_DIM), ("  src/api/client.ts", D_TEXT), ("  +18", LEVEL["calm"]), ("  −3", LEVEL["hot"])])
                + "</text>")
    rows.append(f'<text x="{pad}" y="226" fill="{D_TEXT}" font-size="14">'
                f"Done. Requests now retry up to 3 times (250ms → 1s → 4s), and the new test passes.</text>")

    # The band: a rounded panel above the message box.
    top, bh = 254, 40
    base = top + 25
    rows.append(f'<rect x="24" y="{top}" width="{w - 48}" height="{bh}" rx="12" fill="{D_PANEL}"/>')
    rows.append(f'<text x="44" y="{base}" font-size="13" xml:space="preserve">' + tspans([
        ("◆ ", CLAUDE), ("my-app", D_TEXT, True), ("   ≈", D_DIM), ("$1,284.50", CLAUDE, True),
        (" last 3 months", D_DIM), ("  ·  ", D_DIM), ("$12.30",), (" today", D_DIM),
        ("  ·  ", D_DIM), ("$96.75",), (" last 7d", D_DIM),
    ]) + "</text>")
    right = w - 44
    rows.append(f'<text x="{right}" y="{base}" text-anchor="end" font-size="13" fill="{LEVEL["calm"]}" font-weight="600">$6.04/hr</text>')
    spark_end = right - 58 - 12
    rows.append(desktop_spark(spark_end - 58, base - 1, BARS, LEVEL["calm"]))
    rows.append(f'<text x="{spark_end - 58 - 12}" y="{base}" text-anchor="end" font-size="13" xml:space="preserve">'
                + tspans([("$4.12", D_TEXT, True), (" this session", D_DIM)]) + "</text>")

    # The message box and its send button.
    box = top + bh + 12
    rows.append(f'<rect x="24" y="{box}" width="{w - 48}" height="64" rx="16" fill="{D_CHROME}" stroke="{D_EDGE}"/>')
    rows.append(f'<text x="44" y="{box + 37}" fill="{D_DIM}" font-size="14">Reply to Claude…</text>')
    cx, cy = w - 56, box + 32
    rows.append(f'<circle cx="{cx}" cy="{cy}" r="16" fill="{CLAUDE}"/>')
    rows.append(f'<path d="M{cx} {cy + 7}V{cy - 7}M{cx - 6} {cy - 1}l6-6 6 6" stroke="{D_BG}" stroke-width="2.2" '
                f'fill="none" stroke-linecap="round" stroke-linejoin="round"/>')

    chrome = (
        f'<rect width="{w}" height="{h}" rx="12" fill="{D_BG}"/>'
        f'<path d="M0 12a12 12 0 0 1 12-12h{w - 24}a12 12 0 0 1 12 12v24H0z" fill="{D_CHROME}"/>'
        f'<circle cx="22" cy="18" r="6" fill="#ff5f57"/>'
        f'<circle cx="42" cy="18" r="6" fill="#febc2e"/>'
        f'<circle cx="62" cy="18" r="6" fill="#28c840"/>'
        f'<text x="{w / 2:.0f}" y="23" text-anchor="middle" fill="{D_DIM}" font-size="12">Claude · my-app</text>'
        f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="12" fill="none" stroke="{D_EDGE}"/>'
    )
    title = ("repo-spend in the Claude desktop app: above the message box, a bar shows $1,284.50 spent on "
             "my-app in the last 3 months, $12.30 today, $96.75 in the last 7 days, and $4.12 this session "
             "burning $6.04 an hour, with a small bar chart")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{escape(title)}" font-family="{SANS}">'
        f"<title>{escape(title)}</title>{chrome}{''.join(rows)}</svg>\n"
    )


def layouts():
    pad, gap = 14, 30
    width_cols = 116
    w = round(width_cols * CW + 2 * pad)
    rows = []
    y = 0

    def strip(caption, cols, left, right):
        nonlocal y
        rows.append(f'<text x="2" y="{y + 14}" fill="{CAPTION}" font-family="{SANS}" font-size="13">{escape(caption)}</text>')
        top = y + 22
        sw = cols * CW + 2 * pad
        rows.append(f'<rect x="0" y="{top}" width="{sw:.1f}" height="34" rx="8" fill="{BG}" stroke="{EDGE}"/>')
        rows.append(band(pad, top + 22, cols, left, right))
        y = top + 34 + gap - 10

    strip("Wide: totals, today, last 7 days, and the burn sparkline", 116, left_full(), right_spark())
    strip("Narrower: the 7-day figure goes first", 96, left_medium(), right_spark())
    strip("Compact: short totals, no sparkline", 72, left_compact(), right_compact())
    strip("Tiny: just the numbers", 40, [("◆", CLAUDE), (" ",), ("≈", DIM), ("$1.28k", CLAUDE, True)],
          [("$4.12", TEXT, True), (" · ", DIM), ("$6.04/hr", LEVEL["calm"], True)])
    strip("No python3 on PATH: history is skipped, the live session still shows", 92,
          [("◆", CLAUDE), (" ",), ("my-app", TEXT, True), ("  ",), ("history unavailable: python3 not found", LEVEL["warm"])],
          [("$4.12", TEXT, True), (" this session", DIM), ("  ·  ", DIM), ("$6.04/hr", LEVEL["calm"], True)])

    # The burn's four colours, each with a sparkline of its own.
    rows.append(f'<text x="2" y="{y + 14}" fill="{CAPTION}" font-family="{SANS}" font-size="13">'
                f'Burn over the last 30 minutes: idle, under $15/hr, under $40/hr, $40/hr and up</text>')
    top = y + 22
    rows.append(f'<rect x="0" y="{top}" width="{w}" height="34" rx="8" fill="{BG}" stroke="{EDGE}"/>')
    groups = [
        ("idle", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01], "$0.02/hr"),
        ("calm", BARS, "$6.04/hr"),
        ("warm", [0.3, 0.8, 0.5, 1.2, 0.9, 1.4, 0.7, 1.1, 1.6, 1.0], "$22.80/hr"),
        ("hot", [1.5, 2.2, 3.1, 2.4, 3.8, 2.9, 4.4, 3.6, 4.9, 4.1], "$57.10/hr"),
    ]
    col = 0
    parts = []
    for name, bars, rate in groups:
        parts += [(name, DIM), (" ",), ("SPARK", bars, LEVEL[name]), (" ",), (rate, LEVEL[name], True), ("     ",)]
    s, _ = spans(pad, top + 22, col, parts[:-1])
    rows.append(s)
    h = top + 34 + 2

    title = "repo-spend's bar at four widths, without python3, and its four burn colours"
    return svg(w, h, "".join(rows), title)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    outputs = (
        ("preview-desktop.svg", preview_desktop),
        ("preview-cli.svg", preview_cli),
        ("layouts.svg", layouts),
    )
    for name, make in outputs:
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(make())
        print("wrote", os.path.normpath(os.path.join(OUT, name)))
