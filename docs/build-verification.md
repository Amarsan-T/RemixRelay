# Vercel preparation verification

Reviewed 2026-10-24 in the isolated `chore/demo-preparation` worktree at `C:\Users\amars\.codex\worktrees\demo-preparation\remixrelay`.

## Baseline and isolation

The preparation branch is rebased onto freshly fetched `origin/main` at **`e61643dd58a0bda4a36dbc9db12b0a2ad028c49e`**. This includes PR #6's Convex integration plus teammates' Empty Template, additional patterns, Playlist clip spacing, and persisted pattern-count changes. The rebase completed without conflicts and preserved those application changes. The earlier preparation documents were retained and updated to this baseline.

No application source, Convex functions, audio engine, or studio UI was changed by this preparation. `git diff origin/main -- src/audio src/studio convex fl_studio_web_daw.tsx src/main.tsx src/SyncedApp.tsx vite.config.ts` was empty. Incoming application changes from main are part of the reviewed baseline. The original sound-design checkout, separate integration worktree, and James's Claude AI branch were not edited. This report records pre-merge verification for the user-authorized GitHub integration; backend provisioning, data changes, and public deployment remain prohibited.

## Verification results

Windows PowerShell; Node **v24.20.0**, npm **11.19.0**. No packages were added or upgraded. The lockfile change only records the root Node 24.x engine requirement.

| Check | Result |
| --- | --- |
| `npm ci` | PASS, exit 0; 56 packages installed, 57 audited, npm reported 0 vulnerabilities. |
| `npm run build` | PASS, exit 0; TypeScript + Vite 8.3.5 production bundle, 2,969 modules, no warnings/errors. |
| `npm run lint` | PASS, exit 0; no diagnostics. |
| `npm test` | PASS, **58/58**, no skipped/failed tests, about 2.2 seconds reported by Node. Includes new teammate coverage for added patterns/Empty Template and saved pattern count, plus nine deployment regression tests. |
| `tsc -p convex/tsconfig.json --noEmit` via installed TypeScript | PASS, exit 0; no Convex deploy or code generation. |
| `npm run build:vercel` in `collaborative-demo` mode | PASS with the owner-confirmed `https://silent-butterfly-873.convex.cloud`; that exact URL was found in the emitted client and `watchful-sockeye-395` was absent. Compilation only: no backend was contacted. |
| `npm run build:vercel` in `local` mode with an inherited fixture backend URL | PASS; neither backend fixture URL was present in emitted JavaScript. The final local `dist/` is this network-independent editor build. |
| Missing deployment mode | Expected rejection, exit 1 before compilation; covered by regression tests. |

Both `dist/index.html` and `dist/audio-test.html` are generated. The rebased local build has main JavaScript 288.42 kB (88.36 kB gzip) and shared audio JavaScript 286.80 kB (71.34 kB gzip). Collaborative mode adds the live client path, with main JavaScript 363.86 kB (109.26 kB gzip). Asset hashes may change as Tailwind scans project content.

The tests cover explicit mode selection, local-mode URL clearing, matching the confirmed production hostname, rejection of mismatched/dev and `.convex.site` URLs, malformed/credential-bearing URLs, error-message redaction, and the actual build wrapper's early rejection. A regression test rejects the owner-confirmed dev deployment `watchful-sockeye-395` even when both production settings name it, including through the actual hosted-build process before compilation. Another validates the exact prepared `.env.vercel-production.example`, restricts it to the three public frontend-build variables, and rejects replacing its URL with the dev endpoint. They also check that Vercel uses the guarded command and keeps automatic Git deployments off. Dashboard confirmation remains required because Convex dev/prod URLs have the same shape.

Latest owner-confirmed dashboard state: project `remixrelay` already has Production deployment **`silent-butterfly-873`**, URL **`https://silent-butterfly-873.convex.cloud`**, region **US East (N. Virginia)**, status **Never deployed**. This replaces the earlier report that Production was absent. No creation is needed. This is owner-reported metadata, not a successful automated dashboard inspection or live application connection.

`npm ci`, lint, all 58 tests, Convex type checking, the real-target hosted build, and the ordinary build were rerun after rebasing onto current main. The ordinary build uses an explicitly empty frontend backend URL; local `dist/` is left without a backend connection. The separate hosted local-mode fixture check was completed in a preceding preparation pass. No browser visited the production-configured app, so automatic demo seeding never ran. No creation, deployment, data write, or key generation was performed.

The pre-push audit checked all 14 PR files against the intended deployment/documentation scope, found no credential-like secrets or literal real development URLs, and confirmed that only the two safe env examples are tracked. The development identifier remains solely for denial/documentation and computed regression fixtures; it is absent from both emitted client bundles. The lockfile's only change is root Node engine metadata, with no dependency changes. `vercel.json` disables automatic Git publication. GitHub reported no repository Actions workflows or repository webhooks at review time; absence of configured CI is not a claim of a hosted test run.

## What source inspection establishes

- `src/main.tsx` reads build-time `VITE_CONVEX_URL`, creates the Convex React client, and mounts `SyncedApp`; missing URL intentionally selects the local editor.
- `src/SyncedApp.tsx` uses deployed project queries/mutations, seeds an empty database with the shipped demos, supports `/?project=<id>` links, and passes save/share state into the studio.
- `useProjectSync` batches and retries saves and subscribes to changes. Existing automated tests exercise shared data/change handling; they do not establish live network behavior on Vercel.
- Public Convex functions currently have no identity/ownership checks. All projects on the selected backend are accessible to anonymous callers. The dev database must never be used by the public frontend.
- Claude Chat is not implemented in this revision and is not required for build, music playback, or collaboration. No AI key was added or accessed.

## Still pending before publication

1. Approve and perform the first function/schema deployment to the existing `silent-butterfly-873` Production target. It is Never deployed according to the owner. The public build values are prepared, but no production credentials have been generated or copied. Development deployment `watchful-sockeye-395` remains blocked.
2. Explicit approval of the disposable anonymous-demo access policy, and approval for backend deployment and frontend publication.
3. After release approval, set Vercel's Production variables from `.env.vercel-production.example`. Obtain approval for demo-data initialization before the first runtime website visit, because `SyncedApp` seeds an empty database automatically.
4. Real HTTPS two-browser save/share/reload verification on the published website, as specified in the [deployment checklist](vercel-deployment-checklist.md).
5. Browser listening checks and extended-loop rehearsal on the presentation hardware. No browser automation, subjective listening, or hosted runtime test was performed in this task.

The final site's domain and an actual Convex production connection cannot be verified until those external steps are approved and performed. No build/lint/test error remains in the prepared branch.
