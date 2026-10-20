# Manual iPhone / Spotify release test plan

**Current result: NOT RUN.** The checks below require the real Spotify app/account, a reviewed HTTPS deployment, and a physical iPhone. Mark the actual date, app/OS versions, hostname, source commit, and outcome when executed. Do not record tokens or the setup key in results.

| Scenario | Steps / expected evidence |
| --- | --- |
| Setup and permissions | Verify Client ID allowlist/Premium, complete PKCE, and approve the two playback scopes. Confirm `/me` returns stable `account_id`. Inspect cookies without copying their values: Secure, HttpOnly, SameSite=Lax, Path=/. |
| Private instance | Signed-out browser cannot list bookmarks. Wrong setup key is refused. Original owner can reconnect; another Spotify account cannot replace that owner, even after disconnect. Use a test account only if one is available/approved. |
| One tap after setup | Create the Shortcut per guide. Run once to allow the host and notifications, then use Home Screen/widget while Spotify plays in the background. Verify no companion app opens, notification text appears, and the album shows in the mobile list. Check locked-phone and Back Tap behavior separately if you intend to use them. |
| Capture accuracy | Note the playing track and position, trigger the Shortcut, compare the saved value against Spotify. Record observed latency/tolerance rather than claiming exact synchronization. Test the start and end of a long track. |
| Replace and persistence | Save the same album later; verify one row with the newer position. Switch albums, save another, restart the phone, and confirm both bookmarks remain available after sign-in if needed. |
| Album-context resume | Activate a desired Spotify device, tap Resume, and observe the actual album, track, and timestamp. Listen across the track boundary to confirm the album continues. Repeat with a disc-two track numbered 1 and with shuffle on/off; note shuffle's subsequent ordering. |
| No active device | With no active Spotify player, tap Resume and verify the device list refreshes without automatically choosing a target. Choose an available idle device and retry. Missing devices should prompt opening Spotify and refreshing. Do not claim the service wakes a closed app. |
| Explicit device | Refresh devices, choose a different available device, and resume a bookmark. Verify the selected device receives the album, track, and saved time. A disappeared device must produce actionable feedback; restricted devices must not receive commands. Shortcut credentials must not list devices or resume. |
| Restricted device | If available, select a restricted device and confirm clear refusal. If no such device is available, record the test as unverified. |
| Inactive/unsupported playback | Pause music, play nothing, and try a local file or episode. Each save should return an error notification and retain the last valid bookmark. Ads/audiobooks need only be checked if the account/device can produce them. |
| Lost connectivity | Disable network and run the Shortcut: confirm Shortcuts' own transport failure is visible. Re-enable network and save successfully. Test notification permission denied; document the resulting UI. |
| Credential lifecycle | Create replacement credential; old Shortcut must fail with clear feedback. Update header and retry successfully. Revoke; it fails again. Verify a credential cannot GET the library or POST resume. Never share a populated Shortcut as evidence. |
| Token lifecycle | Wait for natural access expiry or use a separate safe test setup to exercise refresh. Revoke Spotify authorization and confirm reconnect feedback; sign in again and verify saved bookmarks remain. Six-month expiry is covered by mocked `invalid_grant` locally; do not claim six months of observation. |
| Error handling | Real 403/429/quota exhaustion should not be induced by flooding Spotify. Use mocked checks for these conditions and record genuine occurrences only. Confirm `Retry-After` is surfaced, with no retry loop. |
| Delete and disconnect | Delete a bookmark and verify it stays deleted after reload. Disconnect should clear server Spotify credentials, end all sessions, revoke Shortcut access, and retain other bookmarks. Reconnect as the same owner. |
| Mobile layout/accessibility | Inspect small and large iPhone widths, long album/track names, text scaling, focus/tap targets, empty list, multiple cards, visible feedback, and VoiceOver names for Resume/Delete. |

Release can proceed only with an honest account of failed and unavailable checks. Passing mocked tests is not a substitute for observing successful Spotify playback and one-tap Shortcut execution on the intended device.
