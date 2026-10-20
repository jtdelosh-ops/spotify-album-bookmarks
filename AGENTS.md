# Browser sign-in policy

When changing `harden()` or the Spotify login form in `src/index.ts` and `public/index.html`:

- Keep an origin-only referrer policy that preserves the browser form's `Origin` header. Chromium sends `Origin: null` under `no-referrer`, which breaks the exact-origin CSRF check. `strict-origin` was verified to preserve Origin without sending paths or query strings.
- Keep CSP form navigation limited to `'self'` and `https://accounts.spotify.com`. The same-origin login POST redirects to Spotify; restricting `form-action` to `'self'` blocks that navigation in Chromium.
- Check the real browser path through the 303 redirect when changing these headers or the login flow. Tests that manually supply Origin cannot establish this behavior. Continue rejecting cross-origin form/API mutations.

Evidence: local Chromium reproductions on 20 October 2026 showed the original form returning `403 csrf`, then remaining on the page after the referrer correction with CSP still restricted to self. With `strict-origin` and the exact Spotify form-action origin, the form reached Spotify's login page using a synthetic Client ID. No Spotify sign-in was completed. This rule concerns browser login policy; unrelated bookmark/storage changes do not require repeating the navigation check.
