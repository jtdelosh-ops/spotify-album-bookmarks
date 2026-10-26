# Open the bookmark app from your Home Screen

If you already use a Shortcut to open the bookmark page, keep using it. You do not need another Shortcut, an API key, a checkbox, or Get Contents of URL to use the app's bookmark controls.

To create a simple launcher in Apple's Shortcuts app:

1. Add **URL** with your HTTPS bookmark page address, such as `https://YOUR_WORKER_HOST/`.
2. Add **Open URLs** using that URL.
3. Name it **Spotify bookmarks**, then choose **Add to Home Screen** from its details/share menu.

The shortcut opens the website. On that page, use **Add bookmark**, **Update position**, and **Resume**. On iPhone, choose **This iPhone** under **Where to play**, then tap **Resume**. That same tap opens Spotify and starts the saved-position request. Keep Spotify visible; you do not need to play something else first.

Read the [iPhone guide](iphone-setup.md) for device selection and paused playback. Advanced legacy API endpoints remain documented in the [API reference](api.md), but the website no longer has a section for creating or copying Shortcut credentials.
