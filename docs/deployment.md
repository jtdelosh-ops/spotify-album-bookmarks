# Deployment and operations checklist

## Current deployed instance — 20 October 2026

James approved creation/publication on Workers Free without a paid upgrade and confirmed the Free plan. The billing API was not accessible, so plan status is user-confirmed. No subscription or billing setting was changed.

- URL: `https://spotify-album-bookmarks.jtdelosh.workers.dev`
- Configuration: `wrangler.production.jsonc`
- D1 database: `203197d1-c7f1-4cdc-a5e4-92cc800f18e6`, binding `DB`
- Active Worker version: `995f361b-94f9-44fa-901d-dedaa454bccc`, 100% of traffic
- Schema applied; one owner binding and one saved bookmark copied. PC Spotify credentials, sessions, OAuth transactions and Shortcut credentials were not copied.
- Separate production keys were uploaded with `--secrets-file .env.production`; key values were not printed or committed.
- Live checks passed for assets, security headers, unauthenticated access denial, Shortcut error envelopes, cross-origin rejection, Secure OAuth cookies, and one-use state. Metadata confirms the intended D1 binding, daily cleanup schedule, disabled preview URLs, and disabled automatic observability.
- Production Spotify sign-in, live resume accuracy, and physical iPhone execution are pending. Follow [your iPhone setup](iphone-setup.md).

The checklist below describes the general workflow. New resource creation, secret changes or public deployments must remain within the user's authorization. Local `--dry-run` and `--local` commands do not publish a service.

## Prepare a reviewable configuration

- [ ] Confirm the intended Cloudflare account, available plan/limits, Worker name, D1 database name, and exact HTTPS origin. This project does not guarantee zero cost.
- [ ] Confirm the intended Spotify Client ID and user allowlist; avoid changing an unrelated app. Register `https://YOUR_HOST/auth/spotify/callback` exactly.
- [ ] In `wrangler.production.jsonc`, verify the intended account, final `APP_ORIGIN` without a trailing slash, and `SPOTIFY_CLIENT_ID`. The Client ID is public. Changing the hostname requires updating Spotify's redirect URI and signing in again. The PC config is separate.
- [ ] Generate separate production `ENCRYPTION_KEY` and `SETUP_KEY` as in README. Keep recoverable copies in a password manager. Do not reuse local keys.
- [ ] Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. Check the source review and remaining live validation limits.
- [ ] Approve resource creation and deployment against these names and this configuration.

## Commands after approval

These describe initial creation, which has already completed for the current instance. Routine updates use `npm run deploy`; do not create another database or reimport the initial bookmark SQL for an ordinary update.

```sh
npx wrangler login
npx wrangler d1 create spotify-album-bookmarks --config wrangler.production.jsonc
```

Copy the returned UUID into `d1_databases[0].database_id` in `wrangler.production.jsonc`; verify the Cloudflare account before continuing. Then:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
npm run deploy -- --secrets-file .env.production
```

Keep secrets in the ignored `.env.production` file. Do not place values on command lines, in chat, or in configuration committed to Git. Wrangler's remote migration can change a real database: review the account, target, and migration list before confirming.

For the current instance, the actual publication used `npx wrangler deploy --config wrangler.production.jsonc --secrets-file .env.production`, which uploads the secrets with the Worker version. The `npm run deploy` script now selects that production config. Preserve the production keys unless deliberately performing the recovery/rotation procedure.

For a custom domain, configure that exact domain in Cloudflare, verify it routes to this Worker, and set `APP_ORIGIN` to it before testing OAuth. The default workers.dev address must exactly match its configured origin if used.

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
npx wrangler d1 export DB --remote --config wrangler.production.jsonc --output=backups/album-bookmarks.sql
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
