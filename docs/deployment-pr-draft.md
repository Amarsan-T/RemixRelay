# Prepared PR: guarded Vercel deployment

PR description draft for `chore/demo-preparation` targeting `main`, reviewed against `origin/main` at `e61643d`. The owner has authorized push, PR creation, and merge if conflict-free and checks pass. Backend deployment, production data writes, and Vercel publication remain separately approval-gated; no deployed preview is claimed.

## Proposed title

Prepare Vercel release with production Convex checks and demo runbook

## Proposed description

The studio now supports Convex collaboration, but an unset Vite URL silently selects in-memory projects and a copied dev URL would expose the team's test database. This change adds a guarded Vercel build that requires an explicit local-editor or anonymous-collaborative-demo mode. Collaborative builds require a URL matching a production deployment name confirmed separately in Convex's dashboard; local builds explicitly clear inherited backend URLs. The known dev deployment `watchful-sockeye-395` is denied even if incorrectly entered as the production name.

Vercel uses Node 24.x, locked installation, and the existing two-entry Vite output. Git-triggered publication stays disabled, and backend deployment remains a separate approved step rather than running Convex deploy on frontend builds. No backend deploy key is needed by Vercel. The ordinary local build command, audio engine, studio UI, and collaboration implementation are unchanged.

The updated deployment guide identifies the existing `silent-butterfly-873` Production deployment, explains account connection, isolated production data, the anonymous public read/write risk, environment scoping, manual publication, and two-browser acceptance checks. Its exact three public Vercel Production values are supplied in `.env.vercel-production.example`, a filename Vite does not automatically load. Devpost and demo drafts reflect merged collaboration and keep Claude Chat explicitly unfinished.

Validation after rebasing onto `e61643d`: `npm ci`, `npm run build`, `npm run lint`, `npm test` (58 passing), and a separate Convex TypeScript check pass. The hosted build was recompiled with `https://silent-butterfly-873.convex.cloud`; its emitted client contains that URL and excludes the dev identifier. The normal build also passes and leaves local-only output. The prepared Production env example is tested, and the dev database is rejected even when both production settings name it. All 14 PR files were audited for credential-like secrets and real dev URL literals; only safe env examples are tracked and no dependency versions changed. Both HTML entries remain present. No real backend connection, browser listening, backend deployment, or Vercel publication was performed. No repository CI workflows were configured at review time; validation is local.

## Files in scope

- `vercel.json`: Vite hosting settings, guarded build, manual Git publication.
- `scripts/deployment-env.mjs`, `scripts/vercel-build.mjs`: explicit deployment mode and production-name/URL checks.
- `tests/deployment.test.mjs`: nine regression tests included in `npm test`.
- `package.json`, `package-lock.json`: build/test scripts and Node 24.x engine metadata; no dependency version changes.
- `.env.example`, `.env.vercel-production.example`, `.gitignore`: safe local defaults, the exact public Production build settings, and ignored secret environment/Vercel metadata.
- `docs/vercel-deployment-checklist.md`, `docs/build-verification.md`, `docs/demo-runbook.md`, `docs/devpost-draft.md`, this draft.

## Review and release gates

- The owner located the existing Production deployment: `silent-butterfly-873`, US East (N. Virginia), Never deployed. Use it for the first approved function deployment; do not create another deployment/project. Do not use `watchful-sockeye-395`.
- Accept a disposable anonymous demo, or keep Vercel in `local` mode. Backend auth/authorization, stronger input validation and rate limiting are separate work before a private/general service.
- Ensure the reviewed production backend is deployed separately, and that frontend Preview does not inherit the dev database or production credentials.
- Push/PR creation and a conflict-free merge with passing checks are authorized. Backend deployment, data initialization, and Vercel publication still need separate approval. Do not deploy another teammate's working tree.
- Approve the first website visit/demo-data initialization, which automatically calls `seedDemos` on an empty backend. Then complete real two-browser production verification and audio rehearsal before claiming the public release works.

Do not include API keys or private project data in the PR. The known dev deployment's public identifier appears only to deny it; it is never configured as a hosted target. The detailed [deployment checklist](vercel-deployment-checklist.md) contains the first backend release, account, publication, and data-initialization steps to follow after their respective approvals.
