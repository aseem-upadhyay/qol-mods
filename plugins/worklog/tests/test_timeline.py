"""Tests for hooks/timeline.py. Run: python3 -m unittest discover -s tests"""
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))
from timeline import AGENT, HUMAN, Rules, allocate, attended, spans  # noqa: E402

RULES = Rules(idle_gap=15, lead_in=5, max_unattended=30)


class SpansTest(unittest.TestCase):
    def test_a_gap_of_exactly_the_idle_gap_joins(self):
        self.assertEqual(spans([0, 15], RULES), [(0, 15)])

    def test_one_minute_more_splits(self):
        self.assertEqual(spans([0, 16], RULES), [(0, 0), (16, 16)])


class AttendedTest(unittest.TestCase):
    def test_a_span_opening_with_a_prompt_gets_the_lead_in(self):
        seen, alone = attended({100: HUMAN, 110: AGENT}, RULES)
        self.assertEqual(seen, set(range(95, 111)))
        self.assertEqual(alone, set())

    def test_a_span_opening_with_claude_gets_no_lead_in(self):
        seen, _ = attended({100: AGENT, 102: HUMAN}, RULES)
        self.assertEqual(min(seen), 102)

    def test_a_long_autonomous_run_counts_30_minutes(self):
        # A prompt at 0, then Claude works every 5 minutes for two hours.
        activity = {0: HUMAN, **{m: AGENT for m in range(5, 121, 5)}}
        seen, alone = attended(activity, RULES)
        self.assertEqual(seen, set(range(-5, 31)))
        self.assertEqual(alone, set(range(31, 121)))

    def test_a_span_with_no_human_event_is_unattended(self):
        seen, alone = attended({0: AGENT, 10: AGENT}, RULES)
        self.assertEqual(seen, set())
        self.assertEqual(alone, set(range(0, 11)))

    def test_a_later_prompt_restarts_the_cap(self):
        activity = {0: HUMAN, 10: AGENT, 20: AGENT, 30: AGENT, 38: HUMAN, 45: AGENT}
        seen, alone = attended(activity, RULES)
        self.assertEqual(seen, set(range(-5, 31)) | set(range(38, 46)))
        self.assertEqual(alone, set(range(31, 38)))


class AllocateTest(unittest.TestCase):
    def test_parallel_streams_add_up_to_the_wall_clock(self):
        streams = {"a": set(range(0, 60)), "b": set(range(30, 90)), "c": set(range(30, 60))}
        shares, union = allocate(streams)
        self.assertEqual(len(union), 90)
        self.assertAlmostEqual(sum(shares.values()), 90)
        self.assertAlmostEqual(shares["a"], 30 + 10)
        self.assertAlmostEqual(shares["b"], 10 + 30)
        self.assertAlmostEqual(shares["c"], 10)

    def test_nothing_in_nothing_out(self):
        self.assertEqual(allocate({}), ({}, set()))


if __name__ == "__main__":
    unittest.main()
