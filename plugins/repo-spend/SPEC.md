# repo-spend: cost goes where the work was

| | |
|---|---|
| Status | Built (0.5.1); see Appendix A for what changed on the way |
| Author | Aseem Upadhyay, drafted with Claude |
| Date | 2026-10-11 |
| Lives in | `plugins/repo-spend/` in qol-mods |
| Ships as | repo-spend 0.5.1 |
| Replaces | 0.4.0's rule that a session belongs to the repo it was launched in |

## 1. Summary

Today a session's whole cost counts toward the repo it was launched in, however much of it was spent in another repo. 0.5.0 attributes cost to the repo where the work was. A turn that edits files goes to the repos it edited. Any other message goes to the repo its `cwd` was in when it was sent. So a session launched in repo A that edits repo B, or `cd`s into it, counts partly toward each.

The new version writes to new files (`v2/`) and never touches the old ones. Sessions still running 0.4.0 after the update keep reading and writing the old files, so the two versions never share a file, a lock or a count. The new version copies the old archive once, the first time it runs, so no history is lost.

## 2. Goals and non-goals

**Goals**

- Cost counts toward the repo where the work was: the repos a turn edited, otherwise the repo its `cwd` was in.
- Totals across all repos stay the same: cost moves between repos, it is never added or dropped.
- The live session is split too, while it runs.
- Updating loses no history, including the sessions only the old archive and the old cache know about.
- 0.4.0 and 0.5.0 can run side by side on one machine without double counting.
- The band looks and reads the same.

**Non-goals**

- Attributing by files read, searched or listed. Sessions read `~/.claude`, scratchpads and docs all the time, so reads say little about where the work was. Only edits count (§4.2).
- Attributing by files a shell command wrote (`sed -i`, `>`, a formatter). Bash commands don't name their targets reliably.
- Re-splitting history that is already archived. The archive holds weekly totals only, with no `cwd` or edits, so it stays with the launch repo.
- Deleting 0.4.0's files. They stay where they are, untouched (§8.5).
- Migrating 0.5.0's files back for a downgrade (§8.4).

## 3. What the logs show

From the author's logs, 2026-10-10 (194 main logs, 9 repos, about 620 MB, about $5,916):

1. **Every log line carries `cwd`**, assistant lines included, and it changes when the session `cd`s. Subagent logs carry their own.
2. **35 of the 194 main logs have more than one `cwd`.** Most are subfolders of the same repo (`apps/core` in a monorepo). One session launched in another of the author's repos spent 468 lines in this one.
3. **Edits name their repo.** Edit and Write calls carry an absolute `file_path`, so a session can change repo B without ever `cd`ing there. 12 of 3,924 Edit and Write calls (4 turns, all from one of the author's repos into this one) targeted a repo other than their `cwd`'s.
4. **The edit is a small part of the work.** Those 12 editing messages cost $2.42 between them. Most of the work came before them, in messages that read, search and plan without naming a path. That is why a whole turn follows its edits (§4.2), not just the editing message.
5. **Re-attributing moves about $19.67 of about $5,916**, 0.3%: $13.13 by `cwd` alone, and $6.54 more once turns follow their edits. The effect is small for this user and larger for anyone who drives one session across repos.
6. **`git rev-parse` cannot resolve a deleted worktree.** A dry run built on it moved $92 from a deleted worktree of one of the author's repos to "another repo" that was really the same one. The file-only resolution in §5 moves none of it.
7. **A cold scan of every project folder takes 2.9 s, a warm one 0.16 s**, well inside the band's 120 s timeout. Parsing a 2.65 MB cache file takes 13 ms.

## 4. Attribution rules

1. **Turns.** A turn is the run of assistant messages in one log between two human prompts. A tool result is not a prompt. A subagent's log has its own turns, so a subagent's edits decide its own messages, not its parent's.
2. **Edits decide a turn.** The targets of a turn's Edit, Write, MultiEdit and NotebookEdit calls (`file_path`, `notebook_path`) are resolved to repos (§5). If at least one target is in a repo, every message in the turn is split across those repos in proportion to their edit calls: a turn with 3 edits in A and 1 in B goes 75% to A and 25% to B. Targets outside any repo (a scratchpad, `~/.claude` memory files) don't count.
3. **Otherwise `cwd` decides each message.** In a turn with no edits in a repo, each assistant message (deduplicated by message id, as today) goes to `root(cwd)`, the repo of the `cwd` on its log line.
4. **Fallback to the launch repo.** When `root(cwd)` is null (scratchpads, `/tmp`, `$HOME`, a folder that never was a repo) or a line has no `cwd`, the message goes to the session's **launch repo**: `root` of the session's first `cwd`. If that is null too, the launch repo is the launch `cwd` itself, which matches 0.4.0, where a non-repo folder is its own "repo".
5. **The ledger is split by estimate share.** For a session with a `cost-state` record, repo R gets `ledger × (estimate of R's messages ÷ estimate of all its messages)`. This is the scaling 0.4.0 already uses to split a session across weeks. A session with a ledger but no priced messages goes wholly to its launch repo.
6. **Sessions count once in every repo they spent in.** A session that spent in A and B counts as one session in each, so per-repo counts can add up to more than the number of sessions. Dollars still add up exactly.
7. **`since`, `today`, `last 7d` and tokens** are worked out per repo from the messages attributed to it. Tokens of a split turn are split the same way as its dollars.
8. **Unpriced models** are listed for each repo that has an estimated, unpriced message.

## 5. Resolving a folder to a repo

`find_root(folder, home)` from worklog (`plugins/worklog/hooks/scan.py`), moved to `shared/repos.py` and copied into both plugins by `scripts/sync-shared.py`. It resolves both a `cwd` and an edited file's folder:

- Walks up from the folder to the first one holding `.git` and follows a worktree's `.git` file to its common dir, so a worktree resolves to its main checkout.
- Reads files only and never runs `git`. A deleted `<repo>/.claude/worktrees/<name>`, or the folder of a file since deleted, still resolves by walking up to `<repo>`. That fixes the case in §3.6.
- `$HOME` itself never counts, so a dotfiles repo can't swallow everything.

Results are kept in `v2/roots.json` as `{folder: root | null}`. A folder resolved once keeps its repo after it is deleted. A `null` is retried at most once a day, in case the folder becomes a repo.

The repo's identity is its root path. Its archive file is named `slugOf(root)`, the same slug 0.4.0 uses, so the one-time copy (§8.2) maps old files to new by name.

## 6. Scanning

### 6.1 One scan covers every repo

0.4.0 scans only the repo's own project folders, plus a daily `--sweep` of the rest. In 0.5.0 a log from any folder can owe money to any repo, so **every scan reads every project folder**. Logs are cached by `(size, mtime, PRICES_UPDATED)` as today, so a warm scan only stats files.

Because every scan sees every log, every scan also archives deleted sessions for every repo. **The sweep goes away.** 0.5.0's band no longer runs it, and `scan.py --sweep` exits 0 doing nothing, in case anything still calls it.

### 6.2 Cache entry per log file

```jsonc
{
  "k": "size:mtime:PRICES_UPDATED",
  "sid": "877e2e95-…", "main": true,
  "ledger": 46.66,                      // or null
  "launch": "/Users/…/app",            // the log's first cwd; resolves to the launch repo (§4.4)
  "places": [                           // where a message's cost goes, before folders become repos
    { "cwd": "/Users/…/app" },
    { "edits": { "/Users/…/lib/docs": 3, "/Users/…/app/src": 1 } }
  ],
  "msgs": { "msg_…": [usd, epoch_s, unpriced_model, place_index] },
  "first": 1791528666.5,
  "tok": { "2026-10-05": { "0": { "claude-opus-5-5": [in, out, cacheRead, cacheWrite] } } }
}                                       // tok: week → place index → model → counts
```

A place holds a `cwd` (§4.3), a turn's edited folders with their edit counts (§4.2), both, or neither (then the launch repo). An entry copied from 0.4.0 has the place `{"key": <repo slug>}` instead (§8.2). Messages point at places by index to keep the file small. Places hold folders, not repos. They are resolved through `roots.json` when the totals are added up, so a better resolution later doesn't require re-reading logs.

### 6.3 Output

`scan.py <projects> <root> <cache-dir> <data-dir> [exclude-session-id]` prints the same JSON as 0.4.0 for the repo at `<root>`: `usd`, `sessions`, `estimatedUsd`, `today`, `week`, `since`, `unpriced`, plus `live`, the live session's share of this repo (§6.4). Otherwise the band changes only to pass `root` where it passes `slug` today, and to drop the sweep.

### 6.4 The live session

The live session is split by repo while it runs.

- **The scan still leaves it out of the history**, as today, but reads its log, which Claude Code writes as the session goes. It returns `live`: the share of the live session's estimated cost that belongs to `<root>` under §4, a number from 0 to 1. `live` is 1 when the session has no priced messages yet, since its messages fall back to the launch repo, which is the band's repo.
- **The band applies `live` to Claude Code's `/cost` figure.** The repo total becomes `past.usd + session × live`, and the same goes for **today** and **last 7d**. **This session**, the sparkline and the rate on the right stay the whole session, because they describe the session, not the repo.
- **Other repos' bands see it as history.** A band open on repo B leaves out only its own session, so it reads A's live log like any other log and counts B's share of it. No session is left out everywhere or counted twice.
- **The share is at most 2 minutes old.** It moves with each rescan, every 2 minutes and after a `/clear`. Cost added between rescans is split by the last share.
- **A turn in progress can move.** Until its first edit, a turn follows `cwd`. Once it edits, the whole turn, earlier messages included, moves to the edited repos at the next rescan.

## 7. Files

```
~/.cache/claude-repo-spend/v2/folders/<project-folder>.json   cache of one project folder's logs (§6.2)
~/.cache/claude-repo-spend/v2/roots.json                      folder → repo (§5)
~/.cache/claude-repo-spend/v2/scan.lock                       held for the whole scan, archive writes included
~/.local/share/claude-repo-spend/v2/<slug>.json               archive per repo, same schema as 0.4.0 (v1)
~/.local/share/claude-repo-spend/v2/.imported                 written once, when the copy from 0.4.0 is done (§8.2)
```

- **One cache file per project folder.** A scan reads every folder's file, but rewrites only those whose logs changed. Usually that is just the live session's folder. One file for every repo would be rewritten in full on every scan, since the live log changes every turn. It would also grow to 50–100 MB for anyone who keeps logs for a year (`cleanupPeriodDays`).
- **A project folder Claude Code removes entirely** keeps its cache file while its entries count as `gone`. The file is deleted once every one of its sessions is archived.
- **One lock.** A scan writes every folder's cache and every repo's archive while holding `scan.lock`, so there is no per-repo lock ordering to get wrong.
- **The archive schema is unchanged.** Weekly buckets of `usd`, `estimatedUsd`, `sessions`, `first`, `unpriced` and `tokens`, plus the `archived` id map. Only what counts in a bucket changes: a repo's share of a session, not the whole session. `ARCHIVE_VERSION` stays 1.
- **`$XDG_DATA_HOME` and `$CLAUDE_CONFIG_DIR`** are honoured as today.

## 8. Upgrading

### 8.1 Why new files

0.4.0 and 0.5.0 count different things, so they can't share an archive: whichever archived a session first would decide its attribution, and the other would count it again or not at all. Separate files make each version correct by its own rules. An old session still open after the update keeps working against the old files until it restarts.

### 8.2 The one-time copy

The first 0.5.0 scan on a machine, holding `scan.lock`, runs this when `v2/.imported` is missing:

1. **Old archives:** every `~/.local/share/claude-repo-spend/<slug>.json` is copied to `v2/<slug>.json`, `archived` ids included, so a log that comes back is still not counted twice. An unreadable or newer-version file is skipped and logged, never moved or changed.
2. **Old caches:** every `~/.cache/claude-repo-spend/<slug>.json` (any version `load_cache` reads) is checked for entries whose log is no longer on disk and whose session is not in that repo's old archive. Those entries are the only record of logs deleted after 0.4.0's last scan, including a main log gone while its subagent logs remain. Each one is copied into the v2 cache file of the project folder its path names, marked `gone`, with every message in the place `{"key": <slug>}`, since 0.4.0 kept no `cwd` or edits. From then on they count, and are archived when the rest of their session goes, like any other entry.
3. `v2/.imported` is written last, with the time and the counts copied.

If a scan stops partway, the copy reruns next time. Step 1 overwrites its own earlier partial copies and step 2 skips entries already in the v2 cache, so rerunning never counts anything twice. **After `.imported` exists, 0.5.0 never reads the old files again.** Reading them later would count sessions that both versions archived.

### 8.3 What users see

- **Totals shift once.** Logs still on disk (the last 30 days by default) are re-attributed, so a repo that sessions edited or wandered out of goes down and the one they edited or wandered into goes up. On the author's machine that's $19.67.
- **Session counts can go up**, per §4.6.
- **Archived history doesn't move.** It stays with the launch repo.
- **During the switch two sessions can disagree.** One still on 0.4.0 and one on 0.5.0, open on the same repo, show different totals until the old one restarts.
- **The first scan is slower:** a few seconds while every project folder is read once.

### 8.4 Downgrading

0.4.0 reads only the old files. They are complete up to the copy and then miss anything only 0.5.0 archived afterwards. Those sessions drop out of 0.4.0's total. They are still in `v2/`, so upgrading again brings them back. The changelog says so.

### 8.5 Cleaning up

0.5.0 never deletes the old files. The README says the old `<slug>.json` files in both folders (not `v2/`) can be removed once every session has restarted on 0.5.0. Deleting the old **archives** is safe only after `v2/.imported` exists.

## 9. Changes by file

| File | Change |
|---|---|
| `shared/repos.py` | New: `common_dir`, `find_root`, moved from worklog |
| `scripts/sync-shared.py` | `repos.py` → `plugins/repo-spend/hooks`, `plugins/worklog/hooks` |
| `plugins/worklog/hooks/scan.py` | Imports them from `repos.py`. No behaviour change (worklog 0.3.1) |
| `plugins/repo-spend/hooks/scan.py` | Global scan, turns and places, per-folder cache, v2 files, one-time copy, `--sweep` a no-op |
| `plugins/repo-spend/hooks/register.tsx` | Passes `root`, `cacheDir`, `dataDir`. Applies `live`. Drops the sweep timer |
| `plugins/repo-spend/README.md` | "How it counts" section, upgrade note, file list, cleanup note |
| `plugins/repo-spend/.claude-plugin/plugin.json` | 0.5.1 |

## 10. Tests

`python3 -m unittest discover -s tests` in `plugins/repo-spend`, using the existing helpers with a `cwd` on each line and tool calls where a test needs edits:

1. **Split by `cwd`:** one session, messages in A and B, no edits → each repo's `usd` is its share; A + B equals the session.
2. **Edits move the turn:** `cwd` in A, the turn reads and plans, then edits a file in B → every message of that turn goes to B; the next turn, with no edits, follows `cwd` again.
3. **Edits split by count:** a turn with 3 edits in A and 1 in B → 75% and 25%.
4. **Edits that don't count:** an edit to a scratchpad or `~/.claude`, or a Read of a file in B → the turn follows `cwd`.
5. **Edited file since deleted:** the target's folder is gone → it still resolves by walking up to its repo.
6. **Subagent edits:** a subagent that edits B → its own messages go to B; the parent's turn follows the parent's edits and `cwd`.
7. **Ledger split** follows the estimate share. A ledger with no priced messages goes to the launch repo.
8. **Fallback:** a `cwd` in `/tmp`, `$HOME`, or missing → launch repo. A launch in a non-repo folder → that folder.
9. **Deleted worktree:** `cwd` under `<repo>/.claude/worktrees/x` with `x` deleted → `<repo>`.
10. **Subfolder launch:** a session launched in `<repo>/sub` counts toward `<repo>`. This also fixes 0.4.0's subfolder gap.
11. **Sessions** count once in each repo they spent in.
12. **Archive split:** delete a two-repo session's logs → each v2 archive gets its share in the right week; a rescan changes nothing.
13. **Live split:** a live session with messages in A and B → `live` for A equals A's estimated share; B's scan, which doesn't exclude it, counts B's share; the two add up to the whole session. A live turn that edits B after the scan → moves to B on the next one.
14. **Per-folder cache:** change one log → only its folder's cache file is rewritten. Remove a whole project folder → its sessions are archived and its cache file deleted.
15. **Copy, archives:** old archive present → copied with its `archived` ids; `.imported` written; old file unchanged byte for byte.
16. **Copy, orphans:** old cache entry with no log and not archived → lands in its folder's v2 cache, counted, archived later; one already in the old archive → not counted again.
17. **Copy, interrupted:** kill after step 1 → the rerun gives the same totals as an uninterrupted copy.
18. **Side by side:** run 0.4.0's `scan.py` (from git, `cdee039`) and 0.5.0's against one home folder, deleting logs between runs → each version's totals equal its own expected figures; neither changes the other's files.
19. **Conservation:** over a fixture of several repos, the sum of every repo's `usd` equals the sum of every session's cost.
20. **`--sweep`** exits 0 and writes nothing.
21. **Old files untouched:** after any number of 0.5.0 scans, every file in the old folders is unchanged byte for byte.

`claude plugin test plugins/repo-spend` for the band: the scan arguments, `live` applied to the total, today and last 7d but not to this session, and no sweep timer.

Manual: run against the author's real logs and check §3's figures (about $19.67 moved into this repo; every other repo's total within cents of the dry run).

## 11. Decisions

Settled while drafting, for the record:

1. **Edits count, reads don't.** A turn that edits files goes to the repos it edited (§4.2). Reads, searches and shell commands never move cost.
2. **The live session is split while it runs** (§6.4).
3. **A session counts in every repo it spent in** (§4.6).
4. **The cache is split per project folder from the start** (§7).
5. **0.4.0's files are kept, never deleted** (§8.5). Deleting them safely means waiting until no 0.4.0 session is left, which costs more than the few MB it saves.

## Appendix A. What changed while building

1. **Repos are keyed by slug.** A repo's identity in the cache, the archive and the scan is `slugOf(root)`, the name 0.4.0 already gave its files. A log with no `cwd` at all (none in practice, many in the tests) then falls back to its project folder's name, which is that slug.
2. **The launch folder, not the launch repo, is cached.** `launch` holds the log's first `cwd` and is resolved with every other folder (§6.2), so a better resolution later needs no re-read.
3. **A copied session keeps its start.** 0.4.0 folded some sessions into one total carrying only the newest time. The entry's own `first` still counts for `since` and the archive's `first` in its launch repo.
4. **One repo's newer archive holds back only its share.** When another repo's archive is from a newer version, that repo's share of a deleted session waits in the cache, still counting, and the scan goes on. Only the band's own repo stops the scan with "update repo-spend", as before.
5. **On the author's logs** (2026-10-11), 0.5.0 moves $21.13 from one of the author's repos to this one and leaves every other repo unchanged. The total across repos is $5,949.85 in both versions. A cold scan of every folder takes 2.9 s, a warm one 0.13 s.
6. **0.5.1, not 0.5.0.** 0.5.0 was only ever installed on the author's machine, to try it. It saved `roots.json` before adding up the totals, which is when most folders are resolved, so the map was never written and a folder could lose its repo once the repo was deleted. 0.5.1 saves it last. Everything above that says 0.5.0 holds for 0.5.1.
