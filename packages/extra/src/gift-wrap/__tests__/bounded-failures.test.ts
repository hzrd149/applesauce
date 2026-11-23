// Regression for the bounded failure set (#114-M4): any relay can deliver envelopes addressed to
// the user whose contents fail to process, so the failure state must not grow with hostile traffic.
// White-box: recordFailure is private, so this drives it through a cast to keep the test fast and
// deterministic instead of flooding real envelopes through the drain.
import { RumorStore } from "applesauce-core/event-store";
import { EventStore } from "applesauce-core";
import { finalizeEvent, unixNow } from "applesauce-core/helpers";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { describe, expect, it } from "vitest";
import { GiftWrapReceiver } from "../receiver.js";

const CAP = 1000;

describe("bounded failure state", () => {
  it("evicts the oldest tracked failures at the cap", async () => {
    const recipient = new PrivateKeySigner(new Uint8Array(32).fill(22));
    const pubkey = await recipient.getPublicKey();
    const attacker = new PrivateKeySigner(new Uint8Array(32).fill(99));

    const receiver = new GiftWrapReceiver({
      pubkey,
      eventStore: new EventStore(),
      rumorStore: new RumorStore(),
      pool: {} as RelayPool,
      signer: recipient,
      relays: [],
    });
    const internals = receiver as any;
    const record = (i: number) =>
      internals.recordFailure(
        finalizeEvent({ kind: 1059, content: `hostile ${i}`, tags: [["p", pubkey]], created_at: unixNow() + i }, attacker.key),
        "wrap",
        "decryption-failed",
        new Error("hostile"),
      );

    const first = await record(0);
    for (let i = 1; i <= CAP; i++) await record(i);

    expect(internals.failures.size).toBe(CAP);
    // The first failure was evicted, the newest is kept
    expect(internals.failures.has(first.eventId)).toBe(false);
    expect(internals.failures.keys().next().value).not.toBe(first.eventId);
  }, 30000);

  it("protects retryable failures from a hostile flood of never-retry ones", async () => {
    const recipient = new PrivateKeySigner(new Uint8Array(32).fill(22));
    const pubkey = await recipient.getPublicKey();
    const attacker = new PrivateKeySigner(new Uint8Array(32).fill(99));

    const receiver = new GiftWrapReceiver({
      pubkey,
      eventStore: new EventStore(),
      rumorStore: new RumorStore(),
      pool: {} as RelayPool,
      signer: recipient,
      relays: [],
    });
    const internals = receiver as any;

    // A legitimate transient failure (signer rejected) that the user is expected to retry
    const legitWrap = finalizeEvent(
      { kind: 1059, content: "ciphertext", tags: [["p", pubkey]], created_at: unixNow() },
      recipient.key,
    );
    await internals.recordFailure(legitWrap, "wrap", "signer-rejected", new Error("signer locked"));

    // An attacker floods the cap with structural failures, which are always never-retry
    for (let i = 0; i < CAP; i++) {
      const hostile = finalizeEvent(
        { kind: 1059, content: `garbage ${i}`, tags: [["p", pubkey]], created_at: unixNow() },
        attacker.key,
      );
      await internals.recordFailure(hostile, "wrap", "invalid-seal", new Error("hostile"));
    }

    expect(internals.failures.size).toBe(CAP);
    // The legitimate retryable failure survived the flood
    expect(internals.failures.has(legitWrap.id)).toBe(true);
    expect(internals.failures.get(legitWrap.id).retry).toBe("manual");
  }, 30000);
});
