# Use Spotify bookmarks on your iPhone

Open your deployed HTTPS bookmark page in Safari or with your existing Home Screen shortcut. Your phone cannot reach a computer's `127.0.0.1` address. Sign in with the instance's setup key and original Spotify account if asked. The setup key is only for signing into this app.

## Save or update while paused

Leave Spotify at the position you want, playing or paused. On the bookmark page:

- **Add bookmark** keeps a separate new save.
- **Update position → Update now** replaces the selected save's audio and position, keeping its name.

Spotify must still report its item and position. A closed/offline player or an expired playback state may provide nothing to save; the app preserves earlier bookmarks instead of inventing a position.

If **Update now** says Spotify is not reporting your paused position:

1. Choose **This iPhone** under **Where to play**. In the selected bookmark’s Update panel, tap **Open Spotify & recover position**.
2. In Spotify, open the devices/Connect panel below the player and select **This iPhone**. Leave it paused and visible while the app captures the position; do not press Play.
3. Return to the bookmark page. Check the recovered audio title and time against Spotify.
4. Tap **Update now** to replace that bookmark with the displayed capture, or **Cancel update** to keep the earlier save.

Recovery can reconnect your phone and change Spotify’s queue. It does not send a Play command. The review step matters because Spotify might expose a different item after reconnecting. Confirmation saves the capture you reviewed, rather than reading Spotify again after you return. The preview lasts five minutes and survives a page reload in the same signed-in browser; it does not transfer to a different browser or a new sign-in session. If the phone cannot be identified, another device is active, or no valid paused position appears, recovery leaves your bookmark unchanged. This flow updates existing bookmarks; it does not recover a failed **Add bookmark**.

## Resume without playing something first

1. Under **Where to play**, choose **This iPhone**, then tap **Resume** on the saved bookmark.
2. Spotify opens from that same tap. If iOS asks whether to open Spotify, allow it. There is no second in-app confirmation button.
3. Keep Spotify visible while the saved audio starts at the bookmarked time. You do not need to press Play on another track first.

Every bookmark has one **Resume** button. **This iPhone** is the default on iPhone and stays in the dropdown even when the phone disappears from Spotify Connect. The app uses the previously confirmed phone for up to 30 days. On first use, it looks for a single phone that becomes available after Spotify opens. If a phone is already listed and has not been remembered, choose it by name to resume directly. If several new phones appear, return and explicitly choose yours; it will not guess.

A paused phone can disappear from Spotify Connect when you switch back to Safari. The open-and-resume flow keeps the request running briefly while Spotify is in front. It uses up to five device checks, waits up to about 12 seconds for the phone, and bounds the full operation to about 22 seconds. A network failure or timeout means playback was not confirmed; check Spotify before retrying. If Spotify was reinstalled and its device ID changed, choose the phone again when it is available.

On first use, discovery needs a device list fetched within the last minute. If it is missing or stale, the app refreshes the list and asks you to tap Resume again; it sends no playback command and does not open Spotify during that refresh. Returning to the page also refreshes the list. Once the phone has been confirmed, Resume uses its exact remembered ID.

## Other playback devices

Available devices load when the page opens. For a speaker or computer, choose it under **Where to play** and tap the same **Resume** button. Use **Refresh devices** to update the list. A selected device that disappears stays marked unavailable, rather than switching to another player. **Active Spotify device** uses Spotify's current active player. Choosing another device can move your listening there. Spotify's **Everywhere** entry may be an Alexa multiroom group; its members are configured in Alexa.

## Home Screen access

Your existing shortcut that opens this page is sufficient. The app has no Shortcut-key setup section. If you need a launcher, use the [two-action Home Screen recipe](shortcut-setup.md).
