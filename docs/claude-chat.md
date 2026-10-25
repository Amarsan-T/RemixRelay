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
4. Optionally set `CLAUDE_MODEL` in the same server environment. The default is
   `claude-opus-5-5`, verified in the
   [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview).
   `claude-sonnet-5-5` is also supported. Other model IDs omit model-specific
   effort and fallback options; availability depends on the Anthropic account.
5. With `.env.local` selecting `CONVEX_DEPLOYMENT=dev:...`, run
   `npx convex dev --once` and `npm run dev -- --port 5199`.
6. After rotation, run `npm run test:chat:dev -- --with-claude` and
   `npm run test:chat:browser -- http://localhost:5199/ --with-claude`.
   These verify real replies, saved musical context, and recent-turn memory.

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
