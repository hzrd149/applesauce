import { describe, it, expect } from "vitest";
import { createFiltersFromAddressPointers } from "../address-pointer.js";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { matchFilters } from "applesauce-core/helpers/filter";

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

    /** Returns every author/identifier pair of kind 30000 the filters match */
    const admitted = (filters: ReturnType<typeof createFiltersFromAddressPointers>, authors: string[], ids: string[]) =>
      authors.flatMap((pubkey) =>
        ids
          .filter((d) => matchFilters(filters, { kind: 30000, pubkey, tags: [["d", d]] } as NostrEvent))
          .map((d) => `${pubkey}:${d}`),
      );

    it("should only match the requested author and identifier pairs", () => {
      const pairs = [
        ["a", "x"],
        ["b", "y"],
        ["c", "z"],
        ["a", "y"],
      ];
      const filters = createFiltersFromAddressPointers(
        pairs.map(([pubkey, identifier]) => ({ kind: 30000, pubkey, identifier })),
      );

      expect(admitted(filters, ["a", "b", "c"], ["x", "y", "z"]).sort()).toEqual(pairs.map((p) => p.join(":")).sort());
    });

    it("should use one filter when authors share the same identifiers", () => {
      const filters = createFiltersFromAddressPointers(
        ["a", "b", "c"].map((pubkey) => ({ kind: 30000, pubkey, identifier: "mute" })),
      );

      expect(filters).toEqual([{ kinds: [30000], authors: ["a", "b", "c"], "#d": ["mute"] }]);
    });

    it("should keep addressable kinds in separate filters", () => {
      const filters = createFiltersFromAddressPointers([
        { kind: 30000, pubkey: "a", identifier: "x" },
        { kind: 30001, pubkey: "a", identifier: "x" },
      ]);

      expect(filters).toEqual([
        { kinds: [30000], authors: ["a"], "#d": ["x"] },
        { kinds: [30001], authors: ["a"], "#d": ["x"] },
      ]);
    });
  });
});
