# PR #10: manual checks before merging

Use the reconciled branch in the isolated Aero worktree. Keep all edits on the
local preview connected to anonymous local Convex, rather than the public site.
Automated browser tests use a fake output device and fixture piano samples;
these checks cover the actual demo machine, its output device and live downloads.

1. **Listen through the demo output.** Open a local Trap Heat project in Chrome.
   Start playback, then listen continuously for at least 2 minutes. Repeat with
   Synthwave 80s and a Warm Pad channel. Try 85, 140 and 240 BPM while playing.
   Pass: no growing noise/crackle, stuck notes, unexpected level buildup or timing
   drift across repetitions. Notes missed during an intentionally blocked browser
   thread cannot be recovered; playback should resume cleanly on its grid.
2. **Stop and restart with effects.** Raise master Delay to 60–80%, sustain a note
   or chord, then rapidly alternate Stop and Play about ten times. Stop fully,
   return Home and open another project. Pass: no abrupt click, hanging notes or
   audible return of the previous project's delay. Keep mixer levels within the
   demo's intended range; listen to the loudest planned section as well.
3. **Check editing and instruments.** Draw, move, resize and double-click-delete
   notes; edit velocity; change instrument; toggle Channel Rack steps, mute/solo
   and volume. Add a pattern, resize it, load a preset, and edit Playlist clips.
   Double-click a clip to edit its pattern. Test PAT, SONG and Loop-off playback.
   Pass: the visible edit matches what plays and the other patterns are preserved.
4. **Load the real Grand Piano.** With internet available, select Grand Piano and
   wait for “Piano ready”; audition keys and a chord. If samples fail, use Retry
   or switch to Studio Synth and confirm synthesized playback still works.
   Tone Sampler's existing same-pitch overlapping-note release behavior is not
   fixed by this reconciliation; inspect any demo passage that depends on it.
5. **Use two independent browser sessions.** Create a disposable local project.
   Copy Share into an incognito window or a second browser. Edit different channels
   in both sessions, then change notes, BPM and a Playlist clip. Wait for Saved,
   reload one session and reopen the project. Make one more edit and immediately
   go Home, then reopen. Pass: both sessions converge, reload preserves edits and
   the final edit survives navigation. Do not use production projects for this.
6. **Review the layout and standalone page.** Resize to phone/tablet widths.
   Reach the transport, pattern selector, all view tabs and the Piano Roll grid
   through their scroll areas. Stop other tabs, then open `/audio-test.html` and
   audition drums, bass, melody and chords, followed by Stop and Reset engine.
   Pass: controls remain reachable and the standalone page remains playable.

Before pressing Merge, confirm GitHub still shows PR #10 as mergeable at the
reported tested commit, review any newly appearing checks, and resolve any failed
manual item. Merging and deployment remain separate approvals.
