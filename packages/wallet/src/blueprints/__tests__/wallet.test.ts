import { createEvent, EventFactory } from "applesauce-core/event-factory";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { getWalletMints, getWalletPrivateKey } from "../../helpers/wallet";
import { WalletBlueprint } from "../wallet";
import { bytesToHex } from "applesauce-core/helpers";

const user = new FakeUser();
const factory = new EventFactory({ signer: user });

describe("WalletBlueprint", () => {
  it("should create a wallet event with mints", async () => {
    const draft = await createEvent({ signer: user }, WalletBlueprint, { mints: ["https://mint.money.com"] });
    const event = await factory.sign(draft);

    expect(getWalletMints(event)).toEqual(["https://mint.money.com"]);
  });

  it("should create a wallet event with a private key", async () => {
    const key = generateSecretKey();
    const draft = await createEvent({ signer: user }, WalletBlueprint, {
      mints: ["https://mint.money.com"],
      privateKey: key,
    });
    const event = await factory.sign(draft);

    const privkey = getWalletPrivateKey(event);
    expect(privkey).toBeDefined();
    expect(bytesToHex(privkey!)).toEqual(bytesToHex(key));
  });
});
