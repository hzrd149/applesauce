import { NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getZapAddressPointer,
  getZapEventPointer,
  getZapPayment,
  getZapPreimage,
  getZapRecipient,
  getZapRequest,
  getZapSender,
  getZapSplits,
  isValidZap,
  ZapAddressPointerSymbol,
  ZapEventPointerSymbol,
  ZapInvoiceSymbol,
  ZapReceiverSymbol,
  ZapRequestSymbol,
  ZapSenderSymbol,
} from "../zap.js";

let zapEvent: NostrEvent;

let zapEventWithSplits: NostrEvent;

beforeEach(() => {
  zapEvent = {
    content: "",
    created_at: 1749216430,
    id: "73f3940d6e89955806ef0d6c01ae08d6bae542efbc888084332da0c337884974",
    kind: 9735,
    pubkey: "79f00d3f5a19ec806189fcab03c1be4ff81d18ee4f653c88fac41fe03570f432",
    sig: "11e6dae5be11ba644c03b926ebd159c859ee054077d97fe3f24628bcb8bffd5fa098de5f0cf0a0ae7eb545a2e0ad1b85c1c03a9dc9f42ec84f24f649448f42b4",
    tags: [
      ["p", "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5"],
      ["e", "9199d90f756697b0a3e93be9a526d5890fd1ebf6745875ef96febbb66f6d7a0a"],
      ["P", "55f04590674f3648f4cdc9dc8ce32da2a282074cd0b020596ee033d12d385185"],
      [
        "bolt11",
        "lnbc1210n1p5y9m92pp57824537tqsku5cmpltnqga72qjs5npzlqwr6km6x5ma4emlp0z2qhp58vvj52sfaqa4hxdp3vws7fys63tcsvs8a5ke3km4asc93yp0ftgqcqzzsxqyz5vqsp5sqwdnpvpurzh8tlp3q54ffp6cxk7qhftfd03g6fncrs7fxwl3u0s9qxpqysgq6un7rjkpvh5dlw8p5lvkfdflza43qwe8l0v5udx5lkg9jy6hjvp9xz6jtj85g24v360zr95457xzntk7frz9pn8xcujqzlfv7rr29ucp5cymnz",
      ],
      ["preimage", "1beb59590f41873e2f501bc68ad387c45f843dbc751ec56c0de16e152d1b1191"],
      [
        "description",
        '{"id":"2813fcc0240532e5dcaafad02b5312fe73d51c8e7a88dbaa56b6049c6f918897","pubkey":"55f04590674f3648f4cdc9dc8ce32da2a282074cd0b020596ee033d12d385185","content":"","kind":9734,"created_at":1749216425,"tags":[["amount","121000"],["e","9199d90f756697b0a3e93be9a526d5890fd1ebf6745875ef96febbb66f6d7a0a"],["p","266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5"],["relays","wss://relay.snort.social","wss://nos.lol","wss://relay.damus.io","wss://nostr.wine"],["client","zap.stream","694dd00"]],"sig":"2fbabdd5ea3c4342993d29c38187670b7c092c04bb1c15acf5a6d697ef4d5068580594abd033c9ac7ad7908e3a3377f2a2c45d75807419c730bd4d1edf3f4593"}',
      ],
    ],
  };

  zapEventWithSplits = {
    ...zapEvent,
    tags: [
      ...zapEvent.tags,
      ["zap", "pubkey1", "wss://relay1.com", "0.5"],
      ["zap", "pubkey2", "wss://relay2.com", "0.3"],
      ["zap", "pubkey3", "", "0.2"],
    ],
  };
});

describe("getZapSender", () => {
  it("should return the sender pubkey from P tag", () => {
    const sender = getZapSender(zapEvent);
    expect(sender).toBe("55f04590674f3648f4cdc9dc8ce32da2a282074cd0b020596ee033d12d385185");
  });

  it("should cache the result using ZapSenderSymbol", () => {
    getZapSender(zapEvent);
    expect(Reflect.has(zapEvent, ZapSenderSymbol)).toBe(true);
  });

  it("should fallback to zap request pubkey if P tag is missing", () => {
    const eventWithoutPTag = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "P"),
    };
    const sender = getZapSender(eventWithoutPTag);
    expect(sender).toBe("55f04590674f3648f4cdc9dc8ce32da2a282074cd0b020596ee033d12d385185");
  });
});

describe("getZapRecipient", () => {
  it("should return the recipient pubkey from p tag", () => {
    const recipient = getZapRecipient(zapEvent);
    expect(recipient).toBe("266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5");
  });

  it("should cache the result using ZapReceiverSymbol", () => {
    getZapRecipient(zapEvent);
    expect(Reflect.has(zapEvent, ZapReceiverSymbol)).toBe(true);
  });

  it("should return undefined if p tag is missing", () => {
    const eventWithoutPTag = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "p"),
    };
    expect(getZapRecipient(eventWithoutPTag)).toBe(undefined);
  });
});

describe("getZapPayment", () => {
  it("should return parsed bolt11 invoice", () => {
    const payment = getZapPayment(zapEvent);
    expect(payment).toBeDefined();
    expect(payment?.amount).toBe(121000);
    expect(payment?.paymentHash).toBe("f1d55a47cb042dca6361fae60477ca04a149845f0387ab6f46a6fb5cefe17894");
  });

  it("should cache the result using ZapInvoiceSymbol", () => {
    getZapPayment(zapEvent);
    expect(Reflect.has(zapEvent, ZapInvoiceSymbol)).toBe(true);
  });

  it("should return undefined if bolt11 tag is missing", () => {
    const eventWithoutBolt11 = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "bolt11"),
    };
    const payment = getZapPayment(eventWithoutBolt11);
    expect(payment).toBeUndefined();
  });
});

describe("getZapEventPointer", () => {
  it("should return event pointer from e tag", () => {
    const eventPointer = getZapEventPointer(zapEvent);
    expect(eventPointer).toEqual({
      id: "9199d90f756697b0a3e93be9a526d5890fd1ebf6745875ef96febbb66f6d7a0a",
    });
  });

  it("should cache the result using ZapEventPointerSymbol", () => {
    getZapEventPointer(zapEvent);
    expect(Reflect.has(zapEvent, ZapEventPointerSymbol)).toBe(true);
  });

  it("should return null if e tag is missing", () => {
    const eventWithoutETag = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "e"),
    };
    const eventPointer = getZapEventPointer(eventWithoutETag);
    expect(eventPointer).toBeNull();
  });
});

describe("getZapAddressPointer", () => {
  it("should return null when no a tag is present", () => {
    const addressPointer = getZapAddressPointer(zapEvent);
    expect(addressPointer).toBeNull();
  });

  it("should cache the result using ZapAddressPointerSymbol", () => {
    getZapAddressPointer(zapEvent);
    expect(Reflect.has(zapEvent, ZapAddressPointerSymbol)).toBe(true);
  });

  it("should return address pointer when a tag is present", () => {
    const eventWithATag = {
      ...zapEvent,
      tags: [...zapEvent.tags, ["a", "30000:pubkey:identifier"]],
    };
    const addressPointer = getZapAddressPointer(eventWithATag);
    expect(addressPointer).toEqual({
      kind: 30000,
      pubkey: "pubkey",
      identifier: "identifier",
    });
  });
});

describe("getZapPreimage", () => {
  it("should return preimage from preimage tag", () => {
    const preimage = getZapPreimage(zapEvent);
    expect(preimage).toBe("1beb59590f41873e2f501bc68ad387c45f843dbc751ec56c0de16e152d1b1191");
  });

  it("should return undefined if preimage tag is missing", () => {
    const eventWithoutPreimage = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "preimage"),
    };
    const preimage = getZapPreimage(eventWithoutPreimage);
    expect(preimage).toBeUndefined();
  });
});

describe("getZapRequest", () => {
  it("should return parsed zap request from description tag", () => {
    const zapRequest = getZapRequest(zapEvent);
    expect(zapRequest).toEqual({
      id: "2813fcc0240532e5dcaafad02b5312fe73d51c8e7a88dbaa56b6049c6f918897",
      pubkey: "55f04590674f3648f4cdc9dc8ce32da2a282074cd0b020596ee033d12d385185",
      content: "",
      kind: 9734,
      created_at: 1749216425,
      tags: [
        ["amount", "121000"],
        ["e", "9199d90f756697b0a3e93be9a526d5890fd1ebf6745875ef96febbb66f6d7a0a"],
        ["p", "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5"],
        ["relays", "wss://relay.snort.social", "wss://nos.lol", "wss://relay.damus.io", "wss://nostr.wine"],
        ["client", "zap.stream", "694dd00"],
      ],
      sig: "2fbabdd5ea3c4342993d29c38187670b7c092c04bb1c15acf5a6d697ef4d5068580594abd033c9ac7ad7908e3a3377f2a2c45d75807419c730bd4d1edf3f4593",
    });
  });

  it("should cache the result using ZapRequestSymbol", () => {
    getZapRequest(zapEvent);
    expect(Reflect.has(zapEvent, ZapRequestSymbol)).toBe(true);
  });

  it("should return undefined if description tag is missing", () => {
    const eventWithoutDescription = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "description"),
    };
    expect(getZapRequest(eventWithoutDescription)).toBe(undefined);
  });
});

describe("isValidZap", () => {
  it("should return true for valid zap event", () => {
    expect(isValidZap(zapEvent)).toBe(true);
  });

  it("should return false for undefined event", () => {
    expect(isValidZap(undefined)).toBe(false);
  });

  it("should return false for wrong kind", () => {
    const wrongKindEvent = { ...zapEvent, kind: 1 };
    expect(isValidZap(wrongKindEvent)).toBe(false);
  });

  it("should return false if zap request is invalid", () => {
    const invalidZapEvent = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "description"),
    };
    expect(isValidZap(invalidZapEvent)).toBe(false);
  });

  it("should return false if recipient is missing", () => {
    const noRecipientEvent = {
      ...zapEvent,
      tags: zapEvent.tags.filter((tag) => tag[0] !== "p"),
    };
    expect(isValidZap(noRecipientEvent)).toBe(false);
  });
});

describe("getZapSplits", () => {
  it("should return undefined when no zap tags are present", () => {
    const splits = getZapSplits(zapEvent);
    expect(splits).toBeUndefined();
  });

  it("should return zap splits with correct percentages", () => {
    const splits = getZapSplits(zapEventWithSplits);
    expect(splits).toEqual([
      { pubkey: "pubkey1", relay: "wss://relay1.com", weight: 0.5, percent: 0.5 },
      { pubkey: "pubkey2", relay: "wss://relay2.com", weight: 0.3, percent: 0.3 },
      { pubkey: "pubkey3", relay: "", weight: 0.2, percent: 0.2 },
    ]);
  });

  it("should filter out invalid weight values", () => {
    const eventWithInvalidWeights = {
      ...zapEvent,
      tags: [
        ...zapEvent.tags,
        ["zap", "pubkey1", "wss://relay1.com", "0.5"],
        ["zap", "pubkey2", "wss://relay2.com", "invalid"],
        ["zap", "pubkey3", "", "0.5"],
        ["zap", "pubkey4", "", "0"],
      ],
    };
    const splits = getZapSplits(eventWithInvalidWeights);
    expect(splits).toEqual([
      { pubkey: "pubkey1", relay: "wss://relay1.com", weight: 0.5, percent: 0.5 },
      { pubkey: "pubkey3", relay: "", weight: 0.5, percent: 0.5 },
      { pubkey: "pubkey4", relay: "", weight: 0, percent: 0 },
    ]);
  });

  it("should handle empty relay field", () => {
    const eventWithEmptyRelay = {
      ...zapEvent,
      tags: [...zapEvent.tags, ["zap", "pubkey1", "", "1.0"]],
    };
    const splits = getZapSplits(eventWithEmptyRelay);
    expect(splits).toEqual([{ pubkey: "pubkey1", relay: "", weight: 1.0, percent: 1.0 }]);
  });
});
