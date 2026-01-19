import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { normalizeToSecretKey } from "../keys";

describe("normalizeToSecretKey", () => {
  it("should get secret key from nsec", () => {
    expect(
      bytesToHex(
        normalizeToSecretKey("nsec1xe7znq745x5n68566l32ru72aajz3pk2cys9lnf3tuexvkw0dldsj8v2lm") || new Uint8Array(),
      ),
    ).toEqual("367c2983d5a1a93d1e9ad7e2a1f3caef642886cac1205fcd315f326659cf6fdb");
  });

  it("should get secret key from raw hex", () => {
    expect(
      bytesToHex(
        normalizeToSecretKey("367c2983d5a1a93d1e9ad7e2a1f3caef642886cac1205fcd315f326659cf6fdb") || new Uint8Array(),
      ),
    ).toEqual("367c2983d5a1a93d1e9ad7e2a1f3caef642886cac1205fcd315f326659cf6fdb");
  });

  it("should return null on invalid hex key", () => {
    expect(normalizeToSecretKey("209573290")).toBeNull();
  });

  it("should return null on npub", () => {
    expect(normalizeToSecretKey("npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr")).toBeNull();
  });
});
