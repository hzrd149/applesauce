import { describe, it, expect, beforeEach, vitest, Mock } from "vitest";
import { unlockHiddenTags } from "applesauce-core/helpers";
import { lastValueFrom } from "rxjs";
import { generateSecretKey } from "nostr-tools";
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core";
import { ActionHub } from "applesauce-actions";
import { bytesToHex } from "@noble/hashes/utils";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletAddPrivateKey, CreateWallet } from "../wallet.js";
import { getWalletPrivateKey, unlockWallet, WALLET_BACKUP_KIND } from "../../helpers/wallet.js";
import { WalletBlueprint } from "../../blueprints/wallet.js";

const user = new FakeUser();

let events: EventStore;
let factory: EventFactory;
let publish: Mock<() => Promise<void>>;
let hub: ActionHub;
beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
  publish = vitest.fn().mockResolvedValue(undefined);
  hub = new ActionHub(events, factory, publish);
});

describe("CreateWallet", () => {
  it("should publish a wallet backup event", async () => {
    await hub.run(CreateWallet, ["https://mint.money.com"]);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ kind: WALLET_BACKUP_KIND }));
  });

  it("should publish a wallet event with mints", async () => {
    const event = await lastValueFrom(hub.exec(CreateWallet, ["https://mint.money.com"]));
    const hiddenTags = await unlockHiddenTags(event, user);

    // the second call should be the wallet event
    expect(hiddenTags).toEqual(expect.arrayContaining([["mint", "https://mint.money.com"]]));
  });
});

describe("WalletAddPrivateKey", () => {
  it("should add a private key to an existing wallet event without a private key", async () => {
    const walletEvent = await factory.sign(await factory.create(WalletBlueprint, ["https://mint.money.com"]));
    await events.add(walletEvent);

    const privateKey = generateSecretKey();
    const updatedWallet = await lastValueFrom(hub.exec(WalletAddPrivateKey, privateKey));

    await unlockWallet(updatedWallet, user);

    const key = getWalletPrivateKey(updatedWallet);
    expect(key).toBeDefined();
    expect(bytesToHex(key!)).toEqual(bytesToHex(privateKey));
  });

  it("should throw an error if a wallet event already has a private key", async () => {
    const walletEvent = await factory.sign(
      await factory.create(WalletBlueprint, ["https://mint.money.com"], generateSecretKey()),
    );
    await events.add(walletEvent);

    await expect(hub.run(WalletAddPrivateKey, generateSecretKey())).rejects.toThrow("Wallet already has a private key");
  });

  it("should throw an error if the wallet event does not exist", async () => {
    const privateKey = generateSecretKey();

    await expect(hub.run(WalletAddPrivateKey, privateKey)).rejects.toThrow("Wallet does not exist");
  });
});
