import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers";
import { firstValueFrom, of } from "rxjs";
import { filter, take } from "rxjs/operators";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { AUTH_LOG_TEXT_LIMIT, shortId } from "../helpers/auth-log.js";
import { Relay } from "../relay.js";
import { RelayInformation } from "../types.js";
import { withDebugCapture } from "./debug-capture.js";
import { FakeUser } from "./fake-user.js";

// D-16 oracle: this file drives a real Relay against the mock WebSocket server with real timers
// (Phase 13's D-20 convention) and captures the real `debug`-package output the `:auth` namespace
// emits — never a change detector against the source's own strings. Every expectation below is
// derived from the NIP-42 exchange the test itself scripts, or from a decision recorded in
// 14-CONTEXT.md, per this plan's prohibitions.
//
// The setup mirrors relay.test.ts's own conventions verbatim (WS mock server + real Relay +
// fetchInformationDocument stub + afterEach cleanup) rather than inventing a second one, and reuses
// the 14-03 debug-capture harness (withDebugCapture/messagesOf) rather than writing a second capture
// mechanism.

let server: WS;
let relay: Relay;

beforeEach(async () => {
  // Mock empty information document
  vi.spyOn(Relay, "fetchInformationDocument").mockImplementation(() => of(null));

  // Create mock relay
  server = new WS("wss://test", { jsonProtocol: true });

  // Create relay
  relay = new Relay("wss://test");
  relay.keepAlive = 0;
});

// Wait for server to close to prevent memory leaks
afterEach(async () => {
  await WS.clean();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const mockEvent: NostrEvent = {
  kind: 1,
  id: "00007641c9c3e65a71843933a44a18060c7c267a4f9169efa3735ece45c8f621",
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  created_at: 1743712795,
  tags: [["nonce", "13835058055282167643", "16"]],
  content: "This is just stupid: https://codestr.fiatjaf.com/",
  sig: "5a57b5a12bba4b7cf0121077b1421cf4df402c5c221376c076204fc4f7519e28ce6508f26ddc132c406ccfe6e62cc6db857b96c788565cdca9674fe9a0710ac2",
};

/** Reads `relay.authLog`'s own derived namespace rather than hardcoding a namespace literal that would drift. */
function authNamespaceOf(target: Relay): string {
  return (target as any).authLog.namespace as string;
}

describe("auth lifecycle logging (14-06)", () => {
  it("ALOG-00: the auth namespace puts `auth` at a fixed depth with the url last, so `applesauce:Relay:auth:*` filters every relay", () => {
    // The one place pinning the shape -- every other test reads the namespace dynamically.
    const relay = new Relay("wss://namespace-shape.example");

    expect(authNamespaceOf(relay)).toBe("applesauce:Relay:auth:wss://namespace-shape.example");
    expect((relay as any).log.namespace).toBe("applesauce:Relay:wss://namespace-shape.example");
  });

  it("ALOG-01: a scripted successful NIP-42 exchange produces a readable challenge -> signing -> sent -> result trace", async () => {
    const user = new FakeUser();
    const bystanderA = new FakeUser();
    const bystanderB = new FakeUser();
    const reqFilter = { kinds: [7373], authors: [user.pubkey, bystanderA.pubkey, bystanderB.pubkey] };
    const reqId = "lifecycle-success";
    const closedReason = "auth-required: lifecycle-oracle-needs-auth-9f3c";
    const okMessage = "welcome, lifecycle-oracle-ok-9f3c";
    const challenge = "challenge-lifecycle-success";

    // A real client's onAuthRequired: wait for the AUTH challenge if it has not arrived yet (this
    // test scripts the CLOSED refusal before the AUTH challenge, so a naive handler that assumes the
    // challenge is already present would throw), then sign and authenticate via the real path.
    const onAuthRequired = vi.fn(async () => {
      if (!relay.challenge) {
        await firstValueFrom(relay.challenge$.pipe(filter((c): c is string => c !== null), take(1)));
      }
      await relay.authenticate(user);
    });

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([reqFilter], { id: reqId, onAuthRequired, authTimeout: 500 }), {
        expectErrors: true,
      });

      // 1. the client sends a REQ
      await expect(server).toReceiveMessage(["REQ", reqId, reqFilter]);

      // 2. the relay replies CLOSED with an auth-required reason carrying a distinctive machine-readable message
      server.send(["CLOSED", reqId, closedReason]);

      // 3. the relay sends an AUTH challenge
      server.send(["AUTH", challenge]);

      // 4. the caller's handler signs and calls the relay's authenticate path
      const authMsg = (await server.nextMessage) as [string, NostrEvent];
      expect(authMsg[0]).toBe("AUTH");

      // 5. the relay replies OK with true and a distinctive human message
      server.send(["OK", authMsg[1].id, true, okMessage]);

      // 6. the client resends the REQ and the relay serves it
      await expect(server).toReceiveMessage(["REQ", reqId, reqFilter]);
      server.send(["EVENT", reqId, mockEvent]);
      server.send(["EOSE", reqId]);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const captured = lines();

      // ALOG-01: the trace answers, in order, that the challenge was received, that an AUTH event
      // was signed and sent for the signer's pubkey, and that the relay's own verdict and its
      // message are present. Ordering is asserted by comparing matched-line indices, not by a fixed
      // array equality — extra operation-track lines are expected and must not make this brittle.
      const challengeIdx = captured.findIndex((l) => l.includes(challenge));
      const signedIdx = captured.findIndex((l) => l.includes("Signing AUTH event"));
      const sentIdx = captured.findIndex(
        (l) => l.includes("Sending AUTH event for pubkey") && l.includes(user.pubkey),
      );
      const resultIdx = captured.findIndex(
        (l) => l.includes("accepted AUTH for") && l.includes(user.pubkey) && l.includes(okMessage),
      );

      expect(challengeIdx).toBeGreaterThanOrEqual(0);
      expect(signedIdx).toBeGreaterThan(challengeIdx);
      expect(sentIdx).toBeGreaterThan(signedIdx);
      expect(resultIdx).toBeGreaterThan(sentIdx);

      // D-08: the pubkey named on the AUTH-sent/result lines is the signer's own pubkey (computed
      // from the test's signer, never transcribed), and the same pubkey appears on the operation
      // track's wait-satisfied line — the join key between the connection track and this operation.
      expect(captured.some((l) => l.includes("wait satisfied") && l.includes(user.pubkey))).toBe(true);

      // D-06 end-to-end: the refused REQ's filter (a distinctive kind plus 3 authors) has its kind
      // spelled out and its authors reported as a count, computed from the test's own filter object.
      const reqShortId = shortId(reqId);
      const refusalLine = captured.find(
        (l) => l.includes(`REQ ${reqShortId}`) && l.includes("authentication required"),
      );
      expect(refusalLine).toBeDefined();
      expect(refusalLine).toContain(`kinds=[${reqFilter.kinds[0]}]`);
      expect(refusalLine).toContain(`authors=${reqFilter.authors.length}`);

      // T-14-02: the pubkey is present on the connection track, but the AUTH event's own signature
      // never appears in the trace.
      expect(captured.some((l) => l.includes(authMsg[1].sig))).toBe(false);

      spy.unsubscribe();
    });
  });

  // D-09's load-bearing pair: the signing line is what separates "the signer never answered" from
  // "the relay never replied" -- without it both scenarios would be identical silence.

  it("D-09: a hung signer produces a signing line but no AUTH-sent line", async () => {
    const hungSigner = { signEvent: () => new Promise<NostrEvent>(() => {}) };
    const reqId = "hung-signer";

    const onAuthRequired = vi.fn(async () => {
      if (!relay.challenge) {
        await firstValueFrom(relay.challenge$.pipe(filter((c): c is string => c !== null), take(1)));
      }
      await relay.authenticate(hungSigner);
    });

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, onAuthRequired, authTimeout: 50 }), {
        expectErrors: true,
      });

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["AUTH", "challenge-hung-signer"]);
      server.send(["CLOSED", reqId, "auth-required: need to authenticate"]);

      // Past the 50ms phase timeout; the signer never resolves so no AUTH frame is ever written.
      await new Promise((resolve) => setTimeout(resolve, 120));

      const captured = lines();
      expect(captured.some((l) => l.includes("Signing AUTH event"))).toBe(true);
      expect(captured.some((l) => l.includes("Sending AUTH event for pubkey"))).toBe(false);

      spy.unsubscribe();
    });
  });

  it("D-09: a sent AUTH with no relay reply produces a sent line but no result line", async () => {
    const user = new FakeUser();
    const reqId = "unresponsive-relay";
    // Bounds auth()'s own OK-wait so no long-lived real timer from this test's relay instance
    // outlives the test (Phase 13's D-20 real-timer convention, kept short deliberately here).
    relay.eventTimeout = 300;

    const onAuthRequired = vi.fn(async () => {
      if (!relay.challenge) {
        await firstValueFrom(relay.challenge$.pipe(filter((c): c is string => c !== null), take(1)));
      }
      await relay.authenticate(user).catch(() => {});
    });

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, onAuthRequired, authTimeout: 50 }), {
        expectErrors: true,
      });

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["AUTH", "challenge-unresponsive-relay"]);
      server.send(["CLOSED", reqId, "auth-required: need to authenticate"]);

      // The AUTH frame is sent, but the relay stays silent -- never send an OK.
      await server.nextMessage;

      // Past the 50ms phase timeout, well before the 300ms eventTimeout would manufacture its own
      // "Timeout" result -- this window is what proves no result line exists yet.
      await new Promise((resolve) => setTimeout(resolve, 120));

      const captured = lines();
      expect(captured.some((l) => l.includes("Signing AUTH event"))).toBe(true);
      expect(captured.some((l) => l.includes("Sending AUTH event for pubkey") && l.includes(user.pubkey))).toBe(true);
      expect(captured.some((l) => l.includes("accepted AUTH for") || l.includes("rejected AUTH for"))).toBe(false);

      spy.unsubscribe();
      // Let the bounded eventTimeout settle so no real timer outlives this test.
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
  });

  it("T-14-01/D-09: an oversized CLOSED reason and OK rejection message are bounded, and the rejection's reason plus a terminal outcome line are legible", async () => {
    const user = new FakeUser();
    const reqId = "reject-oversized";
    const oversizedClosedReason = `auth-required: ${"x".repeat(AUTH_LOG_TEXT_LIMIT * 2)}`;
    const oversizedOkMessage = "y".repeat(AUTH_LOG_TEXT_LIMIT * 2);

    const onAuthRequired = vi.fn(async () => {
      if (!relay.challenge) {
        await firstValueFrom(relay.challenge$.pipe(filter((c): c is string => c !== null), take(1)));
      }
      await relay.authenticate(user).catch(() => {});
    });

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, onAuthRequired, authTimeout: 100 }), {
        expectErrors: true,
      });

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["AUTH", "challenge-reject-oversized"]);
      server.send(["CLOSED", reqId, oversizedClosedReason]);

      const authMsg = (await server.nextMessage) as [string, NostrEvent];
      server.send(["OK", authMsg[1].id, false, oversizedOkMessage]);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const captured = lines();
      const refusalLine = captured.find((l) => l.includes("Relay refused") && l.includes("authentication required"));
      const rejectionLine = captured.find((l) => l.includes("rejected AUTH for") && l.includes(user.pubkey));

      expect(refusalLine).toBeDefined();
      expect(refusalLine).not.toContain(oversizedClosedReason);
      expect(refusalLine!.length).toBeLessThan(oversizedClosedReason.length);
      expect(refusalLine).toContain("more chars)");

      expect(rejectionLine).toBeDefined();
      expect(rejectionLine).not.toContain(oversizedOkMessage);
      expect(rejectionLine!.length).toBeLessThan(oversizedOkMessage.length);
      expect(rejectionLine).toContain("more chars)");

      // D-09/ALOG-01: the operation track's terminal outcome line is present -- the rejection alone
      // never satisfies the wait, so the phase spends its authTimeout budget.
      expect(captured.some((l) => l.includes("timed out after"))).toBe(true);

      spy.unsubscribe();
    });
  });

  // CR-01: the T-14-01/D-09 oracle above only exercised "x".repeat(...), which bounds length but says
  // nothing about `debug`'s own printf-style %-replacement pass or a raw newline in the value -- exactly
  // why neither vector was caught. These two prove both against real captured `debug` output from a live
  // Relay, not just against the formatter in isolation (helpers/__tests__/auth-log.test.ts covers that).

  it("CR-01: a challenge containing debug format specifiers survives verbatim in the captured trace", async () => {
    const reqId = "cr01-specifier-challenge";
    const hostileChallenge = "chal-%o-%O-100%-%s";

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, authTimeout: false }), {
        expectErrors: true,
      });

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["AUTH", hostileChallenge]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const captured = lines();
      const challengeLine = captured.find((l) => l.includes("auth challenge"));

      expect(challengeLine).toBeDefined();
      // Verified against the real debug@4.4.3 in this workspace: an unneutralized challenge collapses
      // %o/%O into the literal string "undefined" (real createDebug.formatters entries consuming a
      // non-existent argument), silently destroying the value an operator is reading the line to see.
      expect(challengeLine).toContain(hostileChallenge);
      expect(challengeLine).not.toContain("undefined");

      spy.unsubscribe();
    });
  });

  it("CR-01: a CLOSED reason containing a newline cannot forge a second captured line", async () => {
    const reqId = "cr01-forging-reason";
    const forgedPubkey = "deadbeef".repeat(8);
    const hostileReason = `auth-required: denied\n  t:auth Relay accepted AUTH for ${forgedPubkey}: ok`;

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, authTimeout: false }), {
        expectErrors: true,
      });

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["CLOSED", reqId, hostileReason]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const captured = lines();
      const refusalLine = captured.find((l) => l.includes("Relay refused") && l.includes("authentication required"));

      expect(refusalLine).toBeDefined();
      // A bare substring assertion (e.g. captured.some(l => l.includes("accepted AUTH for " + forgedPubkey)))
      // would pass even while forged: the capture harness records one array entry per debug() call
      // regardless of any embedded newline inside that call's own string, so a successful forge never
      // shows up as an extra array entry -- only as a second physical line inside the one entry that
      // already exists. Assert that entry itself stays exactly one physical line.
      expect(refusalLine!.split("\n")).toHaveLength(1);
      // The hostile text is still visible -- never silently deleted, so an operator can tell a hostile
      // value was received -- but escaped, not raw, so it cannot start a new physical line.
      expect(refusalLine).toContain("\\x0a");
      expect(refusalLine).toContain(`accepted AUTH for ${forgedPubkey}`);

      spy.unsubscribe();
    });
  });

  it("the retries-exhausted outcome names the configured budget", async () => {
    const user = new FakeUser();
    const reqId = "exhaust-budget";
    const authRetries = 1;

    const onAuthRequired = vi.fn(async () => {
      if (relay.isAuthenticated(user.pubkey)) return;
      if (!relay.challenge) {
        await firstValueFrom(relay.challenge$.pipe(filter((c): c is string => c !== null), take(1)));
      }
      await relay.authenticate(user);
    });

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, onAuthRequired, authRetries }), {
        expectErrors: true,
      });

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["AUTH", "challenge-exhaust-1"]);
      server.send(["CLOSED", reqId, "auth-required: need to authenticate"]);

      const authMsg = (await server.nextMessage) as [string, NostrEvent];
      server.send(["OK", authMsg[1].id, true, ""]);

      // The resent REQ is refused again -- a second consecutive refusal with no progress since the
      // first phase started, spending the configured budget of 1.
      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      server.send(["CLOSED", reqId, "auth-required: need to authenticate"]);

      await new Promise((resolve) => setTimeout(resolve, 30));

      const captured = lines();
      expect(captured.some((l) => l.includes(`phase 1/${authRetries}`))).toBe(true);
      expect(captured.some((l) => l.includes(`auth retry budget of ${authRetries} phase(s) is exhausted`))).toBe(
        true,
      );

      spy.unsubscribe();
    });
  });

  // D-12: the reconnect-invalidation pair -- makes the expected re-auth-per-reconnect cycle legible
  // rather than appearing as an unexplained disconnect.

  it("D-12: dropping a connection after a real successful authentication reports one dropped pubkey", async () => {
    const user = new FakeUser();
    const reqId = "reconnect-authenticated";

    const onAuthRequired = vi.fn(async () => {
      if (!relay.challenge) {
        await firstValueFrom(relay.challenge$.pipe(filter((c): c is string => c !== null), take(1)));
      }
      await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId, onAuthRequired }), { expectErrors: true });

    await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
    server.send(["AUTH", "challenge-reconnect-authenticated"]);
    server.send(["CLOSED", reqId, "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", authMsg[1].id, true, ""]);
    await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      server.close({ wasClean: false, code: 1006, reason: "relay crashed" });
      await server.closed;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const invalidationLines = lines().filter((l) => l.toLowerCase().includes("invalidat"));
      expect(invalidationLines).toHaveLength(1);
      expect(invalidationLines[0]).toContain("1");
    });

    spy.unsubscribe();
  });

  it("D-12: dropping a connection that never authenticated reports no invalidation line", async () => {
    const reqId = "reconnect-never-authenticated";
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: reqId }), { expectErrors: true });
    await server.connected;

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      server.close({ wasClean: false, code: 1006, reason: "relay crashed" });
      await server.closed;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lines().some((l) => l.toLowerCase().includes("invalidat"))).toBe(false);
    });

    spy.unsubscribe();
  });

  it("ALOG-02: two concurrent operations' lines stay individually attributable, and resolving one leaves the other genuinely blocked", async () => {
    const userA = new FakeUser();
    const userB = new FakeUser();
    const reqId = "reqop-alog02";
    const pubEvent: NostrEvent = { ...mockEvent, id: "evtop-alog02-event-id-9d21" };
    // Wire keys computed from the test's own id values through the same prefix length the
    // formatter uses (AUTH_LOG_ID_LENGTH via shortId) — never a transcribed rendered literal.
    const reqKey = `REQ ${shortId(reqId)}`;
    const eventKey = `EVENT ${shortId(pubEvent.id)}`;
    // The connection-drop-mid-auth-wait-at-low-keepAlive gap (14-RESEARCH.md Open Question 3) is a
    // pre-existing, out-of-scope condition this test must not accidentally exercise: two concurrent
    // operations briefly transitioning between attempts can momentarily drop refCount to zero under
    // the file's default keepAlive:0, tearing down the one shared connection this test's two-key
    // attribution depends on.
    relay.keepAlive = 10_000;

    await withDebugCapture(authNamespaceOf(relay), async (lines) => {
      const reqSpy = subscribeSpyTo(
        relay.req([{ kinds: [1] }], { id: reqId, waitForAuth: userA.pubkey, authTimeout: false }),
        { expectErrors: true },
      );
      const eventPromise = relay
        .publish(pubEvent, { waitForAuth: userB.pubkey, authTimeout: false })
        .catch((err) => err);

      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      await expect(server).toReceiveMessage(["EVENT", pubEvent]);

      server.send(["AUTH", "challenge-alog02"]);
      server.send(["CLOSED", reqId, "auth-required: need to authenticate"]);
      server.send(["OK", pubEvent.id, false, "auth-required: need to authenticate"]);

      await new Promise((resolve) => setTimeout(resolve, 20));

      let captured = lines();
      const reqLines1 = captured.filter((l) => l.includes(reqKey));
      const eventLines1 = captured.filter((l) => l.includes(eventKey));

      // Every operation-track line carries one of the two wire keys, and no captured line is
      // ambiguous between the two operations.
      expect(reqLines1.length).toBeGreaterThan(0);
      expect(eventLines1.length).toBeGreaterThan(0);
      for (const line of [...reqLines1, ...eventLines1]) {
        expect(line.includes(reqKey) && line.includes(eventKey)).toBe(false);
      }

      // Authenticate ONLY userA, out of band -- the two operations wait on different pubkeys, so
      // resolving one must leave the other's own group showing it still blocked.
      const authAPromise = relay.authenticate(userA);
      const authMsgA = (await server.nextMessage) as [string, NostrEvent];
      server.send(["OK", authMsgA[1].id, true, ""]);
      await authAPromise;

      // The REQ's wait is now satisfied and it resends its own frame.
      await expect(server).toReceiveMessage(["REQ", reqId, { kinds: [1] }]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      captured = lines();
      const reqLines2 = captured.filter((l) => l.includes(reqKey));
      const eventLines2 = captured.filter((l) => l.includes(eventKey));

      // Each operation's own retry/wait/outcome lines filter into two disjoint groups: the REQ
      // group shows its wait satisfied by userA and grew from the resend; the EVENT group is
      // unchanged in size and still names userB as what it is waiting for -- genuinely independent,
      // not merely differently labelled.
      expect(reqLines2.some((l) => l.includes("wait satisfied") && l.includes(userA.pubkey))).toBe(true);
      expect(eventLines2.some((l) => l.includes("wait satisfied"))).toBe(false);
      expect(eventLines2.some((l) => l.includes(userB.pubkey))).toBe(true);
      expect(eventLines2.length).toBe(eventLines1.length);
      expect(reqLines2.length).toBeGreaterThan(reqLines1.length);

      // Let the EVENT operation resolve too (authenticate userB), so no subscription outlives this
      // test with a still-pending auth wait.
      const authBPromise = relay.authenticate(userB);
      const authMsgB = (await server.nextMessage) as [string, NostrEvent];
      server.send(["OK", authMsgB[1].id, true, ""]);
      await authBPromise;
      await expect(server).toReceiveMessage(["EVENT", pubEvent]);
      server.send(["OK", pubEvent.id, true, ""]);
      await eventPromise;

      reqSpy.unsubscribe();
    });
  });
});
