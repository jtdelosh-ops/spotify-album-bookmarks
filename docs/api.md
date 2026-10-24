# API reference

All paths are relative to `APP_ORIGIN`. Application data responses are JSON. Browser mutations require a session cookie, an exact matching `Origin`, and `X-CSRF-Token` obtained from `GET /api/session`.

A Shortcut uses its own Bearer credential only for `POST /api/bookmarks/current`. Supplying that credential does not grant access to other API routes, even alongside a browser cookie.

| Method / path | Purpose |
| --- | --- |
| `POST /auth/spotify/start` | Same-origin form with private `setup_key`; begin PKCE sign-in |
| `GET /auth/spotify/callback` | One-use, browser-bound Spotify callback |
| `GET /api/session` | Session state, CSRF token, and Spotify connection state |
| `POST /api/bookmarks/current` | Save current playback, playing or paused; update only that album, playlist, or episode |
| `GET /api/bookmarks` | List private bookmarks |
| `DELETE /api/bookmarks/:bookmarkId` | Delete one bookmark |
| `GET /api/devices` | List available, unrestricted devices |
| `POST /api/bookmarks/:bookmarkId/resume` | Resume on the active device; optional JSON `{ "deviceId": "chosen-device-id" }` selects an available device |
| `GET /api/shortcut-credentials` | Active credential IDs and creation dates; never secrets |
| `POST /api/shortcut-credentials` | Replace the credential; return its secret once |
| `DELETE /api/shortcut-credentials` | Revoke all Shortcut credentials |
| `POST /api/logout` | End this browser session |
| `POST /api/disconnect` | Remove Spotify tokens, end all sessions, revoke Shortcut access; retain bookmarks |

The authorization start form requires the setup key and origin validation. Its callback validates browser-bound state instead of an existing session.

Bookmark IDs have the form `album_SPOTIFY_ID`, `playlist_SPOTIFY_ID`, or `episode_SPOTIFY_ID`. Use the `bookmark_id` returned by the list endpoint. Bare album IDs remain accepted for old album Resume/Delete URLs. List rows use `context_type`, `context_id`, `context_name`, `context_uri`, `item_id`, `item_name`, `item_uri`, `image_url`, `creator_name`, saved position/duration, and optional disc/track numbers. The owner account ID is omitted.

## Errors and Shortcuts

Errors have the shape `{ "ok": false, "code": "…", "message": "…", "httpStatus": 409, "requestId": "…" }` with the appropriate HTTP status. The status varies by error. A rate-limit response may include `Retry-After`.

For save requests only, `X-Shortcut-Response: notification` returns application errors as HTTP 200, preserving `ok:false` and the original status in `httpStatus`. This lets a later Shortcut action display `message`. Authentication and rate limits still apply; network failures cannot produce a server notification response.

See the [Shortcut guide](shortcut-setup.md) for the complete recipe. Keep credentials in headers, never URLs.
