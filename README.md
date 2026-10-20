# Spotify Album Bookmarks

A personal Cloudflare Worker that saves the music album, track, and position currently playing in Spotify. Save from an iPhone Shortcut without opening a companion app; resume from a small mobile page.

**Status:** local implementation with mocked Spotify integration checks. No deployment or live Spotify/iPhone verification has been performed. See [feasibility](docs/feasibility.md) and [manual validation](docs/manual-test-plan.md) before relying on it.

## Requirements

- Node.js 24 or later and npm. Development packages are pinned in `package-lock.json`; production has no npm runtime dependencies.
- Spotify Premium and a developer app in development mode, with your Spotify account allowlisted. This project is for personal, noncommercial use.
- A Cloudflare account for eventual hosting. Creating resources or deploying is a separate action requiring your approval.

## Local setup

1. Run `npm ci`, then `npm run typecheck` and `npm test`.
2. Copy `.env.example` to `.dev.vars`. Wrangler reads `.dev.vars`; the template name `.env.example` is for documentation.
3. Set `SPOTIFY_CLIENT_ID` to your app's public Client ID. No Spotify client secret is used.
4. Generate two **separate** keys and put each value in the indicated variable. Do not commit them:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   # ENCRYPTION_KEY: AES-256 key, standard base64
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   # SETUP_KEY: private sign-in/bootstrap key, at least 32 characters
   ```

5. Keep `APP_ORIGIN="http://127.0.0.1:8787"` for local use. Add **exactly** `http://127.0.0.1:8787/auth/spotify/callback` to your Spotify app's redirect URIs. `localhost` is not accepted by Spotify.
6. Run `npm run db:local`, then `npm run dev`. The placeholder database UUID is sufficient for a local D1 database.
7. Open `http://127.0.0.1:8787`, enter your setup key, and authorize Spotify. The first successful account becomes the permanent owner of this instance. Later sign-ins require the same Spotify account and the setup key. Reauthorization ends all previous web sessions.

Local HTTP is allowed only on explicit loopback addresses; production requires HTTPS. An iPhone cannot reach the computer's loopback address. Use a reviewed HTTPS deployment for real Shortcut testing.

## How it behaves

- Save requires `is_playing=true`, a Spotify music track with album metadata, and a valid position. Paused tracks, local files, ads, episodes, audiobooks, and absent playback are rejected without overwriting a bookmark.
- One row per owner and album; saving again updates that row. Position is the value Spotify reports, so capture is approximate.
- Resume sends the saved album URI, **track URI offset**, and `position_ms` in one request. This supports disc-two tracks without calculating a track index. No automatic fallback changes playback to an isolated track.
- Resume targets the current active, unrestricted Spotify device. Start playback in Spotify first if no device is active. The service does not launch Spotify, transfer playback, or promise it can wake a closed iPhone app.
- Spotify's shuffle/repeat settings are left as they are. Shuffle may affect tracks played after the bookmarked track. Market relinking, catalog removals, or device restrictions can prevent a saved track from resuming.
- Refresh tokens expire after six months under current Spotify rules. Expiration/revocation prompts reconnection; saved bookmarks remain. Shortcut credentials remain usable after ordinary reauthorization, but are revoked by Disconnect.

## iPhone Shortcut

Follow [the exact setup guide](docs/shortcut-setup.md). Create a credential under **iPhone Shortcut & account** after signing in. The credential can only save current playback. Creating a replacement revokes the old one.

## API

Web mutations require the session cookie, an exact matching `Origin`, and `X-CSRF-Token` from `GET /api/session`. A Shortcut supplies its own Bearer credential only to the save endpoint.

| Method / path | Purpose |
| --- | --- |
| `POST /auth/spotify/start` | Same-origin form with private `setup_key`; begin PKCE |
| `GET /auth/spotify/callback` | One-use, browser-bound Spotify callback |
| `GET /api/session` | Session state, CSRF token, Spotify connection state |
| `POST /api/bookmarks/current` | Read Spotify and upsert current album bookmark |
| `GET /api/bookmarks` | Private bookmark list |
| `DELETE /api/bookmarks/:albumId` | Delete one bookmark |
| `POST /api/bookmarks/:albumId/resume` | Request playback on the active device |
| `GET /api/shortcut-credentials` | Active credential ID/date; never returns its secret |
| `POST /api/shortcut-credentials` | Replace credential; display secret once |
| `DELETE /api/shortcut-credentials` | Revoke all Shortcut credentials |
| `POST /api/logout` | End this browser session |
| `POST /api/disconnect` | Remove Spotify tokens, end all sessions, revoke Shortcut access; retain bookmarks |

Errors use `{ok:false,code,message,httpStatus,requestId}` with appropriate HTTP statuses. Save requests with `X-Shortcut-Response: notification` instead return HTTP 200 for application errors, preserving the original status in `httpStatus`, so the Shortcut can display `message`. Authentication and rate limits still apply. Transport failures cannot produce a server notification response.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
```

Tests execute real application SQL in Node's in-memory SQLite and mock Spotify HTTP. `build` is a Wrangler **dry run**, which bundles the Worker without deploying it. The Node adapter does not prove Cloudflare concurrency or actual Spotify device behavior. Local Wrangler migration and runtime checks complement it; real account/device validation remains required.

## Deployment, operations, and security

Use [the deployment checklist](docs/deployment.md), [threat model](docs/security.md), and [manual test plan](docs/manual-test-plan.md). Unknown errors log only a random request ID and fixed event name. Workers automatic observability is disabled to reduce accidental OAuth URL capture; do not enable request tracing or log full request objects, URLs, headers, or bodies.

## Troubleshooting

- **Sign-in denied / 403:** check Premium, your app's user allowlist, private setup key, exact redirect URI, and requested playback permissions. Sign in with the original owner account.
- **No active device:** open Spotify, start any track on the desired device, then tap Resume.
- **Paused playback:** press Play before Bookmark now or the Shortcut.
- **Reconnect Spotify:** sign in again using the same owner. This preserves bookmarks; six-month token expiry is expected.
- **429:** respect `Retry-After` when present. `spotify_quota` means shared developer quota; its reset time is not inferred. No automatic retry loop is used.
- **`spotify_busy`:** a refresh is in progress; retry once after a short pause.
- **Wrong instance origin:** update `APP_ORIGIN`, use that exact address, and keep Spotify's redirect URI aligned. Never include a trailing slash in `APP_ORIGIN`.
- **Lost encryption key:** existing encrypted tokens cannot be recovered. Follow recovery instructions and reconnect.

No Spotify audio is downloaded, stored, or streamed by this service.
