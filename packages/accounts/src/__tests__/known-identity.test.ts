import { sign } from "applesauce-core/operations";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { finalizeEvent } from "applesauce-core/helpers/event";
import { ExtensionSigner, NostrConnectSigner } from "applesauce-signers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionAccount } from "../accounts/extension-account.js";
import { NostrConnectAccount } from "../accounts/nostr-connect-account.js";
import { AccountManager } from "../manager.js";
import { ProxySigner } from "../proxy-signer.js";

afterEach(() => vi.restoreAllMocks());

describe("known account identity", () => {
  it.each(["extension", "remote"])("signs with a cold %s account without discovering identity", async (type) => {
    const key = generateSecretKey();
    const pubkey = getPublicKey(key);
    const signer =
      type === "extension"
        ? new ExtensionSigner()
        : new NostrConnectSigner({ relays: [], subscriptionMethod: vi.fn(), publishMethod: vi.fn() });
    const account =
      signer instanceof ExtensionSigner
        ? new ExtensionAccount(pubkey, signer)
        : new NostrConnectAccount(pubkey, signer);
    const discover = vi.spyOn(signer, "getPublicKey").mockRejectedValue(new Error("discovery requested"));
    const signing = vi.spyOn(signer, "signEvent").mockImplementation(async (draft) => finalizeEvent(draft, key));
    const manager = new AccountManager();
    manager.addAccount(account);
    manager.setActive(account);

    const event = await sign(manager.signer)({ kind: 1, content: "hello", tags: [], created_at: 1 });

    expect(event.pubkey).toBe(pubkey);
    expect(signing).toHaveBeenCalledWith(expect.objectContaining({ pubkey }));
    expect(discover).not.toHaveBeenCalled();

    signing.mockImplementationOnce(async (draft) => finalizeEvent(draft, generateSecretKey()));
    await expect(sign(manager.signer)({ kind: 1, content: "hello", tags: [], created_at: 1 })).rejects.toThrow(
      "Signer signed with wrong pubkey",
    );
    expect(discover).not.toHaveBeenCalled();
    await expect(account.getPublicKey()).rejects.toThrow("discovery requested");

    const other = new ExtensionAccount(getPublicKey(generateSecretKey()), new ExtensionSigner());
    manager.addAccount(other);
    manager.setActive(other);
    expect((manager.signer as ProxySigner<typeof other>).getKnownPublicKey()).toBe(other.pubkey);
    manager.removeAccount(other);
    expect((manager.signer as ProxySigner<typeof other>).getKnownPublicKey()).toBeUndefined();
    await expect(manager.signer.getPublicKey()).rejects.toThrow("No active account");
  });
});
