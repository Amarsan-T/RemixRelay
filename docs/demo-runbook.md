# RemixRelay live demo runbook

Baseline: `origin/main` at `e61643d`, reviewed 2026-10-24, including PR #6 collaboration and the latest Empty Template/additional-pattern changes. This is a source-grounded rehearsal plan, **not a record of listening verification**. Convex collaboration is integrated; its production deployment and two-browser verification are pending. Claude Chat is independently in progress and is not needed for this demo.

## Prepare the demo machine

- [ ] Build the approved release and keep a local copy of its production output. Do not rely only on venue Wi-Fi.
- [ ] From that release's worktree root, run:

  ```powershell
  npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
  ```

- [ ] Open **http://127.0.0.1:4173/** in local Chrome. The standalone diagnostic page is **http://127.0.0.1:4173/audio-test.html**. These are local URLs, not public submission links. If the port is occupied, resolve it explicitly rather than assuming a different URL.
- [ ] Connect the intended speakers/headphones and recording output. Click Play once to unlock audio; confirm browser/OS volume and output device. Keep the active demo tab in the foreground.
- [ ] Open **House Party** (House 4-on-Floor, 124 BPM). Leave default Studio Synth sounds selected; avoid Grand Piano and New channel during the baseline demo. Adding a channel can select Grand Piano.
- [ ] Select PAT and Pattern 1. In Channel Rack or Piano Roll, set **Pattern length in steps to 16** and commit the input. This revision defaults to 64 steps, while shipped preset notes occupy the first 16; leaving 64 can produce three empty bars in PAT mode. Check mute/solo states and restore intended levels.
- [ ] In the disposable rehearsal project, after setting Pattern 1 to 16 steps, set Playlist Length to **4 bars**, use Clear song, select Pattern 1, and place one clip at the start of each of bars 1–4 on the first track. Current shipped clips start at bars 1 and 5 because default patterns span four bars; shortening a pattern does not move its clips. This explicit rehearsal arrangement avoids silent gaps. Do this in local mode, or only after production data-write approval.
- [ ] Rehearse the script below, then restore the starting steps/notes. In local mode, HOME/back retains edits but refresh resets projects. In Convex mode, changes persist: wait for Saved before navigating or reloading, and use a disposable public demo project. Do not assume refresh will undo shared edits.
- [ ] For a collaborative demo, complete the isolated-production-backend steps in the [deployment checklist](vercel-deployment-checklist.md). Never use the existing dev database or sensitive project data.
- [ ] Prepare a locally stored screen/audio recording and screenshots of a verified run. Record a backup separately; the active studio does not expose the export code found in other screens.
- [ ] Record the tested release SHA, browser version, audio device, selected preset, and any failures.

## Two-minute demonstration script

| Time | Say | Do |
| --- | --- | --- |
| 0:00–0:15 | “RemixRelay helps people turn a musical idea into an editable beat and arrangement in the browser.” | Show the project home, then open House Party. |
| 0:15–0:35 | “A preset gives us a starting groove. All these parts share the same playback engine.” | Select PAT / Pattern 1, show 124 BPM, and click Play. Let a few bars play. |
| 0:35–0:55 | “We can reshape the rhythm immediately.” | Open Channel Rack. Toggle one rehearsed hi-hat step and toggle it back. Briefly mute/unmute Sub 808. |
| 0:55–1:20 | “The Piano Roll edits the notes that this same pattern plays.” | Open Piano Roll, select Retro Lead. Move one rehearsed note and adjust its length; listen to the changed phrase. Stop before changing playback mode. |
| 1:20–1:45 | “Patterns become clips in an arrangement.” | Open Playlist at 4 bars. Right-click the last clip to remove it, select Pattern 1, and click that empty bar to replace it. Select SONG, then Play. Show the Playlist playhead. |
| 1:45–2:00 | “The mixer balances the track. Convex saves shared projects; Claude Chat is a separate next step.” | Show Mixer, adjust one rehearsed level, then Stop. If the two-browser rehearsal passed, briefly show the pre-opened second browser receiving an edit. Otherwise state that production collaboration is awaiting verification. |

Skip optional edits if rehearsal shows they take too long. Do not improvise with Randomize, Clear, Clear song, a new project, or instrument/sample downloads during the timed presentation. Only include live collaboration after the production rehearsal below passes.

## Working baseline scenario and acceptance checklist

The baseline scenario is House Party → PAT / Pattern 1 → explicit 16-step length → default synthesized sounds → 124 BPM → edit one step and one lead note → four-bar Playlist → SONG playback. It works in local-only mode without backend or sample downloads. Collaboration adds the configured Convex dependency. Every listening/browser item below is pending manual verification on the final release.

| Area | Check and expected result |
| --- | --- |
| Play/Stop | Click Play from a fresh page after opening a project; audible drums, bass, and lead start together. Stop clears the playhead and playback. Allow intended short effect tails, but no continuing loop. Restart repeatedly; no doubled beats or increasing volume. |
| BPM and loop | While playing PAT, test 85, 124, and 140 BPM, then restore 124. Parts remain synchronized. With Loop off, playback ends at the selected pattern/song end; with Loop on, it repeats. |
| Long-loop audio | Run at least 10 minutes across representative presets/BPMs, including the exact final demo setup. Listen for crackling, distortion, dropped notes, or rising output over time. Record failures; the sound-design fixes in another checkout are not assumed to be in main. |
| Channel Rack | Toggle an unlit step on/off and hear its effect. Mute/solo and volume/pan affect the intended channel; restore states. |
| Piano Roll | Select Retro Lead. Draw a note, move pitch/start, resize duration, and change velocity in Velocity mode. Confirm the audible change and matching step starts in Channel Rack. Remove the test note with right-click or double-click. |
| Playlist | Use 4-bar Length and Pattern 1. Click an empty grid cell to place a clip, drag to move, right-click to remove. Double-click a clip opens its pattern in Channel Rack; select Piano Roll to edit notes. SONG plays placed clips; PAT plays only the selected pattern. |
| Presets | In a disposable/reset demo, load Trap Heat (140), House 4-on-Floor (124), Synthwave 80s (110), and Lo-Fi Chill (85). Check displayed BPM, steps, notes, and playback. Loading a preset replaces the active pattern; return to a known baseline afterward. |
| Mixer | Verify channel/bus/master levels, mute/solo, pan, filter, delay, and distortion controls audibly affect the intended output. Restore demo values. |
| Navigation/cleanup | Stop, go HOME, reopen the same project, and confirm edits persist. Open another project and ensure the previous one is not still playing. In Convex mode, wait for Saved and verify refresh preserves edits; local-only mode resets on refresh. |
| Production URLs | Direct-load and refresh `/` and `/audio-test.html` from the built site. Verify audio in Chrome on the actual presentation device. |

## Two-browser collaboration — integrated; production rehearsal PENDING

Use only the approved disposable production database, never the existing dev database. All projects on this backend are public and editable. Two tabs showing similar local demos are not proof of collaboration.

1. Open the approved HTTPS site in Chrome. Open a demo project, then click Share and paste the copied `/?project=<id>` link into a second browser/incognito window. Confirm both have Saved/Saving indicators.
2. Change a drum step in browser A and a note on another channel in B. Confirm both changes arrive in both browsers without reload; then test a Playlist clip edit in each direction. Wait for Saved.
3. Reload both browsers and verify the saved changes remain. Check the dashboard's Production data and browser Network host match the selected production deployment. No dev connection is acceptable.
4. Trigger Play separately through a user gesture in each browser. Keep only one output audible to avoid doubling/echo. Shared editing does not imply synchronized playback between devices.
5. Rehearse disconnect/reconnect on disposable data, watch Saving/Offline/Saved behavior, and check persistence. Closing a tab with pending saves is not guaranteed durable; wait for Saved before leaving.
6. Record the release SHA/URL, production deployment, browser versions, and outcomes. Keep keys out of notes/screenshots. Mark the scenario ready only after these checks pass.

## Backup plan

| Failure | Response |
| --- | --- |
| Venue internet or hosted frontend unavailable | Switch to an already built **local-mode** preview at the URL above. A build containing a Convex URL still needs the network; it does not automatically fall back to local editing. Build the backup beforehand with `REMIXRELAY_DEPLOYMENT_MODE=local` and `npm run build:vercel`, and preserve its output separately from the collaborative build. Use Studio Synth, skip collaboration/AI, or use the recording. |
| Claude API unavailable, rate-limited, or unintegrated | Continue preset-driven local editing and playback. State that AI is unavailable/pending; never present preset output as a live Claude response. Do not expose credentials while troubleshooting. |
| Grand Piano silent or samples fail | Stop, open Piano Roll for the affected channel, choose **Studio Synth** (or a rehearsed synthesized choice such as Chiptune), then replay. Grand Piano requires external MP3s and has no automatic synth fallback. The baseline demo avoids it. |
| Silence or wrong output device | Stop; check tab mute, OS device, channel/bus/master mute and solo states. Click Play for browser audio initialization. Check Pattern length is 16 for the baseline preset. Refresh loses local-mode edits but does not reset persisted Convex projects. |
| Crackling, stuck playback, or unstable sound | Stop and switch to the verified recording/local baseline. Do not keep increasing volume or assert the issue is fixed. Preserve the failing preset/BPM/release details for the audio owner. |

## Devpost submission checklist

- [ ] Review the [submission draft](devpost-draft.md) against the final release; remove review notes and update every pending feature honestly.
- [ ] Confirm the event's actual deadline, eligibility, required fields, video rules, and any sponsor requirements. This document does not establish those rules.
- [ ] Confirm all public team names, attribution, repository visibility, and permission to publish.
- [ ] Obtain approval for any push/merge/deployment, then add the final public demo and repository links. Test public access in a fresh browser session.
- [ ] Capture real screenshots and a screen/audio demo from the tested release. Check that the video has audible music and no secrets or private project data.
- [ ] Add video link, stack, team contributions, limitations, future work, and sample/asset licenses or credits as required.
- [ ] Test Play/Stop, Piano Roll, Playlist, presets, and `/audio-test.html` on the deployed release; complete the production collaboration scenario before claiming it. Claude Chat is not part of this release.
- [ ] Keep the local preview, backup recording, and final commit reference ready for judging. A team member must review and explicitly approve the final submission; this preparation does not publish it.
