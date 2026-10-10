"""Time from activity (SPEC.md §6): spans per stream, the unattended cap, and
the split of parallel minutes between streams.

Everything here is pure and works in whole minutes: a minute is an epoch
minute (epoch seconds // 60), an activity map is {minute: flags}.
"""
import bisect

AGENT = 1
HUMAN = 2


class Rules:
    """The settings §6 depends on, in minutes."""

    def __init__(self, idle_gap=15, lead_in=5, max_unattended=30):
        self.idle_gap = max(1, int(idle_gap))
        self.lead_in = max(0, int(lead_in))
        self.max_unattended = max(0, int(max_unattended))


def spans(minutes, rules):
    """Active minutes joined into spans: [(first, last)], inclusive, in order.

    Two active minutes join when the gap between them is at most `idle_gap`
    minutes, so 10:00 and 10:15 are one span with a 15-minute gap.
    """
    out = []
    for m in sorted(minutes):
        if out and m - out[-1][1] <= rules.idle_gap:
            out[-1][1] = m
        else:
            out.append([m, m])
    return [(a, b) for a, b in out]


def attended(activity, rules):
    """Splits a stream's activity into the minutes the user was there for and
    the minutes Claude ran on alone. Returns (attended, unattended), two sets.

    Within a span every minute counts, the quiet ones between events too, as
    long as it is no more than `max_unattended` minutes after the span's last
    human event. A span that opens with a human event also gets `lead_in`
    minutes before it: the prompt is stamped when it was sent, not when the
    user started on it. A span with no human event at all is unattended.
    """
    seen, alone = set(), set()
    for first, last in spans(activity, rules):
        if activity.get(first, 0) & HUMAN:
            seen.update(range(first - rules.lead_in, first))
        last_human = None
        for m in range(first, last + 1):
            if activity.get(m, 0) & HUMAN:
                last_human = m
            if last_human is not None and m - last_human <= rules.max_unattended:
                seen.add(m)
            else:
                alone.add(m)
    return seen, alone - seen


# Shares of a shared minute the stream the user last acted in gets, to each other's one.
FOCUS_WEIGHT = 3


def allocate(streams, focus=None, weight=FOCUS_WEIGHT):
    """Splits each minute between the streams attended in it (§6.3).

    `streams` is {key: set of minutes}. With `focus`, a function from a
    minute to the stream the user last acted in by then (or None), that
    stream gets `weight` shares of a minute it shares and every other stream
    one: the user is mostly where they last typed. Without it, or when the
    stream in focus isn't one of the minute's, the minute is split evenly.

    Returns ({key: minutes, as a float}, the set of minutes any stream was
    attended in). The shares add up to the union either way, so parallel
    sessions never count twice.
    """
    count = {}
    for minutes in streams.values():
        for m in minutes:
            count[m] = count.get(m, 0) + 1
    # The stream in focus in each shared minute, where it is one of the minute's.
    lead = {}
    if focus is not None:
        for m, n in count.items():
            if n > 1:
                k = focus(m)
                if k is not None and m in streams.get(k, ()):
                    lead[m] = k
    shares = {}
    for k, minutes in streams.items():
        total = 0.0
        for m in minutes:
            n = count[m]
            if m in lead:
                total += (weight if lead[m] == k else 1) / (weight + n - 1)
            else:
                total += 1.0 / n
        shares[k] = total
    return shares, set(count)


def focus_from(events):
    """A focus function for allocate from the user's own events: [(minute,
    stream)]. At each minute, the stream of the latest event at or before it."""
    events = sorted(events, key=lambda e: e[0])
    stamps = [m for m, _ in events]

    def focus(m):
        i = bisect.bisect_right(stamps, m) - 1
        return events[i][1] if i >= 0 else None

    return focus
