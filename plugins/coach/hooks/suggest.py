"""CLAUDE.md lines and skills worth making (SPEC.md §9.6 and §9.7).

Suggestions only: nothing here writes a file. It reads the CLAUDE.md files
Claude would load, and the skill and command definitions already on disk,
to leave out what the person already has; their contents are never stored.
"""
import os
import re

import patterns as P
from extract import C_MODEL, C_REQ, C_SUB
from metrics import DAY_MS, prompts_of
from pricing import price_for
from rules import evidence

WINDOW_MS = 28 * DAY_MS
RECENT_MS = 7 * DAY_MS
MAX_LINES = 10
MAX_LINE = 120
LONG_LINES = 300
LONG_TOKENS = 5000
TASK_LABEL = {"test": "Test", "build": "Build", "lint": "Lint", "typecheck": "Type-check",
              "format": "Format", "dev": "Dev server", "install": "Install"}
_IMPORT = re.compile(r"(?:^|\s)@((?:~|\.{1,2})?/?[\w./-]+\.md)\b")


# -- files on disk

def _read(path, limit=256 * 1024):
    try:
        with open(path, errors="ignore") as fh:
            return fh.read(limit)
    except OSError:
        return None


def claude_md(root, home):
    """-> [(path, text)]: the CLAUDE.md files Claude loads for `root`, and the
    files they import with @path, one level deep."""
    paths = [os.path.join(root, "CLAUDE.md"), os.path.join(root, ".claude", "CLAUDE.md"),
             os.path.join(root, "CLAUDE.local.md")]
    up = os.path.dirname(root.rstrip("/"))
    for _ in range(12):
        if not up or up == "/" or up == os.path.dirname(up):
            break
        paths.append(os.path.join(up, "CLAUDE.md"))
        up = os.path.dirname(up)
    paths.append(os.path.join(home, ".claude", "CLAUDE.md"))
    out, seen = [], set()
    for path in paths:
        text = _read(path)
        if text is None or path in seen:
            continue
        seen.add(path)
        out.append((path, text))
        for target in _IMPORT.findall(text):
            target = os.path.expanduser(target) if target.startswith("~") else \
                os.path.normpath(os.path.join(os.path.dirname(path), target))
            if target not in seen:
                imported = _read(target)
                if imported is not None:
                    seen.add(target)
                    out.append((target, imported))
    return out


def local_skills(roots, home):
    """-> [{"name", "body", "mtime"}]: skills and commands defined on disk."""
    out = []
    bases = [os.path.join(r, ".claude") for r in roots] + [os.path.join(home, ".claude")]
    for base in bases:
        skills = os.path.join(base, "skills")
        commands = os.path.join(base, "commands")
        for folder in (skills, commands):
            try:
                names = os.listdir(folder)
            except OSError:
                continue
            for name in names:
                if folder == skills:
                    path = os.path.join(folder, name, "SKILL.md")
                elif name.endswith(".md"):
                    path = os.path.join(folder, name)
                    name = name[:-3]
                else:
                    continue
                body = _read(path, 64 * 1024)
                if body is None:
                    continue
                try:
                    mtime = int(os.stat(path).st_mtime * 1000)
                except OSError:
                    mtime = 0
                out.append({"name": name, "body": body, "mtime": mtime})
    return out


# -- helpers

def _union_find(n, pairs):
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _has_word(word, line):
    """`word` in `line` on its own: "npm" is not in "pnpm"."""
    return bool(re.search(rf"(?<![\w-]){re.escape(word.lower())}(?![\w-])", line))


def _says_again(clause, lines):
    """Whether a line already suggested says what `clause` says ("use pnpm")."""
    mine = set(P.content_words(clause))
    for line in lines:
        theirs = set(P.content_words(line.get("text") or ""))
        if mine and theirs and (P.jaccard(mine, theirs) >= 0.6 or mine <= theirs or theirs <= mine):
            return True
    return False


def _covered_clause(clause, texts):
    mine = set(P.content_words(clause))
    if not mine:
        return False
    for text in texts:
        for line in text.splitlines():
            theirs = set(P.content_words(line))
            if theirs and len(mine & theirs) / len(mine) >= 0.6:
                return True
    return False


def _score(impact_usd, week_usd, sessions=0, uncosted=False):
    score = min(1.0, impact_usd / max(5.0, 0.1 * week_usd)) if impact_usd else 0.0
    if uncosted:
        score += 0.5 * min(1.0, sessions / 4)
    return round(min(1.0, score), 4)


# -- CLAUDE.md (§9.6)

def claude_md_cards(sessions, now, home, week_usd):
    since = now - WINDOW_MS
    recent = now - RECENT_MS
    by_root = {}
    for s in sessions.values():
        if s["last"] >= since and s.get("root"):
            by_root.setdefault(s["root"], []).append(s)
    cards, covered_out, ev = [], [], {}
    cross = {"pairs": {}, "clauses": []}

    def keep(e):
        ev[e["id"]] = e
        return [e["id"]]

    for root, group in sorted(by_root.items()):
        files = claude_md(root, home)
        texts = [t for _, t in files]
        lower = "\n".join(texts).lower()
        loaded_lines = sum(t.count("\n") + 1 for t in texts)
        loaded_tokens = sum(len(t) for t in texts) // 4
        name = group[0]["name"]
        lines, notes, pointers = [], [], {"files": [], "tasks": []}
        impact = 0.0
        uncosted_sessions = 0
        reqs = [(s, r) for s in group for r in s["requests"] if r["at"] >= since]
        work_sessions = {s["id"] for s, r in reqs if r["read"] or r["edited"]}
        call_cost = {}
        for s in group:
            main = [c for c in s["calls"] if not c[C_SUB]]
            call_cost[s["id"]] = (sum(r["cost"] for r in s["requests"]) / len(main)) if main else 0.0

        # S1 how to run things
        episodes = {}
        for s, r in reqs:
            for ep in r["discovery"]:
                episodes.setdefault(ep[0], []).append((s, r, ep))
        runs = {}
        for s, r in reqs:
            for run in r["checkRuns"]:
                runs.setdefault((run[0], run[2]), []).append(run)
        for task, eps in sorted(episodes.items()):
            sessions_hit = {s["id"] for s, _, _ in eps}
            if len(sessions_hit) < 3:
                continue
            found = [ep for _, _, ep in eps if ep[4] == "found" and ep[6]]
            steps = sum(ep[1] for _, _, ep in eps)
            failed = sum(ep[2] for _, _, ep in eps)
            cost = sum((ep[1] + ep[2]) * call_cost.get(s["id"], 0.0) for s, _, ep in eps)
            first = max(eps, key=lambda x: x[2][1])
            nums = {"sessions": len(sessions_hit), "of": len(work_sessions | sessions_hit), "steps": steps,
                    "failed": failed, "usd": round(cost, 2)}
            line_id = f"claude-md:{name}:S1:{task}"
            if len(found) * 2 < len(eps):
                if task not in pointers["tasks"]:
                    pointers["tasks"].append(task)
                    impact += cost
                continue
            keys = {}
            for ep in found:
                keys[ep[6]] = keys.get(ep[6], 0) + 1
            key, votes = max(keys.items(), key=lambda kv: kv[1])
            if votes / len(found) < 0.6:
                continue
            displays = {}
            for ep in found:
                if ep[6] == key:
                    displays[(ep[5], ep[7])] = displays.get((ep[5], ep[7]), 0) + 1
            (display, folder), _ = max(displays.items(), key=lambda kv: kv[1])
            with_path = [run for run in runs.get((task, key), []) if run[4]]
            label = TASK_LABEL.get(task, task.title())
            command = f"cd {folder} && {display}" if folder else display
            text = f"- {label}{f' ({folder})' if folder else ''}: `{command}`"
            if with_path and sum(1 for run in with_path if run[5]) * 2 >= len(with_path):
                text += f" (one file: `{command} <path>`)"
            if display.lower() in lower or key.lower() in lower:
                covered_out.append(_covered(line_id, name, "S1", text, group, recent,
                                            lambda r, t=task: sum(1 for e in r["discovery"] if e[0] == t)))
                continue
            impact += cost
            lines.append({"id": line_id, "source": "S1", "text": text[:MAX_LINE], "file": "project",
                          "evidence": keep(evidence("claude-md-S1", first[0], first[1], **nums)),
                          "numbers": nums})

        # S2 wrong tool first
        pairs = {}
        for s, r in reqs:
            for sub in r["subs"]:
                pairs.setdefault((sub[0], sub[1], sub[2]), []).append((s, r))
        for (src, dst, kind), hits in sorted(pairs.items()):
            sessions_hit = {s["id"] for s, _ in hits}
            cross["pairs"].setdefault((src, dst, kind), set()).add(root)
            if len(sessions_hit) < 2:
                continue
            text = P.pair_line(src, dst, kind)
            line_id = f"claude-md:{name}:S2:{src}>{dst}"
            if any(_has_word(src, line) and _has_word(dst, line) for line in lower.splitlines()):
                covered_out.append(_covered(line_id, name, "S2", text, group, recent,
                                            lambda r, a=src, b=dst: sum(1 for x in r["subs"] if x[0] == a and x[1] == b)))
                continue
            machine = src in P.INTERPRETERS and dst in P.INTERPRETERS
            nums = {"sessions": len(sessions_hit), "times": len(hits)}
            cost = sum(call_cost.get(s["id"], 0.0) for s, _ in hits)
            impact += cost
            lines.append({"id": line_id, "source": "S2", "text": text[:MAX_LINE],
                          "file": "user" if machine else "project", "machine": machine,
                          "evidence": keep(evidence("claude-md-S2", hits[0][0], hits[0][1], **nums)),
                          "numbers": nums})

        # S3 files read first
        counts = {}
        tokens = {}
        for s in group:
            if s["id"] not in work_sessions:
                continue
            for path, tk in s.get("orientation") or []:
                # Manifests and READMEs are how-to-run lookups, which S1 covers.
                if os.path.basename(path).upper().startswith("CLAUDE") or P.EXPLORE_FILE.search(path):
                    continue
                counts.setdefault(path, set()).add(s["id"])
                tokens[path] = max(tokens.get(path, 0), tk)
        total = len(work_sessions)
        for path, sids in sorted(counts.items(), key=lambda kv: -len(kv[1])):
            if len(sids) >= 3 and total and len(sids) / total >= 0.4 and path.lower() not in lower:
                pointers["files"].append(path)
                uncosted_sessions = max(uncosted_sessions, len(sids))
                p = price_for(group[0]["calls"][0][C_MODEL]) if group[0]["calls"] else None
                if p:
                    impact += tokens.get(path, 0) * p[2] / 1e6 * 10 * len(sids)
            if len(pointers["files"]) >= 6:
                break

        # S4 and S5 clauses (project-level; S6 is everyone's, below)
        clauses = []
        for s, r in reqs:
            for kind, text in r["clauses"]:
                if kind in ("correction", "instruction"):
                    clauses.append({"kind": kind, "text": text, "s": s, "r": r, "root": root})
        cross["clauses"].extend(clauses)
        for group_ in _cluster_clauses(clauses):
            kind = "correction" if any(c["kind"] == "correction" for c in group_) else "instruction"
            sids = {c["s"]["id"] for c in group_}
            need = 2 if kind == "correction" else 3
            if len(sids) < need:
                continue
            best = min(group_, key=lambda c: len(c["text"]))
            source = "S4" if kind == "correction" else "S5"
            text = "- " + best["text"]
            if _says_again(best["text"], lines):
                continue
            line_id = f"claude-md:{name}:{source}:{P.stable_hash(best['text'].lower())}"
            if _covered_clause(best["text"], texts):
                if kind == "correction" and len(group_) >= 3:
                    notes.append({"id": "covered-but-corrected", "text": best["text"], "times": len(group_)})
                covered_out.append(_covered(line_id, name, source, text, group, recent, lambda r: 0))
                continue
            cost = sum(c["r"]["cost"] for c in group_ if kind == "correction")
            impact += cost
            if kind != "correction":
                uncosted_sessions = max(uncosted_sessions, len(sids))
            nums = {"sessions": len(sids), "times": len(group_)}
            lines.append({"id": line_id, "source": source, "text": text[:MAX_LINE], "file": "project",
                          "evidence": keep(evidence(f"claude-md-{source}", best["s"], best["r"], **nums)),
                          "numbers": nums, "requests": [c["r"]["id"] for c in group_]})
        if loaded_lines > LONG_LINES or loaded_tokens > LONG_TOKENS:
            # Already long: the claude-md-too-long tip suggests trimming; never more lines.
            lines, pointers = [], {"files": [], "tasks": []}
            notes = [{"id": "too-long", "lines": loaded_lines, "tokens": loaded_tokens}]
        if not lines and not pointers["files"] and not pointers["tasks"] and not notes:
            continue
        cards.append(_card(name, root, files, loaded_lines, loaded_tokens, lines[:MAX_LINES], pointers, notes,
                           impact / 4, week_usd, uncosted_sessions))

    # Lines for every project: machine facts seen in two projects, reply preferences (S6).
    user_lines = []
    for (src, dst, kind), roots in sorted(cross["pairs"].items()):
        if len(roots) >= 2 and src in P.INTERPRETERS and dst in P.INTERPRETERS:
            user_lines.append({"id": f"claude-md:*:S2:{src}>{dst}", "source": "S2",
                               "text": P.pair_line(src, dst, kind), "file": "user", "machine": True,
                               "evidence": [], "numbers": {"projects": len(roots)}})
    prefs = []
    for s in sessions.values():
        for r in s["requests"]:
            if r["at"] >= since:
                for kind, text in r["clauses"]:
                    if kind == "preference":
                        prefs.append({"kind": kind, "text": text, "s": s, "r": r, "root": s.get("root")})
    user_texts = [t for _, t in claude_md(home, home)] if home else []
    for group_ in _cluster_clauses(prefs) + [g for g in _cluster_clauses(cross["clauses"])
                                             if len({c["root"] for c in g}) >= 2]:
        sids = {c["s"]["id"] for c in group_}
        if len(sids) < (3 if group_[0]["kind"] != "correction" else 2):
            continue
        best = min(group_, key=lambda c: len(c["text"]))
        if _covered_clause(best["text"], user_texts):
            continue
        source = "S6" if best["kind"] == "preference" else ("S4" if best["kind"] == "correction" else "S5")
        nums = {"sessions": len(sids), "times": len(group_)}
        user_lines.append({"id": f"claude-md:*:{source}:{P.stable_hash(best['text'].lower())}",
                           "source": source, "text": ("- " + best["text"])[:MAX_LINE], "file": "user",
                           "evidence": keep(evidence(f"claude-md-{source}", best["s"], best["r"], **nums)),
                           "numbers": nums, "requests": [c["r"]["id"] for c in group_]})
    if user_lines:
        user_path = os.path.join(home, ".claude", "CLAUDE.md")
        files = [(user_path, t) for t in user_texts[:1]]
        cards.append(_card("All projects", os.path.join(home, ".claude"), files,
                           sum(t.count("\n") + 1 for t in user_texts), sum(len(t) for t in user_texts) // 4,
                           user_lines[:MAX_LINES], {"files": [], "tasks": []}, [], 0.0, week_usd,
                           max(l["numbers"].get("sessions", 0) for l in user_lines), user=True))
    cards.sort(key=lambda c: -c["score"])
    return cards, covered_out, ev


def _card(name, root, files, loaded_lines, loaded_tokens, lines, pointers, notes, impact, week_usd,
          sessions, user=False):
    has = any(os.path.basename(p) in ("CLAUDE.md",) and os.path.dirname(p) in (root, os.path.join(root, ".claude"))
              for p, _ in files) if not user else bool(files)
    return {
        "id": f"claude-md:{name}", "family": "claude-md", "level": 1, "project": name, "root": root,
        "file": os.path.join(root, "CLAUDE.md"), "hasClaudeMd": has,
        "loadedLines": loaded_lines, "loadedTokens": loaded_tokens, "lines": lines, "pointers": pointers,
        "notes": notes, "impactUsd": round(impact, 4),
        "score": _score(impact, week_usd, sessions, uncosted=sessions > 0),
    }


def _covered(line_id, name, source, text, group, recent, events_of):
    """A line CLAUDE.md already holds, with last week's numbers for "Did it help"."""
    sessions = 0
    events = 0
    for s in group:
        mine = [r for r in s["requests"] if r["at"] >= recent]
        if mine:
            sessions += 1
            events += sum(events_of(r) for r in mine)
    return {"id": line_id, "project": name, "source": source, "text": text, "sessions": sessions,
            "events": events}


def _cluster_clauses(items):
    if not items:
        return []
    words = [set(P.content_words(c["text"])) for c in items]
    df = {}
    for w in words:
        for x in w:
            df[x] = df.get(x, 0) + 1
    code = [set(re.findall(r"`([^`]+)`", c["text"].lower())) for c in items]
    pairs = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            sim = P.jaccard(words[i], words[j])
            if sim >= 0.6:
                pairs.append((i, j))
                continue
            rare = {x for x in code[i] & code[j] if df.get(x, 0) <= 3}
            if rare and sim >= 0.4:
                pairs.append((i, j))
    return [[items[k] for k in g] for g in _union_find(len(items), pairs)]


# -- skills (§9.7)

def skill_cards(sessions, now, home, week_usd, logged_commands):
    since = now - WINDOW_MS
    candidates = []
    for s in sessions.values():
        ps = prompts_of(s)
        by_index = {r["i"]: r for r in s["requests"]}
        for r in ps:
            shape = r.get("shape")
            f = r["flags"]
            # A follow-up ("also link each PR") leans on the prompt before it: not a skill alone.
            if r["at"] < since or not shape or r["words"] < 4 or f.get("paste") or f.get("rx") \
                    or f.get("corr") or f.get("form") or f.get("cont"):
                continue
            if any(k in ("correction", "preference") for k, _ in r["clauses"]):
                continue
            follow = by_index.get(r["next"]) if r["next"] is not None else None
            candidates.append({"s": s, "r": r, "shape": shape, "follow": follow})
    n = len(candidates)
    if n < 4:
        return [], [], {}, {}
    df = {}
    for c in candidates:
        for t in set(c["shape"]["rare"]):
            df[t] = df.get(t, 0) + 1
    rare_limit = max(2, int(0.05 * n))
    index = {}
    for k, c in enumerate(candidates):
        keys = [("o", c["shape"].get("open3"))] + [("w", t) for t in c["shape"]["rare"] if df[t] <= rare_limit]
        for key in keys:
            index.setdefault(key, []).append(k)
    pairs = set()
    for members in index.values():
        if len(members) > 200:
            continue
        for a in range(len(members)):
            for b in range(a + 1, len(members)):
                i, j = members[a], members[b]
                if (i, j) in pairs:
                    continue
                gi, gj = candidates[i]["shape"]["grams"], candidates[j]["shape"]["grams"]
                sim = P.jaccard(gi, gj)
                same_open = candidates[i]["shape"]["openerHash"] == candidates[j]["shape"]["openerHash"]
                if sim >= 0.5 or (same_open and sim >= 0.35):
                    pairs.add((i, j))
    skills = local_skills(sorted({c["s"].get("root") for c in candidates if c["s"].get("root")}), home)
    taken = {x["name"] for x in skills} | set(logged_commands)
    cards, adopted, ev, repeat_ids = [], [], {}, {}
    all_tokens_df = {}
    for c in candidates:
        for t in set((c["shape"].get("template") or "").split()):
            all_tokens_df[t] = all_tokens_df.get(t, 0) + 1
    for group in _union_find(n, pairs):
        members = [candidates[k] for k in group]
        sids = {m["s"]["id"] for m in members}
        if len(members) < 4 or len(sids) < 3:
            continue
        medoid = max(members, key=lambda m: sum(P.jaccard(m["shape"]["grams"], o["shape"]["grams"])
                                               for o in members if o is not m))
        cluster_id = f"{medoid['shape']['openerHash']}"
        for m in members:
            repeat_ids[m["r"]["id"]] = cluster_id
        template, slots = _template(medoid, members)
        name = _name(template, members, all_tokens_df, len(candidates), taken)
        roots = {m["s"].get("root") for m in members}
        projects = {m["s"]["name"] for m in members}
        scope = "project" if len(roots) == 1 else "user"
        root = next(iter(roots)) if scope == "project" else os.path.join(home, ".claude")
        base = root if scope == "user" else os.path.join(root or "", ".claude")
        location = os.path.join(base, "skills", name) + "/"
        follow_ups = _follow_ups(members)
        corrected = sum(1 for m in members if m["r"]["corrected"]) / len(members)
        followed = sum(1 for m in members if m["follow"] is not None) / len(members)
        first = min(m["r"]["at"] for m in members)
        weeks = max(1.0, (now - first) / (7 * DAY_MS))
        latest = max(members, key=lambda m: m["r"]["at"])
        nums = {"count": len(members), "sessions": len(sids)}
        ids = [evidence("skill", latest["s"], latest["r"], **nums)]
        for e in ids:
            ev[e["id"]] = e
        existing = _existing(template, name, skills, logged_commands, members, sessions)
        card = {
            "id": f"skill:{scope}:{cluster_id}", "family": "skill", "level": 2, "name": name,
            "scope": scope, "project": next(iter(projects)) if scope == "project" else None,
            "location": location, "count": len(members), "sessions": len(sids),
            "template": template, "slots": slots, "followUps": follow_ups,
            "correctedShare": round(corrected, 3), "existing": existing,
            "evidence": [e["id"] for e in ids], "signature": medoid["shape"]["rare"][:24],
            "score": round(min(1.0, (len(members) / weeks) / 3) * (0.6 + 0.4 * max(followed, corrected)), 4),
        }
        if existing and existing["handTyped"] == 0:
            adopted.append({"name": existing["name"], "uses": existing["uses"], "since": existing["since"],
                            "correctionsBefore": existing["correctionsBefore"],
                            "correctionsAfter": existing["correctionsAfter"]})
            continue
        cards.append(card)
    cards.sort(key=lambda c: -c["score"])
    return cards, adopted, ev, repeat_ids


def _template(medoid, members):
    text = medoid["shape"].get("template")
    if not text:
        return None, []
    tokens = text.split()
    sets = [set((m["shape"].get("template") or "").split()) for m in members]
    out, slots = [], []
    for t in tokens:
        share = sum(1 for s in sets if t in s) / len(sets)
        if t.startswith("<") and t.endswith(">"):
            if not out or out[-1] != t:
                out.append(t)
                slots.append(t)
        elif share < 0.6:
            if not out or out[-1] != "<…>":
                out.append("<…>")
                slots.append("<…>")
        else:
            out.append(t)
    line = " ".join(out)
    return (line[:1].upper() + line[1:])[:400], slots


# Words too generic to name a skill by.
_NAME_SKIP = frozenset("""
run keep also part added need want make create write check add update fix find look see help like
sure then now after before while into onto without again ensure new old thing things way ways really
until them their able start stop give tell show whole every each
""".split())


def _name(template, members, df, n, taken):
    """A skill name from the template's opening: its first two words that every
    version of the prompt shares and that say something ("release-notes")."""
    if not template:
        return "repeat"
    words_ = [t for t in template.lower().split() if not t.startswith("<") and t not in P.STOPWORDS
              and t not in _NAME_SKIP and re.match(r"^[a-z][a-z-]{2,}$", t)]
    chosen = []
    for t in words_:
        if t not in chosen:
            chosen.append(t)
        if len(chosen) == 2:
            break
    name = "-".join(chosen) or "repeat"
    base, k = name, 2
    while name in taken:
        name = f"{base}-{k}"
        k += 1
    return name


def _follow_ups(members):
    follows = [m["follow"] for m in members if m["follow"] is not None and m["follow"].get("shape")]
    if not follows:
        return []
    pairs = []
    for i in range(len(follows)):
        for j in range(i + 1, len(follows)):
            if P.jaccard(follows[i]["shape"]["grams"], follows[j]["shape"]["grams"]) >= 0.5:
                pairs.append((i, j))
    out = []
    for group in _union_find(len(follows), pairs):
        share = len(group) / len(members)
        if share >= 0.4:
            text = follows[group[0]]["shape"].get("template")
            out.append({"text": text[:120] if text else None, "share": round(share, 3), "count": len(group)})
    return sorted(out, key=lambda f: -f["share"])[:2]


def _existing(template, name, skills, logged_commands, members, sessions):
    mine = set(P.content_words(template or ""))
    match = None
    for skill in skills:
        theirs = set(P.content_words(skill["body"]))
        if skill["name"] == name or (mine and len(mine & theirs) / len(mine) >= 0.5):
            match = skill
            break
    if match is None:
        for command in logged_commands:
            if command.split(":")[-1] == name:
                match = {"name": command, "body": "", "mtime": 0}
                break
    if match is None:
        return None
    since = match["mtime"]
    hand = [m for m in members if m["r"]["at"] >= since]
    uses = [r for s in sessions.values() for r in s["requests"]
            if r.get("invoked") and r["invoked"].split(":")[-1] == match["name"].split(":")[-1]]
    before = [m for m in members if m["r"]["at"] < since]
    return {"name": match["name"], "since": since, "handTyped": len(hand), "uses": len(uses),
            "correctionsBefore": sum(1 for m in before if m["r"]["corrected"]),
            "correctionsAfter": sum(1 for r in uses if r["corrected"])}
