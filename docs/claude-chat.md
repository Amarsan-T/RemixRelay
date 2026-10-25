# Claude chat

Each project has a shared AI Chat in `src/assistant/AssistantChat.tsx`.
`chat.send` saves the user message and a pending reply atomically, then schedules
the Node action `chatAgent.respond`. The action reads the saved project and
finished conversation, calls Anthropic on the server, and stores the outcome.
Convex subscriptions update every browser. Messages survive reloads and reopening
the project. The panel waits for music edits to save before asking Claude.

`musicContext.ts` describes tempo, instruments, hits, piano notes, the playlist,
and mixer. The whole-song overview precedes detailed patterns so it survives
truncation. Context is capped at 9,000 characters; history uses at most 20
messages and 24,000 characters. This is recent conversation memory, not unlimited
recall of old turns. Storage retains the conversation; the UI shows the latest
100 messages.

## Ordering, retries, and cost

Requests use a browser-generated ID for idempotency. One reply can run per
project. Each attempt is claimed once; an attempt number prevents late results
or watchdogs from overwriting a retry. A scheduled watchdog marks abandoned
replies failed after 2 minutes. Only the latest failed turn can be retried.
Retries reuse the reply record and count as new attempts in `chatAttempts`:

- 5 per minute and 40 per hour per project.
- 300 per hour across projects.
- 2,000 characters per question and 4,096 output tokens per response.
- SDK automatic retries are disabled; retries are explicit and counted.

These application limits complement an Anthropic account spending cap.
**Everyone with a project link shares its chat. There is no login.**

## Secure development setup

1. Revoke the old Anthropic key committed on the historical
   `claude-implementation` branch. Treat it as compromised even if removed from
   the latest files. Never reuse it. Coordinate repository-history cleanup
   separately; this integration does not merge that branch or rewrite history.
2. Create a fresh key in Anthropic Console and set an account spending limit.
3. Open the Convex dashboard and explicitly select this project's
   **Development** deployment (`watchful-sockeye-395`). In Settings > Environment
   Variables, add `ANTHROPIC_API_KEY` using the dashboard's secret entry field.
   Do not paste it into chat, a command argument, React, any `VITE_*` variable,
   `.env.local`, Vercel, or Git.
4. If the key is not scoped to a workspace, also set `ANTHROPIC_WORKSPACE_ID`
   in the same Convex server environment. Copy the intended workspace ID from
   [Anthropic Console Workspaces](https://platform.claude.com/settings/workspaces).
   The action sends it as `anthropic-workspace-id`; workspace-scoped keys can
   omit this setting. See [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication).
5. Optionally set `CLAUDE_MODEL` in the same server environment. The default is
   `claude-opus-5-5`, verified in the
   [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview).
   `claude-sonnet-5-5` is also supported. Other model IDs omit model-specific
   effort and fallback options; availability depends on the Anthropic account.
6. With `.env.local` selecting `CONVEX_DEPLOYMENT=dev:...`, run
   `npx convex dev --once` and `npm run dev -- --port 5199`.
7. After rotation, run `npm run test:chat:dev -- --with-claude` and
   `npm run test:chat:browser -- http://localhost:5199/ --with-claude`.
   These verify real replies, saved musical context, and recent-turn memory.
8. For detailed real-provider verification, run
   `npm run test:chat:real -- --with-claude http://127.0.0.1:5199/`.
   It creates only disposable Development projects and checks specific
   instruments, note pitches/start steps, pattern lengths, playlist clips,
   memory after refresh, a live tempo edit, project isolation, and UI retry
   after a controlled context error. It makes paid requests only when explicitly
   given `--with-claude`; transcripts and results stay in ignored
   `test-results/real-chat/`.

Listing the environment variable name alone does not prove a usable value is
available. A deployment administrator can safely check server-side presence with
`npx convex run --deployment watchful-sockeye-395 --inline-query '({ configured: Boolean(process.env.ANTHROPIC_API_KEY) })'`.
This returns only a boolean, never the key. If chat still reports "no API key,"
re-save a nonempty fresh value on that exact deployment and retry a disposable
conversation. Do not export the environment values into logs or source files.

The [server-side fallback beta](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)
and low-effort setting are enabled only for the known compatible model IDs.
Production enablement is a separate owner-approved step. This work does not
deploy a production backend, change production secrets, or deploy Vercel.

## Verification

- `npm test`: existing unit tests, context/history checks, and deterministic
  Convex tests. The Anthropic HTTP boundary is mocked for success, failure,
  concurrency, retry races, watchdogs, memory, isolation, and budgets.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run test:e2e`: the Aero/audio suite plus a chat persistence, reconnect,
  concurrency, and project-isolation scenario on disposable local Convex.
- `npm run test:chat:dev`: live Development backend checks, expecting the
  missing-key error unless `--with-claude` is explicitly supplied.
- `npm run test:chat:browser -- http://localhost:5199/`: two-browser chat checks.
- `npm run test:collab:browser -- http://localhost:5199/`: music collaboration
  in independent browser contexts while playing and editing.
- `npm run test:studio:browser -- http://localhost:5199/`: audio/studio smoke
  checks. These use installed Chrome; `CHROME_PATH` overrides its path.

Live backend/browser checks create separate test projects in Development and
refuse production or mismatched deployment URLs. Screenshots go to ignored
`test-results/browser/`. Test projects are retained; no existing data is deleted.

## Final release after approval

Development settings do not configure Production. After the reviewed PR is
approved and merged, the release still needs these separate steps:

1. Deploy the reviewed Convex schema/functions to the existing Production
   deployment `silent-butterfly-873`, including `chatMessages`, `chatAttempts`,
   their indexes, and the chat action. Do not import Development test data.
2. Configure a fresh server-only Production `ANTHROPIC_API_KEY`, and
   `ANTHROPIC_WORKSPACE_ID` if that key is not workspace-scoped. Set
   `CLAUDE_MODEL` only if overriding the default. Neither the API key nor the
   workspace setting belongs in React or Vercel frontend variables.
3. Build Vercel from the approved revision using Node 24, `npm ci`,
   `npm run build`, and output `dist`. Public Production build settings are:
   `REMIXRELAY_DEPLOYMENT_MODE=collaborative-demo`,
   `REMIXRELAY_CONVEX_PRODUCTION_NAME=silent-butterfly-873`, and
   `VITE_CONVEX_URL=https://silent-butterfly-873.convex.cloud`.
4. Publish manually after release approval; automatic Git deployments remain
   disabled. Then perform the approved hosted chat, persistence, collaboration,
   and audio smoke checks. A first visit to an empty Production database seeds
   the shipped demo projects, so include that data write in release approval.
