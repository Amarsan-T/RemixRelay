# RemixRelay: deploy to Vercel

Reviewed 2026-10-24 on `chore/demo-preparation`, rebased onto `origin/main` at `e61643dd58a0bda4a36dbc9db12b0a2ad028c49e`. This includes PR #6's Convex collaboration and the latest teammate changes for Empty Template, additional patterns, clip spacing, and saved pattern count. James's unfinished Claude Chat is not a dependency.

**Status:** the owner has now located the existing Production deployment **`silent-butterfly-873`**, in US East (N. Virginia), with status **Never deployed**. Use that deployment; no creation step is needed. Exact public build settings are prepared in [`.env.vercel-production.example`](../.env.vercel-production.example). The backend's first function deployment and Vercel publication still require approval. Build/test results are recorded in [build-verification.md](build-verification.md).

## Confirmed project and Production target

| Item | Confirmed value / state |
| --- | --- |
| Existing Convex project | `remixrelay` in team `amarsantsyren` |
| Dashboard | [Existing project](https://dashboard.convex.dev/t/amarsantsyren/remixrelay) |
| Existing development deployment | `watchful-sockeye-395` — forbidden for the public website |
| Production deployment | `silent-butterfly-873`, per the owner's corrected dashboard check on 2026-10-24 |
| Region | US East (N. Virginia), Convex region `aws-us-east-1` |
| Production URL | `https://silent-butterfly-873.convex.cloud` |
| Backend status | Never deployed; do not assume project functions/schema are available |

The hosted build explicitly rejects `watchful-sockeye-395`, including when both production name and URL are mistakenly set to it. Do not create another Convex project/deployment, copy development projects, or use the development database for the website.

The production identity, region, and Never deployed status above are owner-reported dashboard information. This preparation does not independently claim a live backend or two-browser connection. A correctly compiled frontend cannot use the project API until the reviewed functions/schema have been deployed to this target. US East needs no matching Vercel region setting for this static frontend; see [Convex regions](https://docs.convex.dev/production/regions).

The next cloud action is the **first backend function deployment**, not resource creation. Follow the approval-gated backend steps below. Do not generate keys, seed projects, or publish the site during configuration verification.

## What is configured

| Setting | Prepared value |
| --- | --- |
| Framework / root | Vite / repository root |
| Node | `24.x`, pinned in `package.json` and lockfile metadata |
| Install | `npm ci` |
| Vercel build | `npm run build:vercel` |
| Output | `dist` |
| Entries | `/` and `/audio-test.html` |
| Automatic Git deployments | Disabled by `vercel.json`; publish approved revisions manually |
| Backend deployment during frontend build | None; Vercel does not need a Convex deploy key |

The normal `npm run build` remains unchanged for local development. Vercel uses a wrapper around the same TypeScript/Vite build, with deployment settings checked first. No audio, studio, or collaboration source was edited.

Share links use `/?project=<id>` at the root, so they need no SPA rewrite. Both HTML entries remain explicit Vite inputs; no catch-all rule masks the audio test page. See [Vercel configuration](https://vercel.com/docs/project-configuration).

## Public-access assessment: decide before publishing

This is an **anonymous, shared demo**, not a private project service:

- `convex/projects.ts` exports public `list`, `get`, `create`, `save`, and `seedDemos` functions without identity or ownership checks. Anyone who discovers the backend URL can call them directly, including outside the website.
- Home lists the newest 200 projects with their stored data. A project link is not an access-control boundary; other projects can be listed too.
- Any visitor can edit existing projects and create new ones. `MAX_PROJECTS = 200` limits the list query, not database growth. There is no application rate limit, per-user quota, or ownership model.
- Project contents use `v.any()` in several places. Untrusted callers can submit malformed musical data, disrupt other people's sessions, or consume usage/storage. Existing change-path and save-count checks do not provide authentication or full musical-data validation.
- Vercel password/login protection controls the frontend page, not these directly reachable Convex functions. CORS, obscure project IDs, and a hidden share link do not solve backend authorization.

The first backend function deployment exposes this public API even before Vercel is published. Accept the disposable-demo access policy before approving that backend release, as well as before the first visit that initializes demo data.

The configuration is appropriate for a deliberately public, disposable hackathon demo only after the owner accepts these limits. Keep personal data, valuable songs, test projects, credentials, and private names out of its database. Monitor Convex usage and retain a cleanup/reset plan. Before offering private projects or an unattended general service, add backend authentication/authorization, stronger validation and abuse controls in a separate reviewed change. None is silently added here.

The existing server-only `load` and `saveFromServer` functions use Convex internal functions and are not browser-callable; see [Convex function visibility](https://docs.convex.dev/functions/internal-functions).

## Which Convex deployment?

**Use the existing Production deployment `silent-butterfly-873` in `remixrelay`, with its database separate from `watchful-sockeye-395`.** It is present but Never deployed. A new Convex project, deployment, hosting service, or separate Node backend is unnecessary. This follows Convex's [production deployment model](https://docs.convex.dev/production/overview).

Do not copy the dev `.env.local`, import the dev database, run data migrations against it, or point Vercel at its URL. Do not use the Convex Marketplace integration to accidentally create another team/project. The prepared public settings identify Production, but this worktree has no production credentials. Dev/prod hostnames have the same format: use the owner's confirmed identity, not a guess based on its name.

After approval, deploy the reviewed backend source once to the selected production deployment. A deployment-specific production key can select that target explicitly:

1. In project `remixrelay`, select **Production / silent-butterfly-873**. Confirm `https://silent-butterfly-873.convex.cloud`, inspect the Data tab without changing it, and confirm your account has deployment access. Stop if a different target is selected or if production contains data unsuitable for the anonymous demo.
2. From that production deployment's settings, generate a deployment-specific production deploy key with deployment permission. Keep it out of screenshots, chat, Git, and Vite variables.
3. On your machine only, create the ignored `.env.convex-production.local` containing `CONVEX_DEPLOY_KEY=<the selected production deployment key>`. This is a template; no key is supplied here. Do not use a dev, project-wide, or preview key for this step.
4. From the approved release checkout, run the following **only after backend deployment approval**:

   ```powershell
   npx convex deploy --env-file .env.convex-production.local
   ```

   The installed Convex CLI selects the deployment from this explicit env file instead of the working dev selector. Its announced target must be `silent-butterfly-873`. The command publishes schema/functions and may regenerate local `convex/_generated` files; review any resulting local diff rather than discarding it.
5. Confirm the expected `projects` functions and schema are present on Production. Do not import dev projects. Obtain approval for the first website visit/demo-data initialization: on an empty backend the app automatically calls `seedDemos`, which writes shipped demo projects. Do not open the production-configured app for runtime testing until this data write is approved.
6. Revoke the temporary deployment key when no longer needed and remove the temporary file. Never upload it to Vercel for this static frontend setup.

This backend release is independent of Claude Chat. Do not deploy an unreviewed worktree or wait for AI integration. [Convex's Vercel guide](https://docs.convex.dev/production/hosting/vercel) also supports combined frontend/backend CI deployment, but this PR deliberately keeps backend publication separate to avoid automatic schema/code releases.

## Environment variables

| Variable | Scope | Value / requirement |
| --- | --- | --- |
| `REMIXRELAY_DEPLOYMENT_MODE` | Vercel build | Production: `collaborative-demo` for the approved anonymous demo. Preview: `local` by default. Missing/unknown modes fail the hosted build. |
| `REMIXRELAY_CONVEX_PRODUCTION_NAME` | Vercel Production build | `silent-butterfly-873` |
| `VITE_CONVEX_URL` | Vercel Production build; public in JavaScript | `https://silent-butterfly-873.convex.cloud`. Use this deployment URL, not a `.convex.site` HTTP-actions URL. |
| `CONVEX_DEPLOY_KEY` | Temporary local approved backend-deploy step only | Secret production deployment key. Not required or configured in Vercel for this PR. |
| `CONVEX_DEPLOYMENT` | Existing backend developer tooling only | Not required by this Vercel build; do not copy the dev selector into hosted settings. |
| `ANTHROPIC_API_KEY` | Not needed for this release | No AI code in this baseline. Any future Claude secret belongs on the server running the action, never in `VITE_*` or the frontend. |

The two `REMIXRELAY_*` names are checks implemented by `scripts/deployment-env.mjs`, not Convex SDK requirements. They are not credentials. The known development name is explicitly denied. The safe local `.env.example` keeps blank backend values; [`.env.vercel-production.example`](../.env.vercel-production.example) contains the three exact public Production build settings. That filename is not automatically loaded by Vite, so ordinary local builds do not acquire a production connection. Copy the settings into Vercel's Production environment after approval; do not rename the example to `.env.local`. The backend's Never deployed status remains a runtime release blocker, even though the frontend configuration can be compiled and checked now.

`local` mode forces `VITE_CONVEX_URL` to an explicit empty value, even if the process or a local env file contains a URL. Such a preview uses in-memory projects and has no persistence or collaboration. A collaborative preview must be deliberately configured against approved disposable data; never inherit the test/dev database. Missing production settings fail rather than silently delivering a local-only app.

`src/main.tsx` builds a `ConvexReactClient` when `VITE_CONVEX_URL` is nonempty and mounts `SyncedApp`; otherwise it mounts local `App`. The SDK connects directly from the browser to Convex over HTTPS/WSS; there is no Vercel API route, proxy, or localhost backend to configure. The frontend must target the production deployment containing the reviewed functions. This source/build check is not a live connection test.

Vite bakes `VITE_*` into the build, so changing a setting requires a new build/deployment. See [Vite environment rules](https://vite.dev/guide/env-and-mode) and [Convex client configuration](https://docs.convex.dev/client/react/deployment-urls). `.gitignore` now excludes `.env*` (except the safe `.env.example`) and `.vercel`.

## Connect your Vercel account and publish — after approval

1. Approve the anonymous-demo data policy and `silent-butterfly-873` backend target. Obtain approval to push/open the preparation PR, merge its reviewed changes, deploy that backend, publish the website, and initialize demo data on its first visit. Those are separate external actions; this task performs none of them.
2. Sign in at [Vercel](https://vercel.com) using your GitHub account. Select your intended personal/team account, then **Add New → Project**. Authorize Vercel's GitHub app for `Amarsan-T/RemixRelay` and choose **Import**. Do not fork or clone an unrelated template. If the repository is missing, check the GitHub installation's selected-repository access and repository ownership requirements in [Vercel's GitHub guide](https://vercel.com/docs/git/vercel-for-github).
3. Import the reviewed revision containing this configuration. Use repository root, Vite, Node 24.x, `npm ci`, `npm run build:vercel`, and `dist`. Confirm the Production branch is `main` and contains the approved preparation changes. Do not import old main before the guard/configuration lands.
4. Add the three values from `.env.vercel-production.example` only to Vercel's **Production** environment. For Preview, set only `REMIXRELAY_DEPLOYMENT_MODE=local`; do not share production values across every environment. Do not add API keys or a deploy key to the frontend project.
5. Keep the deployment protected while rehearsing if appropriate, and plan the intended public judging access. Click **Deploy** only when ready to publish the configured release. This is the first frontend publication, even though Git-triggered deployments are disabled.
6. Check build logs, the Ready result, and the generated HTTPS URL. Confirm the deployed revision and Production environment. No custom domain is needed; optionally add one later in Project Settings → Domains.
7. Complete the two-browser acceptance test below. If the deployment's access settings require Vercel login, confirm the final public demo URL works for a signed-out judge before submission. Frontend protection does not make Convex projects private.
8. Keep automatic Git publication disabled while teammates develop. For an approved later release, use **Deployments → Create Deployment**, select the exact reviewed commit/branch and intended environment, then confirm. Do not redeploy a moving `main` blindly. See [manual deployment from Git](https://vercel.com/docs/git) and [disabling Git triggers](https://vercel.com/docs/project-configuration/git-configuration).

Environment changes take effect on a new deployment, not an existing build; see [Vercel environment variables](https://vercel.com/docs/environment-variables). Rebuilding for a different backend also changes which project IDs/share links are valid.

## Production acceptance test — pending actual publication

- [ ] Open `/` and `/audio-test.html` on the approved HTTPS URL. Direct-load and reload a `/?project=<id>` share link.
- [ ] After demo-data initialization is approved, confirm Production contains only intended demo data. Verify browser Network connects to `silent-butterfly-873.convex.cloud` over HTTPS/WSS; there must be no dev hostname or localhost backend request.
- [ ] Open a demo project. Confirm Share and Saved/Saving indicators are present. Without them, investigate missing `VITE_CONVEX_URL` or local build mode.
- [ ] Copy Share into a second browser/incognito window. Change a drum step in A and a different channel's note in B; both views receive both changes without reload. Test a Playlist edit too. Keep only one audio output audible.
- [ ] Wait for Saved, reload both browsers, and verify persistence. Verify another project remains unchanged. Playback between devices is not claimed to be synchronized.
- [ ] Run the [audio/demo checks](demo-runbook.md) on the actual presentation device, including repeated Play/Stop and extended looping. Compilation and sync-helper tests do not verify listening quality or real network behavior.
- [ ] Record the frontend SHA/URL, selected Convex production deployment, browser versions, and outcome. Do not record keys.

If the backend cannot be made ready or public-edit access is unacceptable, publish an explicitly labeled `local` editor after approval instead. It will demonstrate the music studio without shared persistence or AI. To stop backend abuse, use Convex's deployment controls in addition to frontend rollback; a Vercel rollback does not undo database changes or disable the public backend.
