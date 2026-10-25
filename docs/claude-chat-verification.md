# Claude chat verification

Initial verification on October 24, 2026 against `main` at `7d0fce0`.
The final real-provider verification on October 25 is recorded below.

## Recovery and integration

The unfinished `feature/claude-chat` worktree was based on `ab4f2d6`, after
[PR #9](https://github.com/Amarsan-T/RemixRelay/pull/9). Its source and ignored
local files were copied to a separate recovery snapshot before Git changes.
The original checkout and the user's separate audio changes were preserved.

Claude had already implemented the schema, message queries/mutations, Node
Anthropic action, bounded history, musical context, Aero chat panel, and initial
unit and browser checks. This change continues those files.

The completed branch incorporates
[PR #10](https://github.com/Amarsan-T/RemixRelay/pull/10), which merged during
verification. The final diff preserves its audio engine, editor, presets, and
project synchronization implementation. No merge of `claude-implementation`
or separate backend was used.

## Completed fixes

- Each reply attempt has a generation and a single action claim. Late results
  and old timeout jobs cannot overwrite a retry or cause duplicate API calls.
- Scheduled watchdogs release abandoned pending replies automatically.
- Append-only attempt accounting includes retries in every request budget.
- Duplicate submissions reuse the request ID; mismatched content is rejected.
  Older failed turns cannot be retried into the middle of a newer conversation.
- The UI guards Enter, rapid sends/retries, message size, and project save state.
  It preserves text typed while a send is in flight.
- Large project context retains its song/mixer overview ahead of detailed notes.
- Setup documentation was repaired, and tests became repeatable repo commands.
  The disposable browser backend now includes the shared music preset catalog.

## Results

| Check | Result |
|---|---|
| Existing unit/context tests | 75 passed |
| Deterministic Convex tests, Anthropic HTTP mocked | 13 passed |
| Full Aero/audio/React/collaboration Playwright suite | 20 passed |
| New Playwright chat persistence/reconnect/concurrency/isolation scenario | 1 passed |
| Convex Development backend integration checks | 15 passed |
| Development chat UI checks in two browser contexts | 13 passed |
| Development music collaboration checks in two browser contexts | 16 passed |
| Final local-build studio/audio smoke checks | 12 passed |
| App, backend, and test TypeScript; lint | Passed |
| Local production build and collaborative client bundle build | Passed |
| Browser source and compiled collaborative bundle secret/SDK scan | Passed |
| Convex Development backend deployment | Succeeded |

The audio suite includes 64 real Chrome loop repetitions, JavaScript stalls,
sample-load failure/retry, instrument disposal, and playback while collaborating.
The new chat browser scenario also covers offline reconnect and simultaneous
idempotent mutations. Test projects were created only in Development or the
disposable local backend. Existing project records were not deleted.

## Initial verification limits (October 24)

Development initially had no `ANTHROPIC_API_KEY`. Real Anthropic responses,
account model access, and real-provider recall were unverified at that point.
These limits were resolved during the October 25 verification below.

Revoke the previously exposed key, create a fresh one, and follow
[secure Development setup](claude-chat.md#secure-development-setup). The default
`claude-opus-5-5` and compatible fallback options were checked against Anthropic's
official documentation; `CLAUDE_MODEL` remains server-configurable.

No production Convex data or secrets were changed, and no Vercel deploy or
automatic PR merge was performed. Production enablement remains a separate step.

## Real-provider verification: October 25, 2026

The key was confirmed by listing only its name and checking a server-side
boolean. After the owner re-saved it, Anthropic rejected the organization-wide
key because a workspace header was required. The action now supports optional
server-only `ANTHROPIC_WORKSPACE_ID` and sends `anthropic-workspace-id` on API
requests. Development was configured for the key's sole accessible workspace,
Default. Missing workspace, model/configuration, and billing errors now have
distinct safe messages. Regression tests cover the header and error redaction.
The temporary internal diagnostic action was removed.

The API key never left Convex or appeared in logs, source, browser code, or
test artifacts. Only disposable Development projects were used for live calls.

`npm run test:chat:real -- --with-claude http://127.0.0.1:5199/` passed all
**16 real end-to-end checks** with `claude-opus-5-5`:

- The React chat sent and displayed a valid response using 97 BPM, Grand Piano,
  Deep Bass, piano notes C4@1/E4@5/G4@9, and kick hits on steps 1/5/9/13.
- Claude read Pattern 2's 32-step length and D4@3, plus playlist clips on
  bar 1/track 1 and bar 3/track 2.
- A random rehearsal code was recalled after a page refresh without repeating
  it in the follow-up. Both exchanges remained saved in order.
- A second browser saw the saved conversation. A separate project correctly
  used 143 BPM and Warm Pad without receiving the first project's code.
- A tempo edit made in the UI was saved and read by Claude as 109 BPM.
- A controlled context error was stored safely. After repairing only that
  disposable project's data, UI Retry returned a real answer using the same
  reply ID and without adding messages.
- Completed-reply retry and over-long Enter submissions were rejected; no
  uncaught browser exceptions occurred.

A direct Development `chatMessages` query verified 10 completed messages across
the three detailed fixtures: six in A, two in B, and two in the retry project.
All five assistant records contain `model=claude-opus-5-5` and positive input
and output token counts. Six attempt records include the controlled failed
attempt and its successful retry.

Final checks on this implementation:

| Check | Result |
|---|---|
| Unit/context tests | 75 passed |
| Deterministic Convex tests, including workspace/errors | 23 passed |
| Full Playwright React/audio/chat/collaboration suite | 21 passed |
| Detailed real-provider end-to-end scenario | 16 passed |
| Existing live Development backend checks | 14 passed |
| Existing live Development browser checks | 13 passed |
| App/backend/test TypeScript and lint | Passed |
| Local production build and guarded hosted client compilation | Passed |
| Hosted client secret/SDK/provider-endpoint scan | Passed |

The hosted output was compiled into an ignored test folder, never served or
deployed. No Production data or secrets were changed; PR #11 remains unmerged.
The code is ready for review/merge based on Development verification. The
[separate Production/Vercel release steps](claude-chat.md#final-release-after-approval)
and hosted smoke checks remain to be performed after approval.
