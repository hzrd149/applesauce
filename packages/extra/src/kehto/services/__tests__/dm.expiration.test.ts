import { GiftWrapFactory, LegacyMessageFactory } from "applesauce-common/factories";
import { unlockGiftWrap } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { finalizeEvent, getEventHash, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { firstValueFrom, Subject, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { DmExpirationTracker } from "../dm/expiration.js";
import { createLegacyMessageProtocol, createWrappedMessageProtocol } from "../dm.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const aliceSigner = new PrivateKeySigner(aliceKey);
const bobSigner = new PrivateKeySigner(bobKey);
const alice = await aliceSigner.getPublicKey();
const bob = await bobSigner.getPublicKey();

describe.each(["nip04", "nip17"])("%s expiration mirroring", (protocolId) => {
  it.each([true, false])("mirrors expiration only when enabled (%s)", async (mirrorExpiration) => {
    const eventStore = new EventStore();
    for (const key of [aliceKey, bobKey]) {
      eventStore.add(
        finalizeEvent(
          {
            kind: kinds.DirectMessageRelaysList,
            created_at: unixNow(),
            tags: [["relay", "wss://dm.test"]],
            content: "",
          },
          key,
        ),
      );
    }
    const publish = vi.fn(async (_relays: string[], _event: NostrEvent) => [{ ok: true }]);
    const pool = { req: () => new Subject(), publish } as unknown as RelayPool;
    const createProtocol = protocolId === "nip04" ? createLegacyMessageProtocol : createWrappedMessageProtocol;
    const protocol = createProtocol({ eventStore, pool, signer: aliceSigner, timeout: 5, mirrorExpiration });
    const session = (await firstValueFrom(protocol.session$))!;
    const context = { signal: new AbortController().signal };
    const createdAt = unixNow() - 60;

    async function receive(timestamp: number, duration?: number) {
      const tags = [["p", alice]];
      if (duration !== undefined) tags.push(["expiration", String(timestamp + duration)]);
      if (protocolId === "nip17") {
        const template = {
          kind: kinds.PrivateDirectMessage,
          pubkey: bob,
          created_at: timestamp,
          tags,
          content: "hello",
        };
        const rumor = { ...template, id: getEventHash(template) };
        eventStore.add(await GiftWrapFactory.create(bobSigner, alice, rumor));
      } else {
        let factory = LegacyMessageFactory.create(alice, "hello").created(timestamp);
        if (duration !== undefined) factory = factory.expiration(timestamp + duration);
        eventStore.add(await factory.sign(bobSigner));
      }
      await firstValueFrom(session.messages$({ ...context, history: true }).pipe(toArray()));
    }

    async function send() {
      const prepared = await firstValueFrom(session.prepareSend$({ recipients: [bob], content: "reply" }, context));
      await firstValueFrom(prepared.publish$);
      const event = publish.mock.calls.at(-1)![1];
      return protocolId === "nip17" ? unlockGiftWrap(event, bobSigner) : event;
    }

    try {
      await receive(createdAt, 3600);
      await receive(createdAt - 10, 7200);
      const reply = await send();
      expect(reply.tags.filter((tag) => tag[0] === "expiration")).toEqual(
        mirrorExpiration ? [["expiration", String(reply.created_at + 3600)]] : [],
      );

      await receive(unixNow() + 1);
      const permanentReply = await send();
      expect(permanentReply.tags.some((tag) => tag[0] === "expiration")).toBe(false);
    } finally {
      protocol.close?.();
    }
  });
});

describe("conversation expiration tracking", () => {
  it("isolates participant sets and ignores invalid expiration durations", () => {
    const tracker = new DmExpirationTracker();
    tracker.observe({ id: "first", kind: 14, created_at: 100, content: "", tags: [["expiration", "200"]] }, [
      alice,
      bob,
    ]);
    expect(tracker.tags([bob, alice, alice], 300)).toEqual([["expiration", "400"]]);
    expect(tracker.tags([alice], 300)).toEqual([]);
    expect(new DmExpirationTracker().tags([alice, bob], 300)).toEqual([]);

    for (const [index, value] of ["invalid", "999junk", "Infinity", "0", "100"].entries()) {
      tracker.observe({ id: value, kind: 14, created_at: 101 + index, content: "", tags: [["expiration", value]] }, [
        alice,
      ]);
      expect(tracker.tags([alice], 300)).toEqual([]);
    }
  });
});
