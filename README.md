# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small plugins that add live UI and hooks to your sessions.

| Mod | What it does |
| --- | --- |
| [repo-spend](plugins/repo-spend) | A bar above the prompt showing what you've spent on the current repo to date, and this session's live spend and burn rate |

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install repo-spend --marketplace aseem-upadhyay/claude-mods
```

Answer `y` to add the marketplace, then choose the **user** scope so the mod loads in every session.

Installing from a terminal also makes the mod load in the desktop app's Code tab.

To update later:

```bash
claude plugin marketplace update aseem-mods
```

## Layout

```
.claude-plugin/marketplace.json   lists every mod in this repo
plugins/<mod>/                    one folder per mod, each a self-contained plugin
```

## License

[MIT](LICENSE)
