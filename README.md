# Family Tree

A browser-first static website for managing and visualizing family trees.
Core family data stays in the browser, with optional map features that call OpenStreetMap services when you open the map view or geocode missing coordinates.

## Features

- **Multiple families** — create, import, export, and delete separate datasets
- **List view** with full-text search across names and descriptions
- **Tree view** rendered with D3 in three modes: descendants, inverted ancestors, and force layout
- **Map view** for places attached to people, with clustering and cached geocoding
- **Person editing** for names, dates, notes, photos, parents, partnerships, and places
- **JSON and ZIP import/export** for portable backups, including uploaded photos
- **Local photo storage** in IndexedDB
- **Sample family** preloaded on first run

## Privacy and network behavior

- Family data, selected family state, and geocode cache are stored in `localStorage`
- Uploaded photos are stored in `IndexedDB`
- The sample dataset is fetched from `data/sample-family.json` on first run
- The map view loads OpenStreetMap tiles and geocodes place names through Nominatim when coordinates are missing
- Co-located birth-place markers are auto-expanded by default when a cluster has fewer than 9 people

## Local development

```bash
npm ci
npm run build
npx serve .
# or
python3 -m http.server 8080
```

`npm run build` vendors browser dependencies into `js/vendor/`.

## Deployment

The repository includes a GitHub Pages workflow that runs:

```bash
npm ci
npm run build
```

before publishing the site.

If you deploy manually, run the same commands first and publish the repository root.

## Documentation

- Architecture: [docs/architecture.adoc](docs/architecture.adoc)
- Export schema: [data/family-tree.schema.json](data/family-tree.schema.json)
