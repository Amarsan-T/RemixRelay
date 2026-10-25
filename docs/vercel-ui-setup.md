# Vercel UI setup: stop before Deploy

**Python-service release:** use [the current Python architecture and rollout guide](python-ai-service.md). The direct-Convex-provider/frontend-only instructions below are historical.

**Historical setup notes:** use [the current production release guide](vercel-production-release.md)
for the merged Claude chat application and final frontend deployment fix.

The Convex backend is already deployed and verified on `silent-butterfly-873` from reviewed main `7b6e4f7`. No new backend project, key, or function deployment is needed. Vercel publication and creation of production demo records remain unapproved.

## One repository prerequisite

The owner requested `npm run build` while keeping the existing production checks. The local follow-up changes `vercel.json` to that command and routes the package build script through the same guard and TypeScript/Vite compiler. This update must be reviewed and merged before deployment: current remote main still pins `npm run build:vercel`, and the repository setting overrides the dashboard field. See [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build).

Local builds with no mode default to the in-memory editor and remove backend URLs. Vercel builds require an explicit mode when the system indicator `VERCEL=1` is exposed. Keep **Enable access to System Environment Variables** enabled; see [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables). `npm run build:vercel` remains an explicitly guarded compatibility command.

## Import without publishing

1. Sign into [Vercel](https://vercel.com) with the GitHub identity that owns `Amarsan-T/RemixRelay`. Select the intended personal/team account.
2. Choose **Add New → Project** (or New Project), locate **Amarsan-T/RemixRelay**, and click **Import**. If the private repository is missing, use the GitHub connection/app-permissions controls to grant Vercel access to this repository, then return to the list. Do not create a new repository or use a template. See [Vercel Git import](https://vercel.com/docs/git).
3. On Configure Project, use project name `remixrelay` if available, framework **Vite**, and the **repository root** (leave the default root; do not choose `src` or `convex`).
4. Expand **Build and Output Settings**. Set Install Command to `npm ci`, Build Command to `npm run build`, and Output Directory to `dist`. Do not use `convex deploy` as part of the frontend build.
5. Confirm **Node.js 24.x** wherever the version control is available. The repository already pins `engines.node` to `24.x`; if the import screen has no Node dropdown, that pin supplies the version. After a project exists, the setting is under Settings → Build and Deployment. See [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
6. Expand **Environment Variables** and add the three public Production values below. Scope them only to **Production** where the UI provides an environment selector. If the initial import form does not provide scope controls, review/correct their scope in Project Settings after project creation and before any later Preview deployment; do not assume initial defaults are production-only.
7. **Stop before clicking Deploy.** The initial import's Deploy action creates/builds/publishes the site. `git.deploymentEnabled=false` prevents automatic Git-triggered deployments; it does not make this button a save-only action. If setup cannot be persisted without Deploy, leave it as a prepared form rather than completing import.

| Environment variable | Production value |
| --- | --- |
| `REMIXRELAY_DEPLOYMENT_MODE` | `collaborative-demo` |
| `REMIXRELAY_CONVEX_PRODUCTION_NAME` | `silent-butterfly-873` |
| `VITE_CONVEX_URL` | `https://silent-butterfly-873.convex.cloud` |

Paste plain values, without Markdown link syntax, quotes, or trailing spaces. These are public build configuration, not API keys. Do not add `ANTHROPIC_API_KEY`, `CONVEX_DEPLOY_KEY`, a development selector, or the existing dev endpoint to Vercel. James's Claude Chat is not a dependency. The example file `.env.vercel-production.example` contains the same public values.

For future Preview deployments, use `REMIXRELAY_DEPLOYMENT_MODE=local` and omit the Production name/URL. For an existing Vercel project, add/scope variables under Settings → Environment Variables and enable access to System Environment Variables there. Check Settings → Environments → Production tracks `main`. Changing env values affects a subsequent build, not an existing deployment. See [environment scoping](https://vercel.com/docs/environment-variables).

## Pre-publication checkpoints

- [ ] The standard-build follow-up is merged into main; the repo configuration and requested UI build command agree.
- [ ] Intended GitHub/Vercel accounts have access to the private repository and selected commit. Resolve any import/access failure rather than changing ownership, visibility, or plan automatically.
- [ ] Node 24.x, Vite, root directory, commands, output, and Production-only env values match the list above. System environment variable access is enabled.
- [ ] Automatic Git deployments remain disabled. No Convex Marketplace integration or combined backend deploy command was added.
- [ ] Publication approval also addresses automatic demo initialization. **The first visitor to an empty project database triggers `seedDemos`; merely avoiding a manual Seed button does not prevent writes.** If data initialization must remain forbidden after publication, pause and change that behavior in a separate reviewed update before publishing.
- [ ] The anonymous-demo risk is accepted: all projects on this backend are publicly readable/editable. Vercel page protection does not authorize private Convex records.

No production page was opened during these checks, and no Vercel deployment or production record write was performed. Prior backend verification found zero project records; this guide does not claim a new live data-count check.

## After explicit publication and demo-data approval

Use the reviewed main revision, click Deploy, inspect logs for Node 24 and the guarded collaborative build, and record the Ready URL/commit. Confirm Production variable scope, Production branch, and system-variable setting in Project Settings. Then test the root page, shared project link in two browsers, both-direction edits, Saved/reload persistence, local playback, and `/audio-test.html`. Do not claim those hosted runtime checks passed before performing them.

## Local verification of this follow-up

- `npm run build` passed with simulated Vercel Production settings; its client includes only the approved Production URL and excludes the dev identifier.
- `npm run build` without a mode outside Vercel passed and cleared an inherited backend URL, leaving final `dist/` local-only.
- `npm run lint` passed, and `npm test` passed all **60 tests**. New regression checks ensure the standard hosted build rejects a missing mode and the known development deployment before compilation.
- Both HTML entry pages remain present. No dependency, backend, audio, or studio source changes were made; no backend redeployment is required.
- This repository update is local and has not been pushed or merged. No Vercel account settings, deployment, or production data were changed during this setup review.
