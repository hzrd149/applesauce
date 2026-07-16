import { NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { describe, expect, it } from "vitest";
import { APP_DATA_KIND, AppDataContentSymbol, getAppDataContent, lockAppData, unlockAppData } from "../app-data.js";

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

// 05.1-09: getAppDataContent's AppDataContentSymbol write migrated from Reflect.set to
// setCachedValue — the memo must be non-enumerable and dropped by a plain spread, and
// lockAppData's Reflect.deleteProperty must still clear it (Plan 05 CR-03 regression).
describe("getAppDataContent non-enumerability (05.1-09)", () => {
  it("writes AppDataContentSymbol non-enumerable and drops it on a plain spread", async () => {
    const data = { foo: "bar" };
    const event = createEncryptedAppDataEvent(data);

    await unlockAppData(event, signer);
    getAppDataContent(event);

    expect(Object.keys(event)).not.toContain(AppDataContentSymbol);
    expect(Object.getOwnPropertySymbols(event)).toContain(AppDataContentSymbol);
    const descriptor = Object.getOwnPropertyDescriptor(event, AppDataContentSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const spread = { ...event };
    expect(Reflect.has(spread, AppDataContentSymbol)).toBe(false);
  });

  it("lockAppData still clears the non-enumerable AppDataContentSymbol memo (CR-03 regression)", async () => {
    const data = { foo: "bar" };
    const event = createEncryptedAppDataEvent(data);

    await unlockAppData(event, signer);
    expect(getAppDataContent(event)).toEqual(data);
    expect(Reflect.has(event, AppDataContentSymbol)).toBe(true);

    lockAppData(event);

    expect(Reflect.has(event, AppDataContentSymbol)).toBe(false);
    expect(getAppDataContent(event)).toBeUndefined();
  });
});
