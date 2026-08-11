import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers";
import { firstValueFrom, of } from "rxjs";
import { filter, take } from "rxjs/operators";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { shortId } from "../helpers/auth-log.js";
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
});
