# RemixRelay

> Submission draft for Cal Hacks 13.0. Feature claims below describe `origin/main` at `e61643d`, including PR #6 and the latest Empty Template/additional-pattern changes, reviewed 2026-10-24. Production deployment and real-browser verification remain pending. No submission has been made.

## Problem we are solving

Making music together often starts with friction: installing a workstation, learning its controls, and passing project files between people. We want people to get from a musical idea to an editable beat quickly, with a browser studio that can grow into a shared creative workspace.

## Our solution

RemixRelay is a browser-based music studio built around a fast remixing workflow. Start with a beat, change the rhythm, shape a melody in the Piano Roll, arrange patterns in the Playlist, and hear the result through a shared Tone.js playback engine.

The integrated app supports composition, playback, and Convex-backed shared projects. With the backend configured, a project link opens the same editable workspace in another browser and changes are saved through Convex. **Claude-assisted creation is still in progress and is not required for the studio or collaboration.** Production collaboration must still be verified on the published website.

## How it works

1. Open a demo project such as House Party, Trap Heat, Night Drive, or Study Beats, choose Empty Template, or create a blank project.
2. Load one of four musical presets: Trap Heat, House 4-on-Floor, Synthwave 80s, or Lo-Fi Chill. Edit drum steps in the Channel Rack.
3. Use the Piano Roll to draw, move, resize, and adjust the velocity of melodic notes. Its edits update the same project data used by playback and the Channel Rack.
4. Add patterns and build an arrangement by placing and moving their clips in the Playlist. PAT plays the selected pattern; SONG plays the arrangement. Added pattern counts are included in shared project saves.
5. Adjust tempo, looping, mute/solo, channel levels, pan, and mixer filter/delay/distortion controls while listening.
6. With Convex configured, copy the Share link to another browser, exchange edits, and wait for Saved before leaving. This demo has no accounts or private projects: all projects on its backend are publicly readable and editable.

The default studio sounds are synthesized in the browser. Additional instrument choices include Synth Lead, Deep Bass, Warm Pad, Pluck, Chiptune, and Grand Piano. Grand Piano downloads external samples; the synthesized choices provide a network-independent sound source after the app loads.

With Convex configured, projects persist in the backend and share links use `/?project=<id>`. Without it, the same studio runs locally in memory and refresh loses edits. WAV/MP3 export code exists in separate screens, but those screens are not reachable from the active studio; studio export is pending integration.

## Tech stack

| Layer | Current implementation |
| --- | --- |
| UI | React, TypeScript, Tailwind CSS, Lucide icons |
| Build | Vite; production entries for the studio and standalone audio test page |
| Music editing | Channel Rack, Piano Roll, Playlist, shared typed project/pattern data |
| Playback | Tone.js with synchronized Transport scheduling and per-channel/mixer controls |
| Deployment target | Vercel static hosting with deployment checks; build verified locally, publication pending approval |
| Backend | Convex queries, mutations, shared project links, change-based autosave, and live subscriptions |
| Planned AI | Claude Chat; independently in development, absent from this snapshot |

## What makes it unique

Our focus is the handoff between a quick beat and a fuller arrangement. The Channel Rack, Piano Roll, and Playlist let someone work at different musical levels while feeding the same studio playback path. Genre presets make the first interaction immediate, while direct note and clip editing make the result personal.

Convex extends that workflow to people passing ideas back and forth in a shared project. Changes to different channels use separate save paths so one person's drum edit can coexist with another person's melody edit. Playback runs locally in each browser; cross-device playback synchronization is not claimed. The production two-browser rehearsal remains a release gate.

## Technical challenges

- Translating step gates, pitched notes, velocities, pattern lengths, and Playlist clips into consistent playback data.
- Keeping browser audio initialization, Transport scheduling, live edits, and teardown separate from React rendering.
- Connecting independently developed UI, Piano Roll, and audio modules without duplicating the studio's musical state.
- Balancing synthesized instruments, mixer effects, and optional sampled instruments. Reliable long-loop playback and sample-loading behavior remain final-demo verification tasks.

These are engineering areas addressed by the code and integration work; this draft does not claim that every runtime edge case has been resolved.

## Team contributions

Roles supplied by the team; confirm public names and final attribution before submission:

| Team member | Contribution / status |
| --- | --- |
| Martin | Main React studio interface and design; integrated into the current app |
| Shawn | Piano Roll component; used by the integrated studio |
| Audio engine lead (add public name) | Tone.js audio engine, instruments, playback, and audio integration |
| James | Convex backend and Claude AI work; Convex collaboration is merged in PR #6, Claude Chat remains in progress |

## Future improvements

- Verify the merged Convex collaboration on an isolated production database and the published site.
- Add Claude-assisted music workflows through the existing authorized backend, keeping API keys server-side.
- Finish studio export integration and improve save/reconnect feedback.
- Add backend authentication, project permissions, stronger validation, and abuse controls before offering private projects or a general service.
- Validate extended looping, repeated playback, sample failures, and lower-powered devices against the final release.
- Improve onboarding, recovery from lost connectivity, and the shared-session workflow.

## Before publishing

Replace this draft's release reference with the final tested commit, update feature statuses from evidence, add the approved public demo/repository/video links and screenshots, confirm sample and asset credits, and review the event's actual submission rules. Do not submit this review note or unverified claims as finished functionality.
