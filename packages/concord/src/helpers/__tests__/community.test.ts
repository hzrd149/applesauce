import { describe, expect, it } from "vitest";

import { createCommunity, deriveKeys, verifyOwner } from "../community.js";
import {
  CORD_METADATA_CAPS,
  multiByteStringOfBytes,
  multiByteStringOverBytes,
  utf8Bytes,
} from "../../__tests__/cord-wire-fixtures.js";

describe("community keys", () => {
  it("createCommunity yields a verifiable owner proof and derivable keys", async () => {
    const genesis = await createCommunity({ ownerPubkey: "ab".repeat(32), name: "N", relays: ["wss://r"] });
    expect(verifyOwner(genesis.material)).toBe(true);
    const keys = deriveKeys(genesis.material, []);
    expect(keys.control.pk).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.guestbook.pk).not.toBe(keys.control.pk);
  });
});

// Every cap number below is sourced from `CORD_METADATA_CAPS` — the vendored
// transcription of the CORD-02 §6 sentence stating the `name`/`description`
// byte caps (see `CORD_METADATA_CAP_SENTENCE` in cord-wire-fixtures.ts) —
// NEVER from the implementation module's own NAME_MAX_BYTES/DESCRIPTION_MAX_BYTES
// constants. A test that imports the implementation's own constant and
// asserts the cap equals that constant is exactly the failure mode that let
// 189 tests pass while nine HIGH bugs were live (D-21/TEST-01). Byte lengths
// here are measured with the fixtures' `utf8Bytes`, never with the
// implementation's own byte-measuring helper — the two are deliberately
// named differently so a test cannot measure with the implementation it is
// testing.
describe("createCommunity byte caps (WIRE-06/WIRE-07, D-02/D-03/D-05)", () => {
  const baseOpts = { ownerPubkey: "ab".repeat(32), relays: ["wss://r"] };

  it("accepts a name of exactly the CORD-02 §6 byte cap", async () => {
    const name = multiByteStringOfBytes(CORD_METADATA_CAPS.nameBytes);
    expect(utf8Bytes(name)).toBe(CORD_METADATA_CAPS.nameBytes);
    await expect(createCommunity({ ...baseOpts, name })).resolves.toBeDefined();
  });

  it("rejects a name one astral character over the byte cap, the thrown message naming the measured bytes and the cap", async () => {
    const name = multiByteStringOverBytes(CORD_METADATA_CAPS.nameBytes);
    const bytes = utf8Bytes(name);
    // Assert only the two digits the message must contain — a future
    // rewording of the surrounding prose must not break this suite, but a
    // wrong number still must.
    await expect(createCommunity({ ...baseOpts, name })).rejects.toThrow(
      new RegExp(`${bytes}\\D+${CORD_METADATA_CAPS.nameBytes}`),
    );
  });

  it("the over-cap name's UTF-16 `.length` diverges from its UTF-8 byte length (D-21 self-guard)", () => {
    const name = multiByteStringOverBytes(CORD_METADATA_CAPS.nameBytes);
    // If a future edit swapped the astral fixture for a repeated ASCII
    // character, this assertion would fail loudly instead of silently
    // testing nothing.
    expect(name.length).not.toBe(utf8Bytes(name));
  });

  it("rejects a name over cap in bytes while strictly UNDER cap in UTF-16 code units (the M17 regression proper)", async () => {
    // A 17-repeat of the 4-byte / 2-UTF-16-unit astral fixture is 68 UTF-8
    // bytes and 34 UTF-16 units: a `.length`-based cap implementation would
    // wrongly ACCEPT this name, since 34 < 64. Only a byte-measuring cap
    // rejects it.
    const name = multiByteStringOfBytes(CORD_METADATA_CAPS.nameBytes + 4);
    const bytes = utf8Bytes(name);
    expect(bytes).toBeGreaterThan(CORD_METADATA_CAPS.nameBytes);
    expect(name.length).toBeLessThan(CORD_METADATA_CAPS.nameBytes);
    await expect(createCommunity({ ...baseOpts, name })).rejects.toThrow(
      new RegExp(`${bytes}\\D+${CORD_METADATA_CAPS.nameBytes}`),
    );
  });

  it("accepts a description of exactly the CORD-02 §6 byte cap; rejects one astral character more", async () => {
    const description = multiByteStringOfBytes(CORD_METADATA_CAPS.descriptionBytes);
    expect(utf8Bytes(description)).toBe(CORD_METADATA_CAPS.descriptionBytes);
    await expect(createCommunity({ ...baseOpts, name: "N", description })).resolves.toBeDefined();

    const overCapDescription = multiByteStringOverBytes(CORD_METADATA_CAPS.descriptionBytes);
    const bytes = utf8Bytes(overCapDescription);
    expect(overCapDescription.length).not.toBe(bytes);
    await expect(createCommunity({ ...baseOpts, name: "N", description: overCapDescription })).rejects.toThrow(
      new RegExp(`${bytes}\\D+${CORD_METADATA_CAPS.descriptionBytes}`),
    );
  });

  it("accepts createCommunity with no description at all — the optional field is not an empty-string violation", async () => {
    await expect(createCommunity({ ...baseOpts, name: "N" })).resolves.toBeDefined();
  });
});
