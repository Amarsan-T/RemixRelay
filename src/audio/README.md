# RemixRelay audio engine

Framework-independent Tone.js engine for one 16-step bar in 4/4. No samples, React,
Convex, or network requests are needed. Public imports come from `src/audio/index.ts`.

## Listen

Run `npm run dev`, then open **http://localhost:5173/audio-test.html** (use the port
printed by Vite if 5173 is occupied). Click **Play** to unlock browser audio.

- Hear kick, snare, closed/open hats, bass, melody, and chords together.
- Mute the other tracks to isolate an instrument; adjust each track's volume.
- Change BPM or switch live presets while playing. The playhead should keep moving.
- Turn Loop off to stop at the current bar's end. Play always starts at step 0.
- Try Play → Stop → Play and Reset engine → Play to check resource cleanup.
- Expand Pattern JSON to edit pitches, durations, or drum hits and apply them live.
  Invalid snapshots display an error and leave the previous pattern intact.

`npm run build` includes both the existing main app and `dist/audio-test.html`.
`npm run preview` serves the built test page at `/audio-test.html` as well.

Run `npm run test:audio` for data/API regression tests (Node 24, no browser needed).
With the dev server running, open `/tests/audio-runtime.html` and click **Run audio
checks** for real browser signal checks covering all seven synthesized voices,
stop silence, looping, live updates, muting, one-shot playback, context disposal,
and pending-start cancellation. This developer test page is served only in dev;
the listening page is included in production builds.

## Quick start

```ts
import { AudioEngine, createDemoPattern } from './audio'
import type { MusicalPattern, Track } from './audio'

const engine = new AudioEngine(createDemoPattern())
const unsubscribe = engine.subscribe(({ status, step, bpm }) => {
  // Update UI here. step is 0–15, or null when stopped.
  console.log(status, step, bpm)
})

// Invoke directly from a click/tap handler (before unrelated async work).
async function onPlayClick() {
  try {
    await engine.play()
  } catch (error) {
    // Surface browser/Web Audio initialization failures in the UI.
    console.error(error)
  }
}

engine.setBpm(128)
engine.setLoop(true)
engine.setTrackMuted('bass', true)
engine.setTrackVolume('melody', -18)
engine.stop()

// On component teardown:
unsubscribe()
engine.dispose()
```

Create one engine for the studio, and give controls/Piano Roll access to that
instance. Its constructor is safe before a user gesture: audio is allocated lazily.
In React, create it inside an effect, store it in a ref, and dispose in the effect's
cleanup. React StrictMode runs setup/cleanup twice in development, so create a fresh
instance on each effect setup. Never reuse a disposed instance.

## Playback API

| Method | Behavior |
| --- | --- |
| `new AudioEngine(pattern?)` | Validate/copy a pattern; defaults to demo A. No AudioContext yet. |
| `initialize(): Promise<void>` | Lazily create/resume audio from a user gesture. Optional; `play()` does this too. |
| `play(): Promise<void>` | Start at step 0, or keep the current run. Concurrent calls share initialization. Rejects on audio setup failure. |
| `stop(): void` | Immediately silence, clear owned events/voices, rewind; cancel an in-flight Play. Repeated calls are safe. |
| `setBpm(bpm)` | Set 40–240 BPM without restarting the Transport. |
| `setLoop(boolean)` | Repeat one bar, or stop at the next bar end. |
| `setTrackMuted(id, muted)` | Gate the whole track, including sustained notes; skip new notes while muted. |
| `setTrackVolume(id, volumeDb)` | Set track gain from -60 to 0 dB with a short ramp. |
| `setPattern(pattern)` | Validate and copy a complete snapshot atomically. Empty tracks are allowed. |
| `setTrack(track)` | Upsert a complete track by `id`; preserves existing track ordering. |
| `removeTrack(id)` | Remove/dispose one track. Unknown ids throw. |
| `getPattern()` | Return an editable deep copy, never an internal reference. |
| `getState()` | Return `{ status, step, bpm, loop, initialized }`. |
| `subscribe(listener)` | Immediately deliver state; return unsubscribe. Later playhead events align with audible audio via Tone Draw. |
| `dispose()` | Stop, dispose synths/mixer/Transport/context, remove listeners. Terminal and idempotent. |
| `validatePattern(value)` | Runtime assertion for unknown JSON or backend data. Throws `TypeError` with a useful message. |
| `createDemoPattern('A' \| 'B')` | Fresh, editable four-track preset. Defaults to A. |

`setPattern`, `setTrack`, and setters are synchronous and work before initialization,
while stopped, and during playback. Invalid data throws before changing the current
pattern. Unknown track ids throw `RangeError`. Methods other than getters, `stop`,
and `dispose` throw after disposal.

## Musical data contract

All fields use JSON-serializable strings, numbers, booleans, arrays, and objects.
Interfaces are in `types.ts`: `MusicalPattern`, `Track`, `DrumTrack`,
`InstrumentTrack`, `DrumPattern`, `DrumStep`, `NoteStep`, and `MusicalNote`.

```ts
const pattern: MusicalPattern = {
  bpm: 120,
  loop: true,
  tracks: [
    {
      id: 'drums', name: 'Drums', type: 'drums', muted: false, volumeDb: -6,
      pattern: {
        kick: [{ step: 0, velocity: 1 }, { step: 8, velocity: 0.9 }],
        snare: [{ step: 4 }, { step: 12 }],
        closedHat: [{ step: 2 }, { step: 6 }, { step: 10 }],
        openHat: [{ step: 14, velocity: 0.5 }],
      },
    },
    {
      id: 'chords', name: 'Chords', type: 'chords', muted: false, volumeDb: -20,
      steps: [{
        step: 0,
        notes: ['C4', 'Eb4', 'G4'].map((pitch) => ({
          pitch, durationSteps: 8, velocity: 0.65,
        })),
      }],
    },
  ],
}
engine.setPattern(pattern)
```

- All positions are **zero-based sixteenth notes**: 0–15. Steps 0, 4, 8, 12 are beats.
- `durationSteps` is > 0 and ≤ 16; e.g. 0.5 = 32nd note, 1 = 16th, 4 = quarter.
- Pitches use capital A–G, optional `#`/`b`, octave 0–8 (e.g. `C2`, `F#4`, `Bb3`).
- Optional velocities are 0–1; default 0.8. Zero is silent.
- Track types are `drums`, `bass`, `melody`, `chords`; ids must be unique/nonempty.
- All four drum voice arrays are required; an empty array is silence.
- Empty note arrays are rests. Up to eight notes per step form a chord. Combine
  duplicate/enharmonic pitches into one note. Duplicate step positions are rejected
  within each drum voice or pitched track; combine notes at the same position.
- Up to 32 tracks; each pitched track has 32-voice polyphony. Prefer the four demo
  tracks and sparse overlapping notes for the hackathon MVP.

## Shawn: connect the Piano Roll

Convert cells into a complete `InstrumentTrack.steps` array. Pass edited data to the
shared engine. No Piano Roll implementation lives here.

```ts
function onPianoRollChange(updatedTrack: Track) {
  engine.setTrack(updatedTrack)
}

// Or edit a copy, preserving unrelated tracks/settings:
const melody = engine.getPattern().tracks.find((track) => track.id === 'melody')
if (melody && melody.type !== 'drums') {
  melody.steps = [{ step: 0, notes: [{ pitch: 'G4', durationSteps: 2 }] }]
  engine.setTrack(melody)
}
```

## James: connect Convex snapshots

Map database documents to this plain data shape, stripping database metadata as
needed. Keep ownership/sync logic in the backend/UI integration layer.

```ts
import { validatePattern } from './audio'

function onPatternSnapshot(snapshot: unknown) {
  validatePattern(snapshot)
  engine.setPattern(snapshot)
}
```

## Timing and lifecycle

Every engine owns a private `Tone.Context` and its `context.transport`. All its
tracks run from one `scheduleRepeat(..., '16n')` callback, using the precise audio
time supplied by Transport. There are no per-track browser timers. The engine
does not change Tone's global context, global Transport, or master destination.
Existing app synths can continue to use them independently.

Updates affect the next not-yet-scheduled step without rewinding. Tone schedules
about 50 ms ahead, so a just-scheduled hit may still sound after an edit. Sustained
notes finish their existing envelopes; changing a track's type/removing it disposes
its voices immediately. A closed hat chokes an open hat in the same drum track.
Mute gates sustained output immediately with a 5 ms ramp; unmuting can reveal a
still-decaying tail. Note durations are converted to seconds at onset; a later BPM
change affects future note durations and step timing, while held notes retain
their original duration. Notes can sustain over loop boundaries. One-shot mode
silences tails at the bar boundary.

Stop disposes voices so old delayed releases cannot cut notes in the next run.
Dispose also closes the private AudioContext. Stop/dispose while audio is starting
cancel that start; a stale async continuation cannot restart playback. Tone Draw
drives only UI notifications, so background-tab rendering throttling does not
control musical timing. A short browser timer performs cleanup after the precise
Transport-scheduled one-shot stop; it does not schedule notes.

Browser audio needs a user gesture and a supported Web Audio environment (localhost
or HTTPS). Catch `play()`/`initialize()` errors. Call `dispose()` on teardown/HMR;
the standalone page handles HMR cleanup and stops when navigating away.
