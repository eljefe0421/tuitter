# tuitter

`tuitter` is a terminal UI client for X (Twitter) built with TypeScript and OpenTUI.  
It lets you authenticate with your own X account and browse or interact with content directly from the terminal.

![tuitter](tuitter.png)

## Download, install, and run

### Prerequisites

- [Bun](https://bun.sh/) installed
- An X developer app with OAuth 2.0 credentials (see the section below)

### 1) Clone and install dependencies

```bash
git clone https://github.com/<your-org-or-username>/tuitter.git
cd tuitter
bun install
```

### 2) Create your local env file

```bash
cp .env.example .env
```

Then set at least:

- `X_CLIENT_ID` (required)

Optional:

- `X_CLIENT_SECRET`
- `X_REDIRECT_URI` (defaults to `http://127.0.0.1:8787/callback`)
- `X_OAUTH_SCOPES`
- `X_TOKEN_STORE_PATH`
- `X_IMAGE_MODE` (`auto`, `kitty`, or `off`)

### Optional screen-time limit

Create a `tuitter.conf` file in the directory where you launch `tuitter`:

```ini
MAX_SECONDS=3600
```

- `MAX_SECONDS` sets your maximum allowed usage per day.
- Daily usage is tracked in a local `.tuitter` state file in that same directory.
- When the limit is exceeded, tuitter shows a large red warning banner in the UI.

Quick use:

1. Add `MAX_SECONDS=<seconds>` to `tuitter.conf` (example: `MAX_SECONDS=1800` for 30 minutes/day).
2. Start `tuitter` from that same directory.
3. When you hit the limit, tuitter blocks usage until the next day.

### 3) Link and start the app

```bash
bun link
tuitter
```

On first launch, the app opens your browser for OAuth authorization and then stores your token locally (default: `~/.tuitter/oauth-token.json`).

## Create your own `.env` variables from console.x.com

Use these steps so anyone can run this project with their own X developer app:

1. Go to [console.x.com](https://console.x.com/) and sign in.
2. Create a new Project/App (or open an existing app).
3. In the app settings, enable OAuth 2.0.
4. Set the callback/redirect URL to:
   - `http://127.0.0.1:8787/callback`
5. Copy the **Client ID** into:
   - `X_CLIENT_ID=...`
6. If your app is configured as a confidential client, also copy the **Client Secret** into:
   - `X_CLIENT_SECRET=...`
7. (Optional) Configure scopes. The app defaults to:
   - `tweet.read users.read tweet.write like.write like.read bookmark.write bookmark.read offline.access`
8. Save your `.env` and run `tuitter` again.

If OAuth fails, verify that the callback URL in `console.x.com` exactly matches `X_REDIRECT_URI` in your `.env`.
