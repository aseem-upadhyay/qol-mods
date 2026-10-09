"""Tests for hooks/scan.py. Run: python3 -m unittest discover -s tests"""
import json, os, subprocess, sys, tempfile, unittest

SCAN = os.path.join(os.path.dirname(__file__), "..", "hooks", "scan.py")
SLUG = "-work-demo"


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

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, folder, name, rows):
        d = os.path.join(self.projects, folder)
        os.makedirs(os.path.dirname(os.path.join(d, name)), exist_ok=True)
        with open(os.path.join(d, name), "w") as fh:
            fh.write("\n".join(json.dumps(r) for r in rows) + "\n")

    def scan(self, exclude=""):
        out = subprocess.run(
            [sys.executable, SCAN, self.projects, SLUG, self.cache, exclude],
            check=True, capture_output=True, text=True).stdout
        return json.loads(out)

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

    def test_cache_reuse_gives_same_answer(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000)])
        self.assertEqual(self.scan(), self.scan())


if __name__ == "__main__":
    unittest.main()
