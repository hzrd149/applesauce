import { describe, expect, it } from "vitest";
import { getExternalPointerFromTag, isValidExternalPointer, parseExternalPointer } from "../external-id.js";

describe("parseExternalPointer", () => {
  describe("URLs (web)", () => {
    it("should parse a simple HTTP URL", () => {
      const result = parseExternalPointer("http://example.com/path");
      expect(result).toEqual({
        kind: "web",
        identifier: "http://example.com/path",
      });
    });

    it("should parse a simple HTTPS URL", () => {
      const result = parseExternalPointer("https://example.com/path");
      expect(result).toEqual({
        kind: "web",
        identifier: "https://example.com/path",
      });
    });

    it("should normalize URL by removing fragment", () => {
      const result = parseExternalPointer("https://example.com/path#section");
      expect(result).toEqual({
        kind: "web",
        identifier: "https://example.com/path",
      });
    });

    it("should parse URL with query parameters", () => {
      const result = parseExternalPointer("https://example.com/path?param=value");
      expect(result).toEqual({
        kind: "web",
        identifier: "https://example.com/path?param=value",
      });
    });

    it("should normalize URL with both query and fragment", () => {
      const result = parseExternalPointer("https://example.com/path?param=value#section");
      expect(result).toEqual({
        kind: "web",
        identifier: "https://example.com/path?param=value",
      });
    });

    it("should parse URL from NIP-73 example", () => {
      const result = parseExternalPointer("https://myblog.example.com/post/2012-03-27/hello-world");
      expect(result).toEqual({
        kind: "web",
        identifier: "https://myblog.example.com/post/2012-03-27/hello-world",
      });
    });

    it("should return null for invalid URL", () => {
      const result = parseExternalPointer("not-a-url");
      expect(result).toBe(null);
    });

    it("should return null for empty string", () => {
      const result = parseExternalPointer("");
      expect(result).toBe(null);
    });
  });

  describe("Hashtags", () => {
    it("should parse a hashtag", () => {
      const result = parseExternalPointer("#nostr");
      expect(result).toEqual({
        kind: "#",
        identifier: "#nostr",
      });
    });

    it("should parse a lowercase hashtag", () => {
      const result = parseExternalPointer("#bitcoin");
      expect(result).toEqual({
        kind: "#",
        identifier: "#bitcoin",
      });
    });
  });

  describe("Geohashes", () => {
    it("should parse a geohash", () => {
      const result = parseExternalPointer("geo:9q5h");
      expect(result).toEqual({
        kind: "geo",
        identifier: "geo:9q5h",
      });
    });

    it("should parse a lowercase geohash", () => {
      const result = parseExternalPointer("geo:9q5h7x");
      expect(result).toEqual({
        kind: "geo",
        identifier: "geo:9q5h7x",
      });
    });
  });

  describe("Books (ISBN)", () => {
    it("should parse an ISBN without hyphens", () => {
      const result = parseExternalPointer("isbn:9780765382030");
      expect(result).toEqual({
        kind: "isbn",
        identifier: "isbn:9780765382030",
      });
    });

    it("should parse ISBN from NIP-73 example", () => {
      const result = parseExternalPointer("isbn:9780765382030");
      expect(result).toEqual({
        kind: "isbn",
        identifier: "isbn:9780765382030",
      });
    });
  });

  describe("Podcasts", () => {
    it("should parse a podcast GUID", () => {
      const result = parseExternalPointer("podcast:guid:c90e609a-df1e-596a-bd5e-57bcc8aad6cc");
      expect(result).toEqual({
        kind: "podcast:guid",
        identifier: "podcast:guid:c90e609a-df1e-596a-bd5e-57bcc8aad6cc",
      });
    });

    it("should parse a podcast item GUID", () => {
      const result = parseExternalPointer("podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f");
      expect(result).toEqual({
        kind: "podcast:item:guid",
        identifier: "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f",
      });
    });

    it("should parse a podcast publisher GUID", () => {
      const result = parseExternalPointer("podcast:publisher:guid:18bcbf10-6701-4ffb-b255-bc057390d738");
      expect(result).toEqual({
        kind: "podcast:publisher:guid",
        identifier: "podcast:publisher:guid:18bcbf10-6701-4ffb-b255-bc057390d738",
      });
    });
  });

  describe("Movies (ISAN)", () => {
    it("should parse an ISAN without version part", () => {
      const result = parseExternalPointer("isan:0000-0000-401A-0000-7");
      expect(result).toEqual({
        kind: "isan",
        identifier: "isan:0000-0000-401A-0000-7",
      });
    });

    it("should parse ISAN from NIP-73 example", () => {
      const result = parseExternalPointer("isan:0000-0000-401A-0000-7");
      expect(result).toEqual({
        kind: "isan",
        identifier: "isan:0000-0000-401A-0000-7",
      });
    });
  });

  describe("Papers (DOI)", () => {
    it("should parse a DOI in lowercase", () => {
      const result = parseExternalPointer("doi:10.1000/182");
      expect(result).toEqual({
        kind: "doi",
        identifier: "doi:10.1000/182",
      });
    });
  });

  describe("Blockchain - Bitcoin", () => {
    it("should parse a Bitcoin transaction", () => {
      const result = parseExternalPointer(
        "bitcoin:tx:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
      );
      expect(result).toEqual({
        kind: "bitcoin:tx",
        identifier: "bitcoin:tx:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
      });
    });

    it("should parse a Bitcoin address (base58)", () => {
      const result = parseExternalPointer("bitcoin:address:1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx");
      expect(result).toEqual({
        kind: "bitcoin:address",
        identifier: "bitcoin:address:1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx",
      });
    });

    it("should parse a Bitcoin address (bech32)", () => {
      const result = parseExternalPointer("bitcoin:address:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
      expect(result).toEqual({
        kind: "bitcoin:address",
        identifier: "bitcoin:address:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      });
    });
  });

  describe("Blockchain - Ethereum", () => {
    it("should parse an Ethereum transaction with chainId 1 (mainnet)", () => {
      const result = parseExternalPointer(
        "ethereum:1:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd",
      );
      expect(result).toEqual({
        kind: "ethereum:tx",
        identifier: "ethereum:1:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd",
      });
    });

    it("should parse an Ethereum transaction with chainId 100 (Gnosis)", () => {
      const result = parseExternalPointer(
        "ethereum:100:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd",
      );
      expect(result).toEqual({
        kind: "ethereum:tx",
        identifier: "ethereum:100:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd",
      });
    });

    it("should parse an Ethereum address with chainId 1 (mainnet)", () => {
      const result = parseExternalPointer("ethereum:1:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
      expect(result).toEqual({
        kind: "ethereum:address",
        identifier: "ethereum:1:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      });
    });

    it("should parse an Ethereum address with chainId 100 (Gnosis)", () => {
      const result = parseExternalPointer("ethereum:100:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
      expect(result).toEqual({
        kind: "ethereum:address",
        identifier: "ethereum:100:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      });
    });
  });

  describe("Blockchain - Other chains", () => {
    it("should parse a Solana transaction", () => {
      const result = parseExternalPointer(
        "solana:tx:5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4LjFqZdJ7f7m2M2Hm2N8TbXU",
      );
      expect(result).toEqual({
        kind: "solana:tx",
        identifier: "solana:tx:5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4LjFqZdJ7f7m2M2Hm2N8TbXU",
      });
    });

    it("should parse a Solana address", () => {
      const result = parseExternalPointer("solana:address:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
      expect(result).toEqual({
        kind: "solana:address",
        identifier: "solana:address:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      });
    });
  });

  describe("Priority handling", () => {
    it("should prioritize explicit prefixes over URL parsing", () => {
      // Even though "geo:http://example.com" could be parsed as a URL,
      // it should be parsed as a geohash because of the explicit prefix
      const result = parseExternalPointer("geo:http://example.com");
      expect(result).toEqual({
        kind: "geo",
        identifier: "geo:http://example.com",
      });
    });

    it("should prioritize hashtag over URL parsing", () => {
      // Even though "#http://example.com" starts with #, it's a hashtag
      const result = parseExternalPointer("#http://example.com");
      expect(result).toEqual({
        kind: "#",
        identifier: "#http://example.com",
      });
    });

    it("should prioritize blockchain identifiers over URL parsing", () => {
      // Even though "bitcoin:tx:http://example.com" could be parsed as a URL,
      // it should be parsed as a Bitcoin transaction because of the explicit prefix
      const result = parseExternalPointer("bitcoin:tx:http://example.com");
      expect(result).toEqual({
        kind: "bitcoin:tx",
        identifier: "bitcoin:tx:http://example.com",
      });
    });
  });
});

describe("getExternalPointerFromTag", () => {
  it("should parse URL from i tag", () => {
    const result = getExternalPointerFromTag(["i", "https://example.com/path"]);
    expect(result).toEqual({
      kind: "web",
      identifier: "https://example.com/path",
    });
  });

  it("should normalize URL with fragment from i tag", () => {
    const result = getExternalPointerFromTag(["i", "https://example.com/path#section"]);
    expect(result).toEqual({
      kind: "web",
      identifier: "https://example.com/path",
    });
  });

  it("should parse podcast item GUID from i tag", () => {
    const result = getExternalPointerFromTag(["i", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"]);
    expect(result).toEqual({
      kind: "podcast:item:guid",
      identifier: "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f",
    });
  });

  it("should return null for invalid identifier", () => {
    const result = getExternalPointerFromTag(["i", "not-a-valid-identifier"]);
    expect(result).toBe(null);
  });

  it("should return null for missing identifier", () => {
    const result = getExternalPointerFromTag(["i"]);
    expect(result).toBe(null);
  });

  it("should parse Bitcoin transaction from i tag", () => {
    const result = getExternalPointerFromTag([
      "i",
      "bitcoin:tx:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
    ]);
    expect(result).toEqual({
      kind: "bitcoin:tx",
      identifier: "bitcoin:tx:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
    });
  });

  it("should parse Ethereum transaction from i tag", () => {
    const result = getExternalPointerFromTag([
      "i",
      "ethereum:1:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd",
    ]);
    expect(result).toEqual({
      kind: "ethereum:tx",
      identifier: "ethereum:1:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd",
    });
  });
});

describe("isValidExternalPointer", () => {
  it("should return true for valid URL", () => {
    expect(isValidExternalPointer("https://example.com/path")).toBe(true);
  });

  it("should return true for valid URL with fragment (will be normalized)", () => {
    expect(isValidExternalPointer("https://example.com/path#section")).toBe(true);
  });

  it("should return true for valid hashtag", () => {
    expect(isValidExternalPointer("#nostr")).toBe(true);
  });

  it("should return true for valid geohash", () => {
    expect(isValidExternalPointer("geo:9q5h")).toBe(true);
  });

  it("should return true for valid ISBN", () => {
    expect(isValidExternalPointer("isbn:9780765382030")).toBe(true);
  });

  it("should return true for valid podcast GUID", () => {
    expect(isValidExternalPointer("podcast:guid:c90e609a-df1e-596a-bd5e-57bcc8aad6cc")).toBe(true);
  });

  it("should return true for valid ISAN", () => {
    expect(isValidExternalPointer("isan:0000-0000-401A-0000-7")).toBe(true);
  });

  it("should return true for valid DOI", () => {
    expect(isValidExternalPointer("doi:10.1000/182")).toBe(true);
  });

  it("should return true for valid Bitcoin transaction", () => {
    expect(isValidExternalPointer("bitcoin:tx:a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d")).toBe(
      true,
    );
  });

  it("should return true for valid Bitcoin address", () => {
    expect(isValidExternalPointer("bitcoin:address:1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx")).toBe(true);
  });

  it("should return true for valid Ethereum transaction", () => {
    expect(
      isValidExternalPointer("ethereum:1:tx:0x98f7812be496f97f80e2e98d66358d1fc733cf34176a8356d171ea7fbbe97ccd"),
    ).toBe(true);
  });

  it("should return true for valid Ethereum address", () => {
    expect(isValidExternalPointer("ethereum:1:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
  });

  it("should return true for valid Solana transaction", () => {
    expect(
      isValidExternalPointer(
        "solana:tx:5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4LjFqZdJ7f7m2M2Hm2N8TbXU",
      ),
    ).toBe(true);
  });

  it("should return true for valid Solana address", () => {
    expect(isValidExternalPointer("solana:address:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(true);
  });

  it("should return false for invalid identifier", () => {
    expect(isValidExternalPointer("not-a-valid-identifier")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidExternalPointer("")).toBe(false);
  });
});
