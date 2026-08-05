import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("nostr-signer-capacitor-plugin", () => ({
  NostrSignerPlugin: {
    setPackageName: vi.fn().mockResolvedValue(undefined),
    getPublicKey: vi.fn().mockResolvedValue({
      npub: "npub1qy352euf40x77qfrg4ncn27dauqjx3t83x4ummcpydzk0zdtehhstefp92",
      package: "",
    }),
    getInstalledSignerApps: vi.fn().mockResolvedValue({ apps: [] }),
  },
}));

import { NostrSignerPlugin } from "nostr-signer-capacitor-plugin";
import { AndroidNativeSigner } from "../android-native-signer.js";

const PACKAGE = "com.greenart7c3.amber";
const PUBKEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

beforeEach(() => {
  vi.mocked(NostrSignerPlugin.setPackageName).mockClear();
  vi.mocked(NostrSignerPlugin.getPublicKey).mockClear();
});

describe("AndroidNativeSigner", () => {
  it("skips the getPublicKey request when the pubkey was seeded", async () => {
    const signer = new AndroidNativeSigner(PACKAGE, PUBKEY);

    expect(await signer.getPublicKey()).toBe(PUBKEY);

    expect(NostrSignerPlugin.setPackageName).toHaveBeenCalledWith(PACKAGE);
    expect(NostrSignerPlugin.getPublicKey).not.toHaveBeenCalled();
  });

  it("requests the pubkey from the signer app when it was not seeded", async () => {
    const signer = new AndroidNativeSigner(PACKAGE);

    expect(await signer.getPublicKey()).toBe(PUBKEY);

    expect(NostrSignerPlugin.getPublicKey).toHaveBeenCalledTimes(1);
  });
});
