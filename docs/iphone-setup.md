# Use Spotify bookmarks on your iPhone

Open your deployed HTTPS bookmark page in Safari or with your existing Home Screen shortcut. Your phone cannot reach a computer's `127.0.0.1` address. Sign in with the instance's setup key and original Spotify account if asked. The setup key is only for signing into this app.

## Save or update while paused

Leave Spotify at the position you want, playing or paused. On the bookmark page:

- **Add bookmark** keeps a separate new save.
- **Update position → Update now** replaces the selected save's audio and position, keeping its name.

Spotify must still report its item and position. A closed/offline player or an expired playback state may provide nothing to save; the app preserves earlier bookmarks instead of inventing a position.

## Resume without playing something first

1. Find the saved bookmark and tap **Resume on this iPhone**.
2. Tap **Open Spotify & resume**. If iOS asks whether to open Spotify, allow it.
3. Keep Spotify visible while the saved audio starts at the bookmarked time. You do not need to press Play on another track first.

When your iPhone already appears under **Where to play**, choose it once before step 1. The app uses that exact phone and remembers a confirmed phone in the current browser for up to 30 days. If no phone is listed on first use, the app looks for a single phone that becomes available after Spotify opens. If several new phones appear, return and explicitly choose yours; it will not guess.

A paused phone can disappear from Spotify Connect when you switch back to Safari. The open-and-resume flow keeps the request running briefly while Spotify is in front. It uses up to five device checks, waits up to about 12 seconds for the phone, and bounds the full operation to about 22 seconds. A network failure or timeout means playback was not confirmed; check Spotify before retrying. If Spotify was reinstalled and its device ID changed, choose the phone again when it is available.

## Other playback devices

For a speaker or computer, use **Refresh devices**, choose it under **Where to play**, and tap the regular **Resume** button. Choosing another device can move your listening there. Spotify's **Everywhere** entry may be an Alexa multiroom group; its members are configured in Alexa.

## Home Screen access

Your existing shortcut that opens this page is sufficient. The app has no Shortcut-key setup section. If you need a launcher, use the [two-action Home Screen recipe](shortcut-setup.md).
