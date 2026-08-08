import { describe, expect, it } from "vitest";
import { NostrEvent } from "applesauce-core/helpers/event";
import { getNutzapMint, getNutzapP2PKPubkey } from "../nutzap.js";

describe("getNutzapMint", () => {
  it("should return the mint URL", () => {
    const event = { tags: [["u", "https://mint.com"]] } as NostrEvent;
    expect(getNutzapMint(event)).toBe("https://mint.com");
  });

  it("should return undefined for invalid URL", () => {
    const event = { tags: [["u", "invalid"]] } as NostrEvent;
    expect(getNutzapMint(event)).toBeUndefined();
  });
});

describe("getNutzapP2PKPubkey", () => {
  // Finding #3 of the throw/undefined review. A nutzap arrives from a stranger, so non-P2PK or
  // mixed-lock proofs are hostile input rather than programmer errors. getProofP2PKPubkey one
  // level down (helpers/cashu.ts) already returns undefined for every failure.
  const pk = (n: string) => n.repeat(64);
  const p2pkProof = (pubkey: string, id: string) => [
    "proof",
    JSON.stringify({ secret: JSON.stringify(["P2PK", { data: pubkey }]), C: id, id, amount: 1 }),
  ];
  const plainProof = (id: string) => ["proof", JSON.stringify({ secret: "not-p2pk", C: id, id, amount: 1 })];

  it("returns the shared pubkey when every proof is locked to it", () => {
    const event = { tags: [p2pkProof(pk("a"), "A"), p2pkProof(pk("a"), "B")] } as NostrEvent;
    expect(getNutzapP2PKPubkey(event)).toBe(pk("a"));
  });

  it("returns undefined when there are no proofs", () => {
    expect(getNutzapP2PKPubkey({ tags: [] } as unknown as NostrEvent)).toBeUndefined();
  });

  it("returns undefined instead of throwing when a proof is not P2PK locked", () => {
    const event = { tags: [p2pkProof(pk("a"), "A"), plainProof("B")] } as NostrEvent;

    expect(() => getNutzapP2PKPubkey(event)).not.toThrow();
    expect(getNutzapP2PKPubkey(event)).toBeUndefined();
  });

  it("returns undefined instead of throwing when proofs are locked to different pubkeys", () => {
    const event = { tags: [p2pkProof(pk("a"), "A"), p2pkProof(pk("b"), "B")] } as NostrEvent;

    expect(() => getNutzapP2PKPubkey(event)).not.toThrow();
    // Must be undefined, not the first pubkey seen — returning that would hide the mismatch.
    expect(getNutzapP2PKPubkey(event)).toBeUndefined();
  });
});
