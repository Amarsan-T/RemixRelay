# RemixRelay on Convex

Projects are saved in Convex and shared live: everyone who opens a project's
link (`/?project=<id>`) edits the same project, and edits show up in the other
browsers in about half a second.

## Data

One `projects` document per project (`schema.ts`):

| Field | Meaning |
|---|---|
| `name`, `color` | Home-screen card |
| `data` | The `StudioProject` (`src/studio/types.ts`) as plain JSON |
| `version` | Goes up by one on every save |
| `updatedAt` | Last save, ms since 1970 |
| `lastClientId` | Browser tab (or server feature) that made the last save |

Saves are lists of changes (`projectChanges.ts`). Steps and piano notes change
per pattern and channel (`['stepData', '1', 'kick']`), so two people drumming
on different channels at the same time keep both edits. Other fields (`bpm`,
`mixerTracks`, `song`...) change as a whole. The last save to the same path wins.

## Functions

| Function | Used by |
|---|---|
| `projects.list` | Home screen (newest first) |
| `projects.get({ id })` | An open studio; `null` for a bad or deleted link |
| `projects.create`, `projects.seedDemos` | New project; demo projects for an empty database |
| `projects.save({ id, clientId, changes })` | The studio's autosave (`src/studio/useProjectSync.ts`) |
| `internal.projects.load({ id })` | Server-side features, e.g. the Claude assistant |
| `internal.projects.saveFromServer({ id, fields, source })` | Server-side features that edit a project |

## Claude chat

The project now has a persistent, shared Claude chat. See
[Claude chat setup and verification](../docs/claude-chat.md) for the server
architecture, limits, secure credential setup, and test commands.

## Running it

- `npx convex dev` keeps the deployment named in `.env.local` up to date while you work.
- Without `VITE_CONVEX_URL`, the app still runs, keeping projects in memory only.
- Anyone with the app's URL can list, open, and edit every project: there is no login.
