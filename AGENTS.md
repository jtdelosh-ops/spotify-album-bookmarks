# Browser sign-in policy

When changing `harden()` or the Spotify login form in `src/index.ts` and `public/index.html`:

- Keep an origin-only referrer policy that preserves the browser form's `Origin` header. Chromium sends `Origin: null` under `no-referrer`, which breaks the exact-origin CSRF check. `strict-origin` was verified to preserve Origin without sending paths or query strings.
- Keep CSP form navigation limited to `'self'` and `https://accounts.spotify.com`. The same-origin login POST redirects to Spotify; restricting `form-action` to `'self'` blocks that navigation in Chromium.
- Check the real browser path through the 303 redirect when changing these headers or the login flow. Tests that manually supply Origin cannot establish this behavior. Continue rejecting cross-origin form/API mutations.

Evidence: local Chromium reproductions on 20 October 2026 showed the original form returning `403 csrf`, then remaining on the page after the referrer correction with CSP still restricted to self. With `strict-origin` and the exact Spotify form-action origin, the form reached Spotify's login page using a synthetic Client ID. No Spotify sign-in was completed. This rule concerns browser login policy; unrelated bookmark/storage changes do not require repeating the navigation check.

# Production configuration

`npm run deploy` must select `wrangler.production.jsonc`. The PC `wrangler.jsonc` uses the same Worker name with a loopback origin and placeholder database UUID, so publishing that config would replace the hosted settings with development settings. Before changing deployment scripts/configs, check that the production origin and assigned D1 UUID are retained. The verified production command uses `--config wrangler.production.jsonc`; a plain `wrangler deploy` selects the violating PC config. This rule does not add checks for unrelated bookmark or UI changes.

# Copying a live bookmark table

When a migration copies live bookmark rows into a replacement table, pause web/Shortcut saves and deletes, drain in-flight mutations, and keep the pause until the Worker using the new table is active. Compare IDs, tracks, positions, dates, and counts before activation; reconcile any intervening writes first. If writers cannot be paused, use a reviewed maintenance or reconciliation design.

Evidence: `0002_listening_bookmarks.sql` copies once, while the old Worker continues writing `bookmarks`; a successful save after that copy would otherwise be missing or stale in `listening_bookmarks`. A controlled no-writes window preserves the copied state. A same-table additive column migration or an unrelated UI change does not trigger this cross-table-copy rule.

# Podcast playback context

For episode resume in `src/spotify.ts`, use the parent show context with an exact episode URI offset and saved position, then confirm the reported episode/device/playing state/position. Resolve the show from episode metadata for older saved episode URIs. Do not fall back to a bare `uris: [episode]` command or report success solely because Spotify returned 204.

Evidence: live Windows checks on 25 October 2026 showed the bare episode URI returning 204 but clearing playback. Show context plus episode offset resumed two different shows at the requested times, including an older bookmark resolved through metadata. Album/playlist context playback remains valid; unrelated naming or UI changes do not require repeating this live check. Spotify's published play reference does not explicitly guarantee show-context support on every client.

# Paused iPhone capture

When recovering unavailable paused playback, never silently transfer devices and overwrite a bookmark. Require explicit reconnect, show the recovered audio/time, and save that exact temporary snapshot only after confirmation. A `play:false` transfer does not prove preservation of an otherwise unobservable local queue. Keep recovery out of shared normal capture and legacy Bearer grants.

Evidence: on 27 October 2026, both playback reads returned 204 while the iPhone was paused. An explicitly approved transfer exposed the paused item/time once and the owner confirmed preservation, but a later Update still failed after returning to the page. Recapturing on confirmation loses the recovered state; automatic transfer plus overwrite cannot establish the intended audio. Valid reported paused state can still use ordinary Update without recovery. Naming-only changes do not require device reconnection or a new recovery check.
