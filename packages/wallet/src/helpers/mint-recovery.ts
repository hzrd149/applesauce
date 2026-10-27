import {
  Amount,
  OutputData,
  Wallet,
  deserializeProofs,
  serializeProofs,
  sumProofs,
  type MintPreview,
  type MintQuoteBolt11Response,
  type SerializedOutputData,
  type Token,
} from "@cashu/cashu-ts";
import type { NostrEvent } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import { WalletTokenFactory } from "../factories/tokens.js";
import { WalletHistoryFactory } from "../factories/history.js";
import { NutzapFactory } from "../factories/nutzap.js";
import { saveRecovery, withRecoveryLock, type RecoveryStorage } from "./recovery-storage.js";
import type { Couch } from "./couch.js";
import { tokenIdentity } from "./key-value-couch.js";
import { WALLET_TOKEN_KIND } from "./tokens.js";
import { WALLET_HISTORY_KIND } from "./history.js";
import { NUTZAP_KIND } from "./nutzap.js";

type StoredQuote = Omit<MintQuoteBolt11Response, "amount"> & { amount: string };
type StoredPreview = Omit<MintPreview<MintQuoteBolt11Response>, "outputData" | "quote" | "payload"> & {
  quote: StoredQuote;
  payload: Omit<MintPreview["payload"], "outputs">;
  outputData: SerializedOutputData[];
};

/** Options for preparing a durable bolt11 deposit or invoice-funded nutzap */
export interface PrepareMintOptions {
  /** The mint URL */
  mint: string;
  /** The positive integer amount in sats */
  amount: number;
  /** The optional invoice description */
  description?: string;
  /** The nutzap destination; omitted for a wallet deposit */
  nutzap?: {
    /** The recipient's Nostr public key */
    recipient: string;
    /** The recipient's Cashu P2PK key */
    p2pk: string;
    /** The recipient's delivery relays */
    relays: string[];
    /** The optional comment */
    comment?: string;
    /** The optional event being zapped */
    event?: NostrEvent;
  };
}

/** Public metadata for a pending mint, without secrets, proofs, or private wallet events */
export interface PendingMint extends PrepareMintOptions {
  /** The stable operation identifier */
  id: string;
  /** The operation owner's public key */
  owner: string;
  /** The persisted invoice */
  quote: MintQuoteBolt11Response;
  /** The last durable stage */
  stage: "quote" | "outputs" | "proofs" | "events";
}

type MintRecord = PrepareMintOptions & {
  version: 1;
  id: string;
  owner: string;
  quote: StoredQuote;
  preview?: StoredPreview;
  token?: Omit<Token, "proofs"> & { proofs: string[] };
  events?: NostrEvent[];
  accepted?: string[];
};

/** Options for explicitly resuming a persisted mint */
export interface ResumeMintOptions {
  /** Called after the invoice has been persisted, including on resume */
  onQuote?: (quote: MintQuoteBolt11Response) => void | Promise<void>;
  /** Stops execution without deleting recovery state */
  signal?: AbortSignal;
  /** The maximum time to wait for payment */
  timeoutMs?: number;
}

/** Dependencies for durable minting and idempotent Nostr publication */
export interface MintRecoveryOptions {
  /** The app-scoped durable storage, preferably encrypted */
  storage: RecoveryStorage;
  /** The immutable operation owner's public key */
  owner: string;
  /** The signer for this owner */
  signer: ISigner;
  /** Publishes an event and rejects unless a relay explicitly accepts it */
  publish: (event: NostrEvent, relays?: string[]) => Promise<void>;
  /** Inserts accepted events into the current session's event store, including after restart */
  onAccepted?: (event: NostrEvent) => void;
  /** Returns a loaded Cashu wallet, allowing reuse of cached wallets */
  getCashuWallet?: (mint: string) => Promise<Wallet>;
  /** Waits for payment using the application's preferred transport */
  waitForQuote?: (mint: string, quote: string, options: ResumeMintOptions) => Promise<unknown>;
}

function storeQuote(quote: MintQuoteBolt11Response): StoredQuote {
  return { ...quote, amount: Amount.from(quote.amount).toString() };
}

function restoreQuote(quote: StoredQuote): MintQuoteBolt11Response {
  return { ...quote, amount: Amount.from(quote.amount) };
}

function validateMintInput(input: PrepareMintOptions) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new Error("Mint amount must be a positive integer in sats");
  if (input.nutzap?.event && input.nutzap.event.pubkey !== input.nutzap.recipient)
    throw new Error("The nutzap event does not belong to the recipient");

  // Validate the lock before exposing an invoice that the user could pay.
  if (input.nutzap) OutputData.createSingleP2PKData({ pubkey: input.nutzap.p2pk }, 1, "deedbeef");
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 3000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Persists exact mint outputs and signed events so interrupted minting can be resumed safely */
export class MintRecovery {
  private readonly prefix: string;

  /** Creates a recovery journal without reading storage, signing, or publishing */
  constructor(private readonly options: MintRecoveryOptions) {
    this.prefix = `applesauce-mint:${options.owner}:`;
  }

  private key(id: string) {
    return this.prefix + encodeURIComponent(id);
  }

  private async wallet(mint: string) {
    if (this.options.getCashuWallet) return this.options.getCashuWallet(mint);
    const wallet = new Wallet(mint);
    await wallet.loadMint();
    return wallet;
  }

  private async waitForQuote(wallet: Wallet, record: MintRecord, options: ResumeMintOptions) {
    if (this.options.waitForQuote) return this.options.waitForQuote(record.mint, record.quote.quote, options);
    if (wallet.getMintInfo().isSupported(17).supported)
      return wallet.on.onceMintPaid(record.quote.quote, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 60_000,
      });

    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      const quote = await wallet.checkMintQuoteBolt11(record.quote.quote);
      if (quote.state === "PAID" || quote.state === "ISSUED") return;
      await waitForPoll(options.signal);
    }
    throw new Error("Timed out waiting for mint payment");
  }

  private read(value: string, id: string): MintRecord {
    const record = JSON.parse(value) as MintRecord;
    if (
      record.version !== 1 ||
      record.owner !== this.options.owner ||
      record.id !== id ||
      !record.mint ||
      !Number.isSafeInteger(record.amount) ||
      record.amount <= 0 ||
      !record.quote?.quote ||
      record.quote.unit !== "sat" ||
      !Amount.from(record.quote.amount).equals(record.amount) ||
      (record.events && (!record.token || record.events.length !== (record.nutzap ? 1 : 2)))
    ) {
      throw new Error("Invalid recovery record; preserve the stored value");
    }
    if (record.token) {
      const proofs = deserializeProofs(record.token.proofs);
      if (record.token.mint !== record.mint || record.token.unit !== "sat" || !sumProofs(proofs).equals(record.amount))
        throw new Error("Saved proofs do not match the mint operation; preserve recovery state");
    }
    if (record.events) {
      const ids = new Set(record.events.map((event) => event.id));
      const kinds = record.nutzap ? [NUTZAP_KIND] : [WALLET_TOKEN_KIND, WALLET_HISTORY_KIND];
      if (
        ids.size !== kinds.length ||
        record.events.some(
          (event, index) => !event.id || event.pubkey !== record.owner || event.kind !== kinds[index],
        ) ||
        record.accepted?.some((accepted) => !ids.has(accepted))
      )
        throw new Error("Invalid saved publication events; preserve recovery state");
    }
    return record;
  }

  private metadata(record: MintRecord): PendingMint {
    return {
      id: record.id,
      owner: record.owner,
      mint: record.mint,
      amount: record.amount,
      description: record.description,
      nutzap: record.nutzap,
      quote: restoreQuote(record.quote),
      stage: record.events ? "events" : record.token ? "proofs" : record.preview ? "outputs" : "quote",
    };
  }

  /**
   * Lists this owner's pending operations without signing or resuming them
   * @throws if storage is unavailable or a saved record is invalid
   */
  async getPending(): Promise<PendingMint[]> {
    const records: PendingMint[] = [];
    for (const key of await this.options.storage.keys()) {
      if (!key.startsWith(this.prefix)) continue;
      const value = await this.options.storage.getItem(key);
      if (value !== null)
        records.push(this.metadata(this.read(value, decodeURIComponent(key.slice(this.prefix.length)))));
    }
    return records;
  }

  /**
   * Creates and durably stores a quote before returning its invoice
   * @throws if the amount or destination is invalid, recovery is unsupported, or persistence fails
   */
  async prepare(input: PrepareMintOptions): Promise<PendingMint> {
    validateMintInput(input);
    // Check storage accessibility before contacting the mint, even when no records exist.
    await this.options.storage.getItem(this.prefix + "probe");
    const wallet = await this.wallet(input.mint);
    if (!wallet.getMintInfo().isSupported(9).supported)
      throw new Error("Mint does not support NUT-09 signature recovery");
    const quote = await wallet.createMintQuoteBolt11(input.amount, input.description);
    if (quote.unit !== "sat" || !Amount.from(quote.amount).equals(input.amount))
      throw new Error("Mint quote amount or unit mismatch");
    return this.adoptQuote(input, quote);
  }

  /**
   * Persists an externally created quote before redemption; issued quotes still require saved outputs
   * @throws if the quote conflicts with its operation or cannot be persisted
   */
  async adoptQuote(input: PrepareMintOptions, quote: MintQuoteBolt11Response): Promise<PendingMint> {
    validateMintInput(input);
    if (quote.unit !== "sat" || !Amount.from(quote.amount).equals(input.amount))
      throw new Error("Mint quote amount or unit mismatch");
    const id = JSON.stringify([input.mint.replace(/\/+$/, ""), quote.quote]);
    return withRecoveryLock(this.options.storage, this.key(id), async () => {
      const saved = await this.options.storage.getItem(this.key(id));
      if (saved !== null) {
        const record = this.read(saved, id);
        if (record.amount !== input.amount || JSON.stringify(record.nutzap) !== JSON.stringify(input.nutzap))
          throw new Error("Quote is already associated with another mint operation");
        return this.metadata(record);
      }
      const record: MintRecord = {
        mint: input.mint,
        amount: input.amount,
        description: input.description,
        nutzap: input.nutzap,
        version: 1,
        owner: this.options.owner,
        id,
        quote: storeQuote(quote),
      };
      await saveRecovery(this.options.storage, this.key(record.id), record);
      return this.metadata(record);
    });
  }

  /**
   * Imports an owner-tagged deposit from the earlier example journal without discarding its saved outputs
   * @throws if ownership, saved state, storage, or couch cleanup cannot be verified
   */
  async importLegacyDeposit(
    key: string,
    couch: Couch,
    source: RecoveryStorage = this.options.storage,
  ): Promise<PendingMint | undefined> {
    return withRecoveryLock(source, `legacy:${key}`, async () => {
      const value = await source.getItem(key);
      if (value === null) return undefined;
      const legacy = JSON.parse(value) as Omit<MintRecord, "version" | "id">;
      if (legacy.owner !== this.options.owner || legacy.nutzap)
        throw new Error("Legacy deposit belongs to another owner");
      const id = JSON.stringify([legacy.mint.replace(/\/+$/, ""), legacy.quote.quote]);
      const record = this.read(JSON.stringify({ ...legacy, id, version: 1 }), id);
      return withRecoveryLock(this.options.storage, this.key(id), async () => {
        // Remove duplicate couch copies while the legacy record still durably owns the proofs.
        if (record.token) {
          const identity = tokenIdentity({ ...record.token, proofs: deserializeProofs(record.token.proofs) });
          for (const token of await couch.getAll()) if (tokenIdentity(token) === identity) await couch.remove(token);
          if ((await couch.getAll()).some((token) => tokenIdentity(token) === identity))
            throw new Error("Could not remove legacy couch duplicates");
        }
        const saved = await this.options.storage.getItem(this.key(id));
        if (saved === null) await saveRecovery(this.options.storage, this.key(id), record);
        await source.removeItem(key);
        return this.metadata(saved === null ? record : this.read(saved, id));
      });
    });
  }

  /**
   * Imports an unowned legacy nutzap only after the consumer explicitly selects its owner and delivery relays
   * @throws if the legacy record is invalid or relay discovery or persistence fails
   */
  async importLegacyNutzap(
    key: string,
    getRelays: (recipient: string) => Promise<string[]>,
    source: RecoveryStorage = this.options.storage,
  ): Promise<PendingMint | undefined> {
    return withRecoveryLock(source, `legacy:${key}`, async () => {
      const value = await source.getItem(key);
      if (value === null) return undefined;
      const legacy = JSON.parse(value);
      if (!legacy.recipient || !legacy.p2pk) throw new Error("Invalid legacy nutzap");
      const relays = await getRelays(legacy.recipient);
      const id = JSON.stringify([legacy.mint.replace(/\/+$/, ""), legacy.quote.quote]);
      const record = this.read(
        JSON.stringify({
          version: 1,
          id,
          owner: this.options.owner,
          mint: legacy.mint,
          amount: legacy.amount,
          quote: storeQuote(restoreQuote(legacy.quote)),
          preview: legacy.preview && {
            ...legacy.preview,
            quote: storeQuote(restoreQuote(legacy.preview.quote)),
          },
          token: legacy.token && {
            ...legacy.token,
            proofs: serializeProofs(deserializeProofs(JSON.stringify(legacy.token.proofs))),
          },
          nutzap: { recipient: legacy.recipient, p2pk: legacy.p2pk, comment: legacy.comment, relays },
        }),
        id,
      );
      return withRecoveryLock(this.options.storage, this.key(id), async () => {
        const saved = await this.options.storage.getItem(this.key(id));
        if (saved === null) await saveRecovery(this.options.storage, this.key(id), record);
        await source.removeItem(key);
        return this.metadata(saved === null ? record : this.read(saved, id));
      });
    });
  }

  /**
   * Resumes a saved operation, retaining its state on cancellation or any failure
   * @throws if cancelled, already running, invalid, or unable to mint, sign, persist, or publish
   */
  async resume(id: string, options: ResumeMintOptions = {}): Promise<void> {
    const key = this.key(id);
    await withRecoveryLock(this.options.storage, key, async () => {
      const check = () => options.signal?.throwIfAborted();
      check();
      const value = await this.options.storage.getItem(key);
      if (value === null) throw new Error("No pending mint to resume");
      const record = this.read(value, id);
      const save = () => saveRecovery(this.options.storage, key, record);
      await options.onQuote?.(restoreQuote(record.quote));
      check();

      if (!record.token) {
        const wallet = await this.wallet(record.mint);
        if (!wallet.getMintInfo().isSupported(9).supported)
          throw new Error("Mint does not support NUT-09 signature recovery");
        let quote = await wallet.checkMintQuoteBolt11(record.quote.quote);
        if (quote.state === "UNPAID") {
          await this.waitForQuote(wallet, record, options);
          quote = await wallet.checkMintQuoteBolt11(record.quote.quote);
        }
        check();
        if (
          quote.quote !== record.quote.quote ||
          quote.unit !== "sat" ||
          !Amount.from(quote.amount).equals(record.amount)
        )
          throw new Error("Mint quote does not match the saved operation");
        if (quote.state !== "PAID" && quote.state !== "ISSUED") throw new Error("Mint quote is not paid");
        if (!record.preview) {
          if (quote.state === "ISSUED") throw new Error("Quote issued without saved outputs; preserve recovery state");
          const operation = wallet.ops.mintBolt11(record.amount, quote);
          const preview = await (
            record.nutzap ? operation.asP2PK({ pubkey: record.nutzap.p2pk }) : operation
          ).prepare();
          const { outputs: _outputs, ...payload } = preview.payload;
          record.preview = {
            ...preview,
            quote: storeQuote(preview.quote),
            payload,
            outputData: preview.outputData.map(OutputData.serialize),
          };
          await save();
        }
        const outputData = record.preview.outputData.map(OutputData.deserialize);
        if (
          record.preview.method !== "bolt11" ||
          record.preview.quote.quote !== record.quote.quote ||
          record.preview.payload.quote !== record.quote.quote ||
          !outputData.length ||
          new Set(outputData.map((output) => output.blindedMessage.B_)).size !== outputData.length ||
          outputData.some((output) => output.blindedMessage.id !== record.preview!.keysetId) ||
          !sumProofs(outputData.map((output) => output.blindedMessage)).equals(record.amount)
        )
          throw new Error("Saved outputs do not match the mint operation; preserve recovery state");
        const preview: MintPreview<MintQuoteBolt11Response> = {
          ...record.preview,
          quote: restoreQuote(record.preview.quote),
          outputData,
          payload: { ...record.preview.payload, outputs: outputData.map((output) => output.blindedMessage) },
        };
        check();
        let proofs;
        if (quote.state === "ISSUED") {
          const restored = await wallet.mint.restore({ outputs: preview.payload.outputs });
          if (restored.outputs.length !== outputData.length || restored.signatures.length !== outputData.length)
            throw new Error("Mint did not restore all saved outputs");
          const seen = new Set<string>();
          // A saved quote may refer to a keyset that became inactive while the client was offline.
          await wallet.ensureOperableKeysets([preview.keysetId]);
          const keys = wallet.getKeyset(preview.keysetId);
          proofs = restored.outputs.map((output, index) => {
            const original = outputData.find((candidate) => candidate.blindedMessage.B_ === output.B_);
            if (!original || seen.has(output.B_))
              throw new Error("Mint returned an unknown or repeated recovery output");
            seen.add(output.B_);
            const signature = restored.signatures[index];
            if (
              signature.id !== preview.keysetId ||
              !Amount.from(signature.amount).equals(original.blindedMessage.amount)
            )
              throw new Error("Mint returned mismatched recovery signatures");
            return original.toProof(signature, keys);
          });
        } else {
          proofs = await wallet.completeMint(preview);
        }
        if (!sumProofs(proofs).equals(record.amount)) throw new Error("Mint issued an unexpected amount");
        record.token = { mint: record.mint, unit: "sat", proofs: serializeProofs(proofs) };
        // Never put these proofs in the ordinary couch: couch recovery could swap them before publication.
        await save();
      }

      check();
      if (!record.events) {
        if ((await this.options.signer.getPublicKey()) !== record.owner)
          throw new Error("The signer does not own this operation");
        const token: Token = { ...record.token, proofs: deserializeProofs(record.token.proofs) };
        if (record.nutzap) {
          const { event, recipient, comment } = record.nutzap;
          const factory = event
            ? NutzapFactory.forEvent(event, token, comment)
            : NutzapFactory.forProfile(recipient, token, comment);
          record.events = [await factory.sign(this.options.signer)];
        } else {
          const tokenEvent = await WalletTokenFactory.create(token).sign(this.options.signer);
          const history = await WalletHistoryFactory.create({
            direction: "in",
            amount: record.amount,
            mint: record.mint,
            created: [tokenEvent.id],
          }).sign(this.options.signer);
          record.events = [tokenEvent, history];
        }
        if (record.events.some((event) => event.pubkey !== record.owner))
          throw new Error("The active signer changed during mint recovery");
        record.accepted = [];
        await save();
      }
      for (const event of record.events) {
        check();
        if (event.pubkey !== record.owner) throw new Error("A saved event belongs to another owner");
        if (record.accepted?.includes(event.id)) {
          this.options.onAccepted?.(event);
          continue;
        }
        await this.options.publish(event, record.nutzap?.relays);
        this.options.onAccepted?.(event);
        record.accepted = [...(record.accepted ?? []), event.id];
        await save();
      }
      await this.options.storage.removeItem(key);
    });
  }
}
