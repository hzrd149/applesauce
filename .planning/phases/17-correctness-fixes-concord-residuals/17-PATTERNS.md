# Phase 17 Pattern Map

**Mapped:** 2026-08-20
**Scope:** FIX-01, FIX-02, FIX-03, RESID-01, RESID-02

## Existing Patterns to Reuse

### Relay CLOSED parsing (FIX-01)

- Production seam: `packages/relay/src/relay.ts` owns `CLOSED_ERROR_PREFIXES` and private `parseClosedError(reason)`; `req()`, `count()`, and negentropy translation all call the same parser.
- Preserve the existing constructor mapping and D-07 retry classification. Convert its internal lookup representation to a mutable `Map<string, typeof RelayClosedError>` and use `get(reason.split(":", 1)[0])`; do not add or export a registration API.
- Regression surface: `packages/relay/src/__tests__/relay.test.ts` already drives public REQ/CLOSED behavior with the websocket mock. Add hostile `constructor`, `__proto__`, and unknown-prefix cases through that public path rather than exporting the parser.
- Verify with `pnpm --filter applesauce-relay test -- relay.test.ts` and `pnpm --filter applesauce-relay build`.

### Optional SQLite peers (FIX-02)

- Manifest seam: `packages/sqlite/package.json` already lists exactly four backend packages in `peerDependencies`: `@libsql/client`, `@tursodatabase/database`, `@tursodatabase/database-wasm`, and `better-sqlite3`.
- Add matching `peerDependenciesMeta.<name>.optional: true` entries; keep all four peers and their ranges intact.
- Publication behavior needs a packed-consumer smoke test because workspace installs hide peer-resolution failures. Follow existing repository package-smoke scripts if present; build and pack `applesauce-sqlite`, install its tarball in an isolated temporary consumer with only `better-sqlite3`, and import the matching subpath.
- This changes package publication behavior, so add one patch changeset for `applesauce-sqlite`; its body must be one Markdown sentence per `AGENTS.md`.

### Group pointer compatibility (FIX-03)

- Production seam: `packages/common/src/helpers/groups.ts` exports `decodeGroupPointer` and `encodeGroupPointer`; public exports stay unchanged.
- `normalizeURL` is already the canonical URL normalizer. Decode must split only at the first apostrophe, reject an empty relay and URL fragments, preserve the complete remainder as the ID, and default an empty ID to `_`.
- Encoding may omit only a default secure `wss://` scheme when decoding the result reconstructs the exact normalized URL. Preserve `ws://`, explicit ports, IPv6 brackets, paths, and queries.
- Extend the focused table-driven suite in `packages/common/src/helpers/__tests__/groups.test.ts`; cover bare/default-secure hosts, explicit schemes/ports, localhost, IPv6, paths/queries, apostrophes in IDs, default IDs, and fragments.
- Add one patch changeset for `applesauce-common`; verify with `pnpm --filter applesauce-common test -- groups.test.ts` and its build.

### Concord AUTH/UI boundary (RESID-01)

- `packages/concord/src/client/auth.ts` owns structured `:auth` logging and the optional `StreamSignersOptions.onAuthFailure` callback. Keep caller-visible rejection/throw behavior and redacted pubkey/relay diagnostics there.
- `packages/concord/src/client/community.ts` and `private-channel.ts` pass AUTH failure callbacks that write transient failures into public UI error state. Remove only those writes/callback hookups; do not broaden or replace `error$`.
- Restate provenance in code/tests: the earlier requirement text asked for clear-on-recovery, but Phase 17's accepted decision strengthens it to prevention, so transient AUTH never enters fatal lifecycle state and no identity-clear/recovery mechanism is needed.
- Tests belong in focused community and private-channel client suites, with a control proving a real lifecycle/sync failure still fills `error$`. Preserve existing auth logger tests.
- Add one patch changeset for `applesauce-concord` describing only the RESID-01 AUTH/UI error-boundary correction.

### Invite revocation publication honesty (RESID-02)

- Member path: `ConcordCommunity.revokeInvite()` currently signs, adds locally, absorbs publish rejection, unregisters, then returns `{ revoked: true }`.
- Membership-free path: `ConcordInviteManager.revokeBundle()` currently signs/adds before evaluating `RelayPool.publish()`'s `PublishResponse[]` and absorbs failure; `revoke()` subsequently persists the Invite List tombstone.
- Introduce one focused internal success assertion for `PublishResponse[]`: at least one `ok: true` succeeds; empty/all-failed throws an `AggregateError` retaining per-relay responses. Use it consistently in both paths.
- Order side effects transactionally: successful bundle publication, then local bundle tombstone; for a member revoke, unregister registry link next; only then persist the private Invite List tombstone and resolve a `revoked: true` link. Reject with stage-specific context and leave later local state untouched on failure.
- Extend `packages/concord/src/client/__tests__/client.test.ts` for empty, all-failed, partial-success, unregister failure, no false local tombstones, and both branches. Add one patch changeset for `applesauce-concord`.
- Keep this RESID-02 changeset separate from RESID-01 even though both target `applesauce-concord`.

## Plan Boundaries and File Ownership

1. Relay and SQLite are independent and can execute in parallel because their source, tests, manifests, and changesets do not overlap.
2. Common group-pointer work is independent and can execute in the same wave.
3. Concord AUTH-boundary and revocation work overlap package-level test/build commands and likely `client.test.ts`; sequence them or keep them in one plan to avoid file conflicts.
4. Final validation must run each affected package test/build plus the workspace build. Packed-package smoke validation remains specific to SQLite.

## Do Not Hand-Roll / Do Not Expand

- Do not expose CLOSED-prefix registration or dependency injection; that API is explicitly deferred.
- Do not reinterpret Applesauce's apostrophe encoding as NIP-29 wire law; NIP-29 external identity remains kind-39000 `naddr` plus relay hint.
- Do not add AUTH failures to another public error channel or add recovery clearing; prevention is the locked RESID-01 contract.
- Do not treat a resolved `PublishResponse[]` as publication success without inspecting `ok` values.

## Changeset Discipline

Create separate patch changesets for each independent change: one each for relay, SQLite, and common, plus two Concord files split by RESID-01 and RESID-02. Each changeset body is exactly one Markdown sentence and describes only its one change.
