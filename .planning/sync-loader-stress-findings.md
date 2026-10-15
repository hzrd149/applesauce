# Sync loader stress test findings (temporary)

These findings come from stress-testing `createSyncLoader` (`packages/loaders/src/loaders/sync-loader.ts`) against live relays on 2026-10-15, using the `outbox/photo-gallery` example and Node harnesses in `/tmp/sync-stress/`:
- `run.mjs` records per-relay state transitions;
- `force.mjs` forces the REQ or negentropy method;
- `perf.mjs` compares cold and warm syncs.

## Serious problems

### 1. ~~Negentropy is never detected on most strfry relays~~ (retracted)

**Not a bug: the original detection is correct.** strfry's NIP-11 `"negentropy": 1` field reports the protocol version the software supports, not whether the relay has negentropy enabled. Raw NEG-OPEN probes on 2026-10-15 (`/tmp/sync-stress/raw.mjs`):

| Relay | Lists 77 | `negentropy` field | NEG-OPEN reply |
|---|---|---|---|
| relay.damus.io | no | 1 | `NOTICE "ERROR: bad msg: negentropy disabled"` |
| relay.primal.net | no | 1 | `NOTICE "ERROR: bad msg: negentropy disabled"` |
| nos.lol, nostr.mom | no | 1 | no reply; these also failed to connect from Node in earlier runs |
| offchain.pub, nostr.oxtr.dev, nostr.bitcoiner.social, relay.nostr.net | yes | 1 | `NEG-MSG` |

strfry only adds 77 to `supported_nips` when negentropy is enabled, so `supported_nips` is the right signal. Treating the field as support was tried and reverted: damus and primal then stalled for the full 30s timeout before falling back to REQ.

**Remaining improvement (small):** strfry rejects a disabled negentropy with a `NOTICE`, not `NEG-ERR`, so a relay that wrongly lists 77 stalls for the whole timeout. A fix would make `negentropy()` fail fast on a "negentropy disabled" NOTICE during an open session.

**A NEG-OPEN handshake timeout was tried and dropped (2026-10-15).** It added a `handshakeTimeout` on `negentropySync`, with the sync loader defaulting to 5s and then 10s.
- **Where it worked:** relays forced to claim 77 (nostr.wine, nos.lol) fell back after the timeout instead of 30s.
- **Where it broke:** relay.nostr.net supports negentropy but answers NEG-OPEN slowly. A 1-year `#p` query took between 0.8s and over 15s to get the first reply. At 10s it falsely fell back in 2 of 4 runs and lost data through the REQ `max_limit` bug: 100 events instead of 3,000.
- **Why it isn't needed:** no relay that stays silent on NEG-OPEN lists 77, so the loader never hits this hang in practice.
- **What to do instead:** don't use a fixed handshake timeout, and fix finding 2 first.

### 2. ~~Relays that cap results lose data silently, with both methods~~ (fixed)

**Fixed in 5c93027a (2026-10-15).** Paginated requests clamp the page size to NIP-11 `max_limit` and only trust a short page when that cap is known; otherwise they page until an empty page. `Relay.sync()` re-requests missing ids until a round makes no progress, and the loader passes `max_limit` as its batch size. A live re-run against relay.nostr.net (5 different authors, 30 days) returned 495 events with REQ limit=100, REQ limit=500, and negentropy alike.

relay.nostr.net has `max_limit: 100`. The query was kinds 1 and 7 from 5 authors over 30 days, and the relay holds 458 matching events:

| Method | Events | Notes |
|---|---|---|
| REQ, limit=500 (default) | **100** | The first page is "short" because 100 < 500, so pagination stops |
| REQ, limit=100 | 458 | Complete |
| Negentropy | **100** | `Relay.sync()` requests missing ids in batches of 500 with no follow-up |

- **REQ path:** `paginatedRequest` stops when `count < limit` (`sync-loader.ts:294`).
- **Negentropy path:** `receiveTask` sends one `{ ids }` REQ per 500-id chunk, and ids that never arrive are dropped (`relay.ts:1667`, `relay.ts:1738-1757`, `relay.ts:1773`).
- Neither path reports an error.

**More evidence (gallery, all-time sync, everyone's engagement for hzrd149):** negentropy relays returned suspiciously round totals:
- relay.ditto.pub: 1,100 notes, 4,400 replies and reactions, 400 zaps;
- pyramid.fiatjaf.com: 500 notes, 500 replies and reactions.

These match capped receive batches rather than the relays' real totals.

**Fixes:**
- Clamp the page size and receive batch size to NIP-11 `limitation.max_limit`.
- Only stop paginating on an empty page, or on a short page when the page size is known to be under the relay cap.
- In `sync()`, re-request the ids that didn't arrive until a round makes no progress.

## Weaker spots

3. **`status$` emits only on relay state transitions (fixed, 2026-10-15).** Per-relay `count` and global `loaded` now publish intermediate snapshots through one shared 250 ms progress timer; lifecycle snapshots remain immediate and cancel pending progress.
4. **Unbounded `pendingEvents` buffer.** When only `status$` is subscribed (the gallery, `zap/dashboard`), every event is buffered for the whole run (`sync-loader.ts:741`). Fix: cap the buffer, or don't buffer for status-only consumers.
5. **Slow tails:**
   - The NIP-11 support check shares the 30s stall timeout (`sync-loader.ts:604`). relay.nostr.band took 10s to check, then failed.
   - A negentropy stall plus the REQ fallback can hold a concurrency slot for about 60s. In contacts mode (21 relays), one relay kept the run open for over 33s.
   - Fix: give the support check its own short timeout (about 5s), and consider a total per-relay deadline.
6. ~~**Socket errors read as `[object ErrorEvent]`.**~~ Fixed (2026-10-15): `Relay` converts socket error events to a `RelayConnectionError` ("Connection to <url> failed[: reason]", original event as `cause`) for `req`, `count`, `event`, `negentropy` and `error$`. Node's `ErrorEvent` usually has an empty message, so the URL is the main added context.
7. ~~**`relaySet` accepts junk.** A space-joined string of relay URLs became one percent-encoded "valid" URL.~~ Fixed: `normalizeRelayUrl` now trims its input and rejects inner whitespace or control characters and non-`ws:`/`wss:` protocols, so `relaySet` drops them.
8. **Per-relay `count` differs by method.** REQ counts re-downloaded duplicates, while negentropy counts only events the store was missing.

9. **Negentropy falls back with large tag filters.** In gallery contacts mode, the zap filter `{ kinds: [9735], "#p": [author], "#P": [423 pubkeys] }` started 5 relays on negentropy. By 40s all 5 had fallen back to REQ; the replies run only lost 1 of 5 relays. The relays likely reject or stall on large NIP-77 filters. Fix: record the fallback reason on `SyncRelayStatus`, so the error behind a negentropy-to-request fallback is visible.
10. **Dynamic relay lists work as intended** (commit e36477fa, verified in the gallery). Relays start immediately from the fallback set and grow as mailboxes load: the engagement runs went from 6 to 21 relays in about 5s, without restarting relays that were already running.

## Performance (same events either way)

| Relay | Events | REQ cold | Negentropy cold | REQ warm | Negentropy warm |
|---|---|---|---|---|---|
| nostr.bitcoiner.social | 266 | 1.1s | 1.2s | 550ms | **56ms** |
| offchain.pub | 66 | 1.0s | 1.1s | 245ms | **92ms** |

Negentropy matches REQ on a cold sync and is 3–10x faster on a re-sync, but only on relays that actually enable it.

## Suggested order

1. ~~Respect `max_limit` and re-request missing ids (finding 2).~~ Done in 5c93027a.
2. Throttled progress status and the bounded buffer (findings 3 and 4).
3. Support-check timeout and failing fast on a "negentropy disabled" NOTICE (findings 5 and 1). ~~Better error messages (finding 6).~~ Done.

Each fix gets its own changeset.

## Finding 9 follow-up: fallback visibility (2026-10-15)

Implemented optional `SyncRelayStatus.fallbackReason?: Error`. The existing loading/request transition now includes the negentropy failure and retains it through completion. A failed REQ keeps its terminal `error` separately. Authentication failures that bypass fallback leave the reason unset, and non-Error failures are normalized to Error instances.

The photo gallery labels request fallbacks and exposes the reason in the method tooltip.

Validation:
- Six focused tests passed, covering immediate and retained reasons, Error identity, non-Error normalization, request failure, timeout, direct requests, and authentication behavior.
- Full loader suite: 138 passed, 7 failed in the combined worktree; failures concern pagination call counts, auth-options identity, and dynamic relay event delivery while the result-cap changes are in progress.
- Loader build blocked at sync-loader.ts:356: the concurrently added handshakeTimeout option is absent from the structural SyncMethodOptions type.
- git diff --check passed.
- No new live relay run was performed; the build and combined-suite failures need resolving before recording a clean reproduction.

Next investigation: repeat the gallery contacts-mode zap sync and record relay URL, filter dimensions, fallbackReason.name/message, elapsed time at fallback, and the final REQ outcome. Compare the same relays with smaller #P lists to distinguish explicit rejection from stalls; a timeout alone does not establish a filter-size limit.

## Finding 3 investigation and fix plan (2026-10-15)

Confirmed in the current source: `toMessages()` increments `state[url].count` and updates `seen`, but only emits event messages. `status()` builds snapshots for relay-list and lifecycle changes; the shared dispatcher forwards those snapshots to a `ReplaySubject(1)`. Neither counter mutation triggers a snapshot. The gallery and zap dashboard consume `status$` directly, so their progress remains stale until another transition.

The existing sync-loader suite passes: 57 tests, including final counts, late status replay, fallback visibility, dynamic relays, and teardown. These tests do not assert intermediate counter updates while a relay remains loading.

### Intended behavior

- Publish event-driven progress at most once per 250 ms across the entire run, with no idle polling.
- Keep relay-list, checking, loading, fallback, completion, and error snapshots immediate. Lifecycle snapshots include all counters accumulated so far.
- Keep `events$` delivery immediate and preserve existing counter semantics: relay counts can increase for events already surfaced by another relay, while `loaded` remains globally deduplicated.
- Build each snapshot when it is published and copy relay entries as today, so previously emitted snapshots remain stable.
- Preserve replay of the latest published snapshot, shared execution, cancellation, and prompt completion. A late subscriber may see counters up to one progress interval behind until the next publication.

### Implementation scope

1. Add one progress notification mechanism inside the per-subscription `work$` scope in `packages/loaders/src/loaders/sync-loader.ts`. After an accepted event updates counters, mark progress dirty and schedule one publication if none is pending; update `seen` before any publication can occur. Trigger this even when global deduplication suppresses the event message.
2. Use a single cancellable 250 ms scheduled task for the whole run, equivalent to auditing progress notifications. Build a fresh snapshot at the deadline, rather than building and discarding one for every event. Do not apply `auditTime` to the public status stream, which could suppress lifecycle transitions.
3. Have every immediate snapshot clear pending progress because it already includes those counter changes. Cancel scheduled work on completion, error, or final unsubscription; progress must neither keep a static run open nor emit a redundant snapshot after `done=true`. For dynamic relay lists, cancel pending progress on list changes and remain subscribed for later additions as today.
4. Update the public status JSDoc to distinguish immediate lifecycle snapshots from throttled counter updates. Start with an internal 250 ms interval; no new public option is needed for this fix.
5. Add one patch changeset for `applesauce-loaders` with a single-sentence body describing intermediate sync progress updates. Keep finding 4's buffer policy and finding 8's counter semantics separate.

### Verification plan

Add fake-timer tests in `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` using controlled relay subjects and `timeout: false`:

- Exercise both REQ and negentropy with status-only subscribers: counters advance while the relay remains loading, and a burst produces one progress snapshot per interval.
- With two relays, verify a cross-relay duplicate updates the second relay's count without increasing `loaded`, and both relays share one progress timer.
- Subscribe to `events$` as well and verify events arrive before the progress deadline; earlier snapshots retain their original values.
- Complete, error, or fall back before the deadline and verify the immediate snapshot has current counters, with no trailing stale progress or delayed completion.
- Remove a relay during pending progress, then re-add it; verify snapshots reflect current entries and a dynamic run can resume after `done=true`.
- Unsubscribe all consumers during pending progress and verify timer cleanup; resubscribe and verify a fresh run. Verify late subscribers replay the latest published progress snapshot.

Run the focused sync-loader suite, the full loader suite, `pnpm --filter applesauce-loaders build`, and `git diff --check`. Then repeat a gallery sync to confirm visible mid-run counts; live relay timing is supplementary to the deterministic tests. Existing example consumers need no API changes.

### Finding 3 implementation validation (2026-10-15)

Implemented with one per-run timer, scheduled when accepted events update relay counts, including cross-relay duplicates. Snapshots are built at publication; lifecycle messages cancel pending progress, and teardown clears the timer. No public options or dependencies were added.

Validation: all 150 loader tests passed, including three new cases covering REQ and negentropy progress, status-only consumption, shared throttling, cross-relay deduplication, snapshot stability, immediate event delivery, late replay, final counters, and timer cleanup. The loader build and `git diff --check` passed. No live relay run was performed.
