---
quick_id: 260804-hmw
slug: gate-verifiedsymbol-and-encryptedcontent
description: Gate verifiedSymbol and EncryptedContentSymbol on source.id === dest.id in EventStore.copySymbolsToDuplicateEvent
created: 2026-08-04
source: .planning/todos/pending/05.1-review-followups.md (WR-01)
tasks: 3
must_haves:
  truths:
    - "A losing version of a replaceable event can no longer copy its decrypted plaintext (EncryptedContentSymbol) onto a different, stored version through EventStore.add()."
    - "A losing version can no longer copy its signature verdict (verifiedSymbol) onto a different, stored version — including a false verdict, which would make nostr-tools' verifyEvent short-circuit to false for a genuinely valid event."
    - "A same-id duplicate still merges both symbols exactly as before — the gate narrows cross-version copies only."
    - "FromCacheSymbol still propagates across versions, and that decision is recorded in the code as a declared disposition rather than as an unexplained absence."
    - "A symbol added to the copy list in the future cannot inherit 'copy always' silently — the list's element shape requires a disposition."
  artifacts:
    - packages/core/src/event-store/event-store.ts
    - packages/core/src/event-store/__tests__/event-store.test.ts
    - .changeset/copy-symbols-version-gate.md
  key_links:
    - "packages/core/src/event-store/event-store.ts:269 — the reachable cross-version call site (replaceable-loser branch)"
    - "packages/core/src/event-store/async-event-store.ts:237/252/272 — mirrored call sites, covered by construction because they call the same static"
    - "packages/core/src/helpers/cache.ts — the one-rule symbol doc this disposition table sits under"
---

# Quick Task 260804-hmw: gate payload symbols on source.id === dest.id

WR-01 from `05.1-REVIEW.md` (`.planning/todos/pending/05.1-review-followups.md`). CR-01 and
WR-03 in that same todo are already fixed and are NOT in scope. WR-04
(`EventFactory.kind()`) is explicitly out of scope — do not touch
`packages/core/src/factories/event.ts`.

## The defect

`EventStore.copySymbolsToDuplicateEvent(source, dest)`
(`packages/core/src/event-store/event-store.ts:197`) guards regular kinds with
`source.id !== dest.id` but guards replaceable kinds only on
`pubkey` + `getReplaceableIdentifier`. So for a replaceable kind, `source` and `dest` may be
**different versions** — different `id`, `content`, `created_at`, `sig`. The copy loop then
propagates `EncryptedContentSymbol` (the decrypted plaintext of *one specific* `content`
string) and `verifiedSymbol` (a verdict earned by *one specific* signed byte sequence) across
that version boundary.

## Reachability — per call site, stated explicitly

- **`event-store.ts:269` (replaceable-loser branch) — REACHABLE, ordinary path.**
  `keepOldVersions = false` is the class default (`event-store.ts:77`). The branch is entered
  whenever an incoming replaceable event fails to beat the stored NIP-01 winner, which covers
  both an exact re-delivery (same `id`) *and* any strictly-older or tie-losing **different**
  version. `event` there is the losing incoming version and `winner` is a different,
  already-stored event. This is the live defect site, and it is reached **before** the store's
  own `this.verifyEvent(event)` call at line 276 — so the losing event's verdict memo is
  trusted and copied without the store ever verifying it.
- **`event-store.ts:284` (memory returned a different instance) — NOT reachable with a version
  mismatch.** `EventMemory.add` (`event-memory.ts:80`) keys `this.events` by `event.id` and
  returns `current` only on an id hit, so `existing.id === event.id` by construction.
- **`event-store.ts:304` (database returned a different instance) — reachable only through a
  custom `IEventDatabase`.** `inserted = this.mapToMemory(this.database.add(event))`, and
  `mapToMemory` routes through `memory.add`, which preserves the id of whatever `database.add`
  returned. `IEventDatabase.add(event): E` (`interface.ts:230`) carries no contract requiring a
  same-id return, so a third-party database that does its own replaceable collapsing can hand
  back a different version. With the built-in `EventMemory` it cannot.
- **`async-event-store.ts:237/252/272`** mirror all three and are covered by construction,
  because they call the same static.
- **Bonus, incidental:** a kind that is neither regular (`kind < 10000 && kind !== 0 && kind !== 3`)
  nor replaceable — e.g. an ephemeral kind in 20000–29999 — trips **neither** existing throw, so
  today the function will merge payload symbols between two entirely unrelated events of such a
  kind. The new id gate closes that for the two payload symbols too.

That distribution is exactly why the gate goes **inside** the function rather than at line 269:
two of the five reachable-in-principle sites live in a different file, and one depends on a
consumer's database implementation. Patching the one site known to be reachable today is the
enumerated-denylist shape this project has already paid for twice (STATE.md: the 12-10
`CHANNEL_KEY_FOLD_DISPOSITION` rework, and the CR-01/WR-01 drift that preceded it).

## Task 1 — structural fix in `copySymbolsToDuplicateEvent`

**files:** `packages/core/src/event-store/event-store.ts`

**action:**

- Replace the bare `const symbols = [FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`
  array with a **list of `[symbol, disposition]` pairs**, typed so the disposition is required.
  Name the disposition type something like `DuplicateSymbolDisposition` with the two members
  `"any-duplicate"` and `"same-id-only"`, and type the list as a
  `readonly (readonly [symbol, DuplicateSymbolDisposition])[]`. Adding a symbol without a
  disposition is then a tuple-arity compile error — a future symbol cannot inherit "copy always"
  by omission, which is the structural property this task is buying.
- **Do NOT attempt the keyed/mapped-table form** (`{ [SomeSymbol]: "..." } satisfies Record<...>`)
  that 12-10 and 12.3-14 used for object fields. It cannot work here and probing it will burn
  context for nothing: `FromCacheSymbol` (`helpers/event.ts:72`) and `EncryptedContentSymbol`
  (`helpers/encrypted-content.ts:5`) are both `Symbol.for(...)`, whose type is plain `symbol`,
  not `unique symbol` — a computed key of type `symbol` in an object literal degenerates into a
  `symbol` index signature and enforces nothing. Only `verifiedSymbol` is a `unique symbol`
  (nostr-tools `lib/types/core.d.ts:8`). The tuple-pair list is the strongest form actually
  available, and it is honest about what it guarantees: every entry in **this** list is
  classified. Say so in the doc comment rather than overclaiming exhaustiveness over all symbols.
- Compute `const sameVersion = source.id === dest.id` once above the loop, and skip an entry
  whose disposition is `"same-id-only"` when `sameVersion` is false. Leave the existing
  `symbol in source && !(symbol in dest)` presence gate and the `setCachedValue` write untouched.
- Dispositions and the reasoning that fixes them:
  - `EncryptedContentSymbol` → **`same-id-only`**. It *is* payload: the plaintext of one
    specific `content` string. A different version has a different `content`, so the memo is
    simply the wrong answer for it.
  - `verifiedSymbol` → **`same-id-only`**. It *is* a verdict over one specific
    `id`/`pubkey`/`sig` triple. Copying it forward is worse than merely wrong: nostr-tools'
    `verifyEvent` short-circuits on the memo before recomputing, so a copied `false` makes a
    valid event read as invalid, and a copied `true` suppresses verification of bytes nobody
    checked.
  - `FromCacheSymbol` → **`any-duplicate`** (unchanged behavior). It is delivery provenance, not
    payload — `markFromCache`/`isFromCache` (`helpers/event.ts:176-188`) record only that some
    instance reached the process from a local cache rather than a relay, and the flag is read for
    loader/backfill bookkeeping, never as a security verdict or as a value about `content`. For a
    replaceable address, "a version of this arrived from cache" stays true of the address when
    the version differs, and narrowing it would change existing loader behavior for no
    correctness gain. Record this conclusion **in the code**, next to its disposition, so the
    next reader inherits the reasoning instead of re-deriving it.
- Deliberately unchanged and worth one sentence in the doc comment: the seen-relays merge in the
  branch immediately above the loop also crosses version boundaries. It is the same provenance
  class as `FromCacheSymbol`, it merges element-wise rather than through the presence-gated loop,
  and WR-01 does not name it. Out of scope here.
- While editing, correct the existing loop comment (`event-store.ts:219-221`), which currently
  says "these three symbols propagate" as though the three were interchangeable — that framing is
  precisely the thing this task falsifies.
- Also fix a latent flake this change creates in two **existing** tests:
  `event-store.test.ts:438` ("merges symbols when pubkey and replaceable identifier both match")
  and `event-store.test.ts:448` ("merges the symbol onto dest non-enumerably…") each build
  `source` and `dest` with two separate `userA.event(...)` calls whose `created_at` defaults to
  `unixNow()`. They currently produce identical ids only because both calls land in the same
  second; once the id gate exists, a second-boundary straddle turns them RED at random. Pin an
  explicit identical `created_at` on both events in both tests so their ids are deterministically
  equal. This is a fixture-robustness fix, not an assertion change — do not weaken either
  assertion.

**verify:**
- `pnpm --filter applesauce-core exec vitest run src/event-store` is green.
- `pnpm --filter applesauce-core build` (`tsc`) exits 0.
- Hand-check the arity guarantee once: temporarily append a bare symbol (no disposition) to the
  list, confirm `tsc` errors, remove it. Record the error text in the SUMMARY. This is the only
  evidence that the structural claim in the doc comment is real — the 12-10/12.3-14 precedent is
  that an unproven "adding X fails the build" claim is worth nothing.

**done:** cross-version copies of the two payload symbols are impossible from every call site,
`FromCacheSymbol` behavior is unchanged, and the list's shape forces a future symbol to declare
its disposition.

## Task 2 — regression tests through the real `EventStore.add()` path

**files:** `packages/core/src/event-store/__tests__/event-store.test.ts`

Add a new `describe` block beside the existing `copySymbolsToDuplicateEvent (CR-04 regression)`
block. Match that file's conventions: `FakeUser` from `../../__tests__/fixtures.js`, `vitest`
`describe`/`it`/`expect`, `Reflect.has`/`Reflect.get` for symbol assertions.

**Hard constraint on construction:** every test drives `eventStore.add()` with two genuine
versions of one replaceable event. **Do not call `EventStore.copySymbolsToDuplicateEvent`
directly** in these tests — a direct call with hand-built arguments would still pass if the
reachable path were wired differently, which is the whole reason WR-01 survived a green suite.
Direct-call coverage already exists in the CR-04 block above; leave it alone.

**Shared setup for A/B/D:** pin `created_at` explicitly. Add the newer version `v2` first (it
becomes the stored NIP-01 winner), then add the older `v1` — which routes through
`event-store.ts:269`. Use `setCachedValue` (`../../helpers/cache.js`) to place memos on `v1`,
matching how the real decrypt path writes them, rather than `Reflect.set`.

**Anti-degeneration guards — required in every one of A, B, D** (this is the STATE.md WR-05
lesson from 12-11, where two tests were non-vacuous only by an unasserted coincidence): assert
`v1.id !== v2.id` and `v1.content !== v2.content` inside the test body, and assert that
`eventStore.add(v1)` returns `v2`. Those three assertions are what stop a future fixture edit
from silently collapsing the pair into a same-id case and turning the test into an always-green
no-op.

**Test A — decrypted plaintext does not cross versions.**
Give `v1` an `EncryptedContentSymbol` memo holding a plaintext string that is unique and
recognizable. Add `v1`. Assert `Reflect.has(v2, EncryptedContentSymbol)` is `false`. The
expected value is independently derived: nothing in the test ever decrypts `v2`, so absence is
the only correct state and any present value can only have come from `v1`.

**Test B — a signature verdict does not cross versions, proven downstream.**
Build `v1` legitimately, then corrupt only its `sig` (a 128-char all-zero hex string) so its
`id`, `content` and NIP-01 ordering stay coherent and the *only* defect is the signature. Clear
`v1`'s finalize-time memo (`Reflect.deleteProperty(v1, verifiedSymbol)`), then call nostr-tools'
`verifyEvent` on `v1` and **assert it returns `false`** — this both earns the memo honestly
(never hand-set it to a chosen value) and fails loudly if nostr-tools ever changes. Then clear
the stored winner's memo (`Reflect.deleteProperty(v2, verifiedSymbol)`; the store set it during
`add`) so the `!(symbol in dest)` presence gate is open. Add `v1`.
Assert in this order:
1. `Reflect.has(v2, verifiedSymbol)` is `false` — the unearned verdict did not land.
2. Then, and only then, `verifyEvent(v2)` returns `true`. This is the downstream assertion and
   the discriminating one: `verifyEvent` returns the memo without recomputing when one is
   present, so under the defect the copied `false` makes a genuinely valid event read as
   invalid. `true` here is derived from `v2`'s own signature by nostr-tools, not from anything
   this codebase produced. Ordering matters — step 2 sets the memo, so it must follow step 1.

**Test C — positive control: a same-version duplicate still merges.**
Add `v2`, then build `const duplicate = { ...v2 }` and place an `EncryptedContentSymbol` memo on
it. Assert `duplicate.id === v2.id`, then `eventStore.add(duplicate)` returns `v2` and the memo
**did** land on `v2`. This drives the identical branch at `event-store.ts:269` (a spread copy
ties on `created_at` and `id`, so it loses too) and differs from A only in whether the ids match
— which makes the pair a tight, self-contained statement of what the gate does and does not do.

**Test D — `FromCacheSymbol` still crosses versions.**
Same A/B setup, `markFromCache(v1)` (`../../helpers/event.js`), add `v1`, assert
`isFromCache(v2)` is `true`. This pins the deliberate `any-duplicate` decision so a future
"tighten everything" edit has to argue with a test instead of quietly changing behavior.

**Mandatory non-vacuity demonstration (do not skip, do not assert it in a comment):**
Flip the disposition of `verifiedSymbol` and `EncryptedContentSymbol` from `same-id-only` back
to `any-duplicate` **in place** in `event-store.ts` — a two-token edit, no git surgery needed.
Re-run the file and confirm:
- Test A is RED, and record the leaked value observed on `v2` (it should be `v1`'s exact
  plaintext string).
- Test B is RED, and record which of its two assertions fails.
- Tests C and D stay GREEN (they are controls; if either goes RED the gate is over-broad).
Restore the dispositions, re-run, confirm all four GREEN. Paste the observed vitest output —
test names and pass/fail counts for both runs — into the SUMMARY. A test whose RED was not
observed does not count as coverage under this milestone's verification standard (STATE.md,
Blockers/Concerns; established by 12-11, 10-05, 12.1-01).

**verify:** `pnpm --filter applesauce-core exec vitest run src/event-store` green; the
revert-probe transcript is in the SUMMARY.

**done:** four tests exist, all drive `EventStore.add()`, A and B are empirically demonstrated
RED without the fix, C and D are demonstrated GREEN in both states.

## Task 3 — changeset and full verification

**files:** `.changeset/copy-symbols-version-gate.md`

**action:**
- `applesauce-core` is a released package, so a changeset **is** required (unlike
  `packages/concord`). One change here, so exactly **one** changeset file, bump `patch` — this is
  a bug fix with no API change.
- Follow CLAUDE.md exactly: the body is a **single sentence of markdown**. No bullet list, no
  code fence, no second paragraph, no example. Match the house style of
  `.changeset/copy-symbols-replaceable-guard.md`, which covers the sibling CR-04 fix to the same
  function and is the closest precedent in tone and length.
- The sentence should say that `copySymbolsToDuplicateEvent` now copies `verifiedSymbol` and
  `EncryptedContentSymbol` only when source and destination share an id, so a losing version of a
  replaceable event can no longer leak its plaintext or its signature verdict onto a different
  version.

**verify:** `pnpm test` at the repo root (turbo build for `./packages/*` then the full vitest
run) exits 0. Confirm the changeset frontmatter names `applesauce-core` with `patch`.

**done:** one single-sentence `patch` changeset for `applesauce-core`; full workspace suite green.

## Commits

One commit per task, in order — fix, tests, changeset — so the revert probe in Task 2 has a
clean single-commit fix to flip against and `git diff` attributes behavior to the fix rather
than the tests.

## Out of scope

- WR-04 (`EventFactory.kind()` never resolving) — do not touch
  `packages/core/src/factories/event.ts`.
- WR-03 (`getSealRumor` undefined sentinel) and CR-01 (`getGiftWrapSeal` discarded verify) — both
  already closed.
- The cross-version seen-relays merge in the branch above the loop (reasoning in Task 1).
- The `IEventDatabase.add` contract gap at `event-store.ts:304` — the id gate makes it harmless
  for the two payload symbols; documenting a same-id return requirement on the interface is a
  separate, larger change.
