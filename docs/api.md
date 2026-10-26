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
| `GET /api/shortcut-bookmarks` | Update-enabled Shortcut only: return `{ "ok": true, "choices": { "1. Gym · Song · 6:20": "bookmark-id" } }` for its owner's saves |
| `GET /api/bookmarks` | List private bookmarks |
| `DELETE /api/bookmarks/:bookmarkId` | Delete one bookmark |
| `PATCH /api/bookmarks/:bookmarkId` | Rename one bookmark with JSON `{ "label": "Before the gym" }`; empty label clears the name |
| `GET /api/devices` | List available, unrestricted devices |
| `POST /api/bookmarks/:bookmarkId/resume` | Resume on the active device; optional JSON `{ "deviceId": "chosen-device-id" }` selects an available device |
| `GET /api/shortcut-credentials` | Active credential IDs and creation dates; never secrets |
| `POST /api/shortcut-credentials` | Replace the credential; optional JSON `{ "allowUpdates": true }` grants choice-list/update access; empty body is add-only; return secret once |
| `DELETE /api/shortcut-credentials` | Revoke all Shortcut credentials |
| `POST /api/logout` | End this browser session |
| `POST /api/disconnect` | Remove Spotify tokens, end all sessions, revoke Shortcut access; retain bookmarks |

The authorization start form requires the setup key and origin validation. Its callback validates browser-bound state instead of an existing session.

Every Add capture receives a random UUID `bookmark_id`; repeated adds of the same content create separate rows. Updates retain the chosen ID, name and creation date, replacing only playback metadata/position and advancing the edit date. They can change the source album/playlist/episode. Use the ID returned by save/list responses for all later operations. Migrated rows retain their old `album_SPOTIFY_ID`, `playlist_SPOTIFY_ID`, or `episode_SPOTIFY_ID` IDs even after changing audio; bare album IDs still address migrated album rows. An album ID does not identify new captures. Deleting a migrated slot clears recovery rows using its original ID, regardless of its updated audio.

List rows include `label`, `created_at`, `updated_at`, source context/item metadata, saved position/duration, and optional disc/track numbers. The owner account ID is omitted. `created_at` records initial creation; name/position changes update `updated_at` without changing list order. Labels are optional trimmed strings of at most 120 characters, with session/Origin/CSRF protection. Shortcut credentials cannot rename, delete, resume, list devices, or read full records. `/api/shortcut-bookmarks` exposes only numbered display strings and IDs; numbering makes duplicate names distinct, and clients must use the returned mapping from the same response. Add and update share the 30-per-owner/minute save limit; choice-list access is limited to 30 per owner/minute.

Podcast rows retain `context_type: "episode"` and the episode's `context_id` for identity and links. New rows with show metadata store the parent show's URI in `context_uri` for playback. Older rows with an episode URI resolve the show using Spotify's episode endpoint when resumed; no row rewrite or database migration is needed for this compatibility step.

Podcast Resume sends the show context, exact episode offset, and position together, then makes up to four playback-state checks, spaced by 500 ms plus request latency. Success means Spotify reported the expected episode playing on the requested device at a position consistent with the saved time and elapsed request time. `409 podcast_resume_unconfirmed` means that confirmation was not obtained; playback may still change after the response. Album/playlist success acknowledges the playback request without this extra verification.

## Errors and Shortcuts

Errors have the shape `{ "ok": false, "code": "…", "message": "…", "httpStatus": 409, "requestId": "…" }` with the appropriate HTTP status. The status varies by error. A rate-limit response may include `Retry-After`.

For Add, Update, and Shortcut choice-list requests, `X-Shortcut-Response: notification` returns application errors as HTTP 200, preserving `ok:false` and the original status in `httpStatus`. Check `ok` before reading choices or showing success. Authentication and rate limits still apply; network failures cannot produce a server notification response.

See the [Shortcut guide](shortcut-setup.md) for the complete recipe. Keep credentials in headers, never URLs.
