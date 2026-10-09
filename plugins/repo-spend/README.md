# repo-spend

A bar above the Claude Code prompt that shows what you've spent on the repo you're working in.

```
my-app ≈$1,284.50 to date · today $12.30 · 7d $96.75  │  this session $4.12 · burn $6.30/hr
```

| Field | Meaning |
| --- | --- |
| **to date** | Every Claude Code session ever run in this repo, plus the current one. Sessions in the repo's Claude worktrees (`.claude/worktrees/*`) count toward the main repo |
| **today / 7d** | The same total, limited to today (local time) and to the last 7 days |
| **this session** | The live cost of the current session, the same figure `/cost` shows |
| **burn** | Dollars per hour over the last 30 minutes. Green below $20/hr, amber at $20/hr and above |

The total also counts subagents. The history is re-read every 2 minutes, so other sessions open on the same repo show up too.

Type `/repo-spend` to hide or show the bar.

## Install

```
/plugin install repo-spend --marketplace aseem-upadhyay/claude-mods
```

Type this at the prompt of a terminal session, answer `y`, then pick the **user** scope.

To remove it:

```bash
claude plugin uninstall repo-spend@aseem-mods
```

## Requirements

- Claude Code with mod (hooks module) support
- `python3` 3.9 or newer on your `PATH`. If it's missing, the bar says so and still shows the live session cost
- macOS or Linux. Windows isn't supported yet

## How accurate is it?

| Source | Accuracy |
| --- | --- |
| This session | Exact: it is Claude Code's own figure |
| Past sessions that have a Claude Code `cost-state` record | Exact: Claude Code's own ledger |
| Older past sessions without a ledger | Estimated from each message's token usage × list price, so the total shows **≈** |

The estimates use the list prices in [`hooks/scan.py`](hooks/scan.py) (`PRICES`, dated by `PRICES_UPDATED`). Compared with sessions that do have a ledger, they usually come out a few percent low. Server-side tools such as web search aren't priced.

If a model has no row in the price table, its tokens count as $0. The bar then flags that model in amber (`+ unpriced: <model>`), so you know the total is too low.

Sessions billed through a subscription show what the same usage would cost at API list prices, not what you paid.

## Privacy

- Everything stays on your machine. Nothing is sent over the network.
- It only reads your local session transcripts in `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`).
- It writes one cache file per repo under `~/.cache/claude-repo-spend/`. Delete it at any time; it is rebuilt on the next scan.

## Development

```bash
claude plugin validate plugins/repo-spend
```

```bash
claude plugin test plugins/repo-spend
```

```bash
python3 -m unittest discover -s plugins/repo-spend/tests
```

To run it from a working copy without installing:

```bash
claude --plugin-dir plugins/repo-spend
```

When Anthropic's prices change, edit `PRICES` and `PRICES_UPDATED` in `hooks/scan.py` and raise `version` in `.claude-plugin/plugin.json`. Changing `PRICES_UPDATED` also clears the cache.
