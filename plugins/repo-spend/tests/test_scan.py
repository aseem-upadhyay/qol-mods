"""Tests for hooks/scan.py. Run: python3 -m unittest discover -s tests"""
import json, os, subprocess, sys, tempfile, unittest

SCAN = os.path.join(os.path.dirname(__file__), "..", "hooks", "scan.py")
SLUG = "-work-demo"
# Weeks start on a local Monday: pin the zone so they fall the same everywhere.
ENV = {**os.environ, "TZ": "UTC"}


def assistant(mid, model, ts="2026-01-01T00:00:00Z", **usage):
    base = {"input_tokens": 0, "output_tokens": 0,
            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    base.update(usage)
    return {"type": "assistant", "timestamp": ts,
            "message": {"id": mid, "model": model, "usage": base}}


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.projects = os.path.join(self.tmp.name, "projects")
        self.cache = os.path.join(self.tmp.name, "cache", "c.json")
        self.archive = os.path.join(self.tmp.name, "data", SLUG + ".json")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, folder, name, rows):
        d = os.path.join(self.projects, folder)
        os.makedirs(os.path.dirname(os.path.join(d, name)), exist_ok=True)
        with open(os.path.join(d, name), "w") as fh:
            fh.write("\n".join(json.dumps(r) for r in rows) + "\n")

    def scan(self, exclude=""):
        out = subprocess.run(
            [sys.executable, SCAN, self.projects, SLUG, self.cache, self.archive, exclude],
            check=True, capture_output=True, text=True, env=ENV).stdout
        return json.loads(out)

    def sweep(self):
        out = subprocess.run(
            [sys.executable, SCAN, "--sweep", self.projects,
             os.path.dirname(self.cache), os.path.dirname(self.archive)],
            check=True, capture_output=True, text=True, env=ENV).stdout
        return json.loads(out)

    def remove(self, folder, name):
        os.remove(os.path.join(self.projects, folder, name))

    def read_json(self, path):
        with open(path) as fh:
            return json.load(fh)

    def test_ledger_wins_and_estimates_fill_in(self):
        # Session a: Claude Code's ledger says $7, whatever the messages say.
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", input_tokens=1_000_000),
            {"type": "cost-state", "totalCostUSD": 7.0},
        ])
        # Session b: no ledger; 1M output tokens on Opus 5.5 = $20, plus a
        # subagent's 1M input tokens = $4. A repeated streaming line counts once.
        row = assistant("m2", "claude-opus-5-5", output_tokens=1_000_000)
        self.write(SLUG, "b.jsonl", [row, row])
        self.write(SLUG, "b/subagents/agent-1.jsonl", [
            assistant("m3", "claude-opus-5-5", input_tokens=1_000_000)])
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 31.0)
        self.assertAlmostEqual(r["estimatedUsd"], 24.0)
        self.assertEqual(r["sessions"], 2)
        self.assertEqual(r["unpriced"], [])

    def test_worktrees_count_other_repos_do_not(self):
        self.write(SLUG + "--claude-worktrees-x-1", "w.jsonl", [
            assistant("m1", "claude-sonnet-5-5", output_tokens=1_000_000)])
        self.write(SLUG + "-other", "o.jsonl", [
            assistant("m2", "claude-sonnet-5-5", output_tokens=1_000_000)])
        self.assertAlmostEqual(self.scan()["usd"], 10.0)

    def test_live_session_is_excluded(self):
        self.write(SLUG, "live.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000)])
        self.assertEqual(self.scan(exclude="live")["usd"], 0)

    def test_unknown_model_is_reported_not_priced(self):
        self.write(SLUG, "u.jsonl", [
            assistant("m1", "claude-future-9", output_tokens=1_000_000)])
        r = self.scan()
        self.assertEqual(r["usd"], 0)
        self.assertEqual(r["unpriced"], ["claude-future-9"])

    def test_one_hour_cache_writes_priced_at_their_rate(self):
        self.write(SLUG, "c.jsonl", [assistant(
            "m1", "claude-opus-5-5", cache_creation_input_tokens=1_000_000,
            cache_creation={"ephemeral_1h_input_tokens": 1_000_000,
                            "ephemeral_5m_input_tokens": 0})])
        self.assertAlmostEqual(self.scan()["usd"], 8.0)

    def test_deleted_logs_keep_counting(self):
        # Claude Code deletes old logs (cleanupPeriodDays); a session the scan
        # has already seen stays in the total, scan after scan.
        self.write(SLUG, "old.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000),
            {"type": "cost-state", "totalCostUSD": 21.0},
        ])
        self.write(SLUG, "old/subagents/agent-1.jsonl", [
            assistant("m2", "claude-opus-5-5", input_tokens=1_000_000)])
        self.write(SLUG, "new.jsonl", [
            assistant("m3", "claude-sonnet-5-5", output_tokens=1_000_000)])
        before = self.scan()
        self.assertAlmostEqual(before["usd"], 31.0)

        os.remove(os.path.join(self.projects, SLUG, "old.jsonl"))
        os.remove(os.path.join(self.projects, SLUG, "old", "subagents", "agent-1.jsonl"))
        for _ in range(2):
            after = self.scan()
            self.assertAlmostEqual(after["usd"], 31.0)
            self.assertEqual(after["sessions"], 2)

    def test_deleted_estimates_keep_their_flags(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000),
            assistant("m2", "claude-future-9", output_tokens=5),
        ])
        self.scan()
        os.remove(os.path.join(self.projects, SLUG, "a.jsonl"))
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 20.0)
        self.assertAlmostEqual(r["estimatedUsd"], 20.0)
        self.assertEqual(r["unpriced"], ["claude-future-9"])

    def test_since_is_the_oldest_counted_message(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", ts="2026-03-01T10:00:00Z", output_tokens=1),
            assistant("m2", "claude-opus-5-5", ts="2026-05-01T10:00:00Z", output_tokens=1),
        ])
        self.write(SLUG, "b.jsonl", [
            assistant("m3", "claude-opus-5-5", ts="2026-04-01T10:00:00Z", output_tokens=1)])
        march_1 = 1772359200000  # 2026-03-01T10:00:00Z in epoch ms
        self.assertEqual(self.scan()["since"], march_1)

        # It still reaches back that far after Claude Code deletes the log.
        os.remove(os.path.join(self.projects, SLUG, "a.jsonl"))
        self.assertEqual(self.scan()["since"], march_1)

    def test_first_ever_session_has_no_projects_folder(self):
        # Before Claude Code writes its first log there is no projects folder.
        r = self.scan()
        self.assertEqual((r["usd"], r["sessions"], r["since"]), (0, 0, None))

    def test_since_is_null_without_history(self):
        os.makedirs(os.path.join(self.projects, SLUG))
        self.assertIsNone(self.scan()["since"])

    def test_previous_cache_format_keeps_remembered_sessions(self):
        # A v4 cache, before entries carried "first": one session whose log
        # Claude Code already deleted. It must survive the upgrade.
        gone = os.path.join(self.projects, SLUG, "gone.jsonl")
        os.makedirs(os.path.dirname(self.cache), exist_ok=True)
        with open(self.cache, "w") as fh:
            json.dump({"v": 4, "files": {gone: {
                "k": "1:1:x", "sid": "gone", "main": True, "ledger": None, "gone": True,
                "msgs": {"#total": [12.5, 1772359200.0, ""]}}}}, fh)
        os.makedirs(os.path.join(self.projects, SLUG), exist_ok=True)
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 12.5)
        self.assertEqual(r["since"], 1772359200000)

    def test_deleted_session_moves_to_the_archive(self):
        # Opus 5.5: 1M output = $20, 1M input = $4. Monday 2026-09-28's week.
        self.write(SLUG, "old.jsonl", [
            assistant("m1", "claude-opus-5-5", ts="2026-09-29T10:00:00Z",
                      output_tokens=1_000_000, cache_read_input_tokens=7)])
        self.write(SLUG, "old/subagents/agent-1.jsonl", [
            assistant("m2", "claude-opus-5-5", ts="2026-09-30T10:00:00Z",
                      input_tokens=1_000_000)])
        self.scan()
        self.assertFalse(os.path.exists(self.archive))  # nothing deleted yet

        self.remove(SLUG, "old.jsonl")
        self.remove(SLUG, "old/subagents/agent-1.jsonl")
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 24.0)
        self.assertEqual(r["sessions"], 1)

        archive = self.read_json(self.archive)
        self.assertEqual(list(archive["weeks"]), ["2026-09-28"])
        week = archive["weeks"]["2026-09-28"]
        self.assertAlmostEqual(week["usd"], 24.0, places=4)
        self.assertAlmostEqual(week["estimatedUsd"], 24.0, places=4)
        self.assertEqual(week["sessions"], 1)
        self.assertEqual(week["tokens"], {"claude-opus-5-5": {
            "input": 1_000_000, "output": 1_000_000, "cacheRead": 7, "cacheWrite": 0}})
        self.assertIn("old", archive["archived"])
        # The cache lets go of it: the archive holds it now.
        self.assertEqual(self.read_json(self.cache)["files"], {})

    def test_archive_outlives_the_cache(self):
        self.write(SLUG, "old.jsonl", [
            assistant("m1", "claude-opus-5-5", ts="2026-03-01T10:00:00Z", output_tokens=1),
            {"type": "cost-state", "totalCostUSD": 21.0}])
        self.write(SLUG, "new.jsonl", [
            assistant("m2", "claude-sonnet-5-5", ts="2026-10-01T10:00:00Z",
                      output_tokens=1_000_000)])
        self.scan()
        self.remove(SLUG, "old.jsonl")
        self.scan()
        os.remove(self.cache)
        for _ in range(2):
            r = self.scan()
            self.assertAlmostEqual(r["usd"], 31.0)
            self.assertAlmostEqual(r["estimatedUsd"], 10.0)
            self.assertEqual(r["sessions"], 2)
            self.assertEqual(r["since"], 1772359200000)

    def test_a_session_spread_over_weeks_scales_to_its_ledger(self):
        # Estimates of $20 and $4 in two weeks; the ledger says $12 in all.
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", ts="2026-10-04T23:00:00Z",
                      output_tokens=1_000_000),
            assistant("m2", "claude-opus-5-5", ts="2026-10-07T10:00:00Z",
                      input_tokens=1_000_000),
            {"type": "cost-state", "totalCostUSD": 12.0}])
        self.scan()
        self.remove(SLUG, "a.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 12.0)
        weeks = self.read_json(self.archive)["weeks"]
        self.assertEqual(list(weeks), ["2026-09-28", "2026-10-05"])
        self.assertAlmostEqual(weeks["2026-09-28"]["usd"], 10.0)
        self.assertAlmostEqual(weeks["2026-10-05"]["usd"], 2.0)
        self.assertEqual(weeks["2026-09-28"]["estimatedUsd"], 0)
        self.assertEqual(sum(w["sessions"] for w in weeks.values()), 1)

    def test_a_partly_deleted_session_waits_for_the_rest(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000)])
        self.write(SLUG, "a/subagents/agent-1.jsonl", [
            assistant("m2", "claude-opus-5-5", input_tokens=1_000_000)])
        self.scan()
        self.remove(SLUG, "a.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 24.0)
        self.assertFalse(os.path.exists(self.archive))
        self.remove(SLUG, "a/subagents/agent-1.jsonl")
        self.assertAlmostEqual(self.scan()["usd"], 24.0)
        self.assertEqual(len(self.read_json(self.archive)["archived"]), 1)

    def test_a_log_that_comes_back_counts_once(self):
        rows = [assistant("m1", "claude-opus-5-5", output_tokens=1_000_000)]
        self.write(SLUG, "a.jsonl", rows)
        self.scan()
        self.remove(SLUG, "a.jsonl")
        self.scan()
        self.write(SLUG, "a.jsonl", rows)  # restored from a backup, say
        self.assertAlmostEqual(self.scan()["usd"], 20.0)

    def test_previous_cache_format_moves_deleted_sessions_to_the_archive(self):
        # A v5 cache: one folded session whose log is gone, and one log still
        # on disk, re-read for its tokens.
        gone = os.path.join(self.projects, SLUG, "gone.jsonl")
        self.write(SLUG, "here.jsonl", [
            assistant("m1", "claude-opus-5-5", ts="2026-10-01T10:00:00Z",
                      output_tokens=1_000_000)])
        here = os.path.join(self.projects, SLUG, "here.jsonl")
        os.makedirs(os.path.dirname(self.cache), exist_ok=True)
        with open(self.cache, "w") as fh:
            json.dump({"v": 5, "files": {
                gone: {"k": "1:1:x", "sid": "gone", "main": True, "ledger": 9.0,
                       "gone": True, "first": 1772359200.0,
                       "msgs": {"#total": [12.5, 1772400000.0, ""]}},
                here: {"k": "stale-but-matching", "sid": "here", "main": True,
                       "ledger": None, "first": 0,
                       "msgs": {"m1": [20.0, 0, ""]}}}}, fh)
        r = self.scan()
        self.assertAlmostEqual(r["usd"], 29.0)
        self.assertEqual(r["since"], 1772359200000)
        self.assertEqual(r["sessions"], 2)
        self.assertEqual(list(self.read_json(self.archive)["archived"]), ["gone"])
        self.assertIn("tok", self.read_json(self.cache)["files"][here])

    def test_an_unreadable_archive_is_kept_aside(self):
        os.makedirs(os.path.dirname(self.archive))
        with open(self.archive, "w") as fh:
            fh.write("{not json")
        os.makedirs(os.path.join(self.projects, SLUG))
        self.scan()
        kept = [n for n in os.listdir(os.path.dirname(self.archive)) if ".broken-" in n]
        self.assertEqual(len(kept), 1)

    def test_a_newer_archive_is_left_alone(self):
        os.makedirs(os.path.dirname(self.archive))
        with open(self.archive, "w") as fh:
            json.dump({"v": 99}, fh)
        os.makedirs(os.path.join(self.projects, SLUG))
        run = subprocess.run(
            [sys.executable, SCAN, self.projects, SLUG, self.cache, self.archive],
            capture_output=True, text=True, env=ENV)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("update repo-spend", run.stderr)
        self.assertEqual(self.read_json(self.archive), {"v": 99})

    def test_sweep_archives_every_repo_once_a_day(self):
        other = "-work-other"
        self.write(other, "o.jsonl", [
            assistant("m1", "claude-sonnet-5-5", output_tokens=1_000_000)])
        self.write(other + "--claude-worktrees-x-1", "w.jsonl", [
            assistant("m2", "claude-sonnet-5-5", output_tokens=1_000_000)])
        self.write("-work-wt-only--claude-worktrees-y-2", "y.jsonl", [
            assistant("m3", "claude-sonnet-5-5", output_tokens=1_000_000)])
        self.assertEqual(self.sweep()["repos"], 2)
        self.remove(other, "o.jsonl")
        self.remove(other + "--claude-worktrees-x-1", "w.jsonl")
        self.assertEqual(self.sweep()["skipped"], "swept recently")

        os.utime(os.path.join(os.path.dirname(self.cache), ".last-sweep"), (0, 0))
        self.assertEqual(self.sweep()["failed"], [])
        archive = self.read_json(os.path.join(os.path.dirname(self.archive), other + ".json"))
        self.assertEqual(sorted(archive["archived"]), ["o", "w"])
        self.assertAlmostEqual(sum(w["usd"] for w in archive["weeks"].values()), 20.0)
        # Archives only: locks and the sweep's stamp live with the cache.
        self.assertEqual(sorted(os.listdir(os.path.dirname(self.archive))),
                         ["-work-other.json"])

    def test_cache_reuse_gives_same_answer(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000)])
        self.assertEqual(self.scan(), self.scan())


class PricingCopyTest(unittest.TestCase):
    def test_pricing_is_the_shared_copy(self):
        # Only in the repository: an installed plugin has no shared/ beside it.
        shared = os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared", "pricing.py")
        if not os.path.exists(shared):
            self.skipTest("no shared/ folder")
        mine = os.path.join(os.path.dirname(__file__), "..", "hooks", "pricing.py")
        with open(shared, "rb") as a, open(mine, "rb") as b:
            self.assertEqual(a.read(), b.read(),
                             "hooks/pricing.py differs: run python3 scripts/sync-shared.py")


if __name__ == "__main__":
    unittest.main()
