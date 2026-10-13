import {
  Amount,
  OutputData,
  Wallet as CashuWallet,
  deserializeProofs,
  serializeProofs,
  sumProofs,
  type MintPreview,
  type MintQuoteBolt11Response,
  type SerializedOutputData,
  type Token,
} from "@cashu/cashu-ts";
import type { NostrEvent } from "applesauce-core/helpers";
import type { NutWallet } from "applesauce-wallet/wallet";
import { WalletHistoryFactory, WalletTokenFactory } from "applesauce-wallet/factories";
import { filter, firstValueFrom, take, timeout } from "rxjs";
import type SecureStorage from "./encrypted-storage";
import { tokenIdentity } from "./encrypted-couch";
import { publishEvent } from "./publish";

type StoredQuote = Omit<MintQuoteBolt11Response, "amount"> & { amount: string };
type StoredPreview = Omit<MintPreview<MintQuoteBolt11Response>, "outputData" | "quote" | "payload"> & {
  quote: StoredQuote;
  payload: Omit<MintPreview["payload"], "outputs">;
  outputData: SerializedOutputData[];
};
type PendingDeposit = {
  owner: string;
  mint: string;
  amount: number;
  quote: StoredQuote;
  preview?: StoredPreview;
  token?: Omit<Token, "proofs"> & { proofs: string[] };
  events?: NostrEvent[];
  accepted?: string[];
};
type ResumeOptions = {
  onQuote?: (quote: MintQuoteBolt11Response) => void | Promise<void>;
  signal?: AbortSignal;
  namespace?: string;
};
const operations = new WeakMap<object, Set<string>>();

function assertActive(storage: SecureStorage, signal?: AbortSignal) {
  if (!storage.unlocked) throw new Error("Unlock recovery storage before depositing");
  if (signal?.aborted) throw signal.reason ?? new DOMException("Deposit cancelled", "AbortError");
}

function quoteForStorage(quote: MintQuoteBolt11Response): StoredQuote {
  return { ...quote, amount: Amount.from(quote.amount).toString() };
}

function restoreQuote(quote: StoredQuote): MintQuoteBolt11Response {
  return { ...quote, amount: Amount.from(quote.amount) };
}

async function save(storage: SecureStorage, key: string, pending: PendingDeposit) {
  if (!(await storage.setItem(key, JSON.stringify(pending))))
    throw new Error("Could not persist deposit recovery; the pending record must be retained");
}

async function exclusive<T>(storage: SecureStorage, key: string, operation: () => Promise<T>) {
  let keys = operations.get(storage.database);
  if (!keys) operations.set(storage.database, (keys = new Set()));
  if (keys.has(key)) throw new Error("A deposit recovery operation is already running for this wallet");
  keys.add(key);
  try {
    return await (typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`examples-deposit:${key}`, { ifAvailable: true }, (lock) => {
          if (!lock) throw new Error("A deposit recovery operation is running in another tab");
          return operation();
        })
      : operation());
  } finally {
    keys.delete(key);
  }
}

async function finish(
  storage: SecureStorage,
  wallet: NutWallet,
  key: string,
  pending: PendingDeposit,
  options: ResumeOptions,
) {
  assertActive(storage, options.signal);
  if (pending.owner !== wallet.pubkey) throw new Error("The pending deposit belongs to another wallet");
  await options.onQuote?.(restoreQuote(pending.quote));
  if (!pending.token) {
    const mint = new CashuWallet(pending.mint);
    await mint.loadMint();
    assertActive(storage, options.signal);
    let quote = await mint.checkMintQuoteBolt11(pending.quote.quote);
    if (quote.state === "UNPAID") {
      await wallet.waitForMintQuote(pending.mint, quote.quote, { signal: options.signal, timeoutMs: 60_000 });
      quote = await mint.checkMintQuoteBolt11(quote.quote);
    }
    assertActive(storage, options.signal);
    if (quote.state !== "PAID" && quote.state !== "ISSUED") throw new Error("The mint quote is not paid");
    if (quote.unit !== "sat" || Amount.from(quote.amount).toNumber() !== pending.amount)
      throw new Error("The mint quote does not match the saved deposit amount and unit");
    if (!pending.preview) {
      if (quote.state === "ISSUED")
        throw new Error("This quote was issued without saved outputs; preserve its recovery record");
      const preview = await mint.ops.mintBolt11(pending.amount, quote).prepare();
      const { outputs: _outputs, ...payload } = preview.payload;
      pending.preview = {
        ...preview,
        quote: quoteForStorage(preview.quote),
        payload,
        outputData: preview.outputData.map(OutputData.serialize),
      };
      // The exact secrets and blinding factors must be durable before consuming the paid quote.
      await save(storage, key, pending);
    }
    const outputData = pending.preview.outputData.map(OutputData.deserialize);
    const preview: MintPreview<MintQuoteBolt11Response> = {
      ...pending.preview,
      quote: restoreQuote(pending.preview.quote),
      payload: { ...pending.preview.payload, outputs: outputData.map((output) => output.blindedMessage) },
      outputData,
    };
    assertActive(storage, options.signal);
    let proofs;
    if (quote.state === "ISSUED") {
      const restored = await mint.mint.restore({ outputs: outputData.map((output) => output.blindedMessage) });
      if (restored.outputs.length !== outputData.length || restored.signatures.length !== outputData.length)
        throw new Error("The mint did not restore every saved output; preserve the recovery record");
      const seen = new Set<string>();
      const keys = mint.getKeyset(preview.keysetId);
      proofs = restored.outputs.map((output, index) => {
        const original = outputData.find((candidate) => candidate.blindedMessage.B_ === output.B_);
        if (!original || seen.has(output.B_))
          throw new Error("The mint returned an unknown or repeated recovery output");
        seen.add(output.B_);
        return original.toProof(restored.signatures[index], keys);
      });
    } else {
      proofs = await mint.completeMint(preview);
    }
    if (sumProofs(proofs).toNumber() !== pending.amount)
      throw new Error("The issued proofs do not match the saved deposit amount; preserve the saved outputs");
    pending.token = { mint: pending.mint, unit: "sat", proofs: serializeProofs(proofs) };
    // A failed write still leaves the saved output preview available for NUT-09 restoration.
    await save(storage, key, pending);
  }

  const token: Token = { ...pending.token, proofs: deserializeProofs(pending.token.proofs) };
  const identity = tokenIdentity(token);
  const alreadyAccepted =
    pending.events?.length && pending.events.every((event) => pending.accepted?.includes(event.id));
  if (!alreadyAccepted && !(await wallet.couch.getAll()).some((stored) => tokenIdentity(stored) === identity))
    await wallet.couch.store(token);
  assertActive(storage, options.signal);
  if (!pending.events) {
    if ((await wallet.signer.getPublicKey()) !== wallet.pubkey) throw new Error("The signer does not own this wallet");
    const tokenEvent = await WalletTokenFactory.create(token).sign(wallet.signer);
    const history = await WalletHistoryFactory.create({
      direction: "in",
      amount: pending.amount,
      mint: pending.mint,
      created: [tokenEvent.id],
    }).sign(wallet.signer);
    if (tokenEvent.pubkey !== wallet.pubkey || history.pubkey !== wallet.pubkey)
      throw new Error("The active signer changed during deposit recovery");
    pending.events = [tokenEvent, history];
    pending.accepted = [];
    // Persist signed events before publication so retries republish the same ids without swapping proofs.
    await save(storage, key, pending);
  }
  const unpublished = pending.events.some((event) => !pending.accepted?.includes(event.id));
  const relays = unpublished
    ? await firstValueFrom(
        wallet.relays$.pipe(
          filter((values) => values.length > 0),
          take(1),
          timeout(5_000),
        ),
      )
    : [];
  for (const event of pending.events) {
    if (event.pubkey !== wallet.pubkey) throw new Error("A saved deposit event belongs to another wallet");
    assertActive(storage, options.signal);
    if (!pending.accepted?.includes(event.id)) {
      await publishEvent(wallet.pool, relays, event);
      wallet.eventStore.add(event);
      pending.accepted = [...(pending.accepted ?? []), event.id];
      await save(storage, key, pending);
    } else wallet.eventStore.add(event);
  }
  // Recovery completion is not proof of accepted publishing; every signed event above has an explicit verdict.
  for (const stored of await wallet.couch.getAll())
    if (tokenIdentity(stored) === identity) await wallet.couch.remove(stored);
  if ((await wallet.couch.getAll()).some((stored) => tokenIdentity(stored) === identity))
    throw new Error("Deposit published but matching recovery proofs could not be cleared");
  await storage.removeItem(key);
}

/** Persists a quote and its exact mint outputs before showing an invoice or issuing proofs */
export async function recoverableDeposit(
  storage: SecureStorage,
  wallet: NutWallet,
  options: ResumeOptions & { mint: string; amount: number },
): Promise<void> {
  const key = `${options.namespace ?? "example-deposit"}:${wallet.pubkey}`;
  await exclusive(storage, key, async () => {
    assertActive(storage, options.signal);
    if (!Number.isSafeInteger(options.amount) || options.amount <= 0)
      throw new Error("Deposit amount must be a positive integer in sats");
    if (await storage.getItem(key)) throw new Error("Resume the pending deposit before creating another invoice");
    const quote = await wallet.createMintQuote(options.mint, options.amount);
    const pending: PendingDeposit = {
      owner: wallet.pubkey,
      mint: options.mint,
      amount: options.amount,
      quote: quoteForStorage(quote),
    };
    await save(storage, key, pending);
    await finish(storage, wallet, key, pending, options);
  });
}

/** Resumes saved issuance or republishes the saved events without minting or swapping stored proofs */
export async function resumeDeposit(
  storage: SecureStorage,
  wallet: NutWallet,
  options: ResumeOptions = {},
): Promise<void> {
  const key = `${options.namespace ?? "example-deposit"}:${wallet.pubkey}`;
  await exclusive(storage, key, async () => {
    assertActive(storage, options.signal);
    const stored = await storage.getItem(key);
    if (!stored) throw new Error("No pending deposit to resume for this wallet");
    await finish(storage, wallet, key, JSON.parse(stored) as PendingDeposit, options);
  });
}
