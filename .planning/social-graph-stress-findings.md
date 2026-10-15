# Social graph loader stress test findings (temporary)

These findings come from stress-testing `createSocialGraphLoader` (`packages/loaders/src/loaders/social-graph.ts`) against live relays on 2026-10-15. The harnesses are Bun scripts in `/tmp/social-graph-stress/`:
- `authors.ts`, `limits.ts`, `chunk.ts`, `single.ts`, `retry.ts` send raw-WebSocket probes of kind 3 `authors` filters;
- `loader.ts` runs the real loader through an instrumented upstream that times each batch;
- `proto.ts` is a prototype crawler with the proposed fixes;
- `warm.ts` runs a cold crawl, then a `since` re-sync;
- `missing.ts` and `outbox.ts` check whether missing lists exist anywhere.

Relays are the example defaults (purplepag.es, indexer.coracle.social, relay.vertexlab.io) unless noted. The seed accounts were hzrd149, jb55, gigi, derek, odell, jack and fiatjaf.

## Status after the loader rewrite (branch `social-graph-loader`, 2026-10-15)

Implemented, with live runs against the default lookup relays (`/tmp/social-graph-stress/loader2.ts`):
- the idle-aware group completion (finding 1);
- per-relay requests;
- retries of lossy relays for users no relay returned, one filter per user and at most 20 per REQ (findings 2 and 3);
- 6 batches of 100 in flight, with at most 4 open requests per relay (finding 5);
- the root fetched once (finding 6);
- hint routing per user with a cap (finding 4);
- cache refresh with `since` (finding 9);
- a `{ events$, status$ }` result (finding 10).

| Run | Old loader | New loader |
|---|---|---|
| odell, distance 1 | 32s, 53.4% | **30s, 98.9%** |
| hzrd149, distance 2, with EventStore | 384s, 86.8%, +1.8 GB heap | **276s, 91.2%**, +2.0 GB heap |
| hzrd149, distance 2, no store | — | 235s (2 per relay) / **210s (4 per relay)**, 91.2%, **+46 MB heap** |

**Lessons from tuning:**
- **Per-relay concurrency matters more than batch concurrency.** With 6 batches and no per-relay limit, vertexlab queued REQs, and 9 of 18 requests failed the new 10s `firstResponseTimeout`, leaving 72% coverage.
- **The cap check can't count raw events through `pool.request`,** because the group removes repeated event ids. The retry trigger is "the relay returned stale versions, or under 90% of the batch's found lists" instead.
- **Memory at distance 2 is dominated by the EventStore** holding about 29k full follow lists. The loader itself adds about 46 MB.

**Still open:**
- finding 8 (remembering users with no list across re-syncs);
- the relay follow-ups 2–5 in the investigation section.

## Headline numbers

| Run | Current loader | Prototype |
|---|---|---|
| hzrd149, distance 2 (32k authors) | 384s, 86.8% coverage, +1.8 GB heap | **224s, 90.3%**, +0.8 GB heap |
| derek, distance 1 (1,315) | 27s, **49.8%** | 21s, 98.4% |
| odell, distance 1 (1,676) | 32s, **53.9%** | 27s, 98.9% |
| gigi, distance 1 (767) | 17s, **51.6%** | 20s, 97.1% |
| jack, fiatjaf, hzrd149, distance 1 | 97–99% | same coverage, 20–30% faster |

About 90.3% is the real ceiling at distance 2. Of 200 sampled missing authors, 1 was found on 7 other major relays, and 0 of 57 were found on their own NIP-65 outboxes. Those accounts have no follow list at all.

## Serious problems

### 1. The group's 5s cutoff silently truncates batches (main data loss)

`pool.request()` defaults to `RelayGroup.completeAfterFirstRelay(5_000)` (`packages/relay/src/group.ts:371`, `:593`). indexer.coracle.social answers kind 3 with an empty EOSE in about 60ms. That starts the 5s timer, which then kills relay.vertexlab.io, the only relay with near-complete data, partway through the batch. vertexlab needs about 8s for 300 authors and 11s for 1,000.
- In the distance-2 run, 36 of 108 batches ended at exactly 5,020ms.
- Coverage drops as the batch grows: for derek, `parallel=100` gives 98.4%, `300` gives 49.8%, and `1000` gives 36.3%.
- Whether it happens depends on vertexlab's load at the time, so the same root can get 98% on one run and 50% on the next.

**Fix:** see "Group request completion" below. This is a `RelayGroup.request()` problem, not a social graph problem.

### Group request completion (investigation)

**Where it comes from.** `RelayGroup.request()` defaults `complete` to `completeAfterFirstRelay(5_000)` (`packages/relay/src/group.ts:371`). Group settlement (`settledSubscription`, `group.ts:212`) already completes once every relay has sent EOSE or failed, so this operator only ever ends a request *early*. The default is deliberate: it predates phase 21 as `completeOnAny(completeAfterFirstRelay(5_000), completeOnAllEose())`, was restored in 6ab4ef54, and is documented in `apps/docs/migration/v5-v6.md:125`. Its purpose is to stop waiting on straggler relays.

**What's wrong with the policy.** `completeAfterFirstRelay` (`group.ts:593`) is a fixed wall-clock deadline from the first EOSE:
- an empty EOSE starts it, so the fastest relay with no data decides the deadline for every relay that does have data;
- it ignores activity, so a relay still streaming events is cut off the same as a dead one;
- truncation is silent: the request completes normally and nothing marks the dropped relays.

**Who is affected.** Every loader except the sync loader calls `pool.request(relays, filters)` through `makeUpstreamRequest` (`packages/loaders/src/helpers/upstream.ts:9`). That includes address, event, timeline, tag-value, user-lists, reactions, zaps and social-graph. `NostrRequest` (`packages/loaders/src/types.ts:11`) has no options argument, so loaders cannot opt out. The sync loader already requests each relay separately (`sync-loader.ts:343`).

**Measurements.**
- `repro.ts` uses local fake relays: one sends EOSE immediately with no events; the other streams 100 events over 10s. The default delivered **49/100** in 5.0s. `completeOnAllEose()` delivered 100/100 in 10.1s.
- Live default lookup relays (`live-complete.ts`):

  | Request | Default | All EOSE | Idle 2s (below) |
  |---|---|---|---|
  | kind 0 / 10002, 100–500 authors | no loss (finishes in <2.5s) | same | — |
  | kind 3, 500 authors | 283–451 | 484, 6.6s | 484, 7.1s |
  | kind 3, 1,000 authors | **319**, 5.4s | 979, 16.8s | 979, 15.5s |

  Small events finish well inside 5s. Large events, big batches, and slow relays lose data, and how much depends on relay load at the time.
- **Stalled relay** (`repro-stall.ts`): it sends 20 events and then goes silent with no EOSE. The default completes at 5.0s. Waiting for all EOSE hits the 30s group timeout and **errors with `TimeoutError`** even though 20 events were already delivered: a second sharp edge.

**What the 5s window has to balance.** Relays are unreliable, so `request()` has to stop waiting at some point. The relay behaviours it has to cope with are distinct, and one fixed deadline can't serve them all. Each row below is a fake relay in `sim.ts`; the policies are in `policies.ts`.

| Scenario (fake relays) | Fixed 5s (current) | All EOSE | Idle 2s | **Adaptive** |
|---|---|---|---|---|
| Empty relay + one streaming for 10s | **49/100**, 5.0s | 100, 10.2s | 100, 10.2s | **100, 10.1s** |
| Full relay + silent (dead) relay | 100, 5.2s | 100, 30s + error | 100, 2.1s | **100, 3.1s** |
| Full + 3 dead + 1 offline | 100, 5.1s | 100, 30s + error | 100, 2.1s | **100, 3.1s** |
| Empty + relay that stalls after 20 events | 20, 5.0s | 20, 30s + error | 20, 4.0s | **20, 3.5s** |
| Full + relay with a 3s first byte | 200, 3.1s | 200, 3.1s | **100**, 2.1s | **200, 3.1s** |
| Full + relay with a 7s first byte | 100, 5.2s | 200, 7.1s | 100, 2.1s | 100, 3.1s |
| Full + relay trickling 1 event per 1.2s | 104, 5.1s | 124, 30s + error | 124, 30s + error | 112, 15.2s |
| All relays dead | 0, 30s + error | same | same | same |

- **Fixed deadline:** cuts off relays that are actively streaming.
- **All EOSE:** turns every dead relay into a 30s hang and then an error.
- **Pure idle:** drops relays that are slow to send their *first* event.

**Calibration from real relays** (`latency.ts`): 120 relays from NIP-65 lists, probed at most 8 at a time.
- Time to first message, including connect and TLS: p50 0.8s, p90 1.0s, p95 1.2s; only 4 of about 70 responders took longer than 3s.
- Errors fail fast (p90 0.6s); about 16% of relays never answer at all.
- Opening all 120 sockets at once pushed p75–p95 to 6.8–7.7s, so wide fan-outs inflate latency on the client side.

A 3s grace covers about 97% of relays that respond.

**Implemented (uncommitted, 2026-10-15):** `RelayGroup.completeAfterIdle()` is now the `request()` default, and `firstResponseTimeout` (default 10s) fails silent relays. With the built-in default, `sim.ts` matches the adaptive column and all-dead groups end at 10.0s with `RelayGroupError`. Live loader coverage went from 64.1% to 98.4% (derek) and from 53.4% to 98.9% (odell). The completion example compares the legacy and idle-aware policies.

**Recommended policy: `completeAfterIdle({ grace, idle, cap })`** as the new `request()` default, starting from the first EOSE:
- `grace` (3s): how long to wait for relays that haven't sent anything yet. This replaces today's 5s and covers p95 relays with headroom.
- `idle` (1.5s): a relay that is still sending keeps the request open; each event pushes the deadline to at least `now + idle`.
- `cap` (15s): the hard limit after the first EOSE, so a trickling relay can't hold the request open.

```ts
static completeAfterIdle({ grace = 3_000, idle = 1_500, cap = 15_000 } = {}): GroupRequestCompleteOperator {
  return (source) => source.pipe(
    filter((m) => m.type === "EOSE"), take(1),
    switchMap(() => {
      const start = Date.now();
      const quiet = source.pipe(filter((m) => m.type === "EVENT"), startWith(null),
        switchMap(() => timer(Math.max(start + grace - Date.now(), idle))));
      return merge(quiet, timer(cap));
    }),
    map(() => true),
  );
}
```

A global timer is enough; per-relay tracking gives the same result. Events only come from relays that haven't finished, and the request has to wait for any relay that is still sending anyway.

**Live validation**, real social graph loader at distance 1 with the default lookup relays (`loader.ts complete=fixed|adaptive`):

| Root | Fixed 5s | Adaptive |
|---|---|---|
| derek (1,315) | 64.1%, 23.9s | **98.4%**, 31.9s |
| odell (1,676) | 53.4%, 32.1s | **98.9%**, 37.7s |
| gigi (767) | 68.2%, 17.8s | **97.5%**, 16.8s |

Wall time rises by 0–33% because the loader now actually waits for vertexlab, but the time per list found drops: derek goes from 28ms to 25ms per list.

**Also needed:**
1. ~~**A per-relay first-response timeout**~~ (implemented as `firstResponseTimeout`) (about 10s): a relay with no EVENT or EOSE by then is marked failed. Today, when every relay is dead, no EOSE ever arrives, so every policy hangs for the 30s whole-request timeout and then errors. With this timeout, an all-dead group errors with `RelayGroupError` at 10s.
2. **Partial results instead of a `TimeoutError`:** when the 30s whole-request timeout fires after events were delivered, complete instead of erroring.
3. **Request options for loaders:** add an optional third `opts` argument on `NostrRequest`/`UpstreamPool`, forwarded by `makeUpstreamRequest`. Completeness-first loaders such as the social graph and sync could then use `{ grace: 5_000, cap: 30_000 }`, and UI timelines could keep tighter values.
4. **Visible truncation:** report which relays were cut off when the policy, not EOSE, ends a request.
5. **Bounded socket fan-out:** consider limiting how many relays connect at once; simultaneous connects inflated measured latency 5–7x.
6. **Release:** the new default is a behaviour change, so ship it with a changeset and a v6→v7 migration note replacing the "five seconds" text in `apps/docs/migration/v5-v6.md`.

### 2. purplepag.es drops about half the authors in multi-author filters

With `{ kinds: [3], authors: N }`, purplepag.es returns exactly N events, but they include repeats of the same event id: one author was sent 44 times. With 300 authors, it sent 300 events, 229 distinct ids, and lists for only 162 authors. An explicit `limit` changes nothing, and `limit > 500` gets `CLOSED`.
- One single-author filter per author in one REQ returns 298 of 300 lists in the same ~2s.
- Re-asking only the missing authors converges slowly: 162 → 218 → 245 → 255.
- Single-author queries find every author that is still missing.

**Fix:** when a relay returns at least `authors.length` events, re-request the missing authors as single-author filters, up to 50 filters per REQ. The prototype does this. Detecting the cap, rather than always using single filters, matters because of finding 3.

### 3. Relays disagree on filter limits, and some fail silently

| Relay | Behaviour |
|---|---|
| relay.vertexlab.io | `CLOSED` above 50 filters per REQ, but NIP-11 lists no limitation |
| user.kindpag.es | 50 single-author filters: no reply, waits for the full 30s timeout; 20 are fine |
| indexer.coracle.social | 0 kind 3 events for any author, after a 60ms EOSE |
| relay.damus.io | intermittent HTTP non-101 (rate limit) on connect |
| relay.primal.net, nos.lol | 21–35% coverage, so not useful as indexers |

**Fix:** keep the main request as one multi-author filter, which every relay accepts, and use single-author filters only in the retry path, with at most 20 per REQ. Consider dropping indexer.coracle.social from the default lookup relays for this loader, or document that it is profile/mailbox-only.

### 4. `hints: true` lowers coverage

hzrd149 at distance 1: 63.9% with hints, against 98.8% without. Merging the hints of 123 pointers produced 27 relays, and each got the whole author filter. Each extra relay is another chance of a fast empty EOSE starting the 5s timer, and hints are often dead relays.

**Fix:** after finding 1 this only costs time, not data. Even then, send each author only to its own hinted relay, not the whole batch to every hint, and cap the number of hint relays.

## Weaker spots

5. **Each batch waits for the previous one.** The `while` loop awaits each batch (`social-graph.ts:88`), so one slow relay stalls the whole crawl, and expansion only starts once the batch completes. The prototype keeps 6 chunks of 100 in flight and expands each one as it finishes. That gave 1.7x at distance 2 even with identical relays.
6. **The root is fetched twice.** `seen` never contains the root (`social-graph.ts:75`), so a follow-back or self-follow re-queues it. This showed up in every live run: "authors requested twice=1". **Fix:** `new Set([user.pubkey])`.
7. **Memory.** The current loader used +1.8 GB of heap at distance 2, because the event store keeps every full kind 3 event, about 70 KB each. `fromGenerator` also buffers every yielded event into a `results` array that this loader never reads (`operators/generator.ts:39`). The prototype kept only pubkey → follows and used +0.8 GB, most of which is relay/socket overhead. For graph apps, document that `eventStore` is optional and costly at distance ≥ 2, and stop buffering results in `fromGenerator` when nothing consumes them.
8. **Nothing remembers missing lists.** About 10% of authors at distance 2 have no kind 3 anywhere, and every re-sync asks for them again. A `since` re-sync still sends all 61 batches for fiatjaf distance 2, taking 15s for 32 events, compared with 200s cold.
9. **Cached lists are never refreshed without `since`.** When `cacheRequest` hits, the pointer is dropped from the relay request (`social-graph.ts:113`), so a stale cached list stays stale. The usual fix is to request cached authors from relays with `since` = the cached `created_at`.
10. **No progress or completeness signal.** Callers cannot tell a truncated batch from an author with no list. A `status$` like the sync loader's (requested, found, per-relay errors) would have made finding 1 visible.

## Recommended order

1. Activity-aware group completion (`completeAfterIdle`) plus loader request options (finding 1 and the investigation). This alone takes distance-1 coverage on large roots from about 50% to 98%, and fixes the other loaders too.
2. Re-request missing authors when a relay hits its cap, using single-author filters, at most 20 per REQ (findings 2 and 3).
3. Pipeline chunks of about 100 authors with about 6 in flight (finding 5), and fix the root `seen` bug (finding 6).
4. Per-author hint routing with a capped relay count (finding 4).
5. Memory, negative caching, refreshing cached lists with `since`, and progress status (findings 7–10).
