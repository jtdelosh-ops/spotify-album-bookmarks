# iPhone Shortcut setup

Complete Spotify sign-in in the mobile bookmark page first. Then expand **iPhone Shortcut & account** and create a credential. Copy the value when shown; it cannot be retrieved later. Creating a new one revokes the previous one.

## Bookmark listening

1. Open Apple's Shortcuts app and create a shortcut named **Bookmark listening**. Existing Shortcuts do not need new URLs, headers, or credentials for this upgrade.
2. Add **URL** with `https://YOUR_WORKER_HOST/api/bookmarks/current`. Replace the host with your reviewed deployment's exact HTTPS address.
3. Add **Get Contents of URL**, using that URL. Expand the action's options and set:

   | Setting | Value |
   | --- | --- |
   | Method | `POST` |
   | Header `Authorization` | `Bearer YOUR_SHORTCUT_CREDENTIAL` |
   | Header `X-Shortcut-Response` | `notification` |
   | Header `Content-Type` | `application/json` |
   | Request Body | JSON, no entries (`{}`) |

4. Add **Get Dictionary from Input** if your version of Shortcuts does not automatically treat the response as a dictionary. Its input is **Contents of URL**.
5. Add **Get Dictionary Value**, key **message**, from the response dictionary.
6. Add **Show Notification** with that dictionary value as its text. A fixed title such as **Album bookmark** is sufficient. `message` describes both success and application errors. Optionally use the `ok` boolean to vary the title.
7. Open a Spotify music track or podcast episode, playing or paused, and run the Shortcut once. Allow network access to your host and notifications when prompted. Each run adds a new independent bookmark, even for the same content; previous saves remain unchanged. Name bookmarks later on the web page if desired.
8. In the Shortcut's details/share menu, choose **Add to Home Screen**, or select it in the Shortcuts widget. Optional Back Tap: Settings → Accessibility → Touch → Back Tap → choose the Shortcut. Menu labels may vary by iOS version.

The action does not open a companion app. It cannot add a button inside Spotify. Spotify may be in the background while the Shortcut makes the request. OS permission prompts, an offline phone, a locked device, or notification settings can affect the experience and must be checked on your phone.

## Expected responses

Successful save:

```json
{"ok":true,"bookmarkId":"...","message":"Added bookmark for Movement II at 2:03."}
```

Example application error in notification mode:

```json
{"ok":false,"code":"nothing_playing","message":"Open a track or podcast episode in Spotify, playing or paused, then bookmark it. Spotify is not reporting a playback position.","httpStatus":409,"requestId":"..."}
```

With `X-Shortcut-Response: notification`, server application errors return HTTP 200 with `ok:false` and the original status in `httpStatus`. This lets notification actions run even on iOS versions that stop on HTTP errors. It does not suppress authentication or rate limits. Without this header, errors use normal HTTP statuses. A network/OS failure may stop the Shortcut before the server response; Shortcuts must show its own error in that case.

## Open bookmarks / resume

An optional **Open bookmarks** Shortcut can contain a URL action for `https://YOUR_WORKER_HOST/` and **Open URLs**. Sign in in the browser, then tap Resume on a bookmark. Use Name/Rename to label it without changing its saved position. Use **Refresh devices** and **Where to play** to choose a playback device if needed. Resume does not require the save credential.

## Credential safety and revocation

- The credential belongs only in the private Shortcut's header. Never put it in a URL or share/export a populated Shortcut. Shortcut syncing/backups can also contain it.
- **Revoke credential** immediately disables it. **Create / replace** rotates it; update the Shortcut header afterward.
- **Disconnect Spotify** removes server Spotify tokens, ends all web sessions, and revokes Shortcut access. Separately remove the app in Spotify's account app-access settings to revoke Spotify's authorization itself.
- A replacement phone or a lost credential requires a new credential. No Spotify access/refresh token or client secret is ever placed in the Shortcut.

This guide is an exact manual recipe. An Apple-signed/importable `.shortcut` file was not generated on this Windows environment, and the steps have not yet been run on a physical iPhone.
