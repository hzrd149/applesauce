# Phase 17: Correctness Fixes & Concord Residuals - Context

**Gathered:** 2026-08-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix five independent correctness defects: prototype-safe CLOSED-prefix lookup, optional SQLite backend peers, lossless Applesauce group-pointer round trips, separation of transient Concord AUTH diagnostics from fatal UI error state, and honest invite-revocation publication results. This phase does not otherwise re-layer relay methods or redesign Concord lifecycle APIs.

</domain>

<decisions>
## Implementation Decisions

### Relay and SQLite Hardening
- Represent CLOSED prefix constructors with an internal mutable `Map`, making lookup prototype-safe without closing a future extension seam.
- Keep prefix extension internal in this security-fix phase. Defer a public registration API until collision, override, and lifecycle semantics are designed deliberately.
- Keep all four SQLite backends as peer dependencies and mark each optional through `peerDependenciesMeta`.
- Verify hostile `constructor`, `__proto__`, and unknown prefixes through public retry behavior, plus manifest assertions and a packed-package smoke install with one backend.

### Group-Pointer Compatibility
- Applesauce's apostrophe serialization is compatibility policy, not a NIP-29 wire mandate. NIP-29 defines identity as group ID plus hosting relay and standardizes external references as kind-39000 `naddr` with a relay hint.
- Preserve the complete normalized relay WebSocket URL. Omit a scheme only where decode restores the exact same normalized URL, and always retain explicit ports.
- Preserve normalized paths and queries because relay endpoints may use them; reject fragments.
- Split at the first apostrophe, require a non-empty relay, and preserve the complete remainder as the arbitrary-length group ID. Default an empty ID to `_`.
- Cover bare/default-secure hosts, explicit schemes and ports, localhost, IPv6, path/query endpoints, apostrophes in IDs, default IDs, and fragment rejection with table-driven round-trip tests.

### Concord UI Error Boundary
- Retain public `error$` and `status.error` exclusively for fatal lifecycle/sync failures.
- Remove `StreamSigners` auth-failure writes from both `ConcordCommunity` and `ConcordPrivateChannel`; transient AUTH failures remain on the operation/caller path and never latch into UI state.
- Preserve structured `:auth` diagnostics with relay URL and redacted pubkey.
- Restate RESID-01's prior clear-on-recovery interpretation with provenance: prevention is the stronger contract, so no auth recovery/identity-clearing machinery is needed.
- Tests must prove rejected/thrown AUTH does not modify community or private-channel UI error state, caller-visible operation failure remains intact, and a real non-auth lifecycle failure still populates `error$`.

### Invite Revocation Publish Honesty
- A multi-relay revocation publish succeeds when at least one relay returns `ok: true`; empty or all-failed results reject with an aggregate error carrying per-relay responses.
- Add the signed revocation tombstone to local event state and write the private Invite List tombstone only after required network publication succeeds.
- For a member revoke, publish the bundle revocation first and unregister the registry link second. Resolve `revoked: true` only after both succeed; reject with stage-specific context on either failure.
- Preserve `Promise<ConcordInviteLink>`: resolve a `revoked: true` link on success or reject an `Error`/`AggregateError` on failure.
- Test empty, all-failed, partial-success, unregister failure, absence of false local tombstones, and both member and membership-free branches.

### the agent's Discretion
- Choose focused helper names, error subclasses, and internal test-fixture structure consistent with neighboring packages.
- Source research may add private-channel coverage where needed, but must not broaden `error$` beyond fatal lifecycle/sync failures.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseClosedError` and the current prefix table live in `packages/relay/src/relay.ts`.
- SQLite already declares all backend drivers together in `packages/sqlite/package.json`.
- `decodeGroupPointer`/`encodeGroupPointer` and focused tests live in `packages/common/src/helpers/groups.ts` and its neighboring test file.
- `StreamSigners` centralizes stream-key AUTH behavior in `packages/concord/src/client/auth.ts`; community and private-channel constructors are the two UI-error writers.
- Community and membership-free invite revocation paths already share `ConcordInviteLink` and the pool's `PublishResponse[]` shape.

### Established Patterns
- Relay-group publication returns per-relay responses rather than rejecting each individual relay failure.
- Concord lifecycle walks catch fatal errors into `error$` plus `phase: "error"`; ordinary operations expose failure through their returned promise/observable.
- Package metadata and packed-consumer smoke tests are used to validate publication behavior that unit tests cannot see.

### Integration Points
- CLOSED-prefix safety must preserve D-07 retry-skip behavior.
- Group-pointer changes remain framework-agnostic in common helpers and update existing export-compatible APIs.
- Removing AUTH-to-UI writes requires updating Phase 15 provenance comments/tests without removing the shared auth logger.
- Invite-manager tombstoning must occur only after the community or membership-free revoke path reports real network success.

</code_context>

<specifics>
## Specific Ideas

- Prefer an extensible internal CLOSED-prefix `Map`; a public prefix registration API is intentionally deferred.
- Treat the `error$` surface as a fatal sync/lifecycle message, not a transient per-relay diagnostic stream.
- Preserve NIP-29's distinction from Applesauce's custom apostrophe compatibility encoding in source/test commentary.

</specifics>

<deferred>
## Deferred Ideas

- Public consumer registration or per-Relay injection for custom CLOSED error prefixes. Its validation, collision, override, and instance/global lifecycle contract needs a separate design phase.
- Replacing `error$` entirely with rejecting lifecycle calls or a new typed result channel. That is a broader public API redesign than RESID-01.

</deferred>
