"""Time from activity (SPEC.md §6): spans per stream, the unattended cap, and
the split of parallel minutes between streams.

Everything here is pure and works in whole minutes: a minute is an epoch
minute (epoch seconds // 60), an activity map is {minute: flags}.
"""

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


def allocate(streams):
    """Splits each minute evenly between the streams attended in it (§6.3).

    `streams` is {key: set of minutes}. Returns ({key: minutes, as a float},
    the set of minutes any stream was attended in). The shares add up to the
    union, so parallel sessions never count twice.
    """
    count = {}
    for minutes in streams.values():
        for m in minutes:
            count[m] = count.get(m, 0) + 1
    shares = {k: sum(1.0 / count[m] for m in minutes) for k, minutes in streams.items()}
    return shares, set(count)
