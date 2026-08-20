# Phase 17: Correctness Fixes & Concord Residuals - Research

**Researched:** 2026-08-20
**Domain:** TypeScript package correctness, package metadata, URL round-trips, and Concord failure semantics
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
- Public consumer registration or per-Relay injection for custom CLOSED error prefixes. Its validation, collision, override, and instance/global lifecycle contract needs a separate design phase.
- Replacing `error$` entirely with rejecting lifecycle calls or a new typed result channel. That is a broader public API redesign than RESID-01.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIX-01 | `parseClosedError` cannot reach the prototype chain. | Internal `Map` replacement and public REQ/COUNT/negentropy-path regression locations identified. |
| FIX-02 | All four SQLite backend peers are optional. | Exact manifest edit plus metadata and packed-consumer verification commands identified. |
| FIX-03 | Group identifiers round-trip protocol, port, and full relay endpoint. | Lossy implementation, normalization boundary, input grammar, and table cases identified. |
| RESID-01 | AUTH rejection does not latch UI `error$`. | Both constructor sinks and both obsolete tests identified; fatal lifecycle writers remain isolated. |
| RESID-02 | Revocation rejects when required publication fails. | Both revoke branches, local mutation ordering, publish-response semantics, and failure-stage tests identified. |
</phase_requirements>

## Summary

Phase 17 should be planned as four independent implementation tracks, with the two Concord requirements sharing one final integration test pass. FIX-01 is a private data-structure substitution in `packages/relay/src/relay.ts`; FIX-02 is package metadata plus artifact-level verification; FIX-03 is a focused parser/serializer correction; RESID-01 removes two constructor callbacks while preserving lifecycle catch writers; RESID-02 introduces a small publish-result assertion seam and reorders local mutations after network acknowledgement. No public API expansion and no new dependency is required. [VERIFIED: codebase and 17-CONTEXT.md]

The most consequential finding is that `RelayPool.publish()` resolves `PublishResponse[]` even when individual relays fail, because `RelayGroup.internalPublish()` converts thrown per-relay errors into `{ok:false, from, message, error}` values. Therefore RESID-02 cannot be fixed by merely removing `.catch(...)`; callers must inspect the returned array, accept any `ok:true`, and reject empty/all-failed arrays with the original responses attached. [VERIFIED: packages/relay/src/group.ts:77-88,193-225,259-263; packages/relay/src/types.ts:133-140]

**Primary recommendation:** Implement one requirement-focused commit/test unit per defect, then finish with Concord integration tests that prove failure ordering and the prevention-based RESID-01 contract. [VERIFIED: 17-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CLOSED-prefix classification | API / Backend library | — | Relay-controlled protocol input is classified inside the relay transport library before retry policy consumes it. [VERIFIED: packages/relay/src/relay.ts:163-185,987-1005,1122-1138,1381-1392] |
| SQLite backend peer declaration | Package / Distribution | Consumer package manager | The published manifest determines which peers consumers must install; source runtime logic is unchanged. [VERIFIED: packages/sqlite/package.json:112-129] |
| Group-pointer encoding | Shared domain helper | Caller storage/UI | Framework-agnostic serialization belongs in common helpers; consumers only receive the normalized pointer. [VERIFIED: packages/common/src/helpers/groups.ts:27-56] |
| Concord AUTH diagnostics vs UI lifecycle state | Concord client domain | Relay auth operation | `StreamSigners` owns operation diagnostics; community/channel lifecycle methods exclusively own fatal `error$` writes. [VERIFIED: packages/concord/src/client/auth.ts:138-207; community.ts:535-564; private-channel.ts:238-263] |
| Invite revocation publication | Concord community/invite manager | RelayPool + EventStore | The domain method sequences bundle publication, registry removal, then local invite-list state. [VERIFIED: packages/concord/src/client/community.ts:1377-1393; invite-manager.ts:252-310] |

## Project Constraints (from AGENTS.md)

- Keep documentation focused and avoid redundant standalone best-practice documents or summary sections. [VERIFIED: AGENTS.md]
- Any code examples included here must remain short and focused (about 20 lines maximum). [VERIFIED: AGENTS.md]
- Keep framework-agnostic group parsing in `packages/common`; do not move it into React/UI code. [VERIFIED: AGENTS.md and packages/common/src/helpers/groups.ts]
- Verify examples/tests, package navigation/exports where applicable, and absence of duplicate/orphaned files. [VERIFIED: AGENTS.md]
- If changesets are added, each file describes exactly one change and its body is one Markdown sentence. [VERIFIED: AGENTS.md]
- The NIP feature checklist is not triggered: this phase corrects an existing NIP-29 helper and does not introduce a new NIP surface. [VERIFIED: AGENTS.md and phase boundary]

## Standard Stack

### Core

| Library / Facility | Version | Purpose | Why Standard |
|--------------------|---------|---------|--------------|
| TypeScript | `^7.0.2` in affected packages | Implementation and type checking | Existing workspace compiler; no version change is needed. [VERIFIED: affected package manifests] |
| Vitest | `^4.0.15` manifests; workspace executable `4.1.10` | Unit and integration regression tests | Existing test framework in relay/common/concord/sqlite. [VERIFIED: package manifests; `pnpm exec vitest --version`] |
| WHATWG `URL` | Node 22 runtime | Parse, normalize, and inspect relay URL components | Existing helper already uses `URL`; retaining `href`/component information avoids hostname-only loss. [VERIFIED: packages/common/src/helpers/groups.ts:52-55] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/URL] |
| Native `Map` | ECMAScript runtime | CLOSED prefix → error constructor lookup | Locked internal mutable lookup and prototype-safe by construction. [VERIFIED: 17-CONTEXT.md] |
| Native `AggregateError` or focused subclass | ES2022 target | Carry all failed publish responses | Meets the locked rejection shape without a dependency. [VERIFIED: 17-CONTEXT.md; package tsconfig inheritance] |

### Supporting

| Facility | Version | Purpose | When to Use |
|----------|---------|---------|-------------|
| npm package metadata | npm docs current 2026-08-20 | `peerDependenciesMeta` optional flags | For all four SQLite driver peers. [CITED: https://docs.npmjs.com/cli/configuring-npm/package-json/#peerdependenciesmeta] |
| pnpm pack/install smoke fixture | pnpm `11.10.0` | Validate the actual published artifact with one driver | FIX-02 artifact gate; unit tests cannot prove consumer installation behavior. [VERIFIED: environment and 17-CONTEXT.md] |
| Existing `PublishResponse` | workspace relay type | Preserve per-relay success/failure evidence | RESID-02 aggregate error payload. [VERIFIED: packages/relay/src/types.ts:133-140] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Internal `Map` | `Object.hasOwn` on current object literal | Also safe, but contradicts the locked extensible internal-map choice. [VERIFIED: 17-CONTEXT.md] |
| Preserve normalized full URL | Rebuild from `hostname` | Current defect: discards scheme, port, path, and query. [VERIFIED: packages/common/src/helpers/groups.ts:52-55] |
| Inspect `PublishResponse[]` | Depend on promise rejection | Incorrect for group publish because per-relay errors are converted into response values. [VERIFIED: packages/relay/src/group.ts:77-88,213-216] |

**Installation:** No dependency installation is part of this phase. [VERIFIED: requirements and affected manifests]

## Package Legitimacy Audit

This phase installs no external packages; the package-legitimacy gate is therefore not applicable. Existing SQLite driver names remain unchanged and are not newly recommended. [VERIFIED: 17-CONTEXT.md; packages/sqlite/package.json:115-129]

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| None | — | — | — | — | N/A | No install |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
Relay CLOSED/NEG-ERR reason
  -> first-prefix extraction -> internal Map.get(prefix)
  -> known: typed RelayClosedError -> existing retry-skip behavior
  -> unknown/hostile: null -> graceful/unchanged public behavior

Group pointer string
  -> split first apostrophe -> validate/normalize full relay URL
  -> reject fragment? yes -> null
  -> preserve remaining ID -> GroupPointer -> encode normalized endpoint

Concord revoke request
  -> sign bundle tombstone -> publish to relay group
  -> any ok:true? no -> AggregateError(responses), no local mutation
  -> yes -> add local bundle event -> member?
       -> yes: unregister registry -> mark revoked -> Invite List tombstone
       -> no: mark revoked -> Invite List tombstone
```

### Recommended Project Structure

```text
packages/relay/src/relay.ts                         # FIX-01 map and public-path tests nearby
packages/relay/src/__tests__/relay.test.ts          # hostile prefix/retry regression
packages/sqlite/package.json                        # FIX-02 peer metadata
packages/sqlite/... package-artifact test seam      # manifest + packed install smoke
packages/common/src/helpers/groups.ts               # FIX-03 codec
packages/common/src/helpers/__tests__/groups.test.ts# table-driven round trips
packages/concord/src/client/{community,private-channel}.ts
packages/concord/src/client/invite-manager.ts        # RESID-01/02 sequencing
packages/concord/src/client/__tests__/*.test.ts      # failure contracts
```

### Pattern 1: Prototype-Safe Dispatch

**What:** Construct the internal error-constructor table as a `Map<string, typeof RelayClosedError>` and retrieve with `.get(prefix)`. [VERIFIED: locked decision]

**When to use:** Whenever relay-controlled text selects an internal constructor or handler. [VERIFIED: .planning/research/PITFALLS.md:387]

```typescript
// Source: phase decision + packages/relay/src/relay.ts
const prefixes = new Map<string, typeof RelayClosedError>([
  ["auth-required", AuthRequiredError],
  ["restricted", RelayClosedError],
]);

const ErrorClass = prefixes.get(reason.split(":", 1)[0]);
return ErrorClass ? new ErrorClass(reason) : null;
```

### Pattern 2: First-Delimiter Compatibility Codec

**What:** Use the first apostrophe index, not `split("'")`, so every later apostrophe remains part of the arbitrary-length group ID. Normalize the complete relay URL, reject `hash`, and serialize enough of the normalized URL to decode to the same value. [VERIFIED: 17-CONTEXT.md; current loss at groups.ts:38-55]

**When to use:** The Applesauce compatibility identifier only; do not describe it as NIP-29's standardized external-reference wire format. NIP-29 specifies group identity and `naddr` references separately. [CITED: https://github.com/nostr-protocol/nips/blob/master/29.md]

### Pattern 3: Publish Result Gate Before Mutation

**What:** Centralize the exact “at least one relay ack” rule in a private helper that returns successful responses or throws an aggregate containing every response. [VERIFIED: 17-CONTEXT.md and RelayGroup publish behavior]

**When to use:** Both `ConcordCommunity.revokeInvite()` and `ConcordInviteManager.revokeBundle()`; do not change unrelated best-effort publishes. [VERIFIED: phase boundary]

```typescript
// Source: packages/relay/src/types.ts + locked phase decision
function requireRevocationAck(responses: PublishResponse[]): void {
  if (responses.some((response) => response.ok)) return;
  throw new AggregateError(responses, "bundle revocation publish failed");
}
```

The planner should decide whether the aggregate's `.errors` contains responses directly or a subclass exposes a named `responses` field; either is within agent discretion, but tests must assert relay URL, message, and original `error` survive. [VERIFIED: 17-CONTEXT.md; PublishResponse shape]

### Pattern 4: Prevention-Based UI Error Boundary

**What:** Instantiate `StreamSigners` without an `onAuthFailure` callback in community and private-channel constructors. Keep `auth.ts`'s `:auth` logging and operation behavior unchanged. Keep `start()`/`walk()` catch blocks as the only writers of non-null `error$`. [VERIFIED: auth.ts:178-207; community.ts:356-362,535-564; private-channel.ts:170-176,238-263]

**When to use:** RESID-01. Do not add success callbacks, error clearing on AUTH recovery, or identity tracking; prevention supersedes the earlier clear-on-recovery wording. [VERIFIED: 17-CONTEXT.md provenance restatement]

### Anti-Patterns to Avoid

- **Denylisting `constructor` and `__proto__`:** leaves other inherited keys such as `toString` reachable; use `Map`. [VERIFIED: current plain-object lookup and FIX-01 requirement]
- **Using `URL.hostname`:** explicitly omits the port and all non-host components; the current encoder does exactly this. [VERIFIED: groups.ts:52-55] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/URL/hostname]
- **Calling `.split("'")` destructuring:** drops apostrophes and suffixes after the second field. [VERIFIED: groups.ts:38-39]
- **Removing only `.catch()`:** group publication can resolve with all `ok:false`; inspect values. [VERIFIED: group.ts:77-88,259-263]
- **Adding EventStore state before acknowledgement:** creates a false local revocation when the network still serves the live bundle. [VERIFIED: current early mutations at community.ts:1383-1385 and invite-manager.ts:280-281]
- **Replacing AUTH latching with AUTH clearing:** creates unnecessary recovery state and violates the stronger prevention contract. [VERIFIED: 17-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Prototype ownership checks | Prefix denylist | Native `Map` | Eliminates the entire prototype-chain class. [VERIFIED: locked decision] |
| URL component parsing | Regex/substring reconstruction | Native `URL` plus existing `normalizeURL` | Handles ports, IPv6, path/query, and normalization consistently. [VERIFIED: existing stack] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/URL] |
| Multi-error container | String concatenation | Native `AggregateError` / focused subclass | Retains structured per-relay responses. [VERIFIED: locked decision] |
| SQLite optional-peer semantics | Installer scripts | `peerDependenciesMeta.*.optional=true` | npm natively does not auto-install optional peers. [CITED: https://docs.npmjs.com/cli/configuring-npm/package-json/#peerdependenciesmeta] |
| AUTH recovery state | New success/reset channel | Remove the two UI sinks | Transient AUTH never enters fatal state, so it needs no recovery. [VERIFIED: locked decision] |

**Key insight:** Each defect comes from using a representation with weaker semantics than the domain requires—plain-object inheritance, hostname-only serialization, promise-only failure, or a shared error sink. Prefer the native structure that encodes the invariant. [VERIFIED: codebase synthesis]

## Common Pitfalls

### Pitfall 1: Testing `parseClosedError` Directly

**What goes wrong:** A private-function unit test proves lookup shape but not D-07 retry-skip behavior. [VERIFIED: parseClosedError is private at relay.ts:182]

**How to avoid:** Drive hostile CLOSED reasons through public REQ and COUNT behavior, and include the negentropy translation path if its fixture is cheap. Assert hostile/unknown prefixes do not become typed retry-skipping relay errors and do not trigger retries unexpectedly. Preserve existing `restricted:` tests at relay.test.ts:1697 and 2412 as known-prefix controls. [VERIFIED: relay.ts call sites and relay.test.ts]

### Pitfall 2: Serializer Round-Trip Tests That Compare the Wrong Form

**What goes wrong:** Comparing encoded text literally can reject legitimate normalization, while comparing only `hostname` misses the defect. [VERIFIED: current tests and helper]

**How to avoid:** Compare `decode(encode(pointer))` to the expected normalized `{relay,id}`. Include `ws://localhost:4869`, explicit `wss` port, bracketed IPv6, path/query, apostrophes in ID, empty ID, and fragment rejection. [VERIFIED: locked test matrix]

### Pitfall 3: Optional Peers Verified Only in Source Manifest

**What goes wrong:** A source assertion passes while the packed artifact or consumer install behaves differently. [VERIFIED: locked artifact requirement]

**How to avoid:** Assert all four `peerDependenciesMeta` keys and pack `packages/sqlite`; install the tarball plus exactly one backend in an isolated temporary consumer, then inspect the installed tree for absence of the other peers. npm documents that optional peers are not automatically installed. [CITED: https://docs.npmjs.com/cli/configuring-npm/package-json/#peerdependenciesmeta]

### Pitfall 4: RESID-01 Tests Preserve the Superseded Contract

**What goes wrong:** Existing tests explicitly require post-walk AUTH failure to populate `error$`; leaving them unchanged contradicts the new prevention contract. [VERIFIED: community.test.ts:3401-3445; private-channel.test.ts:794-904]

**How to avoid:** Rewrite those oracles to assert `error$` remains null for rejected, thrown, and zero-answer AUTH. Separately keep `StreamSigners` unit tests proving failure callbacks/logging behavior, and add a genuine lifecycle/sync throw fixture proving `error$` and `phase="error"` still work. [VERIFIED: auth.test.ts:181-262; lifecycle catches]

### Pitfall 5: Partial Success Mistaken for Failure

**What goes wrong:** `responses.every(ok)` rejects a valid revocation after one relay has made it effective. [VERIFIED: locked any-success decision]

**How to avoid:** Success predicate is `responses.some(r => r.ok)`; empty arrays naturally fail. Preserve every response on failure. [VERIFIED: 17-CONTEXT.md]

### Pitfall 6: Failure After Local Mutation

**What goes wrong:** The event store, registry, or private Invite List claims revocation despite failed required publication. [VERIFIED: current ordering]

**How to avoid:** Member branch order: sign → publish/validate → local EventStore add → unregister → create `revoked:true` → callback/private tombstone. Membership-free branch: sign → publish/validate → local EventStore add → return revoked link → manager tombstone. On unregister failure, reject with stage context and do not write the private Invite List tombstone; the already-published bundle revocation is intentionally not rolled back. [VERIFIED: locked sequencing]

## Code Examples

Verified patterns from project and official sources are shown above; keep implementation snippets under 20 lines per AGENTS.md. [VERIFIED: AGENTS.md]

### Optional Peer Metadata

```json
{
  "peerDependenciesMeta": {
    "@libsql/client": { "optional": true },
    "@tursodatabase/database": { "optional": true },
    "@tursodatabase/database-wasm": { "optional": true },
    "better-sqlite3": { "optional": true }
  }
}
```

Source: [npm package.json documentation](https://docs.npmjs.com/cli/configuring-npm/package-json/#peerdependenciesmeta). [CITED: https://docs.npmjs.com/cli/configuring-npm/package-json/#peerdependenciesmeta]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain object keyed by untrusted prefix | `Map.get()` | Phase 17 | Removes prototype-chain resolution. [VERIFIED: phase decision] |
| Required peer alternatives | Optional peer metadata | npm-supported current behavior | Consumers install only the selected backend. [CITED: npm package.json docs] |
| Hostname-only compatibility ID | Normalized full WebSocket endpoint | Phase 17 | Protocol, port, path, and query round-trip. [VERIFIED: phase decision] |
| AUTH diagnostic written into fatal UI state | AUTH diagnostics remain operation/log scoped | Phase 17 provenance restatement | No transient latch and no recovery state machine. [VERIFIED: phase decision] |
| Best-effort revoke reports success | Any-ack publish gate before mutation | Phase 17 | `revoked:true` becomes truthful. [VERIFIED: phase decision] |

**Deprecated/outdated:**
- Existing comments at `community.ts:356-359`, `private-channel.ts:170-173`, `community.test.ts:3401-3405`, and `private-channel.test.ts:794-797` describe AUTH-to-`error$` as intentional. Update/remove them with RESID-01 so provenance does not assert superseded behavior. [VERIFIED: codebase]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|

All claims in this research were verified against project source/context or cited from official documentation; no user confirmation is needed beyond the locked decisions. [VERIFIED: source coverage]

## Open Questions (RESOLVED)

1. **RESOLVED — Aggregate error surface name**
   - What we know: failure must reject with all `PublishResponse`s and stage-specific context. [VERIFIED: 17-CONTEXT.md]
   - What's unclear: whether to use bare `AggregateError.errors` or a private/focused subclass with `responses` and `stage` fields.
   - Recommendation: use a focused internal subclass if it makes stage and response assertions clearer, but do not export it in this phase. [VERIFIED: agent discretion + deferred public APIs]

2. **RESOLVED — Packed-consumer test home**
   - What we know: no package-artifact smoke test currently exists under `packages/sqlite`. [VERIFIED: repository scan]
   - What's unclear: whether the project prefers a Vitest subprocess test or a root/package script.
   - Recommendation: planner should follow the closest package-publication test convention found during execution; keep the test isolated and deterministic, using a temporary directory and the packed tarball. [VERIFIED: locked test requirement]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/tests/package smoke | ✓ | `v22.23.1` | — |
| pnpm | workspace tests and packing | ✓ | `11.10.0` | npm only for isolated consumer if needed |
| npm | registry-compatible consumer install | ✓ | `10.9.8` | pnpm isolated install |
| Vitest | unit/integration tests | ✓ | `4.1.10` executable | — |

**Missing dependencies with no fallback:** none. [VERIFIED: environment probes]

**Missing dependencies with fallback:** none. [VERIFIED: environment probes]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.10` workspace executable |
| Config file | Root workspace/Vitest defaults; affected package scripts call `vitest run --passWithNoTests`. [VERIFIED: package manifests] |
| Quick run command | `pnpm exec vitest run packages/relay/src/__tests__/relay.test.ts packages/common/src/helpers/__tests__/groups.test.ts packages/concord/src/client/__tests__/auth.test.ts packages/concord/src/client/__tests__/community.test.ts packages/concord/src/client/__tests__/private-channel.test.ts packages/concord/src/client/__tests__/client.test.ts` |
| Full suite command | `pnpm test` if defined by root, otherwise `pnpm exec vitest run` plus `pnpm turbo build --filter='./packages/*'`. [VERIFIED: .planning/config.json] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIX-01 | Hostile/unknown CLOSED prefixes cannot select inherited constructors and retry behavior stays correct | integration/unit | `pnpm exec vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ extend existing |
| FIX-02 | Four optional peers present in manifest; packed consumer installs one backend only | manifest/artifact smoke | focused new package metadata test/script + isolated install | ❌ Wave 0 artifact harness |
| FIX-03 | Full relay URL and arbitrary ID round-trip; fragment rejected | unit table | `pnpm exec vitest run packages/common/src/helpers/__tests__/groups.test.ts` | ✅ extend existing |
| RESID-01 | AUTH failures leave UI errors null; fatal lifecycle failures still populate them | integration/unit | `pnpm exec vitest run packages/concord/src/client/__tests__/auth.test.ts packages/concord/src/client/__tests__/community.test.ts packages/concord/src/client/__tests__/private-channel.test.ts` | ✅ rewrite/extend existing |
| RESID-02 | Empty/all-failed reject; partial success resolves; unregister failure rejects; no false local tombstones | integration | `pnpm exec vitest run packages/concord/src/client/__tests__/community.test.ts packages/concord/src/client/__tests__/client.test.ts` | ✅ extend existing |

### Sampling Rate

- **Per task commit:** affected package's focused test file(s). [VERIFIED: package scripts]
- **Per wave merge:** `pnpm --filter applesauce-relay test`, `pnpm --filter applesauce-common test`, `pnpm --filter applesauce-sqlite test`, and `pnpm --filter applesauce-concord test`. [VERIFIED: manifests]
- **Phase gate:** full workspace Vitest plus configured package build; packed SQLite consumer smoke green. [VERIFIED: .planning/config.json and locked decision]

### Wave 0 Gaps

- [ ] Add an artifact-level FIX-02 smoke harness that packs `applesauce-sqlite`, installs the tarball with only one backend, and asserts the other three are absent.
- [ ] Add reusable Concord publish-response fixtures for empty, all-failed, and partial-success results without changing the global `fakePool()` success default.
- [ ] Add a lifecycle/sync-failure fixture distinct from `StreamSigners.onAuthFailure` to protect the fatal `error$` contract.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Operation-scoped NIP-42 handler; AUTH failure remains caller/log scoped. [VERIFIED: auth.ts] |
| V3 Session Management | no | No browser/server session is introduced. [VERIFIED: phase scope] |
| V4 Access Control | yes | Concord registry and invite revocation sequencing must not claim success before relay acknowledgement. [VERIFIED: phase decisions] |
| V5 Input Validation | yes | `Map` lookup for untrusted prefixes; URL normalization, delimiter validation, and fragment rejection. [VERIFIED: phase decisions] |
| V6 Cryptography | yes | Existing `finalizeEvent` and signer keys remain; no cryptography is hand-rolled. [VERIFIED: community.ts and invite-manager.ts] |

### Known Threat Patterns for TypeScript/RxJS Nostr Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prototype-chain dispatch from relay-controlled prefix | Elevation/Tampering | Native `Map`; hostile public-path tests. [VERIFIED: FIX-01] |
| URL authority truncation changes relay destination | Spoofing/Tampering | Preserve normalized scheme/authority/path/query; reject fragments. [VERIFIED: FIX-03] |
| False local revocation after failed network publish | Repudiation/Integrity | Ack gate before EventStore, registry, or private-list mutation. [VERIFIED: RESID-02] |
| Secret invite token leaked in error/log context | Information Disclosure | Keep existing public signer-pubkey identifiers and never include token/signer secret in aggregate messages. [VERIFIED: invite-manager.ts:258-261; community.ts:1369-1372] |
| Transient relay AUTH rejection poisons persistent UI state | Denial of Service | Prevent AUTH diagnostic writes to lifecycle `error$`. [VERIFIED: RESID-01 restatement] |

## Exact Implementation and Test Locations

| Requirement | Production seam | Test seam | Planner note |
|-------------|-----------------|-----------|--------------|
| FIX-01 | `packages/relay/src/relay.ts:163-185` (`CLOSED_ERROR_PREFIXES`, `parseClosedError`); consumers at `:1002`, `:1136`, `:1383` | `packages/relay/src/__tests__/relay.test.ts`; known-prefix controls at `:1697` and `:2412` | Test `constructor`, `__proto__`, `toString`/unknown through public behavior; do not export parser/map. |
| FIX-02 | `packages/sqlite/package.json:115-120` | new manifest/artifact smoke near sqlite package tooling | Add identical optional metadata for all four exact peer keys; verify packed tarball. |
| FIX-03 | `packages/common/src/helpers/groups.ts:38-56` | `packages/common/src/helpers/__tests__/groups.test.ts:34-100` | First apostrophe index; normalize full URL; fragment guard; table tests. |
| RESID-01 | Remove callbacks at `community.ts:356-362` and `private-channel.ts:170-176`; preserve fatal writers at `community.ts:535-564`, `private-channel.ts:238-263`; preserve auth logger/failure path at `auth.ts:138-207` | Rewrite `community.test.ts:3401-3445`, `private-channel.test.ts:794-904`; retain `auth.test.ts:181-262` | Restate Phase 15 provenance in comments: prevention supersedes clear-on-recovery. |
| RESID-02 | `community.ts:1377-1393`; `invite-manager.ts:252-310`; response definition `relay/types.ts:133-140` | Existing happy paths `client.test.ts:611-698`, AUTH/log path `:1477+`, community publish coverage `community.test.ts:3693-3699` | Validate response array before local add; member unregister second; private list last; assert stage-specific rejection. |

## Sources

### Primary (HIGH confidence)

- Direct codebase reads of the exact files and tests listed in “Exact Implementation and Test Locations.” [VERIFIED: codebase]
- `.planning/ROADMAP.md` Phase 17, `.planning/REQUIREMENTS.md` FIX-01/02/03 and RESID-01/02, `17-CONTEXT.md`, `.planning/PROJECT.md`, `.planning/STATE.md`, and current milestone research. [VERIFIED: planning artifacts]
- Package manifests and environment version probes. [VERIFIED: codebase and shell probes]

### Secondary (MEDIUM confidence)

- [npm `peerDependenciesMeta` documentation](https://docs.npmjs.com/cli/configuring-npm/package-json/#peerdependenciesmeta) — optional peer installation semantics. [CITED: official npm docs]
- [MDN URL API](https://developer.mozilla.org/en-US/docs/Web/API/URL) — URL component and serialization behavior. [CITED: MDN]
- [Official NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md) — arbitrary-length group IDs, hosting-relay identity, and `naddr` external references. [CITED: nostr-protocol/nips]

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing tools and native facilities verified in manifests/runtime.
- Architecture: HIGH — every production and test seam inspected directly.
- Pitfalls: HIGH — derived from current control flow and locked tests, with external semantics cited from official docs.

**Research date:** 2026-08-20  
**Valid until:** 2026-09-19 (stable codebase-local phase; re-check if Phase 17 source files change before planning)
