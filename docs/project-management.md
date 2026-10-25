# Project management without accounts

Dashboard cards retain the existing Aero design and expose Rename/Delete from
their three-dot menu. Delete requires the displayed name and a current music
version. It archives the project for everyone; it does not erase music or chat.
Undo is immediate, and Recently deleted in this browser offers Restore after a
refresh. This list is a local recovery shortcut, not a complete server trash view.

## Management permission

New cloud projects receive a random 256-bit management key. The browser saves
the key in localStorage scoped to the Convex deployment and project ID. Convex
stores only SHA-256 of the key; public project queries exclude even that hash.
Raw keys occur only in private browser storage and management mutation arguments,
never in share links, public query arguments/results, music saves or logs. Local
mode remains in-memory and does not contact Convex.

Possession of the management key permits Rename/Delete/Restore. A share link or
client ID does not. There is no public ownership claim, key assignment or key
rotation function. Existing projects without a management hash remain protected,
including all pre-existing Production projects. Browser storage denial fails
creation closed; clearing storage loses management access. A pending creation
key is saved before creation and retained if associating it with the returned
project ID fails. Do not clear that storage if recovering an interrupted creation.

This is capability-based authorization for a public hackathon demo, not user
identity or a substitute for private project permissions. Existing public music
editing and active chat access remain unchanged. A compromised browser/XSS can
steal its keys. Management rights are not automatically shared across devices.

## Deletion and concurrency

Optional `deletedAt`, `lifecycle` and `managementKeyHash` fields need no document
migration. Active queries use an index excluding tombstones before limiting the
result. Tombstones prevent an empty dashboard from reseeding demos. No hard
delete, purge job, cascade deletion or retention timer is introduced.

Rename patches only the name/timestamp; it never replaces music or changes its
sync version. A stale title conflicts instead of overwriting another rename.
Delete checks the title, music version and lifecycle captured by its dialog.
Delete and Restore advance the lifecycle. Every browser save carries the session
lifecycle, so old offline/in-flight/retrying saves cannot affect a restored
project. Old clients default to lifecycle zero and must refresh after a restore.
The same rule applies to internal music writes.

Pending assistant replies become errors on deletion. Chat claim, context loading,
completion and expiry check the active project and lifecycle. Explicit Retry
after restoration creates a fresh attempt; obsolete completions cannot finish
it. History and chatAttempts remain intact, including global rate accounting.
Already-dispatched provider requests cannot be recalled and may still be billed.
The bounded cancellation guard rolls the deletion transaction back if a legacy
project unexpectedly has more than 100 pending replies; operator review is then
required. Normal chat permits only one pending reply.

Connected studios close on deletion or lifecycle change, dispose their audio
engine, stop autosave/retry/leave-flush, and offer a JSON recovery copy of their
local music. They stay closed until explicitly reopened. Saved music remains in
the archived server document; unsaved local edits are never silently replayed
after Restore. Recovery JSON is a data backup, not an automatic import feature.

## Future legacy-project management: owner-only proposal

No legacy assignment tool is implemented by this PR, and no existing record is
changed. To support it later, use a separately reviewed operator procedure:

1. Obtain explicit approval for the exact project IDs, intended manager and
   target deployment. Take a private database/storage export first.
2. Generate a fresh random management key in the intended owner's trusted
   browser. Transfer only its hash to the operator using a private channel.
3. Add a temporary **internal mutation**, callable only through the authenticated
   Convex owner's CLI/dashboard. Accept an explicit ID allowlist and hashes;
   reject missing/deleted/already-managed projects. Never expose a public claim
   endpoint, shared admin password in the client, or VITE_* credential.
4. Patch only managementKeyHash. Leave names, music, versions, timestamps,
   lifecycles and chat unchanged. Verify their before/after fingerprints.
5. Store the matching key under the existing browser credential format. Verify
   access with a harmless authorized check before any rename or deletion.
6. Remove the temporary assignment function. Maintain a private operator audit
   record containing IDs and approval, without keys. Any reassignment or lost-key
   recovery needs a separate explicit approval and reviewed revocation procedure.

Do not run this proposal during implementation, tests, PR merge or deployment.

## Validation boundary

Backend tests use convex-test with the network mocked. Browser tests require an
anonymous loopback Convex fixture and block cloud connections. The empty-dashboard
scenario runs first on that fresh fixture. No test targets existing Development
or Production records, and no paid Claude request is needed.
