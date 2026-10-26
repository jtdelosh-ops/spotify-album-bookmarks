# Deployment and operations checklist

## Choose your deployment

This guide creates your own instance. The repository's `wrangler.production.jsonc` identifies the original maintainer's deployment. For a new installation, copy `wrangler.production.example.jsonc` over that file in your own checkout, then replace every account, hostname, Client ID, and database placeholder. Existing operators should keep their working production file and skip resource creation.

```sh
cp wrangler.production.example.jsonc wrangler.production.jsonc
```

PowerShell equivalent: `Copy-Item wrangler.production.example.jsonc wrangler.production.jsonc`.

Check your Cloudflare plan and usage before creating resources. A small personal installation may fit available allowances; this project makes no zero-cost guarantee. Remote migration and deploy commands change real resources. Local `--dry-run` and `--local` commands do not publish.

## Prepare a reviewable configuration

- [ ] Confirm the intended Cloudflare account, available plan/limits, Worker name, D1 database name, and exact HTTPS origin. This project does not guarantee zero cost.
- [ ] Confirm the intended Spotify Client ID and user allowlist; avoid changing an unrelated app. Register `https://YOUR_HOST/auth/spotify/callback` exactly.
- [ ] In `wrangler.production.jsonc`, verify the intended account, final `APP_ORIGIN` without a trailing slash, and `SPOTIFY_CLIENT_ID`. The Client ID is public. Changing the hostname requires updating Spotify's redirect URI and signing in again. The PC config is separate.
- [ ] Generate separate production `ENCRYPTION_KEY` and `SETUP_KEY` as in README. Keep recoverable copies in a password manager. Do not reuse local keys.
- [ ] Run `npm ci`, `npm run typecheck`, and `npm run build`. Use `npm test` when checking application behavior, and complete relevant manual device checks before relying on a new installation.
- [ ] Approve resource creation and deployment against these names and this configuration.

## Commands after approval

These commands describe a new installation. Fill in your Cloudflare account ID, intended HTTPS `APP_ORIGIN`, and Spotify Client ID before running them. Register `https://YOUR_HOST/auth/spotify/callback` in Spotify, replacing the host with the exact origin you configured. Use a hostname assigned to your Cloudflare account. Routine updates skip database creation; do not import someone else's database or initial bookmark data.

```sh
npx wrangler login
npx wrangler d1 create spotify-album-bookmarks --config wrangler.production.jsonc
```

Copy the returned UUID into `d1_databases[0].database_id` in `wrangler.production.jsonc`; verify the Cloudflare account before continuing. Create the ignored `.env.production` file with two separately generated values, using the commands in the [README](../README.md#2-configure-spotify-and-your-keys):

```dotenv
ENCRYPTION_KEY="YOUR_NEW_STANDARD_BASE64_KEY"
SETUP_KEY="YOUR_NEW_PRIVATE_SETUP_KEY"
```

Do not copy local keys into production. Keep recoverable copies in a password manager. Key values do not belong in Git or command-line arguments. Remote migration can change a real database: review the account, target, and migration list before confirming.

Then apply the schema and deploy:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
npm run deploy -- --secrets-file .env.production
```

After publishing, open your HTTPS page, enter the production setup key, and approve Spotify access. The first account becomes the owner. For the iPhone, follow the [setup checklist](iphone-setup.md).

## Update an existing instance

Pull the intended changes, install locked dependencies with `npm ci`, review any new migrations, and verify your production configuration still names the correct account, origin, Client ID, and D1 UUID. Use `npm run deploy` for code/assets updates; it selects `wrangler.production.jsonc` and preserves existing deployed secrets. Use `-- --secrets-file .env.production` only when intentionally uploading keys. Do not recreate the database, reimport initial data, or generate replacement encryption keys for routine updates.

An update to Worker code does not automatically apply D1 migrations. For schema changes, back up first, review compatibility, and explicitly apply the intended migrations with the production config.

`0004_shortcut_update_access.sql` adds an `allow_updates` flag with a default of zero. Apply it before deploying the add/update Shortcut code. Existing credentials remain add-only; no credential rotation or permission expansion happens during migration. This additive migration does not copy bookmark tables or require a bookmark write pause. Update access is granted only when the owner creates a replacement credential with the checkbox enabled. Updating a bookmark changes only the active `saved_bookmarks` row; recovery tables remain historical copies.

### Upgrade to independent save points

This upgrade needs a short, controlled pause in bookmark changes:

1. Stop web and Shortcut saves and bookmark deletions, and let any in-flight requests finish. Keep this pause in place until the new Worker version is active. Spotify listening itself can continue. This is an operator-controlled window; the migration does not block the old Worker from accepting writes.
2. Export a private backup. Record the legacy bookmark IDs, positions, and dates for comparison.
3. Apply pending migrations using the remote command above. `0002_listening_bookmarks.sql` copies existing album rows to the intermediate `listening_bookmarks` table. `0003_independent_saves.sql` copies each row to its own slot in `saved_bookmarks`, retaining its ID, track, position, and capture date. New captures use random IDs and never replace existing rows. Credentials, sessions, and Shortcut credentials are unchanged. If `0002` was applied earlier while the old Worker continued accepting writes, reconcile that staged table with the current legacy source under this no-writes window before applying `0003`.
4. Verify copied IDs, tracks, positions, dates, and counts. Confirm the legacy data has not changed since the copy. If a save or deletion occurred in the window, stop the release and reconcile the staged copy with the latest legacy data, including deletions, under a fresh no-writes window before switching versions. Counts alone cannot detect a changed position. Do not simply rerun the migration file or clear an active new table.
5. Deploy the reviewed code/assets and confirm the new Worker version is active. Then resume web/Shortcut use and reload open bookmark pages.

The new app reads/writes `saved_bookmarks`. Earlier tables are retained for recovery. Deleting a migrated slot also removes its corresponding recovery rows; deleting a newly added slot leaves other slots and recovery copies belonging to the migrated slot alone. If a controlled no-writes window cannot be maintained, postpone this release and use an explicitly reviewed maintenance or reconciliation mechanism.

Rolling back code alone would show the original table, which does not contain later saves; it is not a full rollback of listening progress. Recover using an appropriate backup/data migration. Never rerun the initial bookmark import on an upgrade.

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
2. Back up retained bookmarks if needed. In an approved D1 operation, delete `spotify_credentials`, `oauth_states`, `sessions`, and `shortcut_credentials`; retain `owner` and all bookmark tables for the same account.
3. Replace the encryption key and/or setup key as appropriate. Update the deployed Worker secrets with approval.
4. Sign in as the same owner and create a new Shortcut credential. Test save/resume again. Lost ciphertext keys cannot be recovered by resetting the key alone.

## Rollback

Do not apply this first migration to an unrelated database. Before future schema changes, take an approved backup and review a compatible rollback plan. Reverting Worker code does not revert D1 schema or revoke credentials. No automatic rollback/deployment pipeline is included.
