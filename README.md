# Spotify Album Bookmarks

**Add a save point for any moment in your Spotify listening.**

A small, self-hosted app for keeping independent save points, like video game saves, across music and podcasts. Tap **Add bookmark** or run your iPhone Shortcut while Spotify is playing or paused. Every save creates a new entry. Later, open your shelf and tap **Resume** on the one you want.

For example: save **Before the gym** and **Evening listening** in the same album, plus a podcast at **23:45**. Add another bookmark whenever you like; previous saves stay unchanged. Each entry can have an optional name, and its own Resume and Delete actions.

This is a personal app for **one Spotify account per deployment**. You host your own copy and connect your own Spotify developer app. It is independent of Spotify.

## What you get

- A flat, mobile-friendly shelf with independent bookmarks, optional names, saved times, and Resume/Delete actions.
- An iPhone Shortcut to save current playback from the Home Screen or a widget.
- Resume on your active Spotify player, or choose a computer, phone, or speaker under **Where to play**.
- Album/playlist resume supplies the original context, saved track, and time together. Episode resume requests the saved episode at its saved time.
- Private bookmarks stored in your own Cloudflare Worker and D1 database.

**Saving is manual.** The app does not continuously track your listening or pause Spotify when you bookmark. It does not download or stream audio; playback stays in Spotify.

## How it works

```mermaid
flowchart LR
    A[Web page or iPhone Shortcut] -->|Save| B[Cloudflare Worker]
    B -->|Read current track and position| C[Spotify Web API]
    B -->|Insert a new save point| D[(Cloudflare D1)]
    E[Web page: Resume] -->|Read saved bookmark| B
    B -->|Resume saved item and position| C
    C --> F[Your Spotify device]
```

On save, the Worker reads Spotify's current playback state, including paused state, and gives the new bookmark a random ID. It never uses an album, playlist, or episode ID to decide whether to overwrite a save. Several bookmarks can point to the exact same item or moment.

Source details are retained to resume the right audio: music records its album/playlist context and track, while podcasts record the episode. After adding a bookmark, use **Name** or **Rename** to give it an optional label of up to 120 characters. Renaming changes only the label, not its audio, timestamp, or place in the list. Clearing the label restores the automatic item/time title.

For music, resume sends the album/playlist URI, track URI offset, and saved time together. Using the track URI supports multi-disc albums. For a podcast, it sends the episode URI and position. Spotify's published play reference documents track URIs rather than episode URIs in the `uris` list, so episode playback needs a check on your actual client; an accepted command alone is not proof of playback. [Playback API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback).

Playlist names are fetched when Spotify permits it. If metadata is unavailable, the app keeps a previously known name or shows a stable label such as **Playlist abc123**. Saving the position does not require extra playlist permissions.

Spotify sign-in uses PKCE and requests `user-read-playback-state` and `user-modify-playback-state`. No Spotify client secret is needed.

## Requirements

- **Spotify Premium**, required by Spotify's [playback-control endpoint](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback).
- Your own [Spotify developer app](https://developer.spotify.com/dashboard) with Web API access and your account permitted to use it. App eligibility and development limits follow Spotify's [current quota-mode rules](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
- **Node.js 24 or later**, npm, and Git for local development.
- A **Cloudflare account** with Workers and D1 access for hosting. Check your plan's limits and usage; this project does not guarantee free hosting.
- An iPhone with Apple's Shortcuts app for one-tap saving. The web page can save without a Shortcut.

## Run locally

### 1. Get the project

```sh
git clone https://github.com/jtdelosh-ops/spotify-album-bookmarks.git
cd spotify-album-bookmarks
npm ci
cp .env.example .dev.vars
```

In Windows PowerShell, `Copy-Item .env.example .dev.vars` also works.

### 2. Configure Spotify and your keys

Add this exact redirect URI to your Spotify developer app:

```text
http://127.0.0.1:8787/auth/spotify/callback
```

Spotify allows HTTP for explicit loopback IPs but does not accept `localhost` as a redirect URI. See its [redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

Edit `.dev.vars`:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `http://127.0.0.1:8787`, no trailing slash |
| `SPOTIFY_CLIENT_ID` | Your app's public Client ID |
| `ENCRYPTION_KEY` | A new 32-byte key in standard base64 |
| `SETUP_KEY` | A separate random key for signing in to your instance |

Generate the keys separately:

```sh
# ENCRYPTION_KEY
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# SETUP_KEY
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Keep both private and recoverable. `.dev.vars` is ignored by Git. Enter the **setup key** on the sign-in page; the **encryption key** stays on the server and is never entered on that page.

### 3. Start the app

```sh
npm run db:local
npm run dev
```

Open [127.0.0.1:8787](http://127.0.0.1:8787), enter your setup key, and authorize Spotify. The first account to complete sign-in becomes the owner. Later sign-ins require that same account and the setup key. Reconnecting ends existing browser sessions and preserves bookmarks.

Open a music track or podcast episode, playing or paused, and tap **Add bookmark**. To resume, use the active player or tap **Refresh devices**, select a device under **Where to play**, and tap **Resume** on a bookmark. Choosing another device may move playback there.

Your iPhone cannot use the computer's loopback address. Deploy an HTTPS instance before setting up the real Shortcut.

## Host your own copy

Follow the [deployment guide](docs/deployment.md) for database creation, secrets, and the Spotify HTTPS callback.

Start with **[`wrangler.production.example.jsonc`](wrangler.production.example.jsonc)** and enter your own account, database, hostname, and Client ID. The checked-in `wrangler.production.jsonc` identifies the original deployment; it is not a configuration for someone else's account. `npm run deploy` uses that production file, so configure it before deploying.

The guide also covers updates, backups, and key recovery.

## Set up the iPhone Shortcut

After signing in to your hosted page:

1. Expand **iPhone Shortcut & account**, choose **Create / replace Shortcut credential**, and copy the value shown once.
2. In Shortcuts, create **Bookmark listening**. Add **Get Contents of URL** for `https://YOUR_HOST/api/bookmarks/current`.
3. Set method **POST**, an empty JSON body, and these headers:

   | Header | Value |
   | --- | --- |
   | `Authorization` | `Bearer YOUR_SHORTCUT_CREDENTIAL` |
   | `X-Shortcut-Response` | `notification` |
   | `Content-Type` | `application/json` |

4. Get the response dictionary's **message** value and pass it to **Show Notification**.
5. Run once with music or a podcast open in Spotify, playing or paused, allow the requested permissions, and add the Shortcut to your Home Screen or widget. Existing Shortcuts keep their URL, headers, and credential.

The [full Shortcut guide](docs/shortcut-setup.md) covers each action, examples, and revocation. This repository provides a manual recipe, not an importable `.shortcut` file.

The Shortcut credential is separate from the setup key. It can **only add a bookmark for current playback**, not read, rename, delete, or overwrite existing saves, or control playback. Replacing it invalidates the old credential; update the Shortcut afterward. Do not share a Shortcut containing your credential.

## Behavior and limitations

- **Playing and paused saves are supported.** Spotify must still report a supported track/episode and a valid position. Closed/offline devices may return no state. Missing data, local files, ads, and audiobook chapters are rejected without overwriting a bookmark.
- **Every save adds an entry.** Repeated taps or Shortcut runs create separate bookmarks, even for the same item. There is no automatic replacement or progress tracking. Delete entries you no longer need.
- **Timing is approximate.** Capture uses Spotify's reported position; network and device delays affect capture and resume.
- **Devices must be available to Spotify.** Explicit selection can target an available idle device, but cannot guarantee waking a closed app or reaching an offline device.
- **Shuffle and repeat stay as you set them.** Shuffle can change which track follows the bookmarked one.
- **Availability can change.** Removed/relinked tracks, regional restrictions, and restricted devices can prevent resume.
- **Reconnection may be needed.** If Spotify authorization expires or is revoked, reconnect with the original owner. Bookmarks remain.
- **One owner per instance.** There is no account switching or ownership-transfer interface. Use a separate instance/database for another account.

## Privacy and security

Spotify access and refresh tokens stay on the server, encrypted in D1 with AES-256-GCM. Bookmark metadata and positions are stored in D1; they are not encrypted by the application. Browser sessions use HttpOnly cookies, and mutations require origin and CSRF checks. Shortcut credentials are hashed and revocable.

**Disconnect Spotify** removes stored Spotify credentials, ends browser sessions, and revokes Shortcut access. It retains bookmarks and the owner binding. To revoke Spotify's grant itself, also remove the app in Spotify's account app-access settings.

Never commit `.dev.vars`, `.env.production`, database exports, or populated Shortcut files. The [security guide](docs/security.md) explains retention, recovery, and trust boundaries.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| No active device, even though Spotify is open | **Refresh devices**, choose the intended device under **Where to play**, then Resume. If absent, open Spotify there and refresh. |
| Nothing saves | Open a supported track or podcast episode using the connected account. Playing or paused is fine; Spotify must still report its position. |
| Sign-in fails | Check the setup key, original owner account, app access, and exact callback. Both playback permissions are required. |
| Reconnect requested | Authorize the same account again. Your bookmarks remain. |
| Shortcut stopped after replacing its credential | Update the Authorization header. Include `Bearer` followed by one space and the new credential. |
| Rate limit or quota error | Respect `Retry-After` if provided. Repeated attempts do not fix quota exhaustion. |
| `spotify_busy` | Credential refresh is in progress. Try again after a short pause. |
| Lost encryption key | Follow the [recovery procedure](docs/deployment.md#lost-key-or-token-compromise-recovery), then reconnect. Existing encrypted credentials cannot be recovered without their key. |

## Development

TypeScript Worker, plain HTML/CSS/JavaScript, and D1 SQL. No frontend framework or npm runtime dependencies.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run locally at `127.0.0.1:8787` |
| `npm run db:local` | Apply local D1 migrations |
| `npm run typecheck` | Check TypeScript |
| `npm test` | Run Node tests with in-memory SQLite and mocked Spotify responses |
| `npm run build` | Bundle a dry run; does not publish |
| `npm run deploy` | Publish using `wrangler.production.jsonc` |

| Location | Contents |
| --- | --- |
| `src/index.ts` | Routes, owner/session checks, bookmarks, and device selection |
| `src/spotify.ts` | Spotify requests, token refresh, automatic context selection, and resume payload |
| `src/crypto.ts` | Encryption, credential generation, and hashing |
| `public/` | Web interface |
| `migrations/` | D1 database schema |
| `tests/` | Application tests; not a substitute for real device checks |
| `docs/` | Deployment, Shortcut instructions, security, and verification |

See the [API reference](docs/api.md) for integration details and the [manual verification plan](docs/manual-test-plan.md) before a release. The original instance has completed sign-in, bookmark capture, and explicit desktop playback checks. A complete physical iPhone/device matrix has not been independently verified.

Pull requests and pushes to `main` run **Typecheck and build** in GitHub Actions. This checks compilation and Worker packaging; it does not run the application test suite, use Spotify credentials, or deploy to Cloudflare.
