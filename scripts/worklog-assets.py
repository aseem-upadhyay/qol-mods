#!/usr/bin/env python3
"""Draws the README images for worklog: plugins/worklog/assets/*.svg.

Run: python3 scripts/worklog-assets.py (needs bun, https://bun.sh)

The figures are made up: a week of three repos in scripts/worklog-art.ts,
which runs the plugin's own code and hands this script the desktop pictures,
the words and the layout view.tsx gives them.

The terminal images lay text on a fixed character grid (textLength pins every
run to its cells), so they line up whatever monospace font a viewer has. The
desktop image sets the plugin's pictures as they are drawn, in the dark
theme's steps of the palette, and its own words in the system sans.
"""
import json
import os
import re
import subprocess
import sys
import textwrap
from xml.sax.saxutils import escape

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "plugins", "worklog", "assets")

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
SUBTLE = "#505058"
CLAUDE = "#d97757"
GREEN = "#4eba65"
# The terminal's stand-ins for the palette's slots, view.tsx's TERM, in a dark theme.
TERM = ["#b1b9f9", "#d77757", "#4eba65", "#ffc107", "#af87ff", "#48968c", "#4782c8", "#b1b9f9"]
SUGGESTION = TERM[0]

# The desktop app's dark theme.
D_BG = "#171717"
D_CHROME = "#1f1f1f"
D_PANEL = "#262626"
D_EDGE = "#333333"
D_TEXT = "#ececec"
D_DIM = "#9b9b9b"
D_LINK = "#8ab4f8"

PANE = 700  # the desktop pane's width, px
COLS = 86  # the terminal's width, cells


def art():
    """What worklog draws for the made-up week: scripts/worklog-art.ts, run with bun."""
    try:
        done = subprocess.run(["bun", os.path.join(HERE, "worklog-art.ts"), str(PANE)],
                              check=True, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("worklog-assets.py needs bun (https://bun.sh): it runs the plugin's own code.")
    except subprocess.CalledProcessError as error:
        sys.exit(f"scripts/worklog-art.ts failed:\n{error.stderr}")
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


def spread(left, right, cols):
    """`left` from the first cell and `right` ending at the last."""
    return left + [(" " * max(1, cols - width_of(left) - width_of(right)),)] + right


def svg(w, h, body, title, font=FONT):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{escape(title)}" font-family="{font}" font-size="{FS}">'
            f"<title>{escape(title)}</title>{body}</svg>\n")


def window(w, h, title):
    return (f'<rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="10" fill="{BG}" stroke="{EDGE}"/>'
            f'<rect x="0.5" y="0.5" width="{w - 1}" height="30" rx="10" fill="{CHROME}"/>'
            f'<rect x="0.5" y="20" width="{w - 1}" height="11" fill="{CHROME}"/>'
            + "".join(f'<circle cx="{18 + i * 18}" cy="16" r="5.5" fill="{c}"/>'
                      for i, c in enumerate(("#ff5f57", "#febc2e", "#28c840")))
            + f'<text x="{w / 2}" y="20" text-anchor="middle" fill="{DIM}" font-family="{SANS}" font-size="12">'
              f"{escape(title)}</text>")


def terminal(rows, title, alt):
    """Rows of parts in a terminal window, the prompt box under them."""
    x0 = 18
    top = 52
    body = [line(x0, top + i * LH, parts) if parts else "" for i, parts in enumerate(rows)]
    prompt_y = top + len(rows) * LH
    body.append(f'<rect x="{x0 - 6}" y="{prompt_y}" width="{COLS * CW + 12}" height="30" rx="6" fill="none" '
                f'stroke="{DIM}" stroke-opacity="0.6"/>')
    body.append(run(x0, prompt_y + 20, 0, ">", DIM))
    w = int(COLS * CW + 2 * x0)
    h = prompt_y + 46
    return svg(w, h, window(w, h, title) + "".join(body), alt)


def wrapped(text, room, color=DIM, indent=0):
    return [[(" " * indent + t, color)] for t in textwrap.wrap(text, room - indent)]


def label_parts(g, color=TEXT):
    """"  #42 branch": the PR number in the accent color, then the branch."""
    parts = [("  ",)]
    if g["pr"] is not None:
        parts.append((f"#{g['pr']} ", SUGGESTION))
    parts.append((g["branch"] or "no branch", color))
    return parts


def standup_rows(s):
    """/standup as view.tsx's drawStandup lays it out on the terminal."""
    cols = COLS - 2
    rows = [[("> ", DIM), ("/standup", TEXT)], [], [(s["title"], CLAUDE, True)]]
    for block in s["blocks"]:
        rows.append([])
        rows.append(spread([(block["heading"], TEXT, True)],
                           [(block["total"], TEXT, True)] + ([(" so far", DIM)] if block["isToday"] else []), cols))
        rows.append([(block["counts"], DIM)])
        rows.append([])
        total = sum(p["minutes"] for p in block["shares"]) or 1
        bar, used = [], 0
        for i, p in enumerate(block["shares"]):
            n = cols - 2 - used if i == len(block["shares"]) - 1 else max(1, round(p["minutes"] / total * (cols - 2)))
            used += n
            bar.append(("━" * n, TERM[p["slot"] % 8]))
        rows.append(bar)
        for repo in block["repos"]:
            rows.append([])
            rows.append(spread([("● ", TERM[repo["slot"] % 8]), (repo["name"], TEXT, True)], [(repo["dur"], TEXT, True)], cols))
            for i, g in enumerate(repo["groups"]):
                if i:
                    rows.append([])
                rows.append(spread(label_parts(g), [(g["dur"],)], cols))
                if g["head"]:
                    rows.append([("    " + g["head"],)])
                rows += wrapped(g["meta"], cols, DIM, 4)
            if repo["also"]:
                rows.append([])
                rows.append([("  " + repo["also"], DIM)])
        if block["reviews"]:
            rows += [[], [("Reviewed", TEXT, True)]]
            rows += [[("  " + r["line"],), ("  " + r["at"], DIM)] for r in block["reviews"]]
    if s["openPrs"]:
        rows += [[], [("Open PRs", TEXT, True)]]
        for p in s["openPrs"]:
            rows.append([(f"  {p['repo']} ",), (f"#{p['number']}", SUGGESTION), (f" {p['title']}",)]
                        + ([(" · draft", DIM)] if p["isDraft"] else []))
    rows.append([])
    rows += wrapped(s["footer"], cols)
    rows.append([])
    return rows


def preview_cli(data):
    alt = ("A Claude Code terminal after /standup: Standup for Thu 22 Oct. Thursday, 6h 19m across 3 repos, split "
           "in a colored bar: my-app 4h 19m, with #42 checkout-redesign, Redesign the checkout page, 2h 58m, PR "
           "open, 3 commits, 14 files, 18 test runs, and main, Fix the flaky cart test, 1h 15m; api 1h 32m, #118 "
           "rate-limit merged; docs 28m. Then the PR reviewed, today so far, 3h 25m, and the open PRs.")
    return terminal(standup_rows(data["standup"]), "claude — my-app", alt)


def preview_week(data):
    """/standup week: the timesheet in columns, as view.tsx's weekView draws it on the terminal."""
    w = data["week"]
    cols = COLS - 2
    day_cols, total_cols = 7, 8
    longest = max([12] + [max(len(f"#{r['pr']} {r['branch']}" if r["pr"] else r["branch"]) + 2, len(r["repo"]) + 2)
                          for r in w["rows"]]) + 1
    label_cols = min(longest, 32, cols - 7 * day_cols - total_cols)
    sheet = label_cols + 7 * day_cols + total_cols

    def cells(values, total, bold=False):
        out = []
        for v in values:
            out += [(" " * (day_cols - len(v)),), (v, DIM if v == "·" else TEXT, bold)]
        return out + [(" " * (total_cols - len(total)),), (total, TEXT, True)]

    rows = [[("> ", DIM), ("/standup week", TEXT)], []]
    rows.append(spread([(w["title"], TEXT, True)], [(w["total"], TEXT, True)], sheet))
    rows.append([])
    head = [(" " * label_cols,)]
    for d in w["dates"]:
        head += [(" " * (day_cols - len(d)),), (d, DIM)]
    rows.append(head + [(" " * (total_cols - 5),), ("Total", DIM)])
    last = None
    for r in w["rows"]:
        if r["repo"] != last:
            if last is not None:
                rows.append([])
            rows.append([("● ", TERM[r["slot"] % 8]), (r["repo"], TEXT, True)])
            last = r["repo"]
        label = label_parts(r)
        rows.append(label + [(" " * (label_cols - width_of(label)),)] + cells(r["cells"], r["total"]))
    rows.append([])
    rows.append([("Total", TEXT, True), (" " * (label_cols - 5),)] + cells(w["dayTotals"], w["sum"], True))
    rows.append([])
    rows.append([(w["note"], DIM)])
    rows.append([])
    rows += wrapped(w["footer"], cols)
    rows.append([])
    alt = ("A Claude Code terminal after /standup week: the week of Mon 19 Oct as a timesheet, 28h 15m. A row per "
           "repo and branch, a column per day, rounded to 15 minutes: my-app #42 checkout-redesign 18:15 over five "
           "days, api #118 rate-limit 6:15, docs main 1:15; each day's total underneath, 6:15 on Monday.")
    return terminal(rows, "claude — my-app", alt)


# ---------------------------------------------------------------- the desktop app


def text_width(text, size, bold=False):
    """About how wide `text` sets in the system sans."""
    em = 0.0
    for ch in text:
        if ch in " .,:;'!|ijlIft()[]":
            em += 0.3
        elif ch in "mwMW@%":
            em += 0.86
        elif "A" <= ch <= "Z":
            em += 0.66
        elif ch.isdigit():
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


def dark(source):
    """One of the plugin's pictures with its own <style> taken out: the page's sets the dark theme's steps."""
    return re.sub(r"<style>.*?</style>", "", source, flags=re.S)


def place(source, x, y):
    """One of the plugin's pictures, set at (x, y) as it was drawn."""
    return dark(source).replace('<svg xmlns="http://www.w3.org/2000/svg" ', f'<svg x="{x:.1f}" y="{y:.1f}" ', 1)


def say(x, y, text, size=13.5, fill=D_TEXT, weight=None, anchor=None):
    bold = f' font-weight="{weight}"' if weight else ""
    end = f' text-anchor="{anchor}"' if anchor else ""
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}"{bold}{end}>{escape(text)}</text>'


def spans(x, y, parts, size=13.5):
    """(text, fill, weight) parts in one <text>, left to right."""
    body = "".join(f'<tspan fill="{fill}"{f" font-weight={chr(34)}{wt}{chr(34)}" if wt else ""}>{escape(t)}</tspan>'
                   for t, fill, wt in parts)
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" xml:space="preserve">{body}</text>'


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
    p = data["pane"]
    palette = data["palette"]["dark"]
    px = 8  # a body column, px, as view.tsx counts them
    w = PANE + 2 * 24 + 2 * 16
    x0 = 16 + 24
    right = x0 + PANE - 12
    label_w = p["labelCols"] * px
    strip_x = x0 + label_w + px
    body = []
    y = 48 + 38 + 22

    tabs, y = desk_buttons(x0, y, ["Day", "Week"], PANE, primary="Day")
    body.append(tabs)
    y += 12
    nav, y = desk_buttons(x0, y, ["← Day before", "Day after →", "Today", "Show details", "Copy", "Refresh"], PANE)
    body.append(nav)
    y += 34

    # The summary: heading and total, what the day held, the day by repo, the legend.
    body.append(say(x0, y, p["heading"], 17, weight=650))
    body.append(say(right, y, p["total"], 17, weight=650, anchor="end"))
    y += 26
    body.append(say(x0, y, p["counts"], 13, D_DIM))
    y += 14
    body.append(place(p["share"], x0, y))
    y += 10 + 24
    x = x0
    for s in p["shares"]:
        body.append(place(p["dots"][s["name"]], x, y - 9.5))
        body.append(spans(x + 16, y, [(s["name"] + " ", D_TEXT, None), (s["dur"], D_DIM, None)]))
        x += 16 + text_width(f"{s['name']} {s['dur']}", 13.5) + 24
    y += 22

    # The hour axis over the timelines, then each repo and its branches.
    body.append(place(p["axis"], strip_x, y - 10))
    for repo in p["repos"]:
        y += 30
        body.append(place(p["dots"][repo["name"]], x0, y - 9.5))
        body.append(say(x0 + 16, y, repo["name"], 14, weight=650))
        body.append(say(right, y, repo["dur"], 14, weight=650, anchor="end"))
        for i, g in enumerate(repo["groups"]):
            y += 30 if i else 26
            mark = "▾ " if g["sections"] else "▸ "
            parts = [(mark, D_DIM, None)]
            if g["pr"] is not None:
                parts.append((f"#{g['pr']} ", D_LINK, None))
            parts.append((g["branch"], D_TEXT, None))
            body.append(spans(x0 + 12, y, parts))
            body.append(place(g["strip"], strip_x, y - 10.5))
            body.append(say(right, y, g["dur"], 13.5, anchor="end"))
            inset = x0 + 4 * px
            if g["head"]:
                y += 21
                body.append(say(inset, y, g["head"]))
            for text in wrap(g["meta"], 13, PANE - 4 * px):
                y += 20
                body.append(say(inset, y, text, 13, D_DIM))
            if g["sections"]:
                y += 10
                for s in g["sections"]:
                    y += 21
                    body.append(say(inset, y, s["label"], 13, D_DIM))
                    for j, item in enumerate(s["items"]):
                        if j:
                            y += 21
                        fill = D_DIM if item.get("isDim") else D_TEXT
                        body.append(spans(inset + 9 * px + 8, y, [(item["text"], fill, None)]
                                          + ([(item["note"], D_DIM, None)] if item.get("note") else []), 13))
    if p["reviews"]:
        y += 34
        body.append(say(x0, y, "Reviewed", 14, weight=650))
        for r in p["reviews"]:
            y += 22
            body.append(spans(x0 + 16, y, [(r["line"], D_TEXT, None), ("  " + r["at"], D_DIM, None)]))
    y += 14
    for text in wrap(data["footnote"], 12.5, PANE):
        y += 19
        body.append(say(x0, y, text, 12.5, D_DIM))

    h = int(y + 40)
    panel_h = h - 48 - 16
    style = ("<style>" + "".join(f".s{i}{{fill:{c}}}" for i, c in enumerate(palette))
             + f"svg svg text{{font-family:{SANS};font-variant-numeric:tabular-nums;font-size:10px;fill:#8b8b8b}}</style>")
    chrome = (
        f'<rect width="{w}" height="{h}" rx="12" fill="{D_BG}"/>'
        f'<path d="M0 12a12 12 0 0 1 12-12h{w - 24}a12 12 0 0 1 12 12v24H0z" fill="{D_CHROME}"/>'
        f'<circle cx="22" cy="18" r="6" fill="#ff5f57"/>'
        f'<circle cx="42" cy="18" r="6" fill="#febc2e"/>'
        f'<circle cx="62" cy="18" r="6" fill="#28c840"/>'
        f'<text x="{w / 2:.0f}" y="23" text-anchor="middle" fill="{D_DIM}" font-size="12">Claude · my-app</text>'
        f'<rect x="16.5" y="48.5" width="{w - 33}" height="{panel_h}" rx="12" fill="{D_CHROME}" stroke="{D_EDGE}"/>'
        f'<text x="36" y="72" font-size="13" font-weight="600" fill="{D_TEXT}">Worklog</text>'
        f'<path d="M{w - 44} 62l8 8m0-8l-8 8" stroke="{D_DIM}" stroke-width="1.6" stroke-linecap="round"/>'
        f'<line x1="17" x2="{w - 17}" y1="86.5" y2="86.5" stroke="{D_EDGE}"/>'
    )
    title = ("The worklog pane in the Claude desktop app, on Thursday 22 October 2026: 6h 19m across 3 repos, 5 "
             "branches, 2 PRs and 1 review, the day split by repo in one bar. Under it each branch has a timeline "
             "of its stretches from 09:00 to 18:00: my-app's #42 checkout-redesign, Redesign the checkout page, "
             "2h 58m, PR open, opened to show what was asked, its three commits and the folders it changed; main, "
             "1h 15m; api's #118 rate-limit, merged, 1h 32m; and docs, 28m, committed by hand.")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'role="img" aria-label="{escape(title)}" font-family="{SANS}">'
        f'<title>{escape(title)}</title>{style}{chrome}{"".join(body)}</svg>\n'
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    data = art()
    outputs = (
        ("preview-desktop.svg", lambda: preview_desktop(data)),
        ("preview-cli.svg", lambda: preview_cli(data)),
        ("preview-week.svg", lambda: preview_week(data)),
    )
    for name, make in outputs:
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(make())
        print("wrote", os.path.relpath(os.path.join(OUT, name)))


if __name__ == "__main__":
    main()
