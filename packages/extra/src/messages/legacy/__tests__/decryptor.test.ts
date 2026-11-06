import { LegacyMessageFactory } from "applesauce-common/factories";
import { getEncryptedContent, type EncryptedContentCache, type NostrEvent } from "applesauce-core/helpers";
import { PrivateKeySigner, type ISigner } from "applesauce-signers";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { LegacyMessageDecryptor } from "../decryptor.js";

const ownerSigner = new PrivateKeySigner(new Uint8Array(32).fill(1));
const peerSigner = new PrivateKeySigner(new Uint8Array(32).fill(2));
const owner = await ownerSigner.getPublicKey();

async function message(content: string) {
  const event = await LegacyMessageFactory.create(owner, content).sign(peerSigner);
  return JSON.parse(JSON.stringify(event)) as NostrEvent;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Creates a signer whose NIP-04 decryption can be observed or replaced */
function mockSigner(decrypt = (pubkey: string, ciphertext: string) => ownerSigner.nip04.decrypt(pubkey, ciphertext)) {
  const spy = vi.fn(decrypt);
  const signer: ISigner = {
    getPublicKey: () => ownerSigner.getPublicKey(),
    signEvent: (draft) => ownerSigner.signEvent(draft),
    nip04: { encrypt: (pubkey, plaintext) => ownerSigner.nip04.encrypt(pubkey, plaintext), decrypt: spy },
  };

  return { signer, decrypt: spy };
}

describe("LegacyMessageDecryptor", () => {
  it("shares one signer call between concurrent readers of an event", async () => {
    const { signer, decrypt } = mockSigner();
    const decryptor = new LegacyMessageDecryptor({ pubkey: owner, signer });
    const event = await message("shared");

    const [first, second] = await Promise.all([
      firstValueFrom(decryptor.read$(event)),
      firstValueFrom(decryptor.read$(event)),
    ]);

    expect(first).toBe(event);
    expect(second).toBe(event);
    expect(getEncryptedContent(event)).toBe("shared");
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("waits for one signer prompt to settle before starting the next", async () => {
    const gate = deferred<void>();
    const { signer, decrypt } = mockSigner(async (pubkey, ciphertext) => {
      await gate.promise;
      return ownerSigner.nip04.decrypt(pubkey, ciphertext);
    });
    const decryptor = new LegacyMessageDecryptor({ pubkey: owner, signer });
    const events = [await message("first"), await message("second")];

    const reading = Promise.all(events.map((event) => firstValueFrom(decryptor.read$(event))));
    await vi.waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    gate.resolve();
    await reading;

    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it("skips the signer when every reader leaves during cache restoration", async () => {
    const lookup = deferred<string | null>();
    const decryptionCache: EncryptedContentCache = { getItem: () => lookup.promise, setItem: async () => {} };
    const { signer, decrypt } = mockSigner();
    const decryptor = new LegacyMessageDecryptor({ pubkey: owner, signer, decryptionCache });
    const event = await message("abandoned");

    decryptor.read$(event).subscribe().unsubscribe();
    lookup.resolve(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(decrypt).not.toHaveBeenCalled();
  });

  it("classifies failures and excludes failed events from bulk unlocking", async () => {
    const rejection = new Error("rejected");
    const { signer } = mockSigner(async () => {
      throw rejection;
    });
    const decryptor = new LegacyMessageDecryptor({ pubkey: owner, signer });
    const rejected = await message("rejected");
    const unsigned = await message("no signer");
    const invalid = { ...(await message("invalid")), content: "plaintext" };
    const signal = new AbortController().signal;

    expect(await decryptor.readResult(rejected, signal)).toMatchObject({
      status: "failed",
      failure: { code: "decryption-failed", cause: rejection, attempts: 1, retry: "manual" },
    });
    expect(await new LegacyMessageDecryptor({ pubkey: owner }).readResult(unsigned, signal)).toMatchObject({
      failure: { code: "signer-unavailable", retry: "manual" },
    });
    expect(await decryptor.readResult(invalid, signal)).toMatchObject({
      failure: { code: "invalid-message", retry: "never" },
    });

    expect(decryptor.shouldUnlock(rejected)).toBe(false);
    decryptor.clearFailure(rejected.id);
    expect(decryptor.shouldUnlock(rejected)).toBe(true);
  });

  it("reports failures by cause in the decryption state", async () => {
    const rejection = new Error("rejected");
    const { signer } = mockSigner(async () => {
      throw rejection;
    });
    const decryptor = new LegacyMessageDecryptor({ pubkey: owner, signer });
    const event = await message("state");

    await decryptor.readResult(event, new AbortController().signal);
    const state = await firstValueFrom(decryptor.observeState$(of([event])));

    expect(state).toMatchObject({ total: 1, unlocked: 0, locked: 1, pending: 0 });
    expect(state.errors.get(event.id)).toBe(rejection);
  });
});
