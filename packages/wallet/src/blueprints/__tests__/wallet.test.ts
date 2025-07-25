import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user";
import { WalletBlueprint } from "../wallet";
import { build, create, EventFactory } from "applesauce-factory";
import { getWalletMints, getWalletPrivateKey } from "../../helpers/wallet";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";

const user = new FakeUser();
const factory = new EventFactory({ signer: user });

describe("WalletBlueprint", () => {
  it("should create a wallet event with mints", async () => {
    const draft = await create({ signer: user }, WalletBlueprint, ["https://mint.money.com"]);
    const event = await user.signEvent(draft);

    expect(getWalletMints(event)).toEqual(["https://mint.money.com"]);
  });

  it("should create a wallet event with a private key", async () => {
    const key = generateSecretKey();
    const draft = await create({ signer: user }, WalletBlueprint, ["https://mint.money.com"], key);
    const event = await user.signEvent(draft);

    const privkey = getWalletPrivateKey(event);
    expect(privkey).toBeDefined();
    expect(bytesToHex(privkey!)).toEqual(bytesToHex(key));
  });
});
