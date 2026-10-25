# Python Claude service

React AI Chat → Convex chat.send → durable claim + saved project/history → authenticated HTTPS POST /api/ai → Python/FastAPI → Anthropic → Convex chat.finish → subscribed browsers.

Convex remains the authority for projects, notes, patterns, playlist, BPM, instruments, autosave, collaboration, chat storage, memory, ordering, request IDs, retries and budgets. Its schema, chat mutations and UI are unchanged. No data migration or reset is needed. The Node Anthropic SDK/direct provider path was removed.

## Files and routing

- api/ai.py exports one FastAPI ASGI app; GET /api/ai is a free liveness check and POST /api/ai is the sole paid operation.
- The Vite preset, npm ci, guarded npm run build, dist, SPA fallback and standalone audio-test.html remain. Python never owns / or frontend assets.
- Root requirements.txt contains valid FastAPI/httpx/Pydantic packages; Python 3.12 is selected. Uvicorn is a local test dependency only.
- James's prototype was moved to backend/ by main commit 396b2bd; those files remain unchanged and excluded. No MIDI filesystem tool or old startInquiry/aiAssist route is activated.
- Automatic Git deployments remain disabled, so merging does not publish this architecture.

This uses [Vercel file-based Python Functions](https://vercel.com/docs/functions/runtimes/python/api-directory) alongside the explicit Vite preset, not a Python framework preset or legacy catch-all builder.

## Environment variables

| Location | Name | Purpose |
| --- | --- | --- |
| Vercel server | ANTHROPIC_API_KEY | Provider credential; never VITE-prefixed |
| Vercel server | ANTHROPIC_WORKSPACE_ID | Optional explicit workspace for keys needing it |
| Vercel server | CLAUDE_MODEL | Optional; defaults to claude-opus-5-5; account availability is required |
| Vercel server | AI_SERVICE_TOKEN | New random secret, at least 32 characters; generate 32 random bytes or more |
| Convex server | AI_SERVICE_URL | Exact canonical HTTPS Vercel URL ending in /api/ai |
| Convex server | AI_SERVICE_TOKEN | Same secret as Python; never a browser/deployment credential |
| Convex server | AI_SERVICE_VERCEL_BYPASS | Only if Preview deployment protection requires an automation bypass; server-only |

Keep the existing three Vercel Production build variables unchanged: REMIXRELAY_DEPLOYMENT_MODE=collaborative-demo, REMIXRELAY_CONVEX_PRODUCTION_NAME=silent-butterfly-873 and VITE_CONVEX_URL=https://silent-butterfly-873.convex.cloud. Anthropic settings on Convex are no longer used. No Production setting is changed by implementing or testing this branch.

AI_SERVICE_ALLOW_LOCAL=1 is for disposable local development only; it permits loopback HTTP when the Convex deployment itself is local. Never configure it on cloud deployments. Cloud URLs must use HTTPS *.vercel.app, with no credentials/query/fragment or redirects. Custom domains are intentionally not accepted by this adapter.

## Authentication and cost

Python compares the Bearer token in constant time before parsing request data or contacting Anthropic. Missing/weak configuration fails closed. Docs/OpenAPI and CORS are disabled. GET health discloses no credential state. Only Convex knows the service token; the browser cannot call the paid gateway directly without it.

Convex retains 5 attempts/minute and 40/hour per project and 300/hour globally. Retries create counted attempts; repeated action runs must win the durable claim before making a request. The Python service makes exactly one provider HTTP POST with no automatic retry/fallback, fixed provider origin, bounded timeout, and maximum 4,096 output tokens. Known compatible models request low effort; custom configured models omit that option.

The authenticated payload is strict: project description ≤9,000 characters; system prompt ≤5,000; ≤20 history messages/24,000 total characters; last user message ≤2,000; HTTP body ≤192 KiB. The prompt and context come from the existing server-owned music description/history builders. Responses carry a request ID, status, text, model and token usage. Provider errors are classified into safe codes; raw input, provider responses and secrets are never logged or returned.

Python also caches completed/in-flight request IDs for 5 minutes, at most 128 completed entries and four active requests per process. A reused ID with different content fails. This cache is NOT a distributed lock across Vercel instances; Convex's durable claim is the primary duplicate-billing protection. A transport timeout can be billed without a saved answer; an explicit user retry may incur another charge. Exactly-once billing across a provider/network failure is not promised.

There is still no login or per-person quota. An owner-approved Anthropic organization/workspace dollar cap and monitoring are mandatory before public launch; request counts alone are not a spending cap. Do not enable real credentials on an unreviewed or unprotected endpoint. Rotate any historical compromised key separately.

## Local verification

Use Python 3.12 and an isolated virtual environment:

```text
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r tests/python/requirements.txt
npm ci
npm run typecheck
npm run lint
npm test
.venv/Scripts/python.exe -m unittest discover -s tests/python -p "test_*.py" -v
npm run test:e2e
npm run build
```

On Unix use .venv/bin/python; REMIXRELAY_PYTHON overrides the browser test interpreter. The browser runner starts fresh anonymous local Convex. Its Python-chain case launches real FastAPI over HTTP and mocks only Anthropic, then tests chat persistence, changed project tempo, reload memory and two-browser display. Other browser cases retain audio/collaboration/editing coverage. No shared cloud Development or Production records are mutated by these default tests.

A successful local/mock test does not prove the deployed provider chain. Preview verification must check actual Python health/authentication plus root/assets/deep links/audio-test, then verify a real reply and refresh memory through Convex. A no-key Preview must return 401 without the token and configuration failure with it. Protected Previews also need server-side Vercel automation bypass; do not disable deployment protection to make a test pass.

## Release gates and Production sequence

Do not merge automatically unless all mandatory checks, deployed Python runtime/routing verification and permitted real-provider chain tests pass. Leave the PR open if credentials, spending approval or Preview verification is blocked. Record exactly which boundary was mocked.

After separate Production approval:

1. Fetch main, pin and record the latest reviewed commit. Export a private snapshot of silent-butterfly-873 and record all seven existing project IDs, versions and fingerprints. Pause editing for an accurate before/after comparison.
2. The owner sets a fresh, strong matching AI_SERVICE_TOKEN on Vercel and Convex; Anthropic key/workspace/model exist only on the Vercel server. Confirm the owner-approved provider dollar cap. Never copy secrets through chat, Git, logs or frontend variables.
3. Point Convex AI_SERVICE_URL at the approved Production /api/ai URL and deploy the reviewed Convex functions/schema to silent-butterfly-873 after backend approval. This adds chatMessages/chatAttempts validators and indexes while preserving the projects validator/index. Do not import, seed or reset records. Deploy this backward-compatible backend before publishing the new frontend, so its chat queries already exist. Until Python is published, attempted AI calls fail safely; the existing studio still works.
4. Publish the reviewed Vercel Python/frontend release only after publication approval, keeping Vite/Node 24/npm ci/npm run build/dist and the three public Production variables. Do not select backend/ as a project root. Confirm the deployment lists api/ai as Python 3.12 and old paid routes are 404.
5. Verify all expected functions/indexes and compare the seven projects against the snapshot. Run approved smoke tests on one designated disposable project: real response using BPM/notes/instruments/patterns/playlist, follow-up memory after refresh, separate project history, two-browser updates, autosave/reload, playback/long loops/Stop and standalone audio-test. Confirm requests hit Vercel Python rather than a direct Convex Anthropic call.
6. Monitor provider spend/errors. Roll back frontend/backend code if needed; do not restore/import the database casually, erase new chats or overwrite user edits as part of a code rollback.


## Verification status for this PR

- Based on latest main 396b2bd; approved PRs #9–#12 are included.
- npm test: 77 Node tests and 26 Convex backend tests passed.
- Dedicated audio suite: 48 passed.
- Python API suite: 15 passed, including authentication-before-parse, bounds, memory context, replay protection, concurrency, deadlines and provider failure classification.
- TypeScript, lint and Production-mode frontend build passed. Lint retains the pre-existing unused API_BASE_URL warning in untouched backend/backend.js.
- Full Chrome suite: 22 passed, including the real local Convex/FastAPI HTTP bridge with only Anthropic mocked, two-browser persistence/collaboration and the 64-loop audio soak.
- A no-Anthropic-key Vercel Preview built with actual Python 3.12 and served the Python health endpoint. Correct authentication with no provider key fails closed; missing/wrong authentication returns 401. Root, assets, client deep links and audio-test work; old paid routes/missing assets are 404.
- Owner-approved real-provider verification passed on 2026-10-25 against committed source e713c881f9425e904dbcc99fb47970b91e939586: exactly three paid requests, all completed by claude-opus-5-5 (3,508 input / 703 output tokens in total). React used a fresh disposable anonymous local Convex backend, which called the protected deployed Vercel Python service and real Anthropic API; replies were stored in Convex and rendered in React. Neither Convex nor Anthropic was mocked in this run. This does not claim verification of a deployed cloud Convex configuration.
- Real responses correctly reported 97 BPM, Warm Pad/Deep Bass, C4/E4/G4, a 32-step pattern and its playlist bar/track. After refresh and a saved project change, Claude remembered a supplied name/test word and correctly reported 113 BPM, Synth Lead and F4. A second browser saw the saved conversation. A separate project reported 143 BPM, Pluck and G3 without inheriting the first conversation.
- Free deployed security checks passed before those three requests: missing/wrong service Bearer tokens returned 401, an authenticated invalid payload returned a sanitized 422 without echoing submitted fields, and the historical paid routes returned 404. Browser request monitoring found no service token, bypass token or Anthropic key. These checks protect direct Python access; the public Convex chat entry point still has no user authentication, as described above.
- One real follow-up response unnecessarily claimed its earlier accurate project values had been invented. The actual values and persisted context were correct; this is a model-answer quality limitation, not lost project data or conversation memory. No additional paid retry was made to conceal it.
- The temporary credentialed Preview was deleted after verification. Both the Vercel management API and its HTTPS URL confirmed it was gone, and the local temporary access file was removed. Development credentials and the pre-existing shared Vercel automation bypass were unchanged. The separate no-provider-key Preview remains available for review.
- No Production deployment, environment change, record mutation, seed or import was performed. Existing seven Production projects are outside the default test fixtures.
