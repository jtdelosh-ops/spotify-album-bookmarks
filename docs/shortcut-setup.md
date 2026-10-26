# iPhone Shortcut setup

Complete Spotify sign-in in the mobile bookmark page first. Then expand **iPhone Shortcut & account** and create a credential. Copy the value when shown; it cannot be retrieved later. Creating a new one revokes the previous one.

## Bookmark listening

1. Open Apple's Shortcuts app and create a shortcut named **Bookmark listening**. Existing add-only Shortcuts keep their URL and credential; the optional update menu below needs a replacement credential with update access.
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

## Add or update menu

First open the bookmark page, expand **iPhone Shortcut & account**, check **Allow this new credential to list bookmark names and update existing bookmarks**, and create a replacement credential. Put the new value in your Shortcut's Authorization header. This revokes the old credential. It grants access to display names and replacing saved audio/positions; it does not grant rename, delete, or playback control.

Duplicate your working basic Shortcut before editing it. Use your own Worker host throughout. All requests use `Authorization: Bearer YOUR_SHORTCUT_CREDENTIAL` and `X-Shortcut-Response: notification` in headers; only POST requests need the JSON Content-Type/body.

1. Add **Choose from Menu** with **Add new bookmark** and **Update existing bookmark**.
2. Under **Add new bookmark**, keep the basic POST `/api/bookmarks/current` and its message notification from the recipe above.
3. Under **Update existing bookmark**, add **URL** for `https://YOUR_WORKER_HOST/api/shortcut-bookmarks`, followed by **Get Contents of URL**, method **GET**, with both headers above.
4. Parse **Contents of URL** as a dictionary if necessary. Save it as a variable named **Choice Response**. Get its `ok` value. Use **If** to continue only when it is true; otherwise show `Choice Response`'s `message` as a notification and stop the Shortcut.
5. Get `choices` from **Choice Response** and save it as **Bookmark Choices**. This dictionary maps numbered bookmark names to IDs. Get **All Keys** from it and **Count** those keys. If the count is zero, show “Add a bookmark first” and stop.
6. Add **Choose from List** using the **Bookmark Choices dictionary itself**, with **Select Multiple** off. Apple documents that selecting a dictionary key passes its corresponding value onward; the chosen value is the bookmark ID. Store it as **Bookmark ID**. Cancelling should stop without updating.
7. Add **Show Alert** asking “Replace this bookmark's audio and position with current Spotify playback?” Keep **Show Cancel Button** on. Cancellation stops the Shortcut; continuing permits the update.
8. Add **URL** with `https://YOUR_WORKER_HOST/api/bookmarks/` followed by the **Bookmark ID** variable, then `/update`.
9. Add **Get Contents of URL**, method **POST**, with the same Authorization/notification headers plus `Content-Type: application/json`; JSON body has no entries (`{}`).
10. Read `message` from that response and **Show Notification**. The response reports success or the reason it could not update. A deleted choice returns an error; run again to refresh the list.

The Shortcut reads current playback **after you choose and confirm**. Updating can replace the album or podcast episode as well as its timestamp; the selected slot's name and identity stay the same. Both playing and paused audio work when Spotify still reports a valid position. This menu performs no resume command.

Apple references: [Choose from Menu](https://support.apple.com/guide/shortcuts/use-the-choose-from-menu-action-apdd7bf369da/ios), [dictionaries and Choose from List](https://support.apple.com/en-ie/guide/shortcuts/apd43b69f337/ios). The service's list/update flow has local verification; the assembled menu still needs a physical iPhone check, including the selected dictionary value and cancellation behavior.

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

An optional **Open bookmarks** Shortcut can contain a URL action for `https://YOUR_WORKER_HOST/` and **Open URLs**. Sign in in the browser, then tap Resume on a bookmark. **Update position** replaces a selected save; Name/Rename changes its label only. Use **Refresh devices** and **Where to play** to choose a playback device if needed. Resume does not require the Shortcut credential.

## Credential safety and revocation

- The credential belongs only in the private Shortcut's header. Never put it in a URL or share/export a populated Shortcut. Shortcut syncing/backups can also contain it.
- **Revoke credential** immediately disables it. **Create / replace** rotates it; update the Shortcut header afterward.
- **Disconnect Spotify** removes server Spotify tokens, ends all web sessions, and revokes Shortcut access. Separately remove the app in Spotify's account app-access settings to revoke Spotify's authorization itself.
- A replacement phone or a lost credential requires a new credential. No Spotify access/refresh token or client secret is ever placed in the Shortcut.
- Existing credentials remain add-only. To enable the update menu, explicitly create a replacement with update access; simply installing an app update does not expand an older credential's permissions.

This guide is an exact manual recipe. An Apple-signed/importable `.shortcut` file was not generated on this Windows environment, and the steps have not yet been run on a physical iPhone.
