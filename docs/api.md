# API reference

All paths are relative to `APP_ORIGIN`. Application data responses are JSON. Browser mutations require a session cookie, an exact matching `Origin`, and `X-CSRF-Token` obtained from `GET /api/session`.

A Shortcut uses its own Bearer credential only for `POST /api/bookmarks/current`. Supplying that credential does not grant access to other API routes, even alongside a browser cookie.

| Method / path | Purpose |
| --- | --- |
| `POST /auth/spotify/start` | Same-origin form with private `setup_key`; begin PKCE sign-in |
| `GET /auth/spotify/callback` | One-use, browser-bound Spotify callback |
| `GET /api/session` | Session state, CSRF token, and Spotify connection state |
| `POST /api/bookmarks/current` | Add a new independent bookmark for current playback, playing or paused; return its `bookmarkId` and a confirmation message |
| `GET /api/bookmarks` | List private bookmarks |
| `DELETE /api/bookmarks/:bookmarkId` | Delete one bookmark |
| `PATCH /api/bookmarks/:bookmarkId` | Rename one bookmark with JSON `{ "label": "Before the gym" }`; empty label clears the name |
| `GET /api/devices` | List available, unrestricted devices |
| `POST /api/bookmarks/:bookmarkId/resume` | Resume on the active device; optional JSON `{ "deviceId": "chosen-device-id" }` selects an available device |
| `GET /api/shortcut-credentials` | Active credential IDs and creation dates; never secrets |
| `POST /api/shortcut-credentials` | Replace the credential; return its secret once |
| `DELETE /api/shortcut-credentials` | Revoke all Shortcut credentials |
| `POST /api/logout` | End this browser session |
| `POST /api/disconnect` | Remove Spotify tokens, end all sessions, revoke Shortcut access; retain bookmarks |

The authorization start form requires the setup key and origin validation. Its callback validates browser-bound state instead of an existing session.

Every new capture receives a random UUID `bookmark_id`; repeated saves of the same content create separate rows. Use the ID returned by save/list responses for all later operations. Migrated rows retain their old `album_SPOTIFY_ID`, `playlist_SPOTIFY_ID`, or `episode_SPOTIFY_ID` IDs; bare album IDs still address migrated album rows. An album ID does not identify new captures.

List rows include `label`, `created_at`, `updated_at`, source context/item metadata, saved position/duration, and optional disc/track numbers. The owner account ID is omitted. `created_at` is the saved moment's capture date; renaming updates `updated_at` but never changes the position or list order. Labels are optional trimmed strings of at most 120 characters, with session/Origin/CSRF protection. Shortcut credentials cannot rename or otherwise mutate an existing bookmark.

Podcast rows retain `context_type: "episode"` and the episode's `context_id` for identity and links. New rows with show metadata store the parent show's URI in `context_uri` for playback. Older rows with an episode URI resolve the show using Spotify's episode endpoint when resumed; no row rewrite or database migration is needed for this compatibility step.

Podcast Resume sends the show context, exact episode offset, and position together, then makes up to four playback-state checks, spaced by 500 ms plus request latency. Success means Spotify reported the expected episode playing on the requested device at a position consistent with the saved time and elapsed request time. `409 podcast_resume_unconfirmed` means that confirmation was not obtained; playback may still change after the response. Album/playlist success acknowledges the playback request without this extra verification.

## Errors and Shortcuts

Errors have the shape `{ "ok": false, "code": "…", "message": "…", "httpStatus": 409, "requestId": "…" }` with the appropriate HTTP status. The status varies by error. A rate-limit response may include `Retry-After`.

For save requests only, `X-Shortcut-Response: notification` returns application errors as HTTP 200, preserving `ok:false` and the original status in `httpStatus`. This lets a later Shortcut action display `message`. Authentication and rate limits still apply; network failures cannot produce a server notification response.

See the [Shortcut guide](shortcut-setup.md) for the complete recipe. Keep credentials in headers, never URLs.
