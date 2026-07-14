import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";

import { createCommunity } from "../community.js";
import { buildInviteBundle, validateInviteBundle, INVITE_BUNDLE_MAX_CHANNELS } from "../invite-bundle.js";
import {
  DIRECT_INVITE_KIND,
  DIRECT_INVITE_INDEX,
  directInviteFilter,
  getDirectInviteBundle,
  getDirectInviteExpiration,
  getDirectInviteRecipient,
  isValidDirectInvite,
  isValidDirectInviteRumor,
} from "../direct-invite.js";
import { GIFT_WRAP_KIND } from "../gift-wrap.js";

const owner = getPublicKey(generateSecretKey());
const genesis = () => createCommunity({ ownerPubkey: owner, name: "Test", description: "d", relays: ["wss://r"] });

describe("buildInviteBundle", () => {
  it("assembles a §1 bundle that self-certifies its owner", async () => {
    const { material } = await genesis();
    const bundle = buildInviteBundle(material, { creator_npub: owner, label: "Reddit" });
    expect(bundle.owner).toBe(owner);
    expect(bundle.creator_npub).toBe(owner);
    expect(bundle.label).toBe("Reddit");
    expect(bundle.channels).toEqual([]);
    expect(validateInviteBundle(bundle)).toBeTruthy();
  });

  it("grants only selected private channels and preserves held keys", async () => {
    const { material } = await genesis();
    const channels = [
      { id: "a", key: "11".repeat(32), epoch: 2, name: "mods", held: [{ epoch: 1, key: "22".repeat(32) }] },
      { id: "b", key: "33".repeat(32), epoch: 1, name: "founders" },
    ];

    const bundle = buildInviteBundle({ ...material, channels }, { channels: ["a"] });
    expect(bundle.channels).toEqual([channels[0]]);
  });

  it("rejects unknown channel grants", async () => {
    const { material } = await genesis();
    expect(() => buildInviteBundle(material, { channels: ["missing"] })).toThrow(
      "not a private channel we hold a key for: missing",
    );
  });
});

describe("validateInviteBundle", () => {
  it("rejects a bundle whose owner/salt don't reproduce the community_id", async () => {
    const { material } = await genesis();
    const bundle = buildInviteBundle(material);
    expect(validateInviteBundle({ ...bundle, owner: "ff".repeat(32) })).toBeUndefined();
  });

  it("rejects a bundle carrying more than the channel ceiling", async () => {
    const { material } = await genesis();
    const bundle = buildInviteBundle(material);
    const channels = Array.from({ length: INVITE_BUNDLE_MAX_CHANNELS + 1 }, (_, i) => ({
      id: i.toString(16),
      key: "00",
      epoch: 1,
      name: `c${i}`,
    }));
    expect(validateInviteBundle({ ...bundle, channels })).toBeUndefined();
  });

  it("truncates the relay snapshot to the community cap", async () => {
    const { material } = await genesis();
    const relays = ["wss://1", "wss://2", "wss://3", "wss://4", "wss://5", "wss://6", "wss://7"];
    const bundle = validateInviteBundle(buildInviteBundle({ ...material, relays }));
    expect(bundle!.relays).toEqual(["wss://1", "wss://2", "wss://3", "wss://4", "wss://5"]);
  });

  it("returns undefined for garbage input", () => {
    expect(validateInviteBundle(undefined)).toBeUndefined();
    // @ts-expect-error exercising the runtime guard
    expect(validateInviteBundle({ owner: 5 })).toBeUndefined();
  });
});

describe("direct-invite helpers", () => {
  it("directInviteFilter is the indexed lookup {1059, #p, #k:3313}", () => {
    const me = "aa".repeat(32);
    expect(directInviteFilter(me)).toEqual({
      kinds: [GIFT_WRAP_KIND],
      "#p": [me],
      "#k": [DIRECT_INVITE_INDEX],
    });
    expect(DIRECT_INVITE_INDEX).toBe(String(DIRECT_INVITE_KIND));
  });

  it("getDirectInviteBundle validates a 3313 rumor's payload", async () => {
    const { material } = await genesis();
    const bundle = buildInviteBundle(material);
    const rumor = { kind: DIRECT_INVITE_KIND, content: JSON.stringify(bundle) } as any;
    expect(isValidDirectInviteRumor(rumor)).toBe(true);
    expect(getDirectInviteBundle(rumor)?.community_id).toBe(material.community_id);
    // Cached parse short-circuits re-validation on the same instance.
    rumor.content = "not json";
    expect(getDirectInviteBundle(rumor)?.community_id).toBe(material.community_id);
  });

  it("isValidDirectInvite checks the indexed gift wrap envelope", () => {
    const recipient = "aa".repeat(32);
    const wrap = {
      kind: GIFT_WRAP_KIND,
      tags: [
        ["p", recipient],
        ["k", DIRECT_INVITE_INDEX],
        ["expiration", "1800000000"],
      ],
    } as any;
    expect(isValidDirectInvite(wrap)).toBe(true);
    expect(getDirectInviteRecipient(wrap)).toBe(recipient);
    expect(getDirectInviteExpiration(wrap)).toBe(1_800_000_000);
    expect(isValidDirectInvite({ kind: GIFT_WRAP_KIND, tags: [["k", DIRECT_INVITE_INDEX]] } as any)).toBe(false);
    expect(isValidDirectInvite({ kind: 1, tags: [["p", recipient], ["k", DIRECT_INVITE_INDEX]] } as any)).toBe(false);
  });

  it("rejects a non-3313 rumor and unparseable content", async () => {
    const { material } = await genesis();
    const bundle = buildInviteBundle(material);
    expect(getDirectInviteBundle({ kind: 1, content: JSON.stringify(bundle) } as any)).toBeUndefined();
    expect(getDirectInviteBundle({ kind: DIRECT_INVITE_KIND, content: "not json" } as any)).toBeUndefined();
  });
});
