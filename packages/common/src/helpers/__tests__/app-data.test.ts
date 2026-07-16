import { NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { describe, expect, it } from "vitest";
import { APP_DATA_KIND, getAppDataContent, lockAppData, unlockAppData } from "../app-data.js";

// A trivial reversible "encryption" - no real crypto needed to exercise the lock/unlock lifecycle
const signer: HiddenContentSigner = {
  nip44: {
    encrypt: (_pubkey: string, plaintext: string) => `nip44:${plaintext}`,
    decrypt: (_pubkey: string, ciphertext: string) => ciphertext.slice("nip44:".length),
  },
};

function createEncryptedAppDataEvent(data: unknown): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 0,
    kind: APP_DATA_KIND,
    tags: [],
    content: `nip44:${JSON.stringify(data)}`,
    sig: "test-sig",
  };
}

describe("lockAppData", () => {
  it("clears the decrypted plaintext from AppDataContentSymbol so a locked event stops returning it (CR-03)", async () => {
    const data = { foo: "bar" };
    const event = createEncryptedAppDataEvent(data);

    // Unlock the app data and read it once to populate the AppDataContentSymbol cache
    await unlockAppData(event, signer);
    expect(getAppDataContent(event)).toEqual(data);

    // Lock the event
    lockAppData(event);

    // A lock must actually drop the decrypted plaintext from memory
    expect(getAppDataContent(event)).toBeUndefined();
  });
});
