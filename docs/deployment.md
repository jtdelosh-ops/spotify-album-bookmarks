# Deployment and operations checklist

Nothing in this checklist has been run against Cloudflare remotely. Resource creation, remote migration, secrets changes, and public deployment require approval of the concrete target configuration. Local `--dry-run` and `--local` commands do not publish this service.

## Prepare a reviewable configuration

- [ ] Confirm the intended Cloudflare account, available plan/limits, Worker name, D1 database name, and exact HTTPS origin. This project does not guarantee zero cost.
- [ ] Confirm the intended Spotify Client ID and user allowlist; avoid changing an unrelated app. Register `https://YOUR_HOST/auth/spotify/callback` exactly.
- [ ] In `wrangler.jsonc`, set `APP_ORIGIN` without a trailing slash and set `SPOTIFY_CLIENT_ID`. The Client ID is public. Choose a final hostname in advance; changing it requires updating Spotify's redirect URI and signing in again.
- [ ] Generate separate production `ENCRYPTION_KEY` and `SETUP_KEY` as in README. Keep recoverable copies in a password manager. Do not reuse local keys.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. Check the source review and remaining live validation limits.
- [ ] Approve resource creation and deployment against these names and this configuration.

## Commands after approval

```sh
npx wrangler login
npx wrangler d1 create spotify-album-bookmarks
```

Copy the returned UUID into `d1_databases[0].database_id` in `wrangler.jsonc`; verify the Cloudflare account before continuing. Then:

```sh
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put SETUP_KEY
npm run deploy
```

Paste secrets interactively. Do not place them on command lines, in chat, or in configuration committed to Git. Wrangler's remote migration can change a real database: review the account, target, and migration list before confirming.

The first `wrangler secret put` can provision an undeployed Worker if none exists; it is included only in the approved deployment stage. For a custom domain, configure that exact domain in Cloudflare, verify it routes to this Worker, and set `APP_ORIGIN` to it before testing OAuth. The default workers.dev address must exactly match its configured origin if used.

## Verify after publishing

- [ ] Confirm all static/API responses include CSP, no-store, the origin-only `strict-origin` referrer policy, and nosniff; HTTPS session cookies are Secure/HttpOnly/SameSite=Lax. Verify a real browser form reaches Spotify's authorization page: the CSP must permit Spotify's exact origin, and the referrer policy must preserve the form's Origin for CSRF validation.
- [ ] A signed-out browser cannot list bookmarks. The sign-in shell is public; the private setup key gates account linking.
- [ ] Complete OAuth with the original owner and verify both playback scopes and returned `account_id`.
- [ ] Complete [the iPhone test plan](manual-test-plan.md), including notification mode, timestamp accuracy, multi-disc resume, revoked credentials, and unavailable devices.
- [ ] Verify the daily cleanup trigger runs. It prunes expired sessions, OAuth states, application-rate rows, and old revoked Shortcut credentials. It never polls Spotify.
- [ ] Keep automatic Worker observability disabled until request URL redaction is reviewed. Default `console.error` output has only event/request ID. Never tail full OAuth requests or copy token-bearing tool output.

## Backup and restore

Store backups in an access-controlled encrypted location outside the public assets directory and Git. D1 exports contain private bookmarks, encrypted Spotify tokens, hashed session/Shortcut credentials, and metadata; keep the Worker encryption key separate. Treat backups as sensitive even though Spotify tokens are encrypted.

After approval, a manual export can use:

```sh
npx wrangler d1 export DB --remote --output=backups/album-bookmarks.sql
```

Create the ignored `backups/` directory first. Choose a backup retention policy; no recurring export or storage service is provisioned by this project. Review Cloudflare's current backup/Time Travel capabilities and retention for the chosen plan rather than assuming a guaranteed recovery window.

Restore into a **new empty approved D1 database**, never over a populated one. Import the export with `wrangler d1 execute NEW_DATABASE_NAME --remote --file=backups/album-bookmarks.sql`, point a reviewed Worker configuration to the new UUID, retain the matching encryption key, and validate record counts. Before exposing the restored instance, clear `sessions`, `oauth_states`, `rate_limits`, and `shortcut_credentials` in the restored database so old sessions and revoked/restored credentials cannot regain access. Reconnect Spotify and provision a fresh Shortcut credential. If Spotify credentials are restored, they may already be expired/revoked; discarding them and reconnecting is the safer recovery route. Review the exact target and SQL before running remote commands.

## Lost-key or token compromise recovery

1. Revoke the app's access in Spotify account settings if Spotify tokens may be compromised. Revoke the Shortcut credential if only the Shortcut leaked.
2. Back up retained bookmarks if needed. In an approved D1 operation, delete `spotify_credentials`, `oauth_states`, `sessions`, and `shortcut_credentials`; retain `owner` and `bookmarks` for the same account.
3. Replace the encryption key and/or setup key as appropriate. Update the deployed Worker secrets with approval.
4. Sign in as the same owner and create a new Shortcut credential. Test save/resume again. Lost ciphertext keys cannot be recovered by resetting the key alone.

## Rollback

Do not apply this first migration to an unrelated database. Before future schema changes, take an approved backup and review a compatible rollback plan. Reverting Worker code does not revert D1 schema or revoke credentials. No automatic rollback/deployment pipeline is included.
