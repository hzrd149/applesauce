import { ActionHub } from "applesauce-actions";
import { User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core/event-factory";
import { bytesToHex, unlockHiddenTags } from "applesauce-core/helpers";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { beforeEach, describe, expect, it, Mock, vi, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletBlueprint } from "../../blueprints/wallet.js";
import { WALLET_HISTORY_KIND } from "../../helpers/history.js";
import { NUTZAP_INFO_KIND } from "../../helpers/nutzap-info.js";
import { unlockTokenContent, WALLET_TOKEN_KIND } from "../../helpers/tokens.js";
import {
  getWalletMints,
  getWalletPrivateKey,
  getWalletRelays,
  unlockWallet,
  WALLET_BACKUP_KIND,
  WALLET_KIND,
} from "../../helpers/wallet.js";
// Import casts to register wallet$ property on User
import "../../casts/index.js";
import { CreateWallet, SetWalletMints, SetWalletRelays, UnlockWallet, WalletAddPrivateKey } from "../wallet.js";

const signer = new FakeUser();

let events: EventStore;
let factory: EventFactory;
let publish: Mock<(...args: any[]) => Promise<void>>;
let hub: ActionHub;
beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer });
  publish = vitest.fn().mockResolvedValue(undefined);
  hub = new ActionHub(events, factory, publish);
  // Clear User cache to ensure clean state between tests
  User.cache.clear();
});

describe("CreateWallet", () => {
  it("should create a wallet event without private key", async () => {
    const mints = ["https://mint.money.com"];
    await hub.run(CreateWallet, { mints });

    // Should publish only the wallet event
    expect(publish).toHaveBeenCalledTimes(1);
    const publishedEvent = publish.mock.calls[0][0];
    expect(publishedEvent.kind).toBe(WALLET_KIND);
    expect(publishedEvent.pubkey).toBe(signer.pubkey);

    // Verify mints are in the wallet
    const hiddenTags = await unlockHiddenTags(publishedEvent, signer);
    expect(hiddenTags).toEqual(expect.arrayContaining([["mint", "https://mint.money.com"]]));
  });

  it("should create wallet, backup, and nutzap info events with private key", async () => {
    const mints = ["https://mint.money.com"];
    const privateKey = generateSecretKey();
    await hub.run(CreateWallet, { mints, privateKey });

    // Should publish all three events (publish unwraps arrays, so we get multiple calls)
    expect(publish).toHaveBeenCalledTimes(3);
    const calls = publish.mock.calls.map((call) => call[0]);
    const walletEvent = calls.find((e: any) => e.kind === WALLET_KIND);
    const backupEvent = calls.find((e: any) => e.kind === WALLET_BACKUP_KIND);
    const nutzapInfoEvent = calls.find((e: any) => e.kind === NUTZAP_INFO_KIND);

    expect(walletEvent).toBeDefined();
    expect(backupEvent).toBeDefined();
    expect(nutzapInfoEvent).toBeDefined();

    // Verify wallet has private key
    const hiddenTags = await unlockHiddenTags(walletEvent, signer);
    const privkeyTag = hiddenTags.find((t) => t[0] === "privkey");
    expect(privkeyTag).toBeDefined();
    expect(privkeyTag![1]).toBe(bytesToHex(privateKey));
  });

  it("should publish to specified relays", async () => {
    const mints = ["https://mint.money.com"];
    const relays = ["wss://relay1.com", "wss://relay2.com"];
    await hub.run(CreateWallet, { mints, relays });

    expect(publish).toHaveBeenCalledWith(expect.anything(), relays);
  });

  it("should throw error if mints array is empty", async () => {
    await expect(hub.run(CreateWallet, { mints: [] })).rejects.toThrow("At least one mint is required");
  });

  it("should throw error if wallet already exists", async () => {
    const mints = ["https://mint.money.com"];
    const walletEvent = await factory.sign(await factory.create(WalletBlueprint, { mints }));
    await events.add(walletEvent);

    await expect(hub.run(CreateWallet, { mints })).rejects.toThrow("Wallet already exists");
  });
});

describe("WalletAddPrivateKey", () => {
  it("should add a private key to an existing wallet event without a private key", async () => {
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"] }),
    );
    await events.add(walletEvent);

    const privateKey = generateSecretKey();
    await hub.run(WalletAddPrivateKey, privateKey);

    // Check the published wallet event
    expect(publish).toHaveBeenCalled();
    const calls = publish.mock.calls.map((call) => call[0]);
    const updatedWallet = calls.find((e: any) => e.kind === WALLET_KIND);
    expect(updatedWallet).toBeDefined();

    await unlockWallet(updatedWallet!, signer);
    const key = getWalletPrivateKey(updatedWallet!);
    expect(key).toBeDefined();
    expect(bytesToHex(key!)).toEqual(bytesToHex(privateKey));
  });

  it("should create backup and nutzap info events when adding private key", async () => {
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"] }),
    );
    await events.add(walletEvent);

    const privateKey = generateSecretKey();
    await hub.run(WalletAddPrivateKey, privateKey);

    // Should publish wallet, backup, and nutzap info (publish unwraps arrays)
    expect(publish).toHaveBeenCalledTimes(3);
    const calls = publish.mock.calls.map((call) => call[0]);
    const backupEvent = calls.find((e: any) => e.kind === WALLET_BACKUP_KIND);
    const nutzapInfoEvent = calls.find((e: any) => e.kind === NUTZAP_INFO_KIND);

    expect(backupEvent).toBeDefined();
    expect(nutzapInfoEvent).toBeDefined();
  });

  it("should throw an error if a wallet event already has a private key", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"], privateKey }),
    );
    await events.add(walletEvent);

    await expect(hub.run(WalletAddPrivateKey, generateSecretKey())).rejects.toThrow("Wallet already has a private key");
  });

  it("should allow override if wallet already has a private key", async () => {
    const oldPrivateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"], privateKey: oldPrivateKey }),
    );
    await events.add(walletEvent);

    const newPrivateKey = generateSecretKey();
    await hub.run(WalletAddPrivateKey, newPrivateKey, true);

    // Check the published wallet event
    expect(publish).toHaveBeenCalled();
    const calls = publish.mock.calls.map((call) => call[0]);
    const updatedWallet = calls.find((e: any) => e.kind === WALLET_KIND);
    expect(updatedWallet).toBeDefined();

    await unlockWallet(updatedWallet!, signer);
    const key = getWalletPrivateKey(updatedWallet!);
    expect(key).toBeDefined();
    expect(bytesToHex(key!)).toEqual(bytesToHex(newPrivateKey));
  });

  it("should throw an error if the wallet event does not exist", async () => {
    vi.useFakeTimers();
    try {
      const privateKey = generateSecretKey();

      const promise = hub.run(WalletAddPrivateKey, privateKey);
      // Give the promise a chance to start and set up the observable subscription
      await vi.runOnlyPendingTimersAsync();
      // Advance timers past the 5 second timeout in getUnlockedWallet
      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).rejects.toThrow("Unable to find wallet");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("UnlockWallet", () => {
  it("should unlock wallet event", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"], privateKey }),
    );
    await events.add(walletEvent);

    await hub.run(UnlockWallet);

    // Verify wallet is unlocked by checking if we can access private key
    const wallet = events.getReplaceable(WALLET_KIND, signer.pubkey);
    expect(wallet).toBeDefined();
    await unlockWallet(wallet!, signer);
    const key = getWalletPrivateKey(wallet!);
    expect(key).toBeDefined();
  });

  it("should unlock wallet and tokens", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"], privateKey }),
    );
    await events.add(walletEvent);

    // Create a token event
    const { WalletTokenBlueprint } = await import("../../blueprints/tokens.js");
    const tokenEvent = await factory.sign(
      await factory.create(WalletTokenBlueprint, {
        mint: "https://mint.money.com",
        proofs: [{ amount: 10, secret: "secret", C: "C", id: "id" }],
      }),
    );
    await events.add(tokenEvent);

    await hub.run(UnlockWallet, { tokens: true });

    // Verify token is unlocked
    const tokens = events.getTimeline({ kinds: [WALLET_TOKEN_KIND], authors: [signer.pubkey] });
    expect(tokens.length).toBeGreaterThan(0);
    const unlockedToken = await unlockTokenContent(tokens[0], signer);
    expect(unlockedToken).toBeDefined();
  });

  it("should unlock wallet and history", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"], privateKey }),
    );
    await events.add(walletEvent);

    // Create a history event
    const { WalletHistoryBlueprint } = await import("../../blueprints/history.js");
    const historyEvent = await factory.sign(
      await factory.create(WalletHistoryBlueprint, {
        direction: "in",
        amount: 100,
        created: [],
        mint: "https://mint.money.com",
      }),
    );
    await events.add(historyEvent);

    await hub.run(UnlockWallet, { history: true });

    // Verify history is unlocked (we can't easily test this without more helpers, but we can verify it doesn't throw)
    const history = events.getTimeline({ kinds: [WALLET_HISTORY_KIND], authors: [signer.pubkey] });
    expect(history.length).toBeGreaterThan(0);
  });

  it("should unlock wallet, tokens, and history together", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"], privateKey }),
    );
    await events.add(walletEvent);

    await hub.run(UnlockWallet, { tokens: true, history: true });

    // Should not throw
    expect(true).toBe(true);
  });

  it("should throw error if wallet does not exist", async () => {
    await expect(hub.run(UnlockWallet)).rejects.toThrow("Wallet does not exist");
  });

  it("should throw error if signer is missing", async () => {
    const factoryWithoutSigner = new EventFactory({});
    const hubWithoutSigner = new ActionHub(events, factoryWithoutSigner, publish);

    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.money.com"] }),
    );
    await events.add(walletEvent);

    await expect(hubWithoutSigner.run(UnlockWallet)).rejects.toThrow("Missing signer");
  });
});

describe("SetWalletMints", () => {
  it("should update wallet mints", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint1.com"], privateKey }),
    );
    await events.add(walletEvent);

    const newMints = ["https://mint2.com", "https://mint3.com"];

    await hub.run(SetWalletMints, newMints);

    // Verify mints were updated - check the published event
    expect(publish).toHaveBeenCalled();
    const publishedEvent = publish.mock.calls.find((call) => call[0].kind === WALLET_KIND)?.[0];
    expect(publishedEvent).toBeDefined();
    await unlockWallet(publishedEvent!, signer);
    const mints = getWalletMints(publishedEvent!);
    expect(mints).toEqual(newMints);
  });

  it("should publish updated wallet event", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint1.com"], privateKey }),
    );
    await events.add(walletEvent);

    const newMints = ["https://mint2.com"];

    await hub.run(SetWalletMints, newMints);

    expect(publish).toHaveBeenCalled();
    const publishedEvent = publish.mock.calls[0][0];
    expect(publishedEvent.kind).toBe(WALLET_KIND);
  });

  it("should throw error if wallet does not exist", async () => {
    vi.useFakeTimers();
    try {
      const promise = hub.run(SetWalletMints, ["https://mint.com"]);
      // Give the promise a chance to start and set up the observable subscription
      await vi.runOnlyPendingTimersAsync();
      // Advance timers past the 5 second timeout in getUnlockedWallet
      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).rejects.toThrow("Unable to find wallet");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SetWalletRelays", () => {
  it("should update wallet relays", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, {
        mints: ["https://mint.com"],
        privateKey,
        relays: ["wss://old-relay.com"],
      }),
    );
    await events.add(walletEvent);

    const newRelays = ["wss://new-relay1.com", "wss://new-relay2.com"];

    await hub.run(SetWalletRelays, newRelays);

    // Verify relays were updated - get the latest event from publish calls
    expect(publish).toHaveBeenCalled();
    const publishedEvent = publish.mock.calls.find((call) => call[0].kind === WALLET_KIND)?.[0];
    expect(publishedEvent).toBeDefined();
    await unlockWallet(publishedEvent!, signer);
    const relays = getWalletRelays(publishedEvent!);
    // URLs may have trailing slashes, so we normalize
    expect(relays?.map((r) => r.replace(/\/$/, ""))).toEqual(newRelays.map(String));
  });

  it("should publish to new relays", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.com"], privateKey }),
    );
    await events.add(walletEvent);

    const newRelays = ["wss://new-relay1.com", "wss://new-relay2.com"];

    await hub.run(SetWalletRelays, newRelays);

    expect(publish).toHaveBeenCalled();
    const publishedEvent = publish.mock.calls[0][0];
    const publishedRelays = publish.mock.calls[0][1];
    expect(publishedEvent.kind).toBe(WALLET_KIND);
    expect(publishedRelays).toEqual(newRelays.map(String));
  });

  it("should handle URL objects as relays", async () => {
    const privateKey = generateSecretKey();
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, { mints: ["https://mint.com"], privateKey }),
    );
    await events.add(walletEvent);

    const newRelays = [new URL("wss://new-relay.com")];

    await hub.run(SetWalletRelays, newRelays);

    expect(publish).toHaveBeenCalled();
    const publishedRelays = publish.mock.calls.find((call) => call[0].kind === WALLET_KIND)?.[1];
    // URL.toString() may add trailing slash, so we normalize
    expect(publishedRelays).toEqual(["wss://new-relay.com/"]);
  });

  it("should throw error if wallet does not exist", async () => {
    vi.useFakeTimers();
    try {
      const promise = hub.run(SetWalletRelays, ["wss://relay.com"]);
      // Give the promise a chance to start and set up the observable subscription
      await vi.runOnlyPendingTimersAsync();
      // Advance timers past the 5 second timeout in getUnlockedWallet
      await vi.advanceTimersByTimeAsync(5000);
      await expect(promise).rejects.toThrow("Unable to find wallet");
    } finally {
      vi.useRealTimers();
    }
  });
});
