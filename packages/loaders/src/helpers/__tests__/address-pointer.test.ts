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
  });
});
