// Stream-key NIP-42 registry (CORD relay-access convention). Ported from
// selftest.ts §8, adapted to the instance-scoped ConcordRelayAuth. The live
// per-relay auth driver is exercised end-to-end by the puppeteer drivers
// (drive-auth.mjs) rather than here.

import { describe, expect, it } from "vitest";
import { verifyEvent } from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { RelayPool } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity, deriveKeys } from "../../helpers/community.js";

describe("ConcordRelayAuth stream-key registry", () => {
  it("registers derived stream keys and signs kind-22242 AS each", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const genesis = await createCommunity({ ownerPubkey: await owner.getPublicKey(), name: "T", relays: ["wss://x"] });
    const keys = deriveKeys(genesis.material, []);

    const auth = new ConcordRelayAuth(new RelayPool());
    const added = auth.registerStreamKeys([keys.control, keys.guestbook]);
    expect(added.sort()).toEqual([keys.control.pk, keys.guestbook.pk].sort());
    // Idempotent: re-registering the same keys adds nothing.
    expect(auth.registerStreamKeys([keys.control, keys.guestbook])).toEqual([]);

    const signers = auth.streamSigners();
    expect(signers).toHaveLength(2);
    expect(auth.streamPubkeys()).toEqual(expect.arrayContaining([keys.control.pk, keys.guestbook.pk]));
    // Each signer authenticates AS its stream pubkey.
    expect(signers.some(({ pubkey }) => pubkey === keys.control.pk)).toBe(true);
    expect(signers.some(({ pubkey }) => pubkey === keys.guestbook.pk)).toBe(true);

    const auths = await Promise.all(
      signers.map(({ signer }) =>
        signer.signEvent({
          kind: 22242,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["relay", "wss://relay.example"],
            ["challenge", "challenge-abc"],
          ],
        }),
      ),
    );
    expect(auths.every((e) => e.kind === 22242 && verifyEvent(e))).toBe(true);
    expect(auths.every((e) => e.tags.find((t) => t[0] === "challenge")?.[1] === "challenge-abc")).toBe(true);
  });
});
