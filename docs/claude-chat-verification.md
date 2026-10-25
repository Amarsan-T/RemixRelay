# Claude chat verification

Verified on October 24, 2026 against `main` at `7d0fce0`.

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

## Owner setup and remaining verification

Development has no `ANTHROPIC_API_KEY`. Real Anthropic responses, account model
access, and real-provider conversational recall remain unverified. Successful
responses and history/context construction pass with the HTTP boundary mocked.

Revoke the previously exposed key, create a fresh one, and follow
[secure Development setup](claude-chat.md#secure-development-setup). The default
`claude-opus-5-5` and compatible fallback options were checked against Anthropic's
official documentation; `CLAUDE_MODEL` remains server-configurable.

No production Convex data or secrets were changed, and no Vercel deploy or
automatic PR merge was performed. Production enablement remains a separate step.
