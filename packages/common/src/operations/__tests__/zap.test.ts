import { kinds, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { setBolt11, setPreimage, setRequest } from "../zap.js";

const sender = new FakeUser();
const recipient = new FakeUser();

/** Builds a minimal valid zap request signed by `sender` targeting `recipient` */
function makeZapRequest(extra?: { eventId?: string; amount?: string; kind?: number }) {
  return sender.event({
    kind: kinds.ZapRequest,
    tags: [
      ["relays", "wss://relay.example.com"],
      ["p", recipient.pubkey],
      ...(extra?.eventId ? [["e", extra.eventId]] : []),
      ...(extra?.amount ? [["amount", extra.amount]] : []),
      ...(extra?.kind !== undefined ? [["k", String(extra.kind)]] : []),
    ],
  });
}

const emptyZap = () => ({ kind: kinds.Zap, created_at: unixNow(), tags: [] as string[][], content: "" });

describe("setBolt11", () => {
  it("sets the bolt11 tag", async () => {
    const invoice = "lnbc10u1abc";
    const result = await setBolt11(invoice)(emptyZap(), {});
    expect(result.tags).toContainEqual(["bolt11", invoice]);
  });

  it("replaces an existing bolt11 tag", async () => {
    const draft = { kind: kinds.Zap, created_at: unixNow(), tags: [["bolt11", "old"]], content: "" };
    const result = await setBolt11("new")(draft, {});
    const bolt11Tags = result.tags.filter((t) => t[0] === "bolt11");
    expect(bolt11Tags).toHaveLength(1);
    expect(bolt11Tags[0][1]).toBe("new");
  });
});

describe("setPreimage", () => {
  it("sets the preimage tag", async () => {
    const result = await setPreimage("abc123")(emptyZap(), {});
    expect(result.tags).toContainEqual(["preimage", "abc123"]);
  });
});

describe("setRequest", () => {
  it("throws for an invalid zap request", () => {
    const invalid = sender.event({ kind: kinds.ShortTextNote, tags: [] });
    expect(() => setRequest(invalid)).toThrow("Invalid zap request event");
  });

  it("sets the description tag to the JSON-encoded zap request", async () => {
    const zapRequest = makeZapRequest();
    const result = await setRequest(zapRequest)(emptyZap(), {});
    const description = result.tags.find((t) => t[0] === "description");
    expect(description).toBeDefined();
    expect(JSON.parse(description![1])).toMatchObject({ id: zapRequest.id });
  });

  it("sets the P tag to the zap request sender pubkey", async () => {
    const zapRequest = makeZapRequest();
    const result = await setRequest(zapRequest)(emptyZap(), {});
    expect(result.tags).toContainEqual(["P", sender.pubkey]);
  });

  it("copies the p tag (recipient) from the zap request", async () => {
    const zapRequest = makeZapRequest();
    const result = await setRequest(zapRequest)(emptyZap(), {});
    expect(result.tags).toContainEqual(["p", recipient.pubkey]);
  });

  it("copies the e tag from the zap request when present", async () => {
    const eventId = "a".repeat(64);
    const zapRequest = makeZapRequest({ eventId });
    const result = await setRequest(zapRequest)(emptyZap(), {});
    expect(result.tags).toContainEqual(["e", eventId]);
  });

  it("copies the amount tag from the zap request when present", async () => {
    const zapRequest = makeZapRequest({ amount: "21000" });
    const result = await setRequest(zapRequest)(emptyZap(), {});
    expect(result.tags).toContainEqual(["amount", "21000"]);
  });

  it("copies the k tag from the zap request when present", async () => {
    const zapRequest = makeZapRequest({ kind: 1 });
    const result = await setRequest(zapRequest)(emptyZap(), {});
    expect(result.tags).toContainEqual(["k", "1"]);
  });

  it("does not duplicate copied tags when receipt already has them", async () => {
    const eventId = "a".repeat(64);
    const zapRequest = makeZapRequest({ eventId, amount: "21000" });
    // Pre-populate the draft with stale copies of the same tags
    const draft = {
      kind: kinds.Zap,
      created_at: unixNow(),
      content: "",
      tags: [
        ["p", "stale_pubkey"],
        ["e", "stale_event_id".padEnd(64, "0")],
        ["amount", "0"],
      ],
    };
    const result = await setRequest(zapRequest)(draft, {});
    expect(result.tags.filter((t) => t[0] === "p")).toHaveLength(1);
    expect(result.tags.filter((t) => t[0] === "e")).toHaveLength(1);
    expect(result.tags.filter((t) => t[0] === "amount")).toHaveLength(1);
  });

  it("preserves non-copied tags already on the receipt", async () => {
    const zapRequest = makeZapRequest();
    const draft = { kind: kinds.Zap, created_at: unixNow(), content: "", tags: [["bolt11", "lnbc10u1abc"]] };
    const result = await setRequest(zapRequest)(draft, {});
    expect(result.tags).toContainEqual(["bolt11", "lnbc10u1abc"]);
  });
});
