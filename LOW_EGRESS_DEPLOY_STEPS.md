# Deploy YouSong low-egress update

1. Make a backup of the currently deployed source and database before replacing files.
2. Replace the current GitHub repository contents with this updated project. Keep the main Render web service root directory set to the repository root, not `converter-service`.
3. Deploy the main YouSong service and wait for the build to finish.
4. In Admin → song requests, open a pending request with a valid single-video YouTube link and select **Publish YouTube Directly**. Confirm the song appears in the library and plays through YouTube's official embedded player.
5. Test a playlist where a video is unavailable. The YouTube error is handled silently and the queue advances; the website itself should not reload.
6. Once that works and you no longer need MP3 conversion, remove `YT_AUDIO_API_URL` and `YT_AUDIO_API_KEY` from the main Render service, save/redeploy, and delete the separate converter Render service. The updated code does not fall back to running `yt-dlp` on the main service when those variables are absent.

Do not delete `DATABASE_URL` / `SUPABASE_DB_URL`, the Google Drive OAuth settings (unless Drive is no longer used at all), session secrets, or other application variables.

See `EGRESS_DIAGNOSIS_AND_FIX.md` for the source-code findings and Supabase usage investigation.
