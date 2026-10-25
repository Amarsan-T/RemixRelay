# Aero studio integration and verification

## Baseline and scope

This integration starts from origin/main b37bfd8. Shawn's origin/feature/aero-ui
f51c660 was already its ancestor: the sky/grass background, bubbles, glass
primitives, glossy transport, Metro tabs/watermark, dark panels and mixer strips
were retained. No second branch merge or replacement studio was needed.

The active application still uses useStudioProject -> patternAdapter ->
useStudioAudio -> AudioEngine. SyncedApp/useProjectSync remain the Convex bridge.
The backend schema, functions, generated API and deployment settings are unchanged.

## Behavior repaired

- Responsive transport and tools wrap instead of hiding playback, patterns or
  view tabs. Narrow screens can search projects. A shared Channel Rack scroll
  keeps step columns aligned. Panels retain their editing height and scroll in
  the workspace instead of compressing the phone Piano Roll to one visible row.
- Default playback matches the opened arrangement. Blank projects open in PAT
  mode in the Channel Rack. Opening a playlist pattern selects PAT playback.
- BPM accepts partial typing; Enter/blur commits a rounded, valid value and
  Escape cancels. Tap tempo starts a fresh sequence after an idle gap.
- Atomic pattern edits update notes and gates together. Randomize clears old
  authored notes that would otherwise keep playing behind unlit steps. Presets
  fill the selected length, trim notes at its end, and preserve other patterns,
  instruments and playlist data.
- Drag pointer capture stays on existing notes/clips, preserving double-click
  delete/edit actions. Playlist clips also support Enter to edit and
  Delete/Backspace to remove.
- Piano Roll selection resets across channel/pattern changes. Velocity audition
  reaches the shared engine. Piano samples expose loading/failure/retry, with
  Studio Synth available as a network-independent alternative. Loading a
  remote/project piano does not automatically initialize audio or audition.
- Mixer FX/pan/solo and pattern controls have explicit accessible names/state.
  The master faders continue to edit the same project field.
- Project creation prevents duplicate submissions and reports failure. Loading
  and missing-project states use the Aero design. Sharing retains its clipboard
  fallback and cleans up its confirmation timer.

## Playback reliability

The old pitched PolySynth path deferred future releases through JavaScript
timeouts. ScheduledSynth keeps bounded, prepared monophonic Tone voices and
submits each note's attack and release together on the audio clock. It includes
release tails across loop boundaries and arbitrary pattern lengths. Preparation
happens on edits/startup/preview, not in Transport callbacks. Named synth patches,
their oscillators/envelopes/effects, and the sampled piano remain available.

Overdue Transport ticks after a main-thread stall are skipped, preventing old
attacks from being replayed together. Ordinary edits and repeated Play calls
retain the existing schedule IDs. Stop/disposal clear their resources.

Chrome measured a 1.66 full-scale output transient with the previous +15 dB boost.
The pre-limiter boost is calibrated to +9 dB separately from the voice/scheduling
fix. No additional limiter was added. This does not promise a clipping ceiling
for arbitrary user-authored gain/effect combinations.

## Run checks

Requires Node 24 and an installed Google Chrome.

- npm ci
- npm test
- npm run test:audio
- npm run lint
- npm run typecheck
- npm run build
- npm run test:e2e

The browser runner creates an anonymous Convex backend in a fresh temporary
directory, with a copy of the existing functions and a junction to installed
dependencies. It clears inherited deployment credentials/selection, uses random
loopback backend ports, and stops its process tree afterwards. No existing cloud
database, developer configuration, or project data is used. Temporary test
records are never imported into production.

Playwright launches Vite on ports 5285/5286 by default; set REMIXRELAY_E2E_PORT to
choose a different pair. A standalone Playwright run can optionally receive
REMIXRELAY_E2E_CONVEX_URL; configuration rejects non-loopback URLs, and tests
block cloud Convex requests. Running npx playwright test alone skips the
collaboration case if no local backend is supplied; the npm runner runs it.
Test servers disable HMR and file watching so a documentation edit or concurrent
build cannot reload a page halfway through the 64-loop check.

The installed Windows Chrome runner did not advance a minimal AudioContext's
clock with its physical output. The test launch uses Chromium's supported
--disable-audio-output fake stream, retaining Chrome's real Web Audio graph,
DSP and timing. This is signal verification, not listening through speakers.
See Chromium's media switches source:
https://chromium.googlesource.com/chromium/src/+/HEAD/media/base/media_switches.cc

Runtime silence checks wait on the rendered audio clock, then verify channel
gates before the master effects and final output after their history clears.
The original silence thresholds are retained; effects are not mistaken for a
failed individual mute.

Browser coverage includes independent project state, tempo editing, patterns,
step gates, Piano Roll draw/move/resize/delete/velocity, instruments, mixer,
playlist clip placement/drag/edit/delete, responsive controls at 390/768/1440px,
sample failure/retry with deterministic WAV fixtures, context lifecycle,
all existing audio runtime assertions, and 64 continuous real-time loop
repetitions with live snapshots/repeated Play and on-grid onset checks.

The collaboration case uses two isolated Chrome contexts with real WebSocket
subscriptions to local Convex: concurrent edits, autosave, project creation,
reload persistence, sharing, offline recovery, navigation and debounce flushing.

## Limits

- Subjective listening on the demo machine and physical output devices remains
  a manual check. The synthetic engine works without samples; Grand Piano still
  requires its public sample downloads in actual use. Browser sample recovery
  tests use fixtures rather than depending on that external server.
- Production collaboration and Vercel publication were not tested or changed.
- No authentication was added. Existing public-project access behavior remains.
- James's Claude work and the separate uncommitted sound-design/profile work
  were not merged or overwritten.
- Dormant legacy export screens were not turned into a second active studio.

## Verified results

- npm test: 63/63 passed, no skips.
- npm run test:audio: 41/41 passed, no skips.
- npm run lint: passed without warnings.
- npm run typecheck: passed.
- npm run build: passed with the reviewed collaborative-demo production settings;
  both index.html and audio-test.html were emitted. Building does not deploy or
  contact the production database; that bundle was not opened against production.
- npm run test:e2e: 17/17 passed in 3.1 minutes, no skips, using anonymous local
  Convex and two isolated Chrome sessions. The BPM case was additionally rerun
  after adding explicit tap-tempo idle-reset timing assertions.
- The final 64-loop Chrome run retained four Transport registrations, at most
  six prepared voices per instrument, and no dropped voices. Onsets stayed on
  grid; late/early RMS ratio was 0.99449; maximum measured output was 0.84048.
  Stop left zero output, owned events and instrument racks.
- All five synthesized named instrument presets produced finite audio, no dropped
  voices and successful cleanup. The piano sample failure/retry case passed with
  decoded WAV fixtures.
- Original sound-design branch, HEAD, dirty/untracked status and all 52 file
  fingerprints were unchanged. Existing worktrees, main and aero-ui were not
  rewritten. Convex/deployment files have no integration diff.
