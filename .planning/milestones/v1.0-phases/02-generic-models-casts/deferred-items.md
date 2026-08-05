# Deferred Items — Phase 2: Generic models & casts

## 1. `castEvent` input type does not exclude rumors from signed-only casts (code-review WR-01) — OWNED BY PHASE 3/4

**Finding (02-REVIEW.md, WARNING, non-blocking):** This phase widened `castEvent`'s first parameter from `NostrEvent` (master) to `StoreEvent` to enable the phase's new capability — casting unsigned rumors (`casts compose over any store event`). Side effect: the parameter is no longer tied to the specific cast's own event type, so a `Rumor` (no `sig`) can now be passed to a signed-only cast subclass that reads `event.sig` — a compile error on master, now a latent runtime `TypeError`. Reviewer confirmed with a compiled repro (`packages/core/src/casts/cast.ts:28-29,45`).

**Why NOT fixed in Phase 2:**
- The reviewer's proposed fix — infer the input from the cast: `event: C extends EventCast<infer T> ? T : never` — was implemented and **does not compile cleanly**: it breaks the internal callers `castEventStream`/`castTimelineStream` (which pass a generic `StoreEvent` stream) and the `castEvent` body, and it over-tightens *external* call sites (requiring the exact event kind, stricter than master's `NostrEvent`). Making it compile requires rippling casts through the stream variants and is a genuine public-API strictness decision with ergonomic tradeoffs.
- Phase 2's goal (generic model framework + cast infrastructure, WR-02 seam closed) is met and independently verified (the reviewer's type probe confirmed `EventStore<Rumor>` returns `Rumor`-typed observables; full `pnpm -r build` green; 592/592 tests).
- Rumor casting is exercised for the FIRST time in **Phase 3 (RumorStore & verification)** and **Phase 4 (common package rumor casts)**. Those phases are the natural place to settle `castEvent`'s input typing with real usage in hand (e.g., whether to gate on the cast's `T`, or split a `castRumor`/`castEvent` surface). **Phase 3/4 planning MUST address this** so the shipped public API does not let a rumor reach a signed-only cast.

**Suggested direction for Phase 3/4:** tie `castEvent`'s input to the cast's declared `EventCast<T>` event type (rejecting rumors for signed casts), while keeping the stream operators (`castEventStream`/`castTimelineStream`) loose since they are runtime-guarded with try/catch over a `StoreEvent` stream.

## 2. Cosmetic (code-review WR-03/IN-01/IN-02) — low priority

- **WR-03:** `profile()` (in `event-store/event-models.ts`) has a dead no-op normalization statement (`typeof user === "string" ? {...} : user;` discarded), unlike its `contacts()`/`mailboxes()` siblings. Pre-existing; safe to remove in a future cleanup.
- **IN-01:** stale "until Wave 2" bridge-cast comments in `models/base.ts` (the seam is already closed).
- **IN-02:** a no-op `defined()` in `castTimelineStream`.

## 3. Release-note item (code-review WR-02 / carried from Phase 1 AR-01)

The CORE-03 change (an options object with `verifyEvent` present-but-`undefined` disables signature verification, vs. master keeping it secure) is intentional and already accepted (Phase 1 `01-SECURITY.md` AR-01), but is security-relevant and must be called out in the milestone migration/release notes.
