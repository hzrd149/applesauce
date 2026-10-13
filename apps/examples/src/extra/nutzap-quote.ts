import {
  Wallet,
  Amount,
  deserializeProofs,
  sumProofs,
  OutputData,
  type MintPreview,
  type MintQuoteBolt11Response,
  type SerializedOutputData,
  type Token,
} from "@cashu/cashu-ts";
import { BehaviorSubject } from "rxjs";
import type { Couch } from "applesauce-wallet/helpers";
import SecureStorage from "./encrypted-storage";
import { createEncryptedCouch } from "./encrypted-couch";

export const nutzapStorage$ = new BehaviorSubject<SecureStorage | null>(null);
type PendingZap = {
  mint: string;
  amount: number;
  recipient: string;
  p2pk: string;
  comment: string;
  quote: MintQuoteBolt11Response;
  preview?: Omit<MintPreview<MintQuoteBolt11Response>, "outputData"> & { outputData: SerializedOutputData[] };
  token?: Token;
};
const pendingKey = "example-pending-nutzap";

async function save(storage: SecureStorage, pending: PendingZap) {
  if (!(await storage.setItem(pendingKey, JSON.stringify(pending))))
    throw new Error("Could not persist zap recovery; minting stopped");
}

/** Creates an invoice and saves the quote before displaying it */
async function createPendingNutzap(storage: SecureStorage, input: Omit<PendingZap, "quote" | "preview" | "token">) {
  if (await storage.getItem(pendingKey)) throw new Error("Resume the pending zap before creating another invoice");
  const wallet = new Wallet(input.mint);
  await wallet.loadMint();
  const quote = await wallet.createMintQuoteBolt11(input.amount);
  const pending: PendingZap = { ...input, quote };
  await save(storage, pending);
  return pending;
}

/** Restores the pending quote, including blinding material and proofs when minting was interrupted */
async function recoverPendingNutzap(
  storage: SecureStorage,
  publish: (recipient: string, token: Token, comment: string, couch: Couch) => Promise<unknown>,
  onInvoice: (quote: MintQuoteBolt11Response) => void,
) {
  const stored = await storage.getItem(pendingKey);
  if (!stored) throw new Error("No pending zap to resume");
  const pending: PendingZap = JSON.parse(stored);
  if (pending.quote.amount !== undefined) pending.quote.amount = Amount.from(pending.quote.amount);
  if (pending.token)
    pending.token = { ...pending.token, proofs: deserializeProofs(JSON.stringify(pending.token.proofs)) };
  onInvoice(pending.quote);
  const wallet = new Wallet(pending.mint);
  await wallet.loadMint();
  if (!pending.token) {
    let quote = await wallet.checkMintQuoteBolt11(pending.quote.quote);
    if (quote.state === "UNPAID") {
      await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 60_000 });
      quote = await wallet.checkMintQuoteBolt11(quote.quote);
    }
    if (!pending.preview) {
      if (quote.state === "ISSUED")
        throw new Error("Mint issued this quote without saved outputs; keep the recovery record");
      const preview = await wallet.ops.mintBolt11(pending.amount, quote).asP2PK({ pubkey: pending.p2pk }).prepare();
      pending.preview = { ...preview, outputData: preview.outputData.map(OutputData.serialize) };
      // Persist the exact blinded outputs before making a request that consumes the paid quote.
      await save(storage, pending);
    }
    if (pending.preview.quote.amount !== undefined)
      pending.preview.quote.amount = Amount.from(pending.preview.quote.amount);
    const outputData = pending.preview.outputData.map(OutputData.deserialize);
    const preview: MintPreview<MintQuoteBolt11Response> = {
      ...pending.preview,
      outputData,
      payload: { ...pending.preview.payload, outputs: outputData.map((output) => output.blindedMessage) },
    };
    let proofs;
    if (quote.state === "ISSUED") {
      const restored = await wallet.mint.restore({
        outputs: preview.outputData.map((output) => output.blindedMessage),
      });
      if (
        restored.signatures.length !== restored.outputs.length ||
        restored.outputs.length !== preview.outputData.length
      )
        throw new Error("Mint did not restore all outputs and signatures; keep the recovery record");
      const matched = new Set<string>();
      const keys = wallet.getKeyset(preview.keysetId);
      proofs = restored.outputs.map((output, index) => {
        const original = preview.outputData.find((candidate) => candidate.blindedMessage.B_ === output.B_);
        if (!original || matched.has(output.B_))
          throw new Error("Mint returned an unknown or duplicate recovery output");
        matched.add(output.B_);
        const signature = restored.signatures[index];
        if (!Amount.from(signature.amount).equals(original.blindedMessage.amount) || signature.id !== preview.keysetId)
          throw new Error("Mint returned mismatched recovery signatures; keep the recovery record");
        return original.toProof(signature, keys);
      });
      if (proofs.length !== preview.outputData.length)
        throw new Error("Mint did not restore all outputs; keep the recovery record");
    } else {
      proofs = await wallet.completeMint(preview);
    }
    if (!sumProofs(proofs).equals(pending.amount))
      throw new Error("Mint issued an unexpected amount; keep the recovery record");
    pending.token = { mint: pending.mint, unit: "sat", proofs };
    await save(storage, pending);
  }
  // The action's couch is encrypted too; the outer record remains until publishing is accepted.
  const couch = createEncryptedCouch(() => storage, `nutzap:${pending.recipient}:${pending.mint}`);
  await publish(pending.recipient, pending.token, pending.comment, couch);
  await storage.removeItem(pendingKey);
}

const mutations = new WeakMap<SecureStorage, Promise<void>>();
function withRecoveryLock<T>(storage: SecureStorage, operation: () => Promise<T>): Promise<T> {
  const previous = mutations.get(storage) ?? Promise.resolve();
  const result = previous.then(() =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("examples-pending-nutzap", operation)
      : operation(),
  );
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  mutations.set(storage, settled);
  return result;
}

/** Persists an invoice before returning it and protects the pending recovery record from concurrent replacement */
export function prepareNutzap(storage: SecureStorage, input: Omit<PendingZap, "quote" | "preview" | "token">) {
  return withRecoveryLock(storage, () => createPendingNutzap(storage, input));
}

/** Resumes the saved minting and publishing operation without replacing its recipient or blinded outputs */
export function resumeNutzap(
  storage: SecureStorage,
  publish: Parameters<typeof recoverPendingNutzap>[1],
  onInvoice: Parameters<typeof recoverPendingNutzap>[2],
) {
  return withRecoveryLock(storage, () => recoverPendingNutzap(storage, publish, onInvoice));
}
