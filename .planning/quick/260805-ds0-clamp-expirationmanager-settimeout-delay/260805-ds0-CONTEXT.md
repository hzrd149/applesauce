# Quick Task 260805-ds0: Clamp setTimeout delays — Context

**Gathered:** 2026-08-05
**Status:** Ready for planning

<domain>
## Task Boundary

Fix unclamped `setTimeout` delays that overflow Node's 32-bit signed integer timer
limit (`2_147_483_647` ms ≈ 24.8 days), plus the two related timer defects found
alongside them.

Two independent bug reports describe the same `applesauce-core` defect:

1. `.planning/phases/999.10-applesauce-core-expiration-timer-overflow/expiration-report.md`
   (on the `concord` branch) — captured 2026-07-29 as backlog Phase 999.10, with a
   patch shape already validated in a local clone.
2. `/tmp/claude-1000/-home-user-Projects-nsite-gateway/71e8a5a4-1c37-486d-a7fe-c08c842d04b0/scratchpad/applesauce-expiration-timer-overflow-report.md`
   — filed 2026-08-05 from a production incident (16 GB syslog, host disk exhausted,
   downstream https://github.com/hzrd149/nsite-gateway/issues/28).

</domain>

<decisions>
## Implementation Decisions

### Branch
- Work lands on `fix/clamp-settimeout-delays`, branched off `origin/master` (4f2c1bbe).
- **Not** `concord` — downstream `nsite-gateway` is blocked waiting on an
  `applesauce-core` patch release, and `concord` is 760 commits from master.

### Scope — all three defects
User elected to fix all three rather than core-only.

**D1 — `packages/core/src/event-store/expiration-manager.ts` (the reported bug).**
Two uncapped sites: line 54 in `track()`, line 124 in `emitNotifications()`, both
`setTimeout(this.emitNotifications.bind(this), timeout * 1000 + 10)`.

Fix via a **single shared private helper**, not two parallel `Math.min` calls — the
duplicated call sites are what let this defect exist at two places at once:

```ts
const MAX_TIMER_DELAY = 2_147_483_647;

private scheduleNextCheck(expiration: number, now = unixNow()): void {
  const timeout = expiration - now;
  if (timeout <= 0) return;
  this.timer = setTimeout(this.emitNotifications.bind(this), Math.min(timeout * 1000 + 10, MAX_TIMER_DELAY));
  this.nextCheck = expiration;
}
```

Both sites become `this.scheduleNextCheck(expiration, now)` /
`this.scheduleNextCheck(nextExpiration, now)`.

`nextCheck` must keep storing the **true target expiration**, not the capped wake
time — the `track()` early-exit guard at line 46 reads it as the semantic "next check
target". Add a brief comment saying so, to stop a future regression. A capped early
wake is a harmless no-op: `emitNotifications()` recomputes `nextExpiration` as the min
over remaining entries and expires nothing when nothing is due, and each chunk
advances `now`, so progress is guaranteed.

**D2 — same file, stale timer bookkeeping (pre-existing, distinct defect).**
The timer cleanup in `emitNotifications()` only runs inside the
`if (nextExpiration !== Infinity)` branch (line 116). When the last tracked expiration
is `forget()`-ten before its timer fires, that branch is skipped and `this.timer` /
`this.nextCheck` keep values from the already-fired timer. A later `track()` then hits
the line-46 guard against a stale `nextCheck` and skips scheduling entirely.
Clear both when there is no next expiration. Needs its own test.

**D3 — `packages/wallet-connect/src/wallet-connect.ts`, two sites.**
- **:523** `simpleTimeout(expiresAt ? expiresAt - now : Infinity)` — `simpleTimeout`
  forwards to rxjs `timeout({ first })`, which schedules with `setTimeout`;
  `setTimeout(fn, Infinity)` clamps to `1` ms, so an invoice with **no** expiry — where
  `Infinity` plainly means "never time out" — throws `TimeoutError` almost immediately.
  Fix by **not applying the operator at all** when there is no expiry, rather than
  passing `Infinity`.
- **:535** `setTimeout(..., expiresAt - now)` — unclamped, same class as D1. Cannot
  hot-loop (the callback rejects rather than re-arming) but fires immediately instead
  of at the intended time. Clamp it.

Units are already correct at both wallet-connect sites: `expiresAt` is
`transaction.expires_at * 1000` and `now` is `Date.now()`, so the deltas are
milliseconds. Do **not** "fix" the units.

### Do NOT change
Explicitly correct as written, per both reports:
- `expiration-manager.ts:100` `let nextExpiration = Infinity` — a sentinel, correctly
  guarded at line 116.
- `expiration-manager.ts:35` `if (!expiration || !Number.isFinite(expiration)) return;`
  — already rejects `NaN` and non-finite values.
- `applesauce-relay`'s documented `reconnect: Infinity` — unrelated, and the original
  downstream hypothesis that blamed it was wrong.

</decisions>

<specifics>
## Specific Ideas

### Tests
Extend the existing `packages/core/src/event-store/__tests__/expiration-manager.test.ts`
— it already uses `vi.useFakeTimers()` and the `FakeUser` fixture.

With fake timers Node's clamping and `TimeoutOverflowWarning` do not occur, so assert
on the **scheduled delay value** (via a `setTimeout` spy) and on **callback invocation
count** — that is what actually characterizes the bug.

1. Far-future expiration (`unixNow() + 365d`) schedules a delay `<= 2_147_483_647`.
2. Far-future expiration still fires at the correct time — advance through several
   clamped hops and assert the event lands on `expired$`. This is what proves the
   chunked re-arm works rather than the timer being silently dropped.
3. Boundary: expirations just under and just over the ~24.8-day cap behave identically
   from the caller's perspective.
4. D2: `forget()` the last tracked expiration before its timer fires, then `track()` a
   new event — assert it schedules rather than being swallowed by a stale `nextCheck`.
5. Existing short-expiration tests must pass unmodified.

### Changesets
One file per distinct change per `CLAUDE.md` — single sentence, no bullets or fences.
Both packages need a `patch`. D1 and D2 are distinct changes to `applesauce-core`;
D3's two sites are one change to `applesauce-wallet-connect`.

### Known workspace gotcha
The prior reporter's `pnpm --filter applesauce-core test -- <path>` ran the **entire**
core suite (50 files / 586 tests) instead of the named file. Sort out the correct
per-file filter syntax so the plan can specify a fast targeted verify command; fall
back to the full core suite if it cannot be resolved quickly.

</specifics>

<canonical_refs>
## Canonical References

- Backlog Phase 999.10 in `.planning/ROADMAP.md` **on the `concord` branch** — this
  task resolves it. It cannot be ticked off from this branch; flag it for follow-up
  when this lands and `concord` next merges master.
- NIP-40 (expiration tag) — the source of the untrusted far-future timestamps.
- `.changeset/verify-event-undefined-fix.md` — house changeset format.

</canonical_refs>
</content>
</invoke>
