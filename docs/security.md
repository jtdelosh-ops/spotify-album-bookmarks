# Security and threat model

## Boundaries and protected data

The public static shell contains no user library or credentials. The browser session can read bookmarks and control playback; a Shortcut credential can only save the current track or episode, playing or paused. Spotify access and refresh tokens remain in the Worker/D1 boundary. Cloudflare account access and Worker secrets are trusted administrative controls.

Protected assets include Spotify tokens, bookmark listening history, browser sessions, Shortcut credentials, the private setup key, and the encryption key. Device compromise, a malicious browser extension, a compromised Cloudflare administrator, and upstream Spotify compromise are outside this application's protection boundary.

## Controls

| Threat | Control and relevant implementation |
| --- | --- |
| An outsider claims or links their account | A high-entropy `SETUP_KEY` is required before starting OAuth. The first account is atomically bound to the singleton owner. Later logins must match its immutable `account_id`; ownership is never selected from a request parameter. Keep the key private after setup because it also gates reauthentication. |
| Callback interception, login CSRF, replay | Random 256-bit state and browser-binding cookie; SHA-256 hashes in D1; ten-minute expiry; atomic `DELETE ... RETURNING` consumes valid state once; PKCE S256 with an encrypted verifier and an exact configured redirect. The callback requires the original browser cookie. A failed exchange requires a fresh sign-in. |
| Database-only disclosure | Spotify refresh and cached access tokens use AES-256-GCM with a random 96-bit nonce. Additional authenticated data binds each ciphertext to the immutable account and token type. Verifiers have a separate `oauth` context. The encryption key is a Worker secret, separate from D1 and backups. This protects against a database-only leak, not a Worker/Cloudflare account compromise. |
| Session theft and CSRF | Random session token stored only as a SHA-256 hash; production `__Host-` cookie with Secure, HttpOnly, SameSite=Lax, Path=/; 30-day server expiry. All browser mutations require an exact Origin and session-specific CSRF header. OAuth start uses a same-origin form plus setup key. Reauthorization replaces all web sessions. Explicit loopback-only HTTP uses non-Secure local cookies. |
| Shortcut leakage or abuse | Random 256-bit credential shown once, hash only in D1. Bearer credentials are accepted solely on `POST /api/bookmarks/current`; any supplied Authorization header on other API routes is rejected even with a valid browser cookie. Rotation revokes all previous credentials; explicit revocation and Disconnect are provided. A stolen credential can save/overwrite the current album, playlist, or episode's position and obtain a short item confirmation until revoked, so it is still sensitive. It cannot select arbitrary saved positions or read the shelf. |
| XSS / hostile metadata | DOM textContent constructs metadata; no HTML interpolation. Artwork is restricted to Spotify's HTTPS image host. CSP blocks inline scripts/styles, framing, arbitrary network connections, and object loads. No third-party JavaScript. Metadata names are not trusted as markup. |
| Brute force / excess upstream requests | D1 fixed-window limits: 120 API/auth requests per IP/minute, ten login attempts per IP/ten minutes, 30 saves per owner/minute, 15 resumes per owner/minute, 60 authenticated web API requests per owner/minute. Keys are salted hashes; expired rows are pruned daily. These are application controls, not a complete volumetric DDoS defense; edge protection and hosting quotas remain relevant. |
| Refresh races / reauthorization races | D1 lease serializes refresh across Worker instances. A generation and lease condition gate token writes/deletion, so a stale refresh cannot overwrite a fresh authorization. A held lease returns actionable busy feedback; crashed leases expire after 30 seconds. Upstream requests have ten-second timeouts. |
| Revoked/expired tokens / rate loops | `invalid_grant` discards credentials with a generation guard and prompts reconnect. A player 401 permits one refresh/retry. Spotify 403/404/429 map to fixed messages; `Retry-After` and quota reason are preserved. No background playback polling or automatic retry loop. |
| Accidental logging / caching | All responses use no-store and an origin-only `strict-origin` referrer policy; paths and query strings are not sent in Referer. This also preserves the form's Origin for CSRF enforcement. CSP permits form navigation only to this instance and Spotify's exact authorization origin. Errors expose only fixed messages and a random request ID. Unknown failures log only that ID and an event name. Automatic Worker observability is disabled. Do not log OAuth query strings, full exceptions, headers, bodies, or environment values. Provider-managed metadata and administrative tooling remain external trust boundaries. |

## Administration and retention

- Store keys in a password manager and Cloudflare Worker secrets. Keep `.dev.vars`, `.env`, `.wrangler`, build output, logs, and backups out of Git.
- Rotating the setup key prevents future sign-ins with the old key; it does **not** invalidate existing browser sessions or Shortcut credentials. Use Disconnect or explicit revocation when access may be compromised.
- Disconnect deletes server Spotify credentials, ends all sessions, and revokes Shortcut credentials. It does not revoke the grant at Spotify; also remove app access in Spotify account settings when required.
- Bookmarks remain until individually deleted. OAuth transactions expire in ten minutes, sessions in 30 days; scheduled cleanup removes expired rows daily. Revoked Shortcut audit rows are retained for at most approximately 31 days. The immutable owner binding is retained to prevent an accidental new-account takeover after disconnect.
- To erase all personal data, delete each bookmark while signed in, Disconnect, remove Spotify app authorization, then delete the D1 database/Worker and retained backups using an approved administrative operation. Deleting only server tokens does not delete historical encrypted copies in backups.
- Ownership transfer is deliberately absent. To bind a different Spotify account, use a fresh private instance/database after erasing the previous owner's data. Do not edit just the singleton owner while leaving old tables behind.
- Encryption key rotation requires decrypting and reencrypting rows under a controlled migration, or deleting stored credentials and OAuth transactions and reconnecting. This MVP uses the latter recovery approach; do not overwrite the key and expect existing tokens to decrypt.

## Limits and release checks

Application tests cover SQL behavior, session and callback controls, token rotation/expiry handling, restricted capabilities, and error paths with mocked upstream responses. They do not establish absence of security defects or verify Cloudflare's distributed behavior, Spotify approval, real device control, or iOS shortcut permissions. Complete the manual release plan and independent source review before public deployment.

No automated observability should be enabled until OAuth/request redaction is reviewed. Cloudflare's own request metadata handling cannot be controlled by application code.
