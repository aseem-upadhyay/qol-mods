"""Tests for hooks/scan.py. Run: python3 -m unittest discover -s tests"""
import json, os, shutil, subprocess, sys, tempfile, time, unittest

HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hooks")
SCAN = os.path.join(HOOKS, "scan.py")
SHARED = os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared")
# Logs with no cwd belong to their project folder's repo: this one.
ROOT = "/work/demo"
SLUG = "-work-demo"
# Weeks start on a local Monday: pin the zone so they fall the same everywhere.
TZ = {"TZ": "UTC"}


def slug_of(path):
    return "".join(c if c.isalnum() else "-" for c in path)


def assistant(mid, model, ts="2026-01-01T00:00:00Z", cwd=None, edits=(), tool="Edit", **usage):
    base = {"input_tokens": 0, "output_tokens": 0,
            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    base.update(usage)
    key = "notebook_path" if tool == "NotebookEdit" else "file_path"
    content = [{"type": "tool_use", "id": f"{mid}-{i}", "name": tool, "input": {key: path}}
               for i, path in enumerate(edits)]
    row = {"type": "assistant", "timestamp": ts,
           "message": {"id": mid, "model": model, "usage": base, "content": content}}
    if cwd:
        row["cwd"] = cwd
    return row


def prompt(cwd=None, text="go on"):
    row = {"type": "user", "message": {"role": "user", "content": text}}
    if cwd:
        row["cwd"] = cwd
    return row


def tool_result(cwd=None):
    row = {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "t", "content": "done"}]}}
    if cwd:
        row["cwd"] = cwd
    return row


OPUS = "claude-opus-5-5"      # 1M output = $20, 1M input = $4
SONNET = "claude-sonnet-5-5"  # 1M output = $10
M = 1_000_000


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        os.makedirs(self.home)
        self.projects = os.path.join(self.tmp.name, "projects")
        self.cache_dir = os.path.join(self.tmp.name, "cache")
        self.data_dir = os.path.join(self.tmp.name, "data")
        self.env = {**os.environ, **TZ, "HOME": self.home}

    def tearDown(self):
        self.tmp.cleanup()

    def repo(self, name):
        """A repo on disk (a folder holding .git) -> its path."""
        path = os.path.join(self.tmp.name, "repos", name)
        os.makedirs(os.path.join(path, ".git"), exist_ok=True)
        return path

    def archive_of(self, root=ROOT):
        return os.path.join(self.data_dir, "v2", slug_of(root) + ".json")

    def folder_file(self, folder):
        return os.path.join(self.cache_dir, "v2", "folders", folder + ".json")

    def write(self, folder, name, rows):
        path = os.path.join(self.projects, folder, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write("\n".join(json.dumps(r) for r in rows) + "\n")
        return path

    def run_scan(self, root=ROOT, exclude="", script=SCAN):
        return subprocess.run(
            [sys.executable, script, self.projects, root, self.cache_dir, self.data_dir, exclude],
            capture_output=True, text=True, env=self.env)

    def scan(self, root=ROOT, exclude=""):
        run = self.run_scan(root, exclude)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout)

    def remove(self, folder, name):
        os.remove(os.path.join(self.projects, folder, name))

    def read_json(self, path):
        with open(path) as fh:
            return json.load(fh)

    def snapshot(self, top):
        """Every file under `top`, by relative path, with its bytes."""
        out = {}
        for dirpath, _dirs, names in os.walk(top):
            for name in names:
                path = os.path.join(dirpath, name)
                with open(path, "rb") as fh:
                    out[os.path.relpath(path, top)] = fh.read()
        return out


class TotalsTest(Base):
    def test_ledger_wins_and_estimates_fill_in(self):
        # Session a: Claude Code's ledger says $7, whatever the messages say.
        self.write(SLUG, "a.jsonl", [
            assistant("m1", OPUS, input_tokens=M),
            {"type": "cost-state", "totalCostUSD": 7.0},
        ])
        # Session b: no ledger; 1M output tokens on Opus 5.5 = $20, plus a
        # subagent's 1M input tokens = $4. A repeated streaming line counts once.
        row = assistant("m2", OPUS, output_tokens=M)
        self.write(SLUG, "b.jsonl", [row, row])
        self.write(SLUG, "b/subagents/agent-1.jsonl", [assistant("m3", OPUS, input_tokens=M)])
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 31.0)
        self.assertAlmostEqual(r["estimatedUsd"], 24.0)
        self.assertEqual(r["sessions"], 2)
        self.assertEqual(r["unpriced"], [])

    def test_worktrees_count_other_repos_do_not(self):
        self.write(SLUG + "--claude-worktrees-x-1", "w.jsonl", [
            assistant("m1", SONNET, output_tokens=M)])
        self.write(SLUG + "-other", "o.jsonl", [assistant("m2", SONNET, output_tokens=M)])
        self.assertAlmostEqual(self.scan()["usd"], 10.0)

    def test_live_session_is_left_out_and_its_share_reported(self):
        self.write(SLUG, "live.jsonl", [assistant("m1", OPUS, output_tokens=M)])
        r = self.scan(exclude="live")
        self.assertEqual(r["usd"], 0)
        self.assertEqual(r["live"], 1.0)

    def test_a_live_session_with_no_log_yet_is_all_here(self):
        self.assertEqual(self.scan(exclude="live")["live"], 1.0)

    def test_unknown_model_is_reported_not_priced(self):
        self.write(SLUG, "u.jsonl", [assistant("m1", "claude-future-9", output_tokens=M)])
        r = self.scan()
        self.assertEqual(r["usd"], 0)
        self.assertEqual(r["unpriced"], ["claude-future-9"])

    def test_one_hour_cache_writes_priced_at_their_rate(self):
        self.write(SLUG, "c.jsonl", [assistant(
            "m1", OPUS, cache_creation_input_tokens=M,
            cache_creation={"ephemeral_1h_input_tokens": M, "ephemeral_5m_input_tokens": 0})])
        self.assertAlmostEqual(self.scan()["usd"], 8.0)

    def test_since_is_the_oldest_counted_message(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", OPUS, ts="2026-03-01T10:00:00Z", output_tokens=1),
            assistant("m2", OPUS, ts="2026-05-01T10:00:00Z", output_tokens=1),
        ])
        self.write(SLUG, "b.jsonl", [
            assistant("m3", OPUS, ts="2026-04-01T10:00:00Z", output_tokens=1)])
        march_1 = 1772359200000  # 2026-03-01T10:00:00Z in epoch ms
        self.assertEqual(self.scan()["since"], march_1)

        # It still reaches back that far after Claude Code deletes the log.
        self.remove(SLUG, "a.jsonl")
        self.assertEqual(self.scan()["since"], march_1)

    def test_first_ever_session_has_no_projects_folder(self):
        # Before Claude Code writes its first log there is no projects folder.
        r = self.scan()
        self.assertEqual((r["usd"], r["sessions"], r["since"]), (0, 0, None))

    def test_since_is_null_without_history(self):
        os.makedirs(os.path.join(self.projects, SLUG))
        self.assertIsNone(self.scan()["since"])

    def test_cache_reuse_gives_same_answer(self):
        self.write(SLUG, "a.jsonl", [assistant("m1", OPUS, output_tokens=M)])
        self.assertEqual(self.scan(), self.scan())

    def test_sweep_is_a_no_op(self):
        run = subprocess.run(
            [sys.executable, SCAN, "--sweep", self.projects, self.cache_dir, self.data_dir],
            capture_output=True, text=True, env=self.env)
        self.assertEqual(run.returncode, 0)
        self.assertEqual(json.loads(run.stdout)["repos"], 0)
        self.assertFalse(os.path.exists(self.cache_dir))
        self.assertFalse(os.path.exists(self.data_dir))


class AttributionTest(Base):
    """SPEC.md §4: turns that edit go where they edited, the rest by cwd."""

    def setUp(self):
        super().setUp()
        self.a, self.b = self.repo("a"), self.repo("b")
        self.folder = slug_of(self.a)

    def test_cwd_splits_a_session(self):
        self.write(self.folder, "s.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=self.a, output_tokens=M),
            assistant("m2", OPUS, cwd=self.b, input_tokens=M),
        ])
        a, b = self.scan(self.a), self.scan(self.b)
        self.assertAlmostEqual(a["usd"], 20.0)
        self.assertAlmostEqual(b["usd"], 4.0)
        self.assertEqual((a["sessions"], b["sessions"]), (1, 1))

    def test_an_edit_moves_its_whole_turn(self):
        self.write(self.folder, "s.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=self.a, output_tokens=M),       # reads, plans
            tool_result(self.a),
            assistant("m2", OPUS, cwd=self.a, input_tokens=M,
                      edits=[os.path.join(self.b, "README.md")]),
            tool_result(self.a),
            prompt(self.a),
            assistant("m3", SONNET, cwd=self.a, output_tokens=M),     # back home
        ])
        self.assertAlmostEqual(self.scan(self.b)["usd"], 24.0)
        self.assertAlmostEqual(self.scan(self.a)["usd"], 10.0)

    def test_edits_split_a_turn_by_count(self):
        edits = [os.path.join(self.a, f"f{i}.py") for i in range(3)] + [
            os.path.join(self.b, "g.py")]
        self.write(self.folder, "s.jsonl", [
            prompt(self.a), assistant("m1", OPUS, cwd=self.a, output_tokens=M, edits=edits)])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 15.0)
        self.assertAlmostEqual(self.scan(self.b)["usd"], 5.0)

    def test_every_editing_tool_counts(self):
        rows = [prompt(self.a)]
        for i, tool in enumerate(["Write", "MultiEdit", "NotebookEdit"]):
            rows.append(assistant(f"m{i}", SONNET, cwd=self.a, output_tokens=M, tool=tool,
                                  edits=[os.path.join(self.b, f"n{i}.ipynb")]))
        self.write(self.folder, "s.jsonl", rows)
        self.assertAlmostEqual(self.scan(self.b)["usd"], 30.0)

    def test_edits_outside_repos_and_reads_do_not_move_cost(self):
        scratch = os.path.join(self.tmp.name, "scratch")
        read_b = assistant("m2", OPUS, cwd=self.a, input_tokens=M)
        read_b["message"]["content"] = [{"type": "tool_use", "id": "r", "name": "Read",
                                         "input": {"file_path": os.path.join(self.b, "x")}}]
        self.write(self.folder, "s.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=self.a, output_tokens=M,
                      edits=[os.path.join(scratch, "notes.md"),
                             os.path.join(self.home, ".claude", "memory.md")]),
            read_b,
        ])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 24.0)
        self.assertEqual(self.scan(self.b)["usd"], 0)

    def test_an_edited_file_in_a_deleted_folder_finds_its_repo(self):
        gone = os.path.join(self.b, "removed", "deeper", "file.py")
        self.write(self.folder, "s.jsonl", [
            prompt(self.a), assistant("m1", OPUS, cwd=self.a, output_tokens=M, edits=[gone])])
        self.assertAlmostEqual(self.scan(self.b)["usd"], 20.0)

    def test_a_subagent_edits_decide_only_its_own_messages(self):
        self.write(self.folder, "s.jsonl", [
            prompt(self.a), assistant("m1", OPUS, cwd=self.a, output_tokens=M)])
        self.write(self.folder, "s/subagents/agent-1.jsonl", [
            prompt(self.a, "fix b"),
            assistant("m2", OPUS, cwd=self.a, input_tokens=M,
                      edits=[os.path.join(self.b, "x.py")])])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 20.0)
        self.assertAlmostEqual(self.scan(self.b)["usd"], 4.0)

    def test_a_ledger_is_split_by_estimate_share(self):
        # Estimates $20 in a and $4 in b; the ledger says $12.
        self.write(self.folder, "s.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=self.a, output_tokens=M),
            assistant("m2", OPUS, cwd=self.b, input_tokens=M),
            {"type": "cost-state", "totalCostUSD": 12.0},
        ])
        a, b = self.scan(self.a), self.scan(self.b)
        self.assertAlmostEqual(a["usd"], 10.0)
        self.assertAlmostEqual(b["usd"], 2.0)
        self.assertEqual(a["estimatedUsd"], 0)

    def test_a_ledger_with_nothing_priced_goes_to_the_launch_repo(self):
        self.write(self.folder, "s.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=self.b),
            {"type": "cost-state", "totalCostUSD": 3.0},
        ])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 3.0)
        self.assertEqual(self.scan(self.b)["sessions"], 0)

    def test_folders_in_no_repo_fall_back_to_the_launch_repo(self):
        scratch = os.path.join(self.tmp.name, "scratch")
        self.write(self.folder, "s.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=scratch, output_tokens=M),
            assistant("m2", OPUS, cwd=self.home, input_tokens=M),
            assistant("m3", SONNET, output_tokens=M),               # no cwd at all
        ])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 34.0)

    def test_a_launch_outside_any_repo_is_its_own_repo(self):
        scratch = os.path.join(self.tmp.name, "scratch")
        self.write(slug_of(scratch), "s.jsonl", [
            prompt(scratch), assistant("m1", OPUS, cwd=scratch, output_tokens=M)])
        self.assertAlmostEqual(self.scan(scratch)["usd"], 20.0)

    def test_a_deleted_worktree_counts_toward_its_repo(self):
        tree = os.path.join(self.a, ".claude", "worktrees", "x")  # never on disk
        self.write(slug_of(tree), "s.jsonl", [
            prompt(tree), assistant("m1", OPUS, cwd=tree, output_tokens=M)])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 20.0)

    def test_a_folder_keeps_its_repo_after_the_repo_is_deleted(self):
        self.write(self.folder, "s.jsonl", [
            prompt(self.a), assistant("m1", OPUS, cwd=self.b, output_tokens=M)])
        self.assertAlmostEqual(self.scan(self.b)["usd"], 20.0)
        shutil.rmtree(self.b)  # nothing on disk says it was ever a repo
        self.assertAlmostEqual(self.scan(self.b)["usd"], 20.0)
        self.assertEqual(self.scan(self.a)["usd"], 0)

    def test_a_live_worktree_counts_toward_its_main_checkout(self):
        tree = os.path.join(self.tmp.name, "trees", "x")
        os.makedirs(tree)
        os.makedirs(os.path.join(self.a, ".git", "worktrees", "x"))
        with open(os.path.join(tree, ".git"), "w") as fh:
            fh.write(f"gitdir: {self.a}/.git/worktrees/x\n")
        with open(os.path.join(self.a, ".git", "worktrees", "x", "commondir"), "w") as fh:
            fh.write("../..\n")
        self.write(slug_of(tree), "s.jsonl", [
            prompt(tree), assistant("m1", OPUS, cwd=tree, output_tokens=M)])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 20.0)

    def test_a_subfolder_launch_counts_toward_its_repo(self):
        sub = os.path.join(self.a, "plugins", "x")
        os.makedirs(sub)
        self.write(slug_of(sub), "s.jsonl", [
            prompt(sub), assistant("m1", OPUS, cwd=sub, output_tokens=M)])
        self.assertAlmostEqual(self.scan(self.a)["usd"], 20.0)

    def test_repos_add_up_to_every_session(self):
        c = self.repo("c")
        self.write(self.folder, "s1.jsonl", [
            prompt(self.a),
            assistant("m1", OPUS, cwd=self.a, output_tokens=M),
            assistant("m2", OPUS, cwd=self.b, input_tokens=M,
                      edits=[os.path.join(c, "x"), os.path.join(self.b, "y")]),
            {"type": "cost-state", "totalCostUSD": 18.0}])
        self.write(slug_of(self.b), "s2.jsonl", [
            prompt(self.b),
            assistant("m3", SONNET, cwd=self.b, output_tokens=M),
            prompt(self.b),
            assistant("m4", SONNET, cwd=c, output_tokens=3 * M)])
        total = sum(self.scan(r)["usd"] for r in (self.a, self.b, c))
        self.assertAlmostEqual(total, 18.0 + 40.0)


class LiveTest(Base):
    def setUp(self):
        super().setUp()
        self.a, self.b = self.repo("a"), self.repo("b")
        self.folder = slug_of(self.a)

    def test_the_live_session_is_split_between_repos(self):
        rows = [prompt(self.a),
                assistant("m1", OPUS, cwd=self.a, output_tokens=M),
                assistant("m2", OPUS, cwd=self.b, input_tokens=5 * M)]
        self.write(self.folder, "live.jsonl", rows)
        self.assertAlmostEqual(self.scan(self.a, exclude="live")["live"], 0.5)
        # Another session's band, on b, counts b's half as history.
        b = self.scan(self.b, exclude="someone-else")
        self.assertAlmostEqual(b["usd"], 20.0)

        # A turn that goes on to edit b moves, earlier messages and all.
        rows += [prompt(self.a),
                 assistant("m3", OPUS, cwd=self.a, output_tokens=M),
                 assistant("m4", OPUS, cwd=self.a, output_tokens=M,
                           edits=[os.path.join(self.b, "x")])]
        self.write(self.folder, "live.jsonl", rows)
        os.utime(os.path.join(self.projects, self.folder, "live.jsonl"), (1, 1))
        self.assertAlmostEqual(self.scan(self.a, exclude="live")["live"], 0.25)


class ArchiveTest(Base):
    def test_deleted_logs_keep_counting(self):
        # Claude Code deletes old logs (cleanupPeriodDays); a session the scan
        # has already seen stays in the total, scan after scan.
        self.write(SLUG, "old.jsonl", [
            assistant("m1", OPUS, output_tokens=M),
            {"type": "cost-state", "totalCostUSD": 21.0}])
        self.write(SLUG, "old/subagents/agent-1.jsonl", [assistant("m2", OPUS, input_tokens=M)])
        self.write(SLUG, "new.jsonl", [assistant("m3", SONNET, output_tokens=M)])
        self.assertAlmostEqual(self.scan()["usd"], 31.0)

        self.remove(SLUG, "old.jsonl")
        self.remove(SLUG, "old/subagents/agent-1.jsonl")
        for _ in range(2):
            after = self.scan()
            self.assertAlmostEqual(after["usd"], 31.0)
            self.assertEqual(after["sessions"], 2)

    def test_deleted_estimates_keep_their_flags(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", OPUS, output_tokens=M),
            assistant("m2", "claude-future-9", output_tokens=5)])
        self.scan()
        self.remove(SLUG, "a.jsonl")
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 20.0)
        self.assertAlmostEqual(r["estimatedUsd"], 20.0)
        self.assertEqual(r["unpriced"], ["claude-future-9"])

    def test_deleted_session_moves_to_the_archive(self):
        self.write(SLUG, "old.jsonl", [
            assistant("m1", OPUS, ts="2026-09-29T10:00:00Z",
                      output_tokens=M, cache_read_input_tokens=7)])
        self.write(SLUG, "old/subagents/agent-1.jsonl", [
            assistant("m2", OPUS, ts="2026-09-30T10:00:00Z", input_tokens=M)])
        self.scan()
        self.assertFalse(os.path.exists(self.archive_of()))  # nothing deleted yet

        self.remove(SLUG, "old.jsonl")
        self.remove(SLUG, "old/subagents/agent-1.jsonl")
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 24.0)
        self.assertEqual(r["sessions"], 1)

        archive = self.read_json(self.archive_of())
        self.assertEqual(list(archive["weeks"]), ["2026-09-28"])
        week = archive["weeks"]["2026-09-28"]
        self.assertAlmostEqual(week["usd"], 24.0, places=4)
        self.assertAlmostEqual(week["estimatedUsd"], 24.0, places=4)
        self.assertEqual(week["sessions"], 1)
        self.assertEqual(week["tokens"], {OPUS: {
            "input": M, "output": M, "cacheRead": 7, "cacheWrite": 0}})
        self.assertIn("old", archive["archived"])
        # The cache lets go of it: the archive holds it now.
        self.assertFalse(os.path.exists(self.folder_file(SLUG)))

    def test_archive_outlives_the_cache(self):
        self.write(SLUG, "old.jsonl", [
            assistant("m1", OPUS, ts="2026-03-01T10:00:00Z", output_tokens=1),
            {"type": "cost-state", "totalCostUSD": 21.0}])
        self.write(SLUG, "new.jsonl", [
            assistant("m2", SONNET, ts="2026-10-01T10:00:00Z", output_tokens=M)])
        self.scan()
        self.remove(SLUG, "old.jsonl")
        self.scan()
        shutil.rmtree(os.path.join(self.cache_dir, "v2"))
        for _ in range(2):
            r = self.scan()
            self.assertAlmostEqual(r["usd"], 31.0)
            self.assertAlmostEqual(r["estimatedUsd"], 10.0)
            self.assertEqual(r["sessions"], 2)
            self.assertEqual(r["since"], 1772359200000)

    def test_a_session_spread_over_weeks_scales_to_its_ledger(self):
        # Estimates of $20 and $4 in two weeks; the ledger says $12 in all.
        self.write(SLUG, "a.jsonl", [
            assistant("m1", OPUS, ts="2026-10-04T23:00:00Z", output_tokens=M),
            assistant("m2", OPUS, ts="2026-10-07T10:00:00Z", input_tokens=M),
            {"type": "cost-state", "totalCostUSD": 12.0}])
        self.scan()
        self.remove(SLUG, "a.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 12.0)
        weeks = self.read_json(self.archive_of())["weeks"]
        self.assertEqual(list(weeks), ["2026-09-28", "2026-10-05"])
        self.assertAlmostEqual(weeks["2026-09-28"]["usd"], 10.0)
        self.assertAlmostEqual(weeks["2026-10-05"]["usd"], 2.0)
        self.assertEqual(weeks["2026-09-28"]["estimatedUsd"], 0)
        self.assertEqual(sum(w["sessions"] for w in weeks.values()), 1)

    def test_a_partly_deleted_session_waits_for_the_rest(self):
        self.write(SLUG, "a.jsonl", [assistant("m1", OPUS, output_tokens=M)])
        self.write(SLUG, "a/subagents/agent-1.jsonl", [assistant("m2", OPUS, input_tokens=M)])
        self.scan()
        self.remove(SLUG, "a.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 24.0)
        self.assertFalse(os.path.exists(self.archive_of()))
        self.remove(SLUG, "a/subagents/agent-1.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 24.0)
        self.assertEqual(len(self.read_json(self.archive_of())["archived"]), 1)

    def test_a_log_that_comes_back_counts_once(self):
        rows = [assistant("m1", OPUS, output_tokens=M)]
        self.write(SLUG, "a.jsonl", rows)
        self.scan()
        self.remove(SLUG, "a.jsonl")
        self.scan()
        self.write(SLUG, "a.jsonl", rows)  # restored from a backup, say
        self.assertAlmostEqual(self.scan()["usd"], 20.0)

    def test_a_split_session_is_archived_in_each_repo(self):
        a, b = self.repo("a"), self.repo("b")
        self.write(slug_of(a), "s.jsonl", [
            prompt(a),
            assistant("m1", OPUS, ts="2026-09-29T10:00:00Z", cwd=a, output_tokens=M),
            prompt(a),
            assistant("m2", OPUS, ts="2026-10-06T10:00:00Z", cwd=a, input_tokens=M,
                      edits=[os.path.join(b, "x")])])
        self.scan(a)
        self.remove(slug_of(a), "s.jsonl")
        for _ in range(2):
            self.assertAlmostEqual(self.scan(a)["usd"], 20.0)
            self.assertAlmostEqual(self.scan(b)["usd"], 4.0)
        wa = self.read_json(self.archive_of(a))["weeks"]
        wb = self.read_json(self.archive_of(b))["weeks"]
        self.assertEqual(list(wa), ["2026-09-28"])
        self.assertEqual(list(wb), ["2026-10-05"])
        self.assertEqual(wb["2026-10-05"]["tokens"][OPUS]["input"], M)
        self.assertEqual((wa["2026-09-28"]["sessions"], wb["2026-10-05"]["sessions"]), (1, 1))

    def test_a_removed_project_folder_is_archived_and_its_cache_dropped(self):
        self.write(SLUG, "a.jsonl", [assistant("m1", OPUS, output_tokens=M)])
        self.scan()
        self.assertTrue(os.path.exists(self.folder_file(SLUG)))
        shutil.rmtree(os.path.join(self.projects, SLUG))
        self.assertAlmostEqual(self.scan()["usd"], 20.0)
        self.assertFalse(os.path.exists(self.folder_file(SLUG)))

    def test_only_changed_folders_are_rewritten(self):
        self.write(SLUG, "a.jsonl", [assistant("m1", OPUS, output_tokens=M)])
        self.write("-work-other", "b.jsonl", [assistant("m2", OPUS, output_tokens=M)])
        self.scan()
        os.utime(self.folder_file("-work-other"), (1, 1))
        self.write(SLUG, "a.jsonl", [assistant("m1", OPUS, output_tokens=M),
                                     assistant("m3", OPUS, input_tokens=M)])
        self.assertAlmostEqual(self.scan()["usd"], 24.0)
        self.assertEqual(os.stat(self.folder_file("-work-other")).st_mtime, 1)

    def test_an_unreadable_archive_is_kept_aside(self):
        os.makedirs(os.path.dirname(self.archive_of()))
        with open(self.archive_of(), "w") as fh:
            fh.write("{not json")
        os.makedirs(os.path.join(self.projects, SLUG))
        self.scan()
        kept = [n for n in os.listdir(os.path.dirname(self.archive_of())) if ".broken-" in n]
        self.assertEqual(len(kept), 1)

    def test_a_newer_archive_is_left_alone(self):
        os.makedirs(os.path.dirname(self.archive_of()))
        with open(self.archive_of(), "w") as fh:
            json.dump({"v": 99}, fh)
        os.makedirs(os.path.join(self.projects, SLUG))
        run = self.run_scan()
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("update repo-spend", run.stderr)
        self.assertEqual(self.read_json(self.archive_of()), {"v": 99})

    def test_another_repos_newer_archive_holds_back_only_its_share(self):
        b = self.repo("b")
        os.makedirs(os.path.dirname(self.archive_of(b)))
        with open(self.archive_of(b), "w") as fh:
            json.dump({"v": 99}, fh)
        self.write(SLUG, "s.jsonl", [
            prompt(ROOT),
            assistant("m1", OPUS, output_tokens=M),
            assistant("m2", OPUS, cwd=b, input_tokens=M)])
        self.scan()
        self.remove(SLUG, "s.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 20.0)
        self.assertEqual(self.read_json(self.archive_of(b)), {"v": 99})
        # The session stays in the cache, still counting, until b can take it.
        self.assertTrue(os.path.exists(self.folder_file(SLUG)))


class UpgradeTest(Base):
    """SPEC.md §8: 0.4.0's files are copied once and never touched."""

    def old_cache(self, slug, files, v=6):
        os.makedirs(self.cache_dir, exist_ok=True)
        with open(os.path.join(self.cache_dir, slug + ".json"), "w") as fh:
            json.dump({"v": v, "files": files}, fh)

    def old_archive(self, slug, archive):
        os.makedirs(self.data_dir, exist_ok=True)
        with open(os.path.join(self.data_dir, slug + ".json"), "w") as fh:
            json.dump(archive, fh)

    OLD_WEEK = {"usd": 50.0, "estimatedUsd": 0.0, "sessions": 3, "first": 1772359200.0,
                "unpriced": [], "tokens": {}}

    def test_old_archives_are_copied_once(self):
        recent = int(time.time())
        self.old_archive(SLUG, {"v": 1, "weeks": {"2026-02-23": self.OLD_WEEK},
                                "archived": {"x": recent}})
        before = self.snapshot(self.data_dir)
        self.write(SLUG, "a.jsonl", [
            assistant("m1", OPUS, ts="2026-10-01T10:00:00Z", output_tokens=M)])
        for _ in range(2):
            r = self.scan()
            self.assertAlmostEqual(r["usd"], 70.0)
            self.assertEqual(r["sessions"], 4)
            self.assertEqual(r["since"], 1772359200000)
        self.assertEqual(self.read_json(self.archive_of())["archived"], {"x": recent})
        self.assertTrue(os.path.exists(os.path.join(self.data_dir, "v2", ".imported")))
        after = {k: v for k, v in self.snapshot(self.data_dir).items() if not k.startswith("v2")}
        self.assertEqual(after, before)

    def test_the_copy_is_not_repeated(self):
        self.old_archive(SLUG, {"v": 1, "weeks": {"2026-02-23": self.OLD_WEEK}, "archived": {}})
        self.scan()
        # 0.4.0, still running somewhere, archives more after the copy.
        week = dict(self.OLD_WEEK, usd=999.0)
        self.old_archive(SLUG, {"v": 1, "weeks": {"2026-02-23": week}, "archived": {}})
        self.assertAlmostEqual(self.scan()["usd"], 50.0)

    def test_orphaned_cache_entries_are_rescued(self):
        gone = os.path.join(self.projects, SLUG, "gone.jsonl")
        known = os.path.join(self.projects, SLUG, "known.jsonl")
        here = self.write(SLUG, "here.jsonl", [
            assistant("m1", OPUS, ts="2026-10-01T10:00:00Z", output_tokens=M)])
        self.old_cache(SLUG, {
            gone: {"k": "1:1:x", "sid": "gone", "main": True, "ledger": 9.0, "gone": True,
                   "first": 1772359200.0, "msgs": {"#total": [12.5, 1772400000.0, ""]},
                   "tok": {"2026-03-02": {OPUS: [1, 2, 3, 4]}}},
            known: {"k": "1:1:x", "sid": "known", "main": True, "ledger": None,
                    "first": 0, "msgs": {"k1": [7.0, 0, ""]}, "tok": {}},
            here: {"k": "stale", "sid": "here", "main": True, "ledger": None,
                   "first": 0, "msgs": {"m1": [20.0, 0, ""]}, "tok": {}}})
        # "known" is in the old archive already: copied with it, not again.
        self.old_archive(SLUG, {"v": 1, "weeks": {"2026-02-23": self.OLD_WEEK},
                                "archived": {"known": int(time.time())}})
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 9.0 + 20.0 + 50.0)
        self.assertEqual(r["sessions"], 5)
        self.assertEqual(r["since"], 1772359200000)
        archive = self.read_json(self.archive_of())
        self.assertEqual(sorted(archive["archived"]), ["gone", "known"])
        self.assertEqual(archive["weeks"]["2026-03-02"]["tokens"][OPUS]["cacheWrite"], 4)
        self.assertAlmostEqual(self.scan()["usd"], 79.0)

    def test_a_partly_deleted_session_is_rescued_whole(self):
        main = os.path.join(self.projects, SLUG, "s.jsonl")
        self.write(SLUG, "s/subagents/agent-1.jsonl", [assistant("m2", OPUS, input_tokens=M)])
        self.old_cache(SLUG, {main: {"k": "1:1:x", "sid": "s", "main": True, "ledger": None,
                                     "gone": True, "first": 0,
                                     "msgs": {"m1": [20.0, 0, ""]}, "tok": {}}})
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 24.0)
        self.assertEqual(r["sessions"], 1)

    def test_older_cache_versions_are_read(self):
        gone = os.path.join(self.projects, SLUG, "gone.jsonl")
        os.makedirs(os.path.dirname(gone))
        self.old_cache(SLUG, {gone: {"k": "1:1:x", "sid": "gone", "main": True,
                                     "ledger": None, "gone": True,
                                     "msgs": {"#total": [12.5, 1772359200.0, ""]}}}, v=4)
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 12.5)
        self.assertEqual(r["since"], 1772359200000)

    def test_an_interrupted_copy_reruns_to_the_same_totals(self):
        gone = os.path.join(self.projects, SLUG, "gone.jsonl")
        os.makedirs(os.path.dirname(gone))
        self.old_cache(SLUG, {gone: {"k": "1:1:x", "sid": "gone", "main": True, "ledger": 5.0,
                                     "gone": True, "first": 0,
                                     "msgs": {"g": [5.0, 1772359200.0, ""]}, "tok": {}}})
        self.old_archive(SLUG, {"v": 1, "weeks": {"2026-02-23": self.OLD_WEEK}, "archived": {}})
        whole = self.scan()
        shutil.rmtree(os.path.join(self.cache_dir, "v2"))
        shutil.rmtree(os.path.join(self.data_dir, "v2"))
        # Cut short: the archives copied and the orphan saved, no marker yet.
        self.scan()
        os.remove(os.path.join(self.data_dir, "v2", ".imported"))
        self.assertEqual(self.scan(), whole)

    def test_unreadable_and_newer_old_archives_are_skipped_untouched(self):
        os.makedirs(self.data_dir)
        with open(os.path.join(self.data_dir, SLUG + ".json"), "w") as fh:
            fh.write("{not json")
        self.old_archive("-work-newer", {"v": 2, "weeks": {}})
        before = self.snapshot(self.data_dir)
        run = self.run_scan()
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("not copied", run.stderr)
        after = {k: v for k, v in self.snapshot(self.data_dir).items() if not k.startswith("v2")}
        self.assertEqual(after, before)

    def test_old_files_are_never_changed(self):
        self.old_archive(SLUG, {"v": 1, "weeks": {"2026-02-23": self.OLD_WEEK}, "archived": {}})
        self.old_cache(SLUG, {})
        with open(os.path.join(self.cache_dir, ".last-sweep"), "w") as fh:
            fh.write("then\n")
        old = (self.snapshot(self.cache_dir), self.snapshot(self.data_dir))
        for i in range(3):
            self.write(SLUG, f"a{i}.jsonl", [assistant(f"m{i}", OPUS, output_tokens=M)])
            self.scan()
            self.remove(SLUG, f"a{i}.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 110.0)
        new = tuple({k: v for k, v in self.snapshot(d).items() if not k.startswith("v2")}
                    for d in (self.cache_dir, self.data_dir))
        self.assertEqual(new, old)

    def test_side_by_side_with_0_4_0(self):
        # 0.4.0's scanner, from git history; skipped outside the repository.
        old = os.path.join(self.tmp.name, "old")
        os.makedirs(old)
        for name in ("scan.py", "pricing.py"):
            show = subprocess.run(
                ["git", "show", f"cdee039:plugins/repo-spend/hooks/{name}"],
                capture_output=True, cwd=HOOKS)
            if show.returncode != 0:
                self.skipTest("no git history")
            with open(os.path.join(old, name), "wb") as fh:
                fh.write(show.stdout)
        a, b = self.repo("a"), self.repo("b")

        def scan_old():
            # 0.4.0's band: the slug, its own cache and archive files.
            slug = slug_of(a)
            run = subprocess.run(
                [sys.executable, os.path.join(old, "scan.py"), self.projects, slug,
                 os.path.join(self.cache_dir, slug + ".json"),
                 os.path.join(self.data_dir, slug + ".json")],
                capture_output=True, text=True, env=self.env)
            self.assertEqual(run.returncode, 0, run.stderr)
            return json.loads(run.stdout)

        self.write(slug_of(a), "s1.jsonl", [
            prompt(a), assistant("m1", OPUS, cwd=a, output_tokens=M),
            assistant("m2", OPUS, cwd=b, input_tokens=M)])
        self.assertAlmostEqual(scan_old()["usd"], 24.0)      # all of it: launched in a
        self.assertAlmostEqual(self.scan(a)["usd"], 20.0)    # a's share only
        self.remove(slug_of(a), "s1.jsonl")
        self.write(slug_of(a), "s2.jsonl", [
            prompt(a), assistant("m3", SONNET, cwd=a, output_tokens=M)])
        old_v2 = self.snapshot(os.path.join(self.data_dir, "v2"))
        self.assertAlmostEqual(scan_old()["usd"], 34.0)
        self.assertEqual(self.snapshot(os.path.join(self.data_dir, "v2")), old_v2)
        old_files = {k: v for k, v in self.snapshot(self.data_dir).items()
                     if not k.startswith("v2")}
        self.assertAlmostEqual(self.scan(a)["usd"], 30.0)
        self.assertAlmostEqual(self.scan(b)["usd"], 4.0)
        self.assertEqual({k: v for k, v in self.snapshot(self.data_dir).items()
                          if not k.startswith("v2")}, old_files)


class SharedCopyTest(unittest.TestCase):
    def test_shared_files_are_the_shared_copies(self):
        # Only in the repository: an installed plugin has no shared/ beside it.
        if not os.path.isdir(SHARED):
            self.skipTest("no shared/ folder")
        for name in ("pricing.py", "repos.py"):
            with open(os.path.join(SHARED, name), "rb") as a, \
                    open(os.path.join(HOOKS, name), "rb") as b:
                self.assertEqual(a.read(), b.read(),
                                 f"hooks/{name} differs: run python3 scripts/sync-shared.py")


if __name__ == "__main__":
    unittest.main()
