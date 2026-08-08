# Phase 14: Auth Lifecycle Debug Logging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-08
**Phase:** 14-auth-lifecycle-debug-logging
**Areas discussed:** Operation attribution key, The AUTH send/result leg, Namespace + line set, ALOG-03 sweep boundary

---

## Operation attribution key

The first framing of this area was rejected by the user before an answer was given. The original
question asked which token identifies an operation, offering the three-value `RelayAuthOperation`
bucket as a given. The user's correction reframed the area: *"upstream on the relay side it can
require auth for anything based on the shape of the request or event … so trying to bucket
authentication state into three types isn't going to work going forward and it's the thing I wanted
to move away from."* Everything below follows from that.

### How far Phase 14 goes on retiring the bucket

| Option | Description | Selected |
|--------|-------------|----------|
| Logging only; backlog the type change | Lines stop leaning on the bucket; `RelayAuthOperation`/`RelayAuthContext` stay as Phase 13 shipped them | |
| Logging + widen `RelayAuthContext` now | Context gains the triggering request so handlers branch on shape, bucket retained | |
| Logging + retire the bucket entirely | `operation` stops being a 3-value union; replaced by something request-derived | ✓ |

**User's choice:** Logging + retire the bucket entirely
**Notes:** Decided against the backdrop that all fourteen of Phase 13's `applesauce-relay` changesets
are unreleased (published version is 6.2.1), so `RelayAuthOperation` has zero downstream consumers
and changing it costs a changeset-body edit rather than a major bump. That window closes at the next
release, which is why an API change was entertained inside a logging phase at all.

### What replaces `operation`

| Option | Description | Selected |
|--------|-------------|----------|
| Wire-verb discriminated union | `{verb:"REQ";id;filters} \| {verb:"COUNT";…} \| {verb:"EVENT";event} \| {verb:"NEG-OPEN";…}`; discriminant is the protocol verb, new verb is a compile error | ✓ |
| The outgoing frame, verbatim | Carry the exact array passed to `socket.next()` — zero reconstruction, but a positional tuple and a binary negentropy payload | |
| Flat optional fields | Drop `operation`, add `filters?`/`event?`/`subscriptionId?` side by side — smallest diff, but nothing encodes valid combinations | |

**User's choice:** Wire-verb discriminated union
**Notes:** Matches Phase 13's total-predicate lesson (13-14/CR-02) and the project's standing
preference for making bad states unrepresentable rather than enumerating fixes.

### Token disambiguating concurrent operations

| Option | Description | Selected |
|--------|-------------|----------|
| The wire key, plus a phase counter | Reuse the id already on the union, truncated for display, with `phase n/N`; greppable against the relay's own log | ✓ |
| Mint a separate token in `authRetryOperator` | Uniform short nanoid, zero threading, no negentropy restructure — but two ids for one operation | |
| Both on every line | Most information, longest prefix, two ids to keep aligned | |

**User's choice:** The wire key, plus a phase counter
**Notes:** Carries a consequence — `negentropy()` must own its subscription id instead of
`negentropySync` minting it per negotiation (`negentropy.ts:71`), so the id identifies the operation
rather than an attempt.

### How much of the triggering request appears

| Option | Description | Selected |
|--------|-------------|----------|
| Summary: kinds listed, rest as counts | Bounded line length; answers "why did this one need auth and the other didn't" | ✓ |
| Full filters as JSON | Nothing lost, but a 500-author filter yields an unreadable multi-kilobyte line | |
| Wire key only | Shortest lines, but abandons the kind-1059 case that motivated retiring the bucket | |

**User's choice:** Summary: kinds listed, rest as counts

### Unprompted user decision

The user then stated, without a question being posed: *"we are doing away with the concept of 'auth
required for read' or 'auth required for write'. Those reactive subjects must stay for backwards
compatibility and not breaking the API, however the goal is to NOT use them internally."*

Reflected back and unchallenged: the two `take(1)` log subscriptions at `relay.ts:546`/`:554` are the
package's last internal readers and are removed; every write and the `status$` composition stay; the
read/publish bucket survives only as a compatibility adapter at the flag write. Concord's four
readers are CAUTH-03's.

---

## The AUTH send/result leg

### Joining a connection-scoped AUTH to its waiting operations

| Option | Description | Selected |
|--------|-------------|----------|
| Pubkey is the join key | Both tracks print the pubkey; one grep joins them; an out-of-band AUTH with no handler still reads correctly | ✓ |
| AUTH leg names the waiters | One line tells the whole story, but requires relay-scoped bookkeeping of in-flight phases | |
| No join — chronological only | Simplest; ambiguous with two signers or two concurrent phases | |

**User's choice:** Pubkey is the join key
**Notes:** The relationship is many-to-many by protocol. Naming the waiters would reintroduce exactly
the shared relay-scoped state RAUTH-05 forbids and Phase 13 spent fourteen plans removing.

### Granularity of the connection track

| Option | Description | Selected |
|--------|-------------|----------|
| Challenge → signing → sent → result | Four lines; the signing line separates "signer never answered" from "relay never replied" (D-12's scenario) | ✓ |
| Sent → result | Two lines; a hung signer reads as silence | |
| Result only | One line; a signed-but-never-sent AUTH produces nothing | |

**User's choice:** Challenge → signing → sent → result

### Local timeout vs relay rejection

| Option | Description | Selected |
|--------|-------------|----------|
| Mark it at the source via `error` | `event()`'s timeout branch sets the unused `PublishResponse.error`; log and state both discriminate structurally | ✓ |
| Log-only — `event()` logs its own timeout | Strictly additive, but `authenticationResponse$` keeps reporting a local give-up as a relay verdict | |
| Leave it — backlog the discriminator | Keeps the phase to observability; defers a known ambiguity past the free window | |

**User's choice:** Mark it at the source via `error`
**Notes:** Surfaced mid-area rather than planned. `event():1153` manufactures `{ok:false,
message:"Timeout"}` with the same shape `:1120` builds a relay rejection with, and `auth()` writes
either into `authentications$` and `authenticationResponse$` — so the state is ambiguous, not just
the log. This is the defect class PROJECT.md records as recurring three times across Phase 13.

### Auth invalidation on reconnect

| Option | Description | Selected |
|--------|-------------|----------|
| Log invalidation when non-empty | Reuses `resetState()`'s existing guards; explains D-08's re-auth-per-reconnect cycle | ✓ |
| Log invalidation unconditionally | Uniform, but noisy on relays that never require auth | |
| Rely on the existing `Disconnected` line | Nothing added, but requires the reader to already know D-08's rule | |

**User's choice:** Log invalidation when non-empty

---

## Namespace + line set

### Where auth lines print

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `:auth` sub-namespace | Additive — parent glob still shows everything, `applesauce:Relay:*:auth` narrows | ✓ |
| Same namespace as everything else | One chronological stream, but ~5 new lines per phase buried in connection output | |
| Top-level `applesauce:auth` | Whole-pool view, but loses per-relay narrowing and breaks the per-class convention | |

**User's choice:** Dedicated `:auth` sub-namespace

### Line set for an operation's auth phase

| Option | Description | Selected |
|--------|-------------|----------|
| Every state, incl. the counter reset | ~6–9 lines; counter reset earns a line because CR-01/WR-01 was that bug | |
| Every blocking state, not bookkeeping | ~5 lines; a blocked attempt always has a line naming what it's blocked on | ✓ |
| Phase open + terminal outcome | Two lines; an in-flight hang shows as silence | |

**User's choice:** Every blocking state, not bookkeeping
**Notes:** D-08's counter reset stays observable anyway — the per-line phase counter restarts at 1.

### Line shape

| Option | Description | Selected |
|--------|-------------|----------|
| Structured key=value | Greppable by field, machine-parseable, consistent vocabulary | |
| Human prose with key facts inline | Matches the package's existing voice | ✓ |
| Prose + debug formatters | Defers string building, but format-string/argument drift is easy and invisible | |

**User's choice:** Human prose with the key facts inline

### Oracle for ALOG-01/02

| Option | Description | Selected |
|--------|-------------|----------|
| Capture real debug output | Assert a NIP-42-derived line sequence from actually-emitted output; mirrors D-20 | ✓ |
| Spy on injected log functions | Fast and isolated, but proves call sites fire rather than that output is readable | |
| Both — unit spies plus one end-to-end capture | Cheap branch coverage plus one real test; two mechanisms to maintain | |

**User's choice:** Capture real debug output
**Notes:** `debug`'s enable state is global, so tests need setup/teardown discipline.

---

## ALOG-03 sweep boundary

Presented with a correction: ALOG-03's stated criterion — *"a grep for inline `.extend(` at a log
call site returns zero hits"* — already passes, since no extend-then-immediately-invoke pattern
exists anywhere in the monorepo, and SEED-001's own rule explicitly blesses the one site it flagged
by line number.

### What the sweep actually is

| Option | Description | Selected |
|--------|-------------|----------|
| Tighten to "not on a repeating path", sweep that | Restate the criterion; fix `sync-loader.ts:611`; keep the `nanoid` correlation loggers | ✓ |
| Audit, record, close as already satisfied | Honest to the code, but a requirement closes having changed nothing | |
| Sweep every site not at construction scope | Zero ambiguity, but removes per-call correlation namespaces this phase is otherwise adding | |

**User's choice:** Tighten to "not on a repeating path", sweep that
**Notes:** Requires amending both `REQUIREMENTS.md` ALOG-03 and `ROADMAP.md` Phase 14 success
criterion 3.

### Enforcement afterwards

| Option | Description | Selected |
|--------|-------------|----------|
| Written invariant at the derivation sites | The `relay.ts:787` mechanism; but Phase 5.1 found 14 such comments had gone false | |
| A repo test that greps for the pattern | Mechanically enforced, but it is the scoped-out lint rule wearing different clothes | |
| Nothing — one-time sweep, retire the seed | Smallest footprint; rule recorded in REQUIREMENTS.md either way | ✓ |

**User's choice:** Nothing — one-time sweep, retire the seed

---

## Claude's Discretion

- Placement of the AUTH-leg lines: signing in `authenticate()`, sent/result in `auth()` — stated
  during discussion and unchallenged.
- Exact naming and field shape of the wire-verb union; whether it replaces `operation` in place.
- Rendering of the request summary beyond "kinds spelled out, rest counted".
- Exact prose of each line; id truncation width.
- Where the `:auth` logger lives on `Relay`; how `RelayGroup`/`RelayPool` route theirs.
- How `negentropy()` takes ownership of its subscription id.
- Test file placement and the shape of the debug-output capture harness.

## Deferred Ideas

- Concord's four remaining reads of `authRequiredForRead$`/`authRequiredForPublish$` — Phase 15
  (CAUTH-03).
- A lint rule enforcing the logger convention, and its grep-test and written-invariant substitutes —
  all declined; available as a follow-up.
- A broader audit of locally-manufactured `PublishResponse`/message values that are indistinguishable
  from relay-supplied ones — D-11 closes one instance, not the class. Worth a backlog entry.
- Value-signalling the remaining `CLOSED` prefixes (blocked, rate-limited, invalid) — carried forward
  unchanged from Phase 13's deferred list.

### Reviewed Todos (not folded)
- `05.1-review-followups.md` — matched at 0.6 on generic keywords ("phase", "pre"); content is
  gift-wrap/seal helpers in `applesauce-common`, unrelated to auth logging. Same disposition as
  Phase 13.
