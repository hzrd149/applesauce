---
"applesauce-wallet-connect": patch
---

Bound and cancel encryption negotiation in `WalletConnect.genericCall`.

The request deadline is now armed at subscription and covers encryption negotiation and request
creation up to the first response, instead of only the response stream. Previously `genericCall`
awaited `firstValueFrom(encryption$)` before the timeout was created, so a wallet that never
announces its capabilities (kind:13194) — for example behind a stale or half-open relay
subscription — could stay pending forever regardless of the configured `timeout`.

Negotiation is also moved into the RxJS chain so the deadline unsubscribes the pending negotiation
instead of leaking it and keeping the shared relay subscription open indefinitely. Two limits are
worth noting, both unchanged by this fix: the deadline only releases the negotiation subscription,
so a signing or publishing Promise that has already started is not cancelled (it is merely
ignored); and, like any first-emission timeout, it stops enforcing after the first response, so
multi-response methods are only bounded until their first reply.

`waitForService` now rejects immediately when passed an already-aborted `AbortSignal`, which was
previously ignored because `fromEvent` only observes future abort events.
