# Deferred Items — Phase 4: Common package rumor support

## 1. `getHashtagTag` return type hides a possible `undefined` (code-review WR-01) — PRE-EXISTING, deferred to maintainer

**Finding (04-REVIEW.md, WARNING, non-blocking):** `packages/common/src/helpers/hashtag.ts:9` casts the `event.tags.find(...)` result as `["t", string]`, hiding the fact that `.find` can return `undefined`. A caller doing `getHashtagTag(event)[1]` would crash with a `TypeError` when the event has no hashtag tag. This is inconsistent with the sibling `getEmojiTag`, which correctly types its return as `... | undefined`.

**Why NOT fixed in Phase 4:**
- **Pre-existing** — the unsafe cast predates this phase; Phase 4's diff only touched the function's signature line (the `<E>` genericization), not the cast.
- Phase 4's charter is a strict **zero-behavior-change** genericization of 4 structural helpers, not general bug-fixing.
- The correct fix changes the **public return type** (`["t", string]` → `["t", string] | undefined`), which ripples to every caller (they must handle `undefined`) — a breaking API change out of scope for this phase and this milestone.

**Suggested direction:** fix in a dedicated correctness change (own changeset, `patch`/`minor` as appropriate), auditing `getHashtagTag` callers to handle the `undefined` case, aligning it with `getEmojiTag`.

## 2. Informational (code-review IN-01/IN-02) — no action

- **IN-01:** `emoji.ts:35` `getReactionEmoji` uses the wider `StoreEvent` bound (vs the `{content, tags}` it reads) — intentional, a shared cast/rumor-friendly bound.
- **IN-02:** `threading.ts:104,114` empty `catch {}` blocks — pre-existing, intended best-effort tag parsing.

## Milestone-level scope note (for the audit)

COMMON-02's targeted-cast set is empty **by design** this milestone: no `applesauce-common` cast has a current rumor use case, and common casts' event types derive from core's `KnownEvent<K>` (hardcoded to `NostrEvent`, out of scope to genericize). The generic cast infrastructure (Phase 2/3) already supports rumor casts. Remaining common casts/helpers are explicitly **COMMON-F1/F2** (future, beyond this milestone). See `04-COMMON-02-AUDIT.md`.
