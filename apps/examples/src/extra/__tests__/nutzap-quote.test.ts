import { beforeEach, describe, expect, it, vi } from "vitest";
import type SecureStorage from "../encrypted-storage";

const mocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  checkQuote: vi.fn(),
  completeMint: vi.fn(),
  restore: vi.fn(),
  paid: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  const output = () => ({
    blindedMessage: { B_: "blinded-output", amount: 1 },
    toProof: () => ({ amount: 1, secret: "proof-secret", C: "signature", id: "keyset" }),
  });
  return {
    ...actual,
    Wallet: class {
      mint = { restore: mocks.restore };
      on = { onceMintPaid: mocks.paid };
      ops = { mintBolt11: () => ({ asP2PK: () => ({ prepare: mocks.prepare }) }) };
      async loadMint() {}
      createMintQuoteBolt11 = mocks.createQuote;
      checkMintQuoteBolt11 = mocks.checkQuote;
      completeMint = mocks.completeMint;
      getKeyset() {
        return {};
      }
    },
    OutputData: {
      serialize: () => ({ blindedMessage: { B_: "blinded-output", amount: 1 }, secret: "blinding-secret" }),
      deserialize: output,
    },
  };
});
import { prepareNutzap, resumeNutzap } from "../nutzap-quote";

const input = { mint: "https://mint.example", amount: 1, recipient: "recipient", p2pk: "lock-key", comment: "zap" };
const paidQuote = { quote: "quote-id", request: "invoice", state: "PAID", amount: 1 };
const proof = { amount: 1, secret: "proof-secret", C: "signature", id: "keyset" };
const pendingKey = "example-pending-nutzap";
function storage() {
  const records = new Map<string, string>();
  const adapter = {
    database: {},
    unlocked: true,
    getItem: vi.fn(async (key: string) => records.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
      return true;
    }),
    removeItem: vi.fn(async (key: string) => {
      records.delete(key);
    }),
  };
  return { records, adapter, secure: adapter as unknown as SecureStorage };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createQuote.mockResolvedValue(paidQuote);
  mocks.checkQuote.mockResolvedValue(paidQuote);
  mocks.prepare.mockResolvedValue({
    method: "bolt11",
    payload: { quote: "quote-id", outputs: [{ B_: "blinded-output", amount: 1 }] },
    quote: paidQuote,
    keysetId: "keyset",
    outputData: [{}],
  });
  mocks.completeMint.mockResolvedValue([proof]);
  mocks.restore.mockResolvedValue({
    outputs: [{ B_: "blinded-output", amount: 1 }],
    signatures: [{ amount: 1, id: "keyset" }],
  });
});

describe("durable nutzap quote recovery", () => {
  it("persists the quote before returning an invoice and refuses to overwrite a pending zap", async () => {
    const { secure, records } = storage();
    await prepareNutzap(secure, input);
    expect(JSON.parse(records.get(pendingKey)!).quote.quote).toBe("quote-id");
    await expect(prepareNutzap(secure, input)).rejects.toThrow("Resume the pending zap");
    expect(mocks.createQuote).toHaveBeenCalledTimes(1);
  });

  it("persists exact outputs before minting, restores an issued quote, and retains tokens until publish succeeds", async () => {
    const { secure, records } = storage();
    await prepareNutzap(secure, input);
    mocks.completeMint.mockImplementationOnce(async () => {
      expect(JSON.parse(records.get(pendingKey)!).preview.outputData[0].secret).toBe("blinding-secret");
      throw new Error("Connection lost after issuance");
    });
    const publish = vi.fn().mockRejectedValueOnce(new Error("Relay rejected"));
    await expect(resumeNutzap(secure, publish, vi.fn())).rejects.toThrow("Connection lost");
    expect(records.has(pendingKey)).toBe(true);
    mocks.checkQuote.mockResolvedValue({ ...paidQuote, state: "ISSUED" });
    await expect(resumeNutzap(secure, publish, vi.fn())).rejects.toThrow("Relay rejected");
    expect(mocks.restore).toHaveBeenCalledWith({ outputs: [{ B_: "blinded-output", amount: 1 }] });
    expect(JSON.parse(records.get(pendingKey)!).token.proofs).toEqual([proof]);
    publish.mockResolvedValueOnce(undefined);
    await resumeNutzap(secure, publish, vi.fn());
    expect(records.has(pendingKey)).toBe(false);
    expect(mocks.completeMint).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it("keeps unpaid quotes available after a payment-wait timeout", async () => {
    const { secure, records } = storage();
    await prepareNutzap(secure, input);
    mocks.checkQuote.mockResolvedValue({ ...paidQuote, state: "UNPAID" });
    mocks.paid.mockRejectedValueOnce(new Error("Timeout"));
    await expect(resumeNutzap(secure, vi.fn(), vi.fn())).rejects.toThrow("Timeout");
    expect(records.has(pendingKey)).toBe(true);
    expect(mocks.completeMint).not.toHaveBeenCalled();
  });

  it("stops before minting when the prepared outputs cannot be persisted", async () => {
    const { secure, adapter } = storage();
    await prepareNutzap(secure, input);
    adapter.setItem.mockResolvedValueOnce(false);
    await expect(resumeNutzap(secure, vi.fn(), vi.fn())).rejects.toThrow("persist zap recovery");
    expect(mocks.completeMint).not.toHaveBeenCalled();
  });
});
