// ConcordPrivateChannel over a dependency-injected pool that SERVES pre-built
// wraps (no sockets). Exercises the sub-engine's epoch-atomic walk: sync a
// private channel's epoch-1 history, follow a forward channel Rekey, and sync the
// adopted epoch's messages — proving a private channel rotates on its own
// lifecycle, independent of the community root.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, firstValueFrom, from } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore, RumorStore } from "applesauce-core";
import { ChatMessageFactory } from "applesauce-common/factories";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RelayPool } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { buildChannelRekey, deriveChannelKeys } from "../../helpers/keys.js";
import { giftWrap } from "../../operations/gift-wrap.js";
import { bindToChannel } from "../../operations/channel.js";
import type { ChannelKey } from "../../types.js";
import { ConcordPrivateChannel } from "../private-channel.js";

const settle = () => new Promise((r) => setTimeout(r, 200));

// A RelayPool stand-in that serves `events` matching each REQ's authors/kinds and
// completes (EOSE). No NIP-77, no live subscription.
function servingPool(events: NostrEvent[]): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => {
      const fs = (Array.isArray(filters) ? filters : [filters]) as Array<{
        kinds?: number[];
        authors?: string[];
        since?: number;
        until?: number;
      }>;
      const match = events.filter((e) =>
        fs.some(
          (f) =>
            (!f.kinds || f.kinds.includes(e.kind)) &&
            (!f.authors || f.authors.includes(e.pubkey)) &&
            (f.since === undefined || e.created_at >= f.since) &&
            (f.until === undefined || e.created_at <= f.until),
        ),
      );
      return from(match);
    },
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: (_relays: string[], filters: unknown) => relay.request(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}

describe("ConcordPrivateChannel (DI, served wraps)", () => {
  it("syncs epoch-1 history, follows a channel Rekey, and syncs the adopted epoch", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const me = new PrivateKeySigner(generateSecretKey());
    const myPub = await me.getPublicKey();
    const g = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = g.material;

    const channel: ChannelKey = {
      id: bytesToHex(generateSecretKey()),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "secret",
    };

    const wraps: NostrEvent[] = [];
    // Two epoch-1 messages wrapped to the channel plane.
    const k1 = deriveChannelKeys(material, channel);
    for (const text of ["one", "two"]) {
      const rumor = await bindToChannel(channel.id, 1)(await ChatMessageFactory.create(text));
      wraps.push(await giftWrap(k1.current.sk, k1.current.convKey, me)(rumor));
    }
    // Owner rotates the channel, keeping us → rekey blobs at the channel-rekey address.
    const plan = await buildChannelRekey(material, channel, owner, { recipients: [ownerPub, myPub], self: ownerPub });
    wraps.push(...plan.rekeyWraps);
    // One epoch-2 message under the new key.
    const k2 = deriveChannelKeys(material, plan.next);
    const rumor2 = await bindToChannel(channel.id, 2)(await ChatMessageFactory.create("three"));
    wraps.push(await giftWrap(k2.current.sk, k2.current.convKey, me)(rumor2));

    const pool = servingPool(wraps);
    const store = new RumorStore();
    let persisted: ChannelKey | undefined;
    const sub = new ConcordPrivateChannel({
      channelKey: channel,
      material: () => material,
      signer: me,
      pubkey: myPub,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      store,
      relays: ["wss://fake"],
      isAuthorized: (r) => r === ownerPub,
      onKeyChange: (ck) => (persisted = ck),
    });

    expect(sub.phase$.value).toBe("idle"); // not started yet
    await sub.start();
    await settle();

    // All three messages decoded — epoch-1 history + the adopted epoch-2 message.
    const msgs = store.getTimeline([{ kinds: [kinds.ChatMessage] }]).map((m) => m.content);
    expect(msgs.sort()).toEqual(["one", "three", "two"]);
    // The channel rolled forward to its own epoch 2 and persisted the new key.
    expect(sub.epoch$.value).toBe(2);
    expect(persisted?.epoch).toBe(2);
    expect(persisted?.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });

    // Descriptive status: caught up to the tip, epoch rolled, no error.
    expect(sub.phase$.value).toBe("live");
    const snap = await firstValueFrom(sub.status$);
    expect(snap).toMatchObject({ phase: "live", epoch: 2, connected: false, error: null });

    sub.dispose();
  });
});
