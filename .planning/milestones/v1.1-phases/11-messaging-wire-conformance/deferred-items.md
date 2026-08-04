# Deferred Items — Phase 11 (messaging-wire-conformance)

Out-of-scope discoveries logged per the executor's Scope Boundary rule. Not fixed here.

## 11-02: Pre-existing `applesauce-examples` build failure (unrelated to WIRE-01)

**Discovered:** Task 2's baseline `pnpm exec turbo build --filter=applesauce-examples` run
(before any WIRE-01 edits landed), and reconfirmed with `--force` (cache bypass) after the
edits landed.

**Symptom:** `tsc -b` fails with `TS2322: Type '(filters: Filter[]) => Promise<StoredEvent[]>'
is not assignable to type 'CacheRequest'` (`StoredEvent` missing `sig`, required by
`NostrEvent`) in 9 files, none of which this plan touches:

- `src/examples/cache/nostr-idb.tsx` (2 occurrences)
- `src/examples/comment/feed.tsx`
- `src/examples/feed/reactions-timeline.tsx`
- `src/examples/feed/relay-timeline.tsx`
- `src/examples/nutzap/contacts.tsx`
- `src/examples/outbox/social-feed.tsx`
- `src/examples/torrent/feed.tsx`
- `src/examples/wallet/admin.tsx`
- `src/examples/wallet/wallet.tsx`

**Root cause (not investigated further — out of scope):** these call sites hand a
`CacheRequest` a function returning `Promise<StoredEvent[]>`; `CacheRequest` requires
`Promise<NostrEvent[]>`, and `StoredEvent` (from `applesauce-core`) omits `sig`. Predates
this plan — `git log` on each file's most recent commits shows unrelated work (Noble/Scure
dependency upgrade, relay-connection hang fix, nut-wallet unlock bug fix), none of which
mention `concord`, `admin-management`, or `voice`.

**Effect on 11-02's acceptance criteria:** Task 2's stated criterion "`pnpm build`
(unfiltered) exits 0" cannot be met without fixing these 9 unrelated files. Verified this
plan's own edit (`apps/examples/src/examples/concord/admin-management.tsx`) introduces no
new errors: it does not appear anywhere in the `tsc -b` error output, with or without
`--force` cache bypass. `pnpm test` (the root script, `turbo build --filter='./packages/*'
&& vitest run`) is unaffected and fully green (269/270 test files, 2359/2361 tests — 1
skipped file/2 skipped tests are pre-existing and unrelated).

**Disposition:** Left unfixed per the Scope Boundary rule (pre-existing, unrelated to the
current task's changes). A future plan targeting `applesauce-examples`'s cache-request
call sites should either widen `CacheRequest`'s accepted type or narrow these call sites'
return type to `NostrEvent[]`.
