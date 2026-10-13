import { Amount, type Token } from "@cashu/cashu-ts";
import type { NutWallet } from "applesauce-wallet/wallet";
import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type SecureStorage from "../encrypted-storage";

const mocks = vi.hoisted(() => ({
  checkQuote: vi.fn(),
  prepare: vi.fn(),
  completeMint: vi.fn(),
  restore: vi.fn(),
  publish: vi.fn(),
  tokenSign: vi.fn(),
  historySign: vi.fn(),
  signerPubkey: "owner",
}));
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  return {
    ...actual,
    Wallet: class {
      mint = { restore: mocks.restore };
      ops = { mintBolt11: () => ({ prepare: mocks.prepare }) };
      async loadMint() {}
      checkMintQuoteBolt11 = mocks.checkQuote;
      completeMint = mocks.completeMint;
      getKeyset() {
        return {};
      }
    },
    OutputData: {
      serialize: (output: {
        blindedMessage: { amount: unknown; B_: string; id: string };
        secret: string;
        blindingFactor: bigint;
      }) => ({
        blindedMessage: { ...output.blindedMessage, amount: String(output.blindedMessage.amount) },
        secret: output.secret,
        blindingFactor: String(output.blindingFactor),
      }),
      deserialize: (output: { blindedMessage: { amount: string; B_: string; id: string }; secret: string }) => ({
        blindedMessage: { ...output.blindedMessage, amount: actual.Amount.from(output.blindedMessage.amount) },
        toProof: (signature: { C: string }) => ({
          id: output.blindedMessage.id,
          amount: actual.Amount.from(output.blindedMessage.amount),
          secret: output.secret,
          C: signature.C,
        }),
      }),
    },
  };
});
vi.mock("applesauce-wallet/helpers", () => ({
  getProofUID: (proof: { id: string; amount: unknown; secret: string; C: string }) =>
    proof.id + String(proof.amount) + proof.C + proof.secret,
  IndexedDBCouch: class {},
}));
vi.mock("applesauce-wallet/factories", () => ({
  WalletTokenFactory: { create: () => ({ sign: mocks.tokenSign }) },
  WalletHistoryFactory: { create: () => ({ sign: mocks.historySign }) },
}));
vi.mock("../publish", () => ({ publishEvent: mocks.publish }));
import { recoverableDeposit, resumeDeposit } from "../deposit-recovery";
import { createEncryptedCouch } from "../encrypted-couch";

const mint = "https://mint.example";
const pendingKey = "example-deposit:owner";
const quote = () => ({
  quote: "quote-id",
  request: "invoice",
  state: "PAID",
  amount: Amount.from(3),
  unit: "sat",
  expiry: null,
});
const proofs = (): Token["proofs"] => [
  { id: "keyset", amount: Amount.from(1), secret: "first-secret", C: "first-signature" },
  { id: "keyset", amount: Amount.from(2), secret: "second-secret", C: "second-signature" },
];
function fixture() {
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
  const secure = adapter as unknown as SecureStorage;
  const wallet = {
    pubkey: "owner",
    signer: { getPublicKey: vi.fn(async () => "owner") },
    couch: createEncryptedCouch(() => secure, "owner"),
    relays$: of(["wss://relay.example"]),
    createMintQuote: vi.fn(async () => quote()),
    waitForMintQuote: vi.fn(async () => quote()),
    pool: {},
    eventStore: { add: vi.fn() },
  } as unknown as NutWallet;
  return { secure, adapter, records, wallet };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signerPubkey = "owner";
  mocks.checkQuote.mockImplementation(async () => quote());
  mocks.prepare.mockImplementation(async () => ({
    method: "bolt11",
    keysetId: "keyset",
    quote: quote(),
    payload: { quote: "quote-id", outputs: [] },
    outputData: proofs().map((proof, index) => ({
      blindedMessage: { B_: `blinded-${index}`, id: proof.id, amount: proof.amount },
      secret: proof.secret,
      blindingFactor: BigInt(index + 1),
    })),
  }));
  mocks.completeMint.mockImplementation(async () => proofs());
  mocks.restore.mockResolvedValue({
    outputs: [{ B_: "blinded-1" }, { B_: "blinded-0" }],
    signatures: [{ C: "second-signature" }, { C: "first-signature" }],
  });
  mocks.publish.mockResolvedValue([{ ok: true }]);
  mocks.tokenSign.mockImplementation(async () => ({ id: "signed-token", pubkey: mocks.signerPubkey, kind: 7375 }));
  mocks.historySign.mockImplementation(async () => ({ id: "signed-history", pubkey: mocks.signerPubkey, kind: 7376 }));
});

describe("durable deposits", () => {
  it("saves the quote before displaying the invoice and refuses to overwrite unresolved deposits", async () => {
    const { secure, wallet, records } = fixture();
    const onQuote = vi.fn(async (value) => {
      expect(JSON.parse(records.get(pendingKey)!).quote.quote).toBe(value.quote);
      expect(value.amount).toBeInstanceOf(Amount);
      throw new Error("Stop after displaying the invoice");
    });
    await expect(recoverableDeposit(secure, wallet, { mint, amount: 3, onQuote })).rejects.toThrow("Stop after");
    await expect(recoverableDeposit(secure, wallet, { mint, amount: 3 })).rejects.toThrow("Resume the pending");
    expect(wallet.createMintQuote).toHaveBeenCalledTimes(1);
    expect(mocks.completeMint).not.toHaveBeenCalled();
  });

  it("does not issue proofs if persisting exact outputs fails", async () => {
    const { secure, wallet, adapter, records } = fixture();
    adapter.setItem.mockImplementation(async (key, value) => {
      if (key === pendingKey && JSON.parse(value).preview) return false;
      records.set(key, value);
      return true;
    });
    await expect(recoverableDeposit(secure, wallet, { mint, amount: 3 })).rejects.toThrow("Could not persist");
    expect(mocks.completeMint).not.toHaveBeenCalled();
    expect(JSON.parse(records.get(pendingKey)!).quote.quote).toBe("quote-id");
  });

  it("restores issued outputs by blinded-message identity, retains proofs on rejection, and reuses signed ids", async () => {
    const { secure, wallet, records } = fixture();
    mocks.completeMint.mockImplementationOnce(async () => {
      const saved = JSON.parse(records.get(pendingKey)!);
      expect(saved.preview.outputData.map((output: { secret: string }) => output.secret)).toEqual([
        "first-secret",
        "second-secret",
      ]);
      throw new Error("Connection lost after mint issued proofs");
    });
    await expect(recoverableDeposit(secure, wallet, { mint, amount: 3 })).rejects.toThrow("Connection lost");
    mocks.checkQuote.mockImplementation(async () => ({ ...quote(), state: "ISSUED" }));
    mocks.publish.mockRejectedValueOnce(new Error("Relay rejected"));
    await expect(resumeDeposit(secure, wallet)).rejects.toThrow("Relay rejected");
    const pending = JSON.parse(records.get(pendingKey)!);
    expect(pending.events.map((event: { id: string }) => event.id)).toEqual(["signed-token", "signed-history"]);
    expect((await wallet.couch.getAll())[0].proofs.map((proof) => proof.secret)).toEqual([
      "second-secret",
      "first-secret",
    ]);
    expect((await wallet.couch.getAll())[0].proofs[0].amount).toBeInstanceOf(Amount);
    await resumeDeposit(secure, wallet);
    expect(mocks.completeMint).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.tokenSign).toHaveBeenCalledTimes(1);
    expect(mocks.historySign).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls.map((call) => call[2].id)).toEqual([
      "signed-token",
      "signed-token",
      "signed-history",
    ]);
    expect(wallet.eventStore.add).toHaveBeenCalledTimes(2);
    expect(await wallet.couch.getAll()).toEqual([]);
    expect(records.has(pendingKey)).toBe(false);
  });

  it("retains exact outputs if an issued quote restores unknown or missing outputs", async () => {
    const { secure, wallet, records } = fixture();
    mocks.completeMint.mockRejectedValueOnce(new Error("Issued but response lost"));
    await expect(recoverableDeposit(secure, wallet, { mint, amount: 3 })).rejects.toThrow("response lost");
    mocks.checkQuote.mockImplementation(async () => ({ ...quote(), state: "ISSUED" }));
    mocks.restore.mockResolvedValue({ outputs: [{ B_: "unknown" }, { B_: "blinded-0" }], signatures: [{}, {}] });
    await expect(resumeDeposit(secure, wallet)).rejects.toThrow("unknown or repeated");
    expect(JSON.parse(records.get(pendingKey)!).preview.outputData).toHaveLength(2);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("preserves minted tokens and refuses to publish if the proxy signer switches accounts", async () => {
    const { secure, wallet, records } = fixture();
    mocks.signerPubkey = "another-owner";
    await expect(recoverableDeposit(secure, wallet, { mint, amount: 3 })).rejects.toThrow("active signer changed");
    expect(JSON.parse(records.get(pendingKey)!).token.proofs).toHaveLength(2);
    expect(await wallet.couch.getAll()).toHaveLength(1);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
