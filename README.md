# Family Tree

A privacy-first static website for visualizing and managing family trees.
All data is stored in your browser's localStorage — no server, no account required.

## Features

- **List view** with full-text search
- **Tree view** rendered with D3 — select any root person, depth, and mode (descendants or inverted ancestors)
- **Multiple families** — create, import, export, and delete family datasets
- **Person editing** — add/edit names, dates, descriptions, photos, and parent relations
- **JSON import/export** for data portability
- **Sample family** preloaded with adoption, divorce, and remarriage edge cases

## Deployment

This site can be deployed directly to GitHub Pages (Settings → Pages → source: `main` / root).
No build step required.

## Local development

```bash
npx serve .
# or
python3 -m http.server 8080
```

## Documentation

See [docs/architecture.adoc](docs/architecture.adoc) for the full architecture documentation.
