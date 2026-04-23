import { describe, it, expect } from "vitest";
import { createFiltersFromAddressPointers } from "../address-pointer.js";
import { kinds } from "applesauce-core/helpers/event";

describe("address pointer helpers", () => {
  describe("createFiltersFromAddressPointers", () => {
    it("should separate replaceable and parameterized replaceable pointers", () => {
      expect(
        createFiltersFromAddressPointers([
          { kind: kinds.BookmarkList, pubkey: "pubkey" },
          { kind: kinds.Metadata, pubkey: "pubkey" },
          { kind: kinds.Metadata, pubkey: "pubkey2" },
          { kind: kinds.Bookmarksets, identifier: "funny", pubkey: "pubkey" },
        ]),
      ).toEqual(
        expect.arrayContaining([
          { kinds: [kinds.Metadata], authors: ["pubkey", "pubkey2"] },
          { kinds: [kinds.BookmarkList], authors: ["pubkey"] },
          { "#d": ["funny"], authors: ["pubkey"], kinds: [kinds.Bookmarksets] },
        ]),
      );
    });

    it("should combine pointers with the same `since` into a single filter", () => {
      expect(
        createFiltersFromAddressPointers([
          { kind: kinds.Metadata, pubkey: "pubkey", since: 100 },
          { kind: kinds.Metadata, pubkey: "pubkey2", since: 100 },
        ]),
      ).toEqual([{ kinds: [kinds.Metadata], authors: ["pubkey", "pubkey2"], since: 100 }]);
    });

    it("should split pointers with different `since` values into separate filters", () => {
      expect(
        createFiltersFromAddressPointers([
          { kind: kinds.Metadata, pubkey: "pubkey", since: 100 },
          { kind: kinds.Metadata, pubkey: "pubkey2", since: 200 },
        ]),
      ).toEqual(
        expect.arrayContaining([
          { kinds: [kinds.Metadata], authors: ["pubkey"], since: 100 },
          { kinds: [kinds.Metadata], authors: ["pubkey2"], since: 200 },
        ]),
      );
    });

    it("should split pointers with and without `since` into separate filters", () => {
      expect(
        createFiltersFromAddressPointers([
          { kind: kinds.Metadata, pubkey: "pubkey", since: 100 },
          { kind: kinds.Metadata, pubkey: "pubkey2" },
        ]),
      ).toEqual(
        expect.arrayContaining([
          { kinds: [kinds.Metadata], authors: ["pubkey"], since: 100 },
          { kinds: [kinds.Metadata], authors: ["pubkey2"] },
        ]),
      );
    });
  });
});
