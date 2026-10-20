# Your iPhone setup

Your bookmark page: [spotify-album-bookmarks.jtdelosh.workers.dev](https://spotify-album-bookmarks.jtdelosh.workers.dev).

**Hosting is deployed.** The production configuration is `wrangler.production.jsonc`, with the assigned database UUID filled in. Your existing saved bookmark is copied. Production uses a new Spotify sign-in and separate keys; the PC app remains available through its local configuration. Physical iPhone setup/testing is still pending.

## Connect on your iPhone after deployment

1. Add this exact additional redirect URI in your Spotify developer app settings:

   `https://spotify-album-bookmarks.jtdelosh.workers.dev/auth/spotify/callback`

2. Open `https://spotify-album-bookmarks.jtdelosh.workers.dev` in Safari on the iPhone.
3. Enter the production **SETUP_KEY** from the private local `.env.production` file, then approve Spotify access using the same Spotify account. The production key is separate from the PC app's key. Keep the encryption key private; it is not used in the Shortcut.
4. Expand **iPhone Shortcut & account**, tap **Create / replace Shortcut credential**, and copy the credential shown once. It is separate from your setup key and Spotify tokens.

## Build Bookmark current album in Shortcuts

1. Create a new Shortcut named **Bookmark current album**.
2. Add **Get Contents of URL** and enter:

   `https://spotify-album-bookmarks.jtdelosh.workers.dev/api/bookmarks/current`

   Expand its options, set **Method** to **POST**, and add these headers:

   | Header | Value |
   | --- | --- |
   | `Authorization` | `Bearer YOUR_SHORTCUT_CREDENTIAL` |
   | `X-Shortcut-Response` | `notification` |
   | `Content-Type` | `application/json` |

   Replace `YOUR_SHORTCUT_CREDENTIAL` with the copied value. Set **Request Body** to **JSON** with no fields.

3. Add **Get Dictionary Value**: key `message`, dictionary **Contents of URL**. If your iOS version does not recognize the response as a dictionary, insert **Get Dictionary from Input** before this action.
4. Add **Show Notification** with the dictionary value as its text.
5. Start a Spotify music track and run the Shortcut once. Allow access to the host and notifications when prompted. Confirm the saved position appears on the web page.
6. Use the Shortcut's details/share menu to **Add to Home Screen**, or add it to a Shortcuts widget. After setup, one tap saves your place while Spotify keeps playing.

Resume from the album's **Resume** button in the Safari page. To choose a device explicitly, tap **Refresh devices** and select it under **Where to play**, then tap Resume. If the device is absent, open Spotify there and refresh again. An optional second Shortcut can use **Open URLs** with the bookmark page address.

This is a manual recipe for creating the Shortcut directly on the iPhone. No importable Apple-signed Shortcut file has been produced on this Windows computer. Do not share a Shortcut after adding its credential. The full [Shortcut guide](shortcut-setup.md) covers error responses, revocation, and network failures.
