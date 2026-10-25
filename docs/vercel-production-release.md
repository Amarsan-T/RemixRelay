# Frontend deployment fix and final release

This is the current release guide; it supersedes the historical import/build
notes in `vercel-ui-setup.md`. Do not deploy until the owner approves publication.

## What changed

`bb6338a` selected only a Python builder and sent every request to FastAPI,
bypassing the frontend. Main `ff4c876` already removed those legacy settings,
but still placed Python files in root `api/`, where Vercel auto-discovers
functions, with invalid Python dependencies in root `requirements.txt`.

The fix retains Vite, `npm ci`, the guarded `npm run build`, and output `dist`.
It moves the Python files and their requirements unchanged to
`experiments/python-api/`, and excludes that directory and `backend/` from
Vercel. No Python packages are installed by this frontend deployment.

Existing filesystem entries are served first, including `/audio-test.html` and
hashed `/assets/*`. Other frontend navigation paths fall back to `/index.html`.
The fallback excludes `/api` and `/assets`, so nonexistent API/asset paths are
404s instead of HTML. Project sharing currently uses `?project=<id>`, which
continues to work on the root page and on reload.

The active backend remains Convex: `AssistantChat` uses `chat.list`, `chat.send`
and `chat.retry`; the server action `chatAgent.respond` calls Anthropic and
stores results. Music autosave/collaboration uses the same Convex deployment.
There is no frontend proxy to FastAPI and no Vercel paid API function.

References: [Vercel Vite routing](https://vercel.com/docs/frameworks/frontend/vite),
[filesystem precedence](https://vercel.com/docs/project-configuration/vercel-json#rewrites),
[function discovery](https://vercel.com/docs/functions/runtimes/python),
and [deployment exclusions](https://vercel.com/docs/deployments/vercel-ignore).

## Publish after this PR is approved and merged

1. Record the final merged `main` commit. Do not redeploy an older failed build:
   a redeploy of an old commit would keep its incompatible configuration.
2. In the existing Vercel RemixRelay project, check **Settings > Build and
   Deployment**: repository root, Framework **Vite**, Node **24.x**, Install
   **npm ci**, Build **npm run build**, Output **dist**. Leave access to system
   environment variables enabled so the guarded build detects Vercel.
3. Verify the existing **Production** environment values without changing them:

   | Name | Existing Production value |
   | --- | --- |
   | REMIXRELAY_DEPLOYMENT_MODE | collaborative-demo |
   | REMIXRELAY_CONVEX_PRODUCTION_NAME | silent-butterfly-873 |
   | VITE_CONVEX_URL | https://silent-butterfly-873.convex.cloud |

   Do not add an Anthropic key, Convex deploy key, or Python configuration to
   Vercel. Do not point Preview builds at Production; local mode is the safe
   preview setting. This fix does not change either environment's values.
4. Confirm the separately approved Convex Production release already contains
   PR #11's chat functions/schema and its server-only Anthropic configuration.
   Earlier backend deployment alone does not prove the new chat action is
   deployed. If missing, stop and obtain separate backend approval. No backend
   deploy, data import or environment edit is included in this frontend fix.
5. Obtain explicit publication approval, including any production smoke-test
   writes. The app has no authentication; shared projects/chat are public, AI
   requests cost money despite server rate limits, and the first visit to an
   empty database can automatically seed demo projects. Do not visit Production
   to test until those writes are approved.
6. In **Deployments**, choose **Create Deployment**, select the repository's
   latest approved **main** commit (or its full SHA), confirm the **main** branch
   configuration targets **Production**, and start the deployment.
   Keep `git.deploymentEnabled=false`; pushing/merging alone does not publish.
   If that control is unavailable for your account, use an authorized manual
   deployment of the same approved revision; do not enable automatic publishing
   just to bypass it. Build without reusing the previous failed build cache.
7. Inspect the deployment source commit and logs: `npm ci`, Node 24,
   `[deployment] collaborative-demo`, TypeScript and Vite, with `index.html`,
   `audio-test.html` and assets emitted. There should be no pip install,
   `@vercel/python` build or Python Functions. Confirm the result is **Ready**
   and Production points to that exact commit.
8. After smoke-test approval, check `/`, a copied `?project=...` URL and refresh,
   frontend navigation/asset requests, and `/audio-test.html`. Expect 404 for
   `/api/main`, `/api/aiAssist`, `/api/startInquiry`, and a missing asset. Test
   playback and, using an approved disposable production project, two-browser
   edits/Saved/reload. Send one approved Claude message and verify persistence
   and sharing. Real-provider success requires working server credentials;
   automated tests use mocked Anthropic responses or no key on local Convex.

## Verification boundaries

Build and route checks can run entirely locally; compiling with the public
Production URL does not deploy or access that database. Browser tests must
intercept cloud Convex connections or use the disposable local test backend.
Local route smoke checks verify build output plus the configured filesystem
precedence/fallback policy, not a running Vercel edge deployment. Final hosted
checks remain a post-approval step. No production records, environments or
deployments are modified by this PR.

Verified in the isolated deployment-fix worktree:

- `npm ci`: passed, zero reported vulnerabilities; lockfile unchanged.
- `npm run typecheck`: frontend, Convex and test types passed.
- `npm run lint`: passed; one pre-existing unused `API_BASE_URL` warning in the
  unchanged experimental `backend/backend.js`.
- `npm test`: 77 Node tests and 23 deterministic Convex chat tests passed.
- Hosted-mode `npm run build` with the existing public Production settings:
  passed, both HTML entries and five JS/CSS assets emitted.
- Local production-output smoke checks: root, project query URL, deep navigation
  and standalone HTML returned 200; every built asset had the correct MIME type;
  API and missing asset paths returned 404 for GET and POST. Chrome mounted the
  production React pages with cloud HTTP/WebSockets blocked before networking.
- The output contains the expected public Production URL, no dev deployment
  identifier, no Anthropic key marker and no experimental paid API paths.
- `npm run test:e2e`: 21/21 Chrome regressions passed in 3.2 minutes with fresh
  anonymous local Convex, including chat persistence/retry/isolation, two-browser
  music collaboration, the 64-loop audio soak and standalone page playback.
  No production backend or paid Anthropic request was used.
