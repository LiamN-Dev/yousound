# YouSong Supabase egress diagnosis and fix

## What the supplied usage screenshots show

- Uncached egress: 5.91 GB used against 5 GB included; 0.91 GB over quota. This is 118.2% of the included allowance (18.2% above it), not 180% above the allowance.
- Daily bars have the largest spikes on October 25–27.
- Monthly active users: 0; storage size: 0.00 GB; database size: 25.79 MB; cached egress: 0.00 GB.
- The screenshot does not show the per-day service breakdown. In the Supabase Usage page, hover October 25, 26, and 27 in the egress chart to reveal whether the egress was Shared Pooler/Database, Storage, Auth, Realtime, or another service.

## High-egress code patterns found in the uploaded source

1. `AuthContext.tsx` polled every 15 seconds. Every poll launched nine requests: `/api/songs`, `/api/playlists`, `/api/requests`, `/api/popups`, `/api/users`, `/api/banner`, `/api/maintenance`, `/api/settings/auto-tags`, and `/api/settings/spotlight`. The server reads the corresponding tables/settings from Postgres/Supabase. The songs query selects every song row.
2. `ChatSideNotification.tsx` polled every 3.5 seconds. For each thread with an incoming last message, it fetched the entire message history just to find the latest message. This could repeatedly transfer the same chat history through the Supabase DB connection.
3. `ChatHub.tsx` polled chat requests, threads, and messages every 3.5 seconds while the chat tab was open. `AuthContext.tsx` also polled chat threads every 4 seconds for unread counts; this badge polling is now reduced to 60 seconds because notifications already poll thread previews. Suspended-account appeal screens also reloaded the full appeal transcript every 4 seconds.
4. `StorageService.syncWithServer()` had no in-flight guard, so simultaneous callers could launch duplicate sets of nine reads. Login also triggered redundant syncs.
5. The `/api/songs` ETag is checked after `getSongsDb()` has already run. It can reduce the response sent from Render to the browser, but it does not prevent the SQL query and its egress from Supabase to the app server.

The Node server uses Drizzle + `pg` to connect to the Supabase Postgres database. If its connection URL uses Supavisor's shared pooler, Supabase reports those response bytes as Shared Pooler Egress. Confirm that category by hovering over the daily graph; the screenshot alone cannot prove the category.

## Changes in this package

- Changed global data refresh from 15 seconds to 120 seconds, only while the tab is visible and signed in.
- Added a single-flight guard so concurrent calls share one sync.
- Removed extra background sync calls on login.
- Changed chat and suspended-account refresh intervals from 3.5–4 seconds to 15 seconds and paused them in hidden tabs.
- Reworked the side notification to use `chat_threads.last_message` and `last_message_at` rather than requesting every message in every thread each cycle.
- YouTube playback failures are handled silently before the queue advances, including when the player rejects the initial `play()` call; the page is not reloaded by the playback error handler. In the uploaded source, the only `window.location.reload()` is the user-triggered “Clear cached session & reset” button in `LoginGate.tsx`.
- Added “Publish YouTube Directly” for pending YouTube song requests. It saves `youtube:VIDEO_ID` in the songs table and uses YouTube's official embedded player. The app does not download the audio.
- Removed the silent local `yt-dlp` fallback. If no dedicated converter is configured, MP3 conversion now fails with a clear message instead of trying to download on the main web service.

## Deploy steps

1. Back up the current repository and replace it with this updated source.
2. Keep the main Render service's root directory at the project root (not `converter-service`). Deploy the main YouSong service.
3. Test one pending YouTube request with the new “Publish YouTube Directly” action. Verify that the song appears and plays in the official YouTube player.
4. Once direct publishing works and you no longer need YouTube-to-MP3 conversion, remove `YT_AUDIO_API_URL` and `YT_AUDIO_API_KEY` from the main Render service, save/redeploy, then delete the separate converter Render service. Keep Google Drive credentials only if you still use Drive for files you own or are licensed to host.
5. In Supabase Usage, hover the egress bars for October 25–27 and note the service breakdown. If Shared Pooler Egress dominates, this code's repeated Postgres reads are the main target. If Storage or Realtime dominates, there is a separate source to investigate.

## Important notes

- Egress already consumed cannot be undone; these changes only reduce future usage.
- The included quota resets at the start of the billing cycle. On the Free plan, exceeding the quota may restrict service until the reset or an upgrade/disablement of the spend cap, as described in Supabase's usage documentation.
- Direct YouTube playback only works for videos whose owners allow embedding and which are available to the listener. YouSong cannot force playback of private, removed, region-blocked, or embedding-disabled videos.
- The official YouTube player streams the actual media directly from YouTube to the listener. Supabase still handles song metadata, accounts, playlists, and listen-limit checks.
