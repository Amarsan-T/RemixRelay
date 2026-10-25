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

## For the Claude assistant

Call Claude from a Convex **action** so the API key stays on the server:

```sh
npx convex env set ANTHROPIC_API_KEY sk-ant-...   # never in .env.local, never VITE_*
```

```ts
// convex/assistant.ts
'use node'
import { action } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

export const ask = action({
  args: { projectId: v.id('projects'), question: v.string() },
  handler: async (ctx, { projectId, question }) => {
    const project = await ctx.runQuery(internal.projects.load, { id: projectId })
    if (!project) throw new Error('Project not found')
    // project.data is a StudioProject: bpm, channels, stepData, pianoNotes, mixerTracks, song...
    // ...call Claude with a compact summary of project.data and the question...
    // To change the music, replace whole fields; every open studio updates live:
    // await ctx.runMutation(internal.projects.saveFromServer, { id: projectId, fields: { pianoNotes }, source: 'assistant' })
  },
})
```

In the browser, the open project's id is the `project` URL parameter.

## Running it

- `npx convex dev` keeps the deployment named in `.env.local` up to date while you work.
- Without `VITE_CONVEX_URL`, the app still runs, keeping projects in memory only.
- Anyone with the app's URL can list, open, and edit every project: there is no login.
