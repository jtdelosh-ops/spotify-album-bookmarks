# API reference

All paths are relative to `APP_ORIGIN`. Application data responses are JSON. Browser mutations require a session cookie, an exact matching `Origin`, and `X-CSRF-Token` obtained from `GET /api/session`.

A Shortcut uses its own Bearer credential. All credentials can add current playback; only credentials explicitly created with update access can list choices and update an existing slot. Supplying a Bearer header never falls back to a browser cookie or grants other browser capabilities.

| Method / path | Purpose |
| --- | --- |
| `POST /auth/spotify/start` | Same-origin form with private `setup_key`; begin PKCE sign-in |
| `GET /auth/spotify/callback` | One-use, browser-bound Spotify callback |
| `GET /api/session` | Session state, CSRF token, and Spotify connection state |
| `POST /api/bookmarks/current` | Add a new independent bookmark for current playback, playing or paused; return its `bookmarkId` and a confirmation message |
| `POST /api/bookmarks/:bookmarkId/update` | Replace one slot's audio/position from current playing or paused playback; browser session/Origin/CSRF or update-enabled Shortcut credential |
| `POST /api/bookmarks/:bookmarkId/recover-paused` | Browser-only: start a temporary paused capture with JSON `{ "captureId": "client-generated-v4-uuid", "seenDeviceIds": [], "deviceId": "optional-exact-phone" }`; return 202; does not update a bookmark |
| `GET /api/update-captures/:captureId` | Same browser session: read waiting/ready/failed/cancelled/confirmed status; ready includes preview and confirmed phone |
| `POST /api/update-captures/:captureId/confirm` | Save the displayed capture to its original slot if the slot is unchanged; no Spotify reread |
| `POST /api/update-captures/:captureId/cancel` | Cancel pending/ready recovery and discard its audio snapshot |
| `POST /api/bookmarks/:bookmarkId/update-on-phone` | Browser-only automatic playing/paused update; same captureId/deviceId/seenDeviceIds shape as recovery, returns202 and commits its snapshot automatically; poll existing update-captures status |
| `GET /api/shortcut-bookmarks` | Update-enabled Shortcut only: return `{ "ok": true, "choices": { "1. Gym · Song · 6:20": "bookmark-id" } }` for its owner's saves |
| `GET /api/bookmarks` | List private bookmarks |
| `DELETE /api/bookmarks/:bookmarkId` | Delete one bookmark |
| `PATCH /api/bookmarks/:bookmarkId` | Rename one bookmark with JSON `{ "label": "Before the gym" }`; empty label clears the name |
| `GET /api/devices` | List available, unrestricted devices |
| `POST /api/bookmarks/:bookmarkId/resume` | Resume on the active device; optional JSON `{ "deviceId": "chosen-device-id" }` selects an available device |
| `POST /api/bookmarks/:bookmarkId/resume-on-phone` | Browser-only: JSON `{ "seenDeviceIds": ["id"], "deviceId": "optional-remembered-phone" }`; briefly wait for the chosen/new phone, resume and confirm; return `phone: { id, name }` |
| `GET /api/shortcut-credentials` | Active credential IDs and creation dates; never secrets |
| `POST /api/shortcut-credentials` | Replace the credential; optional JSON `{ "allowUpdates": true }` grants choice-list/update access; empty body is add-only; return secret once |
| `DELETE /api/shortcut-credentials` | Revoke all Shortcut credentials |
| `POST /api/logout` | End this browser session |
| `POST /api/disconnect` | Remove Spotify tokens, end all sessions, revoke Shortcut access; retain bookmarks |

The authorization start form requires the setup key and origin validation. Its callback validates browser-bound state instead of an existing session.

The phone route shares the 15-per-owner/minute resume limit and requires session/Origin/CSRF; no Bearer credential can call it. With `deviceId`, it waits for that exact ID and rejects a restricted/non-phone device. Without it, only a smartphone absent from the supplied fresh device snapshot can be selected; more than one is an error. The client opens the saved Spotify URI with a real user click and sends the request using fetch keepalive. The Worker registers the same bounded promise with `waitUntil` to survive a backgrounded/disconnected Safari request. It rechecks that the bookmark was not deleted or moved while waiting, then confirms item/device/position/playing state. Provider delays can still make the outcome unconfirmed. No database job, recurring poll, permission expansion, or bookmark write is involved.

Shortcut credential APIs are retained for legacy API clients; the website no longer exposes credential setup controls. The normal iPhone flow uses the browser session and needs no Shortcut key.

The legacy manual recovery API is separate from normal Update and phone Resume. It requires browser authentication; Bearer credentials are rejected even alongside a valid browser cookie. Start is limited to five requests per owner/minute. A capture ID is idempotent within its original session and slot, preventing a retried start from repeating the reconnect. The Worker checks for an exact known or single newly appearing, visible, unrestricted smartphone, rejects another active device or playing state, and may send one transfer with `play:false`. It then requires a valid paused position on that exact phone. It never calls Play. Provider work is bounded to about 25 seconds (up to nine device checks, with a roughly 16-second discovery deadline).

The recovered snapshot is encrypted with session-bound authenticated data and expires after five minutes. GET exposes the captured title, creator, context, position, duration, capture time and phone, not tokens. Confirm uses that stored snapshot in a database transaction; it rejects a changed/deleted slot and preserves its ID, name and creation date. Repeated confirmation is harmless. Cancel/confirm clear the snapshot; expired rows are removed by daily cleanup or a subsequent start. Recovery never writes a bookmark before confirmation. A cancellation can stop pending work, but cannot undo a reconnect already sent to Spotify. The legacy manual endpoints retain their preview/confirmation protocol. The website instead uses the automatic route described below.

Every Add capture receives a random UUID `bookmark_id`; repeated adds of the same content create separate rows. Updates retain the chosen ID, name and creation date, replacing only playback metadata/position and advancing the edit date. They can change the source album/playlist/episode. Use the ID returned by save/list responses for all later operations. Migrated rows retain their old `album_SPOTIFY_ID`, `playlist_SPOTIFY_ID`, or `episode_SPOTIFY_ID` IDs even after changing audio; bare album IDs still address migrated album rows. An album ID does not identify new captures. Deleting a migrated slot clears recovery rows using its original ID, regardless of its updated audio.

List rows include `label`, `created_at`, `updated_at`, source context/item metadata, saved position/duration, and optional disc/track numbers. The owner account ID is omitted. `created_at` records initial creation; name/position changes update `updated_at` without changing list order. Labels are optional trimmed strings of at most 120 characters, with session/Origin/CSRF protection. Shortcut credentials cannot rename, delete, resume, list devices, or read full records. `/api/shortcut-bookmarks` exposes only numbered display strings and IDs; numbering makes duplicate names distinct, and clients must use the returned mapping from the same response. Add and update share the 30-per-owner/minute save limit; choice-list access is limited to 30 per owner/minute.

Podcast rows retain `context_type: "episode"` and the episode's `context_id` for identity and links. New rows with show metadata store the parent show's URI in `context_uri` for playback. Older rows with an episode URI resolve the show using Spotify's episode endpoint when resumed; no row rewrite or database migration is needed for this compatibility step.

Podcast Resume sends the show context, exact episode offset, and position together, then makes up to four playback-state checks, spaced by 500 ms plus request latency. Success means Spotify reported the expected episode playing on the requested device at a position consistent with the saved time and elapsed request time. `409 podcast_resume_unconfirmed` means that confirmation was not obtained; playback may still change after the response. For albums/playlists, ordinary `/resume` success acknowledges the playback request. The `/resume-on-phone` route additionally makes up to three playback-state checks and requires the saved item, phone, playing state, and position to match before confirming success.

## Errors and Shortcuts

Errors have the shape `{ "ok": false, "code": "…", "message": "…", "httpStatus": 409, "requestId": "…" }` with the appropriate HTTP status. The status varies by error. A rate-limit response may include `Retry-After`.

For Add, Update, and Shortcut choice-list requests, `X-Shortcut-Response: notification` returns application errors as HTTP 200, preserving `ok:false` and the original status in `httpStatus`. Check `ok` before reading choices or showing success. Authentication and rate limits still apply; network failures cannot produce a server notification response.

These notification envelopes support existing API clients. The [Home Screen guide](shortcut-setup.md) describes a simple website launcher, which needs no API credential. Keep legacy API credentials in headers, never URLs.

## Automatic iPhone update

The website has one Update position action. `/update-on-phone` first captures supported playing or paused state already reported by Spotify, without transfer. If unavailable, it targets the exact remembered phone or one uniquely visible smartphone, rejects other active devices, and may reconnect once with play:false. Newly recovered state must be valid and paused on that phone; a playing state that becomes available without transfer is also valid. The stored snapshot is committed automatically using the existing transaction and stale-slot guard. A confirmed job means the save completed, not a request for another client confirmation. The browser never calls the manual confirm endpoint. Old manual previews are not auto-confirmed.

Jobs are browser-session-bound, idempotent by captureId, and subject to the30/minute shared save limit. Origin/CSRF and Bearer denial apply. No new scope or Play command is introduced. The user explicitly requested automatic saving; queue changes are disclosed in the page hint, and there is no guarantee a previously unobservable local queue was preserved. Failed or missing state keeps the earlier bookmark.
