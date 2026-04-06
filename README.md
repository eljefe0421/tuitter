# tuitter

Terminal UI for browsing your X/Twitter bookmarks locally. Powered by [Xtract](https://github.com/eljefe0421/xtract)'s SQLite database — no API credits, no authentication, fully offline.

![tuitter](tuitter.png)

## Features

- Browse **14,500+ bookmarks** in the terminal
- **FTS5 full-text search** across bookmark text, tags, and entities
- **13 AI-generated categories** with browse-by-category
- **Kitty graphics protocol** for inline images (Ghostty, WezTerm, Kitty, Warp)
- **Author profiles** — see all bookmarks from a specific author
- Keyboard-driven: `j/k` navigate, `/` search, `c` categories, `Enter` detail, `p` profile

## Setup

### Prerequisites

- [Bun](https://bun.sh/) installed
- [Xtract](https://github.com/eljefe0421/xtract) with a populated SQLite database at `prisma/dev.db`

### Install & run

```bash
git clone https://github.com/eljefe0421/tuitter.git
cd tuitter
bun install
bun src/index.ts
```

The app looks for the Xtract database at `../xtract/prisma/dev.db` by default. Override with:

```bash
TUITTER_DB_PATH=/path/to/dev.db bun src/index.ts
```

Or set it in `.env`:

```bash
cp .env.example .env
# edit TUITTER_DB_PATH
```

### Optional screen-time limit

Create a `tuitter.conf` file in the directory where you launch `tuitter`:

```ini
MAX_SECONDS=3600
```

When the limit is exceeded, tuitter shows a large red warning banner in the UI.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate up/down |
| `Enter` | Open bookmark detail |
| `p` | View author profile |
| `/` | Search bookmarks |
| `c` | Browse categories |
| `Tab` | Toggle search input / results |
| `q` / `Esc` | Back / quit |

## Architecture

```
src/
  index.ts              Entry point
  config.ts             Configuration (env vars, tuitter.conf)
  db.ts                 SQLite queries via bun:sqlite (read-only)
  types.ts              Shared TypeScript interfaces
  api/
    local-adapter.ts    Maps DB rows → ExpandedPost for views
  ui/
    app.ts              Main app (view stack, key handling)
    theme.ts            Color scheme
    views/
      timeline.ts       Bookmark feed (paginated, category-filtered)
      post-detail.ts    Full bookmark with enrichment metadata
      profile.ts        Author's bookmarks
      search.ts         FTS5 search with results
      category.ts       Category picker
    components/         Reusable UI components
    media/              Kitty graphics protocol for inline images
```

## Forked from

Originally [bddicken/tuitter](https://github.com/bddicken/tuitter) — a Twitter API client. This fork replaces the API layer with local SQLite, making it a zero-cost offline bookmark browser.
