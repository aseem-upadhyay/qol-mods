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

    def test_cache_reuse_gives_same_answer(self):
        self.write(SLUG, "a.jsonl", [
            assistant("m1", "claude-opus-5-5", output_tokens=1_000_000)])
        self.assertEqual(self.scan(), self.scan())


if __name__ == "__main__":
    unittest.main()
