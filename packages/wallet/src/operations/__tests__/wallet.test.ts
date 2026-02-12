import { EventFactory } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user";
import { WalletBlueprint } from "../../blueprints/wallet";
import { WALLET_BACKUP_KIND } from "../../helpers/wallet";
import { setBackupContent } from "../wallet";

const user = new FakeUser();
const factory = new EventFactory({ signer: user });

describe("setBackupContent", () => {
  it("should throw if kind is not wallet kind", async () => {
    const note = user.note();

    await expect(
      setBackupContent(
        note,
        factory.services.signer,
      )({ kind: WALLET_BACKUP_KIND, tags: [], created_at: unixNow(), content: "" }),
    ).rejects.toThrow();
  });

  it("should throw if pubkey does not match", async () => {
    const wallet = await factory.sign(
      await factory.create(WalletBlueprint, { mints: [], privateKey: generateSecretKey() }),
    );
    const user2 = new FakeUser();

    await expect(
      setBackupContent(wallet, user2)({ kind: WALLET_BACKUP_KIND, tags: [], created_at: unixNow(), content: "" }),
    ).rejects.toThrow();
  });

  it("should copy the content of the wallet event", async () => {
    const wallet = await factory.sign(
      await factory.create(WalletBlueprint, { mints: [], privateKey: generateSecretKey() }),
    );

    expect(
      await setBackupContent(
        wallet,
        factory.services.signer,
      )({ kind: WALLET_BACKUP_KIND, tags: [], created_at: unixNow(), content: "" }),
    ).toEqual(expect.objectContaining({ content: wallet.content }));
  });
});
