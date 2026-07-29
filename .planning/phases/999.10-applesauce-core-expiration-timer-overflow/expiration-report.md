# Applesauce Expiration Timer Overflow Report

> Captured to backlog 2026-07-29 via `/gsd-capture --backlog` as Phase 999.10.
> The report below is the reporter's original text, reproduced verbatim.
> A verification note appended at the end records what was independently
> checked against the live source at capture time.

## Summary

`applesauce-core` schedules native `setTimeout()` calls for NIP-40 expiration tags using the full delay until the event expires. If an event has an expiration more than ~24.8 days in the future, the delay exceeds Node's 32-bit timer limit and Node clamps the timeout to `1ms`, emitting repeated warnings.

This is not caused by `reconnect: Infinity` in `applesauce-relay`. The gateway should keep `reconnect: Infinity`; Applesauce docs explicitly support that setting for persistent subscriptions.

## Observed Warning

```text
(node:68085) TimeoutOverflowWarning: 30483937010 does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
```

The value is milliseconds. `30,483,937,010ms` is about 352 days, which matches a future event expiration delay, not a relay reconnect delay.

## Minimal Reproduction

Run from a project with `applesauce-core@6.2.0` installed:

```sh
deno eval 'import { EventStore } from "applesauce-core"; const store = new EventStore(); store.verifyEvent = undefined; const now = Math.floor(Date.now()/1000); store.add({ id: "0".repeat(64), pubkey: "1".repeat(64), created_at: now, kind: 1, tags: [["expiration", String(now + 365 * 24 * 60 * 60)]], content: "", sig: "2".repeat(128) }); console.log("added"); store.dispose?.();'
```

Observed output:

```text
[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.
added
(node:80488) TimeoutOverflowWarning: 31536000010 does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
```

## Root Cause

Published package path:

`applesauce-core@6.2.0/dist/event-store/expiration-manager.js`

Source repo path:

`packages/core/src/event-store/expiration-manager.ts`

Current code schedules a native timeout using the full expiration delta:

```ts
const timeout = expiration - now;
if (timeout > 0) {
  this.timer = setTimeout(this.emitNotifications.bind(this), timeout * 1000 + 10);
  this.nextCheck = expiration;
}
```

This appears in both `track()` and `emitNotifications()`.

Node's maximum safe timer delay is `2_147_483_647ms`. Anything larger triggers `TimeoutOverflowWarning` and is clamped to `1ms`.

## Recommended Fix

Cap each scheduled timer to Node's max delay. When the capped timer fires before the target expiration, `emitNotifications()` already recalculates the next expiration and schedules again, so long future expirations become safe timer chunks without changing semantics.

Patch shape validated in a local Applesauce clone:

```ts
const MAX_TIMER_DELAY = 2_147_483_647;

private scheduleNextCheck(expiration: number, now = unixNow()): void {
  const timeout = expiration - now;
  if (timeout <= 0) return;

  const delay = Math.min(timeout * 1000 + 10, MAX_TIMER_DELAY);
  this.timer = setTimeout(this.emitNotifications.bind(this), delay);
  this.nextCheck = expiration;
}
```

Then replace both direct `setTimeout(..., timeout * 1000 + 10)` blocks with:

```ts
this.scheduleNextCheck(expiration, now);
```

and

```ts
this.scheduleNextCheck(nextExpiration, now);
```

## Regression Test

Add to:

`packages/core/src/event-store/__tests__/expiration-manager.test.ts`

```ts
it("should cap timers for distant future expirations", () => {
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const event = user.note("test", { tags: [["expiration", String(unixNow() + 365 * 24 * 60 * 60)]] });

  expirationManager.track(event);

  expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
});
```

## Validation Performed

In `/tmp/opencode/applesauce`, I applied the patch above and ran:

```sh
pnpm --filter applesauce-core test -- event-store/__tests__/expiration-manager.test.ts
```

Result:

```text
Test Files  50 passed (50)
Tests       586 passed (586)
```

The command unexpectedly ran the full core test suite rather than only that one file, but all core tests passed.

## Notes for Relay Reconnect

`applesauce-relay` docs explicitly support:

```ts
reconnect: Infinity
```

for persistent subscriptions. The nsite gateway should keep this setting. The warning is reproducible without `applesauce-relay` and without any websocket/reconnect code by adding a single future-expiring event to `EventStore`.

---

## Verification note (added at capture, 2026-07-29)

Checked against the live working tree, not the published `6.2.0` bundle. The report's
structural claims hold:

- `packages/core/src/event-store/expiration-manager.ts` exists and contains **two**
  uncapped `setTimeout(this.emitNotifications.bind(this), timeout * 1000 + 10)` sites:
  **line 54** inside `track()` and **line 124** inside `emitNotifications()`. Neither
  clamps the delay.
- `packages/core/src/event-store/__tests__/expiration-manager.test.ts` exists, so the
  proposed regression test extends an existing suite rather than creating one.
- The "semantics-preserving" claim for the capped-chunk approach checks out.
  `emitNotifications()` (lines 98-128) recomputes `nextExpiration` as the minimum over
  all remaining entries on every invocation and expires nothing when nothing is due, so
  a capped early wake is a no-op that reschedules. Progress toward the true expiration
  is guaranteed because each chunk advances `now`.
- Setting `this.nextCheck` to the true target expiration (as the proposed patch does)
  rather than to the capped wake time is the right choice: the `track()` early-exit
  guard at **line 46** (`if (this.timer && this.nextCheck && this.nextCheck <= expiration) return;`)
  reads `nextCheck` as the semantic "next check target". Storing the capped wake time
  there instead would make that guard admit redundant reschedules.

### Secondary observation (pre-existing; not introduced by the proposed fix)

In `emitNotifications()`, the timer bookkeeping only runs inside the
`if (nextExpiration !== Infinity)` branch (line 116). When the last tracked expiration
is removed via `forget()` before its timer fires, that branch is skipped and
`this.timer` / `this.nextCheck` are left holding values from the already-fired timer.
A subsequent `track()` can then hit the line-46 guard against a stale `nextCheck` and
skip scheduling. Worth clearing in the same pass, since it lives in the same handful of
lines — but note it is a distinct defect from the overflow and deserves its own test.

### Open item for promotion

The reporter's `pnpm --filter applesauce-core test -- <path>` ran the entire core suite
(50 files / 586 tests) instead of the single named file. That means the reported green
run is real but broader than intended; the per-file filter syntax for this workspace
should be sorted out so a promoted plan can specify a fast, targeted verify command.
