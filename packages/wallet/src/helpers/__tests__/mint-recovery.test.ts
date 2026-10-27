import { Amount, serializeProofs, type Token } from "@cashu/cashu-ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ISigner } from "applesauce-signers";
import { MintRecovery } from "../mint-recovery.js";
import { KeyValueCouch } from "../key-value-couch.js";

const mocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  checkQuote: vi.fn(),
  prepare: vi.fn(),
  completeMint: vi.fn(),
  restore: vi.fn(),
  paid: vi.fn(),
  tokenSign: vi.fn(),
  historySign: vi.fn(),
  zapSign: vi.fn(),
  p2pk: vi.fn(),
  supported: true,
  websocket: true,
}));

vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  return {
    ...actual,
    Wallet: class {
      mint = { restore: mocks.restore };
      on = { onceMintPaid: mocks.paid };
      ops = {
        mintBolt11: () => ({
          prepare: mocks.prepare,
          asP2PK: (options: unknown) => {
            mocks.p2pk(options);
            return { prepare: mocks.prepare };
          },
        }),
      };
      async loadMint() {}
      createMintQuoteBolt11 = mocks.createQuote;
      checkMintQuoteBolt11 = mocks.checkQuote;
      completeMint = mocks.completeMint;
      async ensureOperableKeysets() {}
      getMintInfo() {
        return { isSupported: (nut: number) => ({ supported: nut === 17 ? mocks.websocket : mocks.supported }) };
      }
      getKeyset() {
        return {};
      }
    },
    OutputData: {
      createSingleP2PKData: actual.OutputData.createSingleP2PKData,
      serialize: (output: { blindedMessage: object; secret: string }) => output,
      deserialize: (output: { blindedMessage: { B_: string; amount: string; id: string }; secret: string }) => ({
        ...output,
        toProof: (signature: { C_: string }) => ({
          id: output.blindedMessage.id,
          amount: actual.Amount.from(output.blindedMessage.amount),
          secret: output.secret,
          C: signature.C_,
        }),
      }),
    },
  };
});
vi.mock("../../factories/tokens.js", () => ({ WalletTokenFactory: { create: () => ({ sign: mocks.tokenSign }) } }));
vi.mock("../../factories/history.js", () => ({
  WalletHistoryFactory: { create: () => ({ sign: mocks.historySign }) },
}));
vi.mock("../../factories/nutzap.js", () => ({
  NutzapFactory: {
    forProfile: () => ({ sign: mocks.zapSign }),
    forEvent: () => ({ sign: mocks.zapSign }),
  },
}));

const input = { mint: "https://mint.example", amount: 3 };
const lockKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const quote = () => ({
  quote: "quote-id",
  request: "invoice",
  state: "PAID",
  unit: "sat",
  amount: Amount.from(3),
  expiry: null,
});
const proofs = (): Token["proofs"] => [
  { id: "keyset", amount: Amount.from(1), secret: "first", C: "signature-1" },
  { id: "keyset", amount: Amount.from(2), secret: "second", C: "signature-2" },
];

function fixture() {
  const records = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => records.get(key) ?? null),
    keys: vi.fn(async () => [...records.keys()]),
    setItem: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
      return true;
    }),
    removeItem: vi.fn(async (key: string) => {
      records.delete(key);
    }),
  };
  const signer = { getPublicKey: vi.fn(async () => "owner") } as unknown as ISigner;
  const publish = vi.fn(async () => {});
  const onAccepted = vi.fn();
  const options = { storage, owner: "owner", signer, publish, onAccepted };
  const recovery = new MintRecovery(options);
  const saved = () => JSON.parse([...records.values()][0]);
  return { records, storage, signer, publish, onAccepted, options, recovery, saved };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supported = true;
  mocks.websocket = true;
  mocks.createQuote.mockResolvedValue(quote());
  mocks.checkQuote.mockResolvedValue(quote());
  mocks.prepare.mockResolvedValue({
    method: "bolt11",
    keysetId: "keyset",
    quote: quote(),
    payload: { quote: "quote-id", outputs: [] },
    outputData: proofs().map((proof, index) => ({
      blindedMessage: { B_: `blinded-${index}`, id: "keyset", amount: proof.amount.toString() },
      secret: proof.secret,
    })),
  });
  mocks.completeMint.mockResolvedValue(proofs());
  mocks.restore.mockResolvedValue({
    outputs: [{ B_: "blinded-1" }, { B_: "blinded-0" }],
    signatures: [
      { amount: Amount.from(2), id: "keyset", C_: "signature-2" },
      { amount: Amount.from(1), id: "keyset", C_: "signature-1" },
    ],
  });
  mocks.tokenSign.mockResolvedValue({ id: "token-id", pubkey: "owner", kind: 7375 });
  mocks.historySign.mockResolvedValue({ id: "history-id", pubkey: "owner", kind: 7376 });
  mocks.zapSign.mockResolvedValue({ id: "zap-id", pubkey: "owner", kind: 9321 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("durable mint recovery", () => {
  it("persists the quote before exposing its invoice and discovers it in a new session", async () => {
    const { recovery, options, saved } = fixture();
    const pending = await recovery.prepare(input);
    expect(saved().quote.quote).toBe(pending.quote.quote);
    const restarted = new MintRecovery(options);
    expect(await restarted.getPending()).toEqual([pending]);
    await expect(
      restarted.resume(pending.id, {
        onQuote: () => {
          throw new Error("UI closed");
        },
      }),
    ).rejects.toThrow("UI closed");
    expect(mocks.completeMint).not.toHaveBeenCalled();
    expect(await restarted.getPending()).toHaveLength(1);
  });

  it("rejects inaccessible storage and mints without restore support before creating an invoice", async () => {
    const { recovery, storage } = fixture();
    storage.getItem.mockRejectedValueOnce(new Error("locked"));
    await expect(recovery.prepare(input)).rejects.toThrow("locked");
    mocks.supported = false;
    await expect(recovery.prepare(input)).rejects.toThrow("NUT-09");
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("does not mint when saving exact outputs fails", async () => {
    const { recovery, storage, saved } = fixture();
    const pending = await recovery.prepare(input);
    storage.setItem.mockResolvedValueOnce(false);
    await expect(recovery.resume(pending.id)).rejects.toThrow("Could not persist");
    expect(mocks.completeMint).not.toHaveBeenCalled();
    expect(saved().preview).toBeUndefined();
  });

  it("restores reordered outputs after a lost response and republishes the same signed event ids", async () => {
    const { recovery, options, publish, saved, records } = fixture();
    const pending = await recovery.prepare(input);
    mocks.completeMint.mockImplementationOnce(async () => {
      expect(saved().preview.outputData.map((output: { secret: string }) => output.secret)).toEqual([
        "first",
        "second",
      ]);
      throw new Error("response lost");
    });
    await expect(recovery.resume(pending.id)).rejects.toThrow("response lost");
    mocks.checkQuote.mockResolvedValue({ ...quote(), state: "ISSUED" });
    publish.mockRejectedValueOnce(new Error("relay rejected"));
    await expect(new MintRecovery(options).resume(pending.id)).rejects.toThrow("relay rejected");
    expect(saved().token.proofs).toHaveLength(2);
    await new MintRecovery(options).resume(pending.id);
    expect(publish.mock.calls.map((call) => (call as unknown as [{ id: string }])[0].id)).toEqual([
      "token-id",
      "token-id",
      "history-id",
    ]);
    expect(mocks.completeMint).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.tokenSign).toHaveBeenCalledTimes(1);
    expect(records.size).toBe(0);
  });

  it("retains outputs when persisting minted proofs fails", async () => {
    const { recovery, storage, records, saved } = fixture();
    const pending = await recovery.prepare(input);
    storage.setItem.mockImplementation(async (key, value) => {
      if (JSON.parse(value).token) return false;
      records.set(key, value);
      return true;
    });
    await expect(recovery.resume(pending.id)).rejects.toThrow("persist");
    expect(saved().preview).toBeDefined();
    expect(saved().token).toBeUndefined();
    expect(mocks.tokenSign).not.toHaveBeenCalled();
  });

  it.each(["missing", "duplicate", "amount", "keyset"])(
    "preserves outputs on an invalid %s restore response",
    async (failure) => {
      const { recovery, saved } = fixture();
      const pending = await recovery.prepare(input);
      mocks.completeMint.mockRejectedValueOnce(new Error("lost"));
      await expect(recovery.resume(pending.id)).rejects.toThrow("lost");
      mocks.checkQuote.mockResolvedValue({ ...quote(), state: "ISSUED" });
      const outputs =
        failure === "missing" ? [] : [{ B_: "blinded-0" }, { B_: failure === "duplicate" ? "blinded-0" : "blinded-1" }];
      mocks.restore.mockResolvedValue({
        outputs,
        signatures: [
          { amount: Amount.from(failure === "amount" ? 2 : 1), id: failure === "keyset" ? "other" : "keyset" },
          { amount: Amount.from(2), id: "keyset" },
        ],
      });
      await expect(recovery.resume(pending.id)).rejects.toThrow();
      expect(saved().preview.outputData).toHaveLength(2);
      expect(saved().token).toBeUndefined();
    },
  );

  it("retains signed events when their write fails and does not publish", async () => {
    const { recovery, storage, records, saved, publish } = fixture();
    const pending = await recovery.prepare(input);
    storage.setItem.mockImplementation(async (key, value) => {
      if (JSON.parse(value).events) return false;
      records.set(key, value);
      return true;
    });
    await expect(recovery.resume(pending.id)).rejects.toThrow("persist");
    expect(saved().token).toBeDefined();
    expect(publish).not.toHaveBeenCalled();
  });

  it("records partial acceptance and restores already accepted events to a restarted session", async () => {
    const { recovery, publish, options, saved, onAccepted } = fixture();
    const pending = await recovery.prepare(input);
    publish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("history rejected"));
    await expect(recovery.resume(pending.id)).rejects.toThrow("history rejected");
    expect(saved().accepted).toEqual(["token-id"]);
    onAccepted.mockClear();
    await new MintRecovery(options).resume(pending.id);
    expect(onAccepted.mock.calls.map(([event]) => event.id)).toEqual(["token-id", "history-id"]);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("retries cleanup without minting or publishing again", async () => {
    const { recovery, storage, publish } = fixture();
    const pending = await recovery.prepare(input);
    storage.removeItem.mockRejectedValueOnce(new Error("delete failed"));
    await expect(recovery.resume(pending.id)).rejects.toThrow("delete failed");
    await recovery.resume(pending.id);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(mocks.completeMint).toHaveBeenCalledTimes(1);
  });

  it("keeps proofs out of the spendable couch and refuses a switched signer", async () => {
    const { recovery, storage, publish, saved } = fixture();
    const couch = new KeyValueCouch(storage);
    const pending = await recovery.prepare(input);
    mocks.historySign.mockResolvedValueOnce({ id: "history-id", pubkey: "another-owner" });
    await expect(recovery.resume(pending.id)).rejects.toThrow("active signer changed");
    expect(saved().token.proofs).toHaveLength(2);
    expect(await couch.getAll()).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("aborts without deleting state and prevents concurrent resume across instances", async () => {
    const { recovery, options } = fixture();
    const pending = await recovery.prepare(input);
    const signal = AbortSignal.abort();
    await expect(recovery.resume(pending.id, { signal })).rejects.toThrow();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = recovery.resume(pending.id, { onQuote: () => blocked });
    await expect(new MintRecovery(options).resume(pending.id)).rejects.toThrow("already running");
    release();
    await running;
  });

  it("preserves unpaid quotes after a timeout", async () => {
    const { recovery } = fixture();
    const pending = await recovery.prepare(input);
    mocks.checkQuote.mockResolvedValue({ ...quote(), state: "UNPAID" });
    mocks.paid.mockRejectedValueOnce(new Error("timeout"));
    await expect(recovery.resume(pending.id)).rejects.toThrow("timeout");
    expect(await recovery.getPending()).toHaveLength(1);
  });

  it("supports independent pending operations and owner isolation", async () => {
    const { recovery, options } = fixture();
    await recovery.prepare(input);
    mocks.createQuote.mockResolvedValueOnce({ ...quote(), quote: "second-quote" });
    await recovery.prepare(input);
    expect(await recovery.getPending()).toHaveLength(2);
    expect(await new MintRecovery({ ...options, owner: "another-owner" }).getPending()).toEqual([]);
  });

  it("refuses issued quotes without saved outputs and mismatched quote amounts", async () => {
    const { recovery, saved } = fixture();
    const pending = await recovery.prepare(input);
    mocks.checkQuote.mockResolvedValueOnce({ ...quote(), amount: Amount.from(4) });
    await expect(recovery.resume(pending.id)).rejects.toThrow("does not match");
    mocks.checkQuote.mockResolvedValueOnce({ ...quote(), state: "ISSUED" });
    await expect(recovery.resume(pending.id)).rejects.toThrow("without saved outputs");
    expect(saved().quote).toBeDefined();
  });

  it("mints P2PK-locked nutzaps and retains the signed event until publication succeeds", async () => {
    const { recovery, publish, saved } = fixture();
    const pending = await recovery.prepare({
      ...input,
      nutzap: { recipient: "recipient", p2pk: lockKey, relays: ["wss://recipient"], comment: "zap" },
    });
    publish.mockRejectedValueOnce(new Error("rejected"));
    await expect(recovery.resume(pending.id)).rejects.toThrow("rejected");
    expect(mocks.p2pk).toHaveBeenCalledWith({ pubkey: lockKey });
    expect(saved().events).toHaveLength(1);
    await recovery.resume(pending.id);
    expect(mocks.zapSign).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ id: "zap-id" }), ["wss://recipient"]);
  });

  it("imports legacy deposits copy-before-delete", async () => {
    const { recovery, storage, records } = fixture();
    const pending = await recovery.prepare(input);
    const legacy = JSON.parse([...records.values()][0]);
    records.clear();
    delete legacy.version;
    delete legacy.id;
    records.set("legacy", JSON.stringify(legacy));
    storage.setItem.mockResolvedValueOnce(false);
    const couch = new KeyValueCouch(storage);
    await expect(recovery.importLegacyDeposit("legacy", couch)).rejects.toThrow("persist");
    expect(records.has("legacy")).toBe(true);
    await recovery.importLegacyDeposit("legacy", couch);
    expect(records.has("legacy")).toBe(false);
    expect((await recovery.getPending())[0].id).toBe(pending.id);
  });

  it("removes legacy couch duplicates while retaining their journal until migration is durable", async () => {
    const { recovery, storage, records, saved } = fixture();
    await recovery.prepare(input);
    const legacy = { ...saved(), token: { mint: input.mint, unit: "sat", proofs: serializeProofs(proofs()) } };
    records.clear();
    delete legacy.version;
    delete legacy.id;
    records.set("legacy", JSON.stringify(legacy));
    const couch = new KeyValueCouch(storage);
    await couch.store({ mint: input.mint, unit: "sat", proofs: proofs() });
    storage.setItem.mockResolvedValueOnce(false);
    await expect(recovery.importLegacyDeposit("legacy", couch)).rejects.toThrow("persist");
    expect(records.has("legacy")).toBe(true);
    expect(await couch.getAll()).toHaveLength(1);
    await recovery.importLegacyDeposit("legacy", couch);
    expect(records.has("legacy")).toBe(false);
    expect(await couch.getAll()).toEqual([]);
    expect((await recovery.getPending())[0].stage).toBe("proofs");
  });

  it("rejects invalid P2PK locks before creating a payable invoice", async () => {
    const { recovery } = fixture();
    await expect(
      recovery.prepare({ ...input, nutzap: { recipient: "recipient", p2pk: "invalid", relays: [] } }),
    ).rejects.toThrow();
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("retains the same events when persisting publication acceptance fails", async () => {
    const { recovery, storage, records, saved, publish } = fixture();
    const pending = await recovery.prepare(input);
    storage.setItem.mockImplementation(async (key, value) => {
      if (JSON.parse(value).accepted?.length) return false;
      records.set(key, value);
      return true;
    });
    await expect(recovery.resume(pending.id)).rejects.toThrow("persist");
    expect(saved().events[0].id).toBe("token-id");
    expect(saved().accepted).toEqual([]);
    storage.setItem.mockImplementation(async (key, value) => {
      records.set(key, value);
      return true;
    });
    await recovery.resume(pending.id);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(mocks.tokenSign).toHaveBeenCalledTimes(1);
  });

  it("preserves malformed records instead of overwriting them", async () => {
    const { recovery, records, storage } = fixture();
    const pending = await recovery.prepare(input);
    const key = [...records.keys()][0];
    records.set(key, JSON.stringify({ version: 999 }));
    storage.setItem.mockClear();
    await expect(recovery.getPending()).rejects.toThrow("Invalid recovery");
    await expect(recovery.resume(pending.id)).rejects.toThrow("Invalid recovery");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("uses consumer-provided cross-process locks", async () => {
    const { options } = fixture();
    const lock = vi.fn();
    const storage = {
      ...options.storage,
      async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
        lock(key);
        return operation();
      },
    };
    const recovery = new MintRecovery({ ...options, storage });
    const pending = await recovery.prepare(input);
    await recovery.resume(pending.id);
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it("preserves state when the storage adapter rejects a cross-context lock", async () => {
    const { recovery, options } = fixture();
    const pending = await recovery.prepare(input);
    const locked = new MintRecovery({
      ...options,
      storage: {
        ...options.storage,
        async withLock() {
          throw new Error("Locked in another tab");
        },
      },
    });
    await expect(locked.resume(pending.id)).rejects.toThrow("another tab");
    expect(mocks.completeMint).not.toHaveBeenCalled();
  });

  it("does not share operation locks between independent stores with identical record keys", async () => {
    const first = fixture();
    const second = fixture();
    const pending = await first.recovery.prepare(input);
    await second.recovery.prepare(input);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = first.recovery.resume(pending.id, { onQuote: () => blocked });
    try {
      await second.recovery.resume(pending.id);
    } finally {
      release();
      await running;
    }
    expect(first.records.size).toBe(0);
    expect(second.records.size).toBe(0);
  });

  it("polls mints without WebSocket support and leaves timed-out invoices pending", async () => {
    vi.useFakeTimers();
    const { recovery } = fixture();
    const pending = await recovery.prepare(input);
    mocks.websocket = false;
    mocks.checkQuote.mockResolvedValue({ ...quote(), state: "UNPAID" });
    const running = expect(recovery.resume(pending.id, { timeoutMs: 3000 })).rejects.toThrow("Timed out");
    await vi.advanceTimersByTimeAsync(3000);
    await running;
    expect(mocks.paid).not.toHaveBeenCalled();
    expect(await recovery.getPending()).toHaveLength(1);
  });

  it("imports legacy nutzap proofs and resolves relays for the saved recipient", async () => {
    const { recovery, publish } = fixture();
    const legacyStorage = fixture();
    legacyStorage.records.set(
      "legacy-zap",
      JSON.stringify({
        ...input,
        recipient: "saved-recipient",
        p2pk: lockKey,
        comment: "old comment",
        quote: quote(),
        token: { mint: input.mint, unit: "sat", proofs: proofs() },
      }),
    );
    const getRelays = vi.fn(async () => ["wss://saved-recipient"]);
    const pending = await recovery.importLegacyNutzap("legacy-zap", getRelays, legacyStorage.storage);
    expect(getRelays).toHaveBeenCalledWith("saved-recipient");
    expect(legacyStorage.records.has("legacy-zap")).toBe(false);
    await recovery.resume(pending!.id);
    expect(mocks.completeMint).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: "zap-id" }), ["wss://saved-recipient"]);
  });

  it("imports a legacy deposit from a separate app store", async () => {
    const legacy = fixture();
    const current = fixture();
    await legacy.recovery.prepare(input);
    const record = legacy.saved();
    legacy.records.clear();
    delete record.version;
    delete record.id;
    legacy.records.set("legacy-deposit", JSON.stringify(record));
    await current.recovery.importLegacyDeposit("legacy-deposit", new KeyValueCouch(current.storage), legacy.storage);
    expect(legacy.records.size).toBe(0);
    expect(await current.recovery.getPending()).toHaveLength(1);
  });
});
