import { unixNow } from "applesauce-core/helpers";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user";
import { WalletFactory } from "../../factories/wallet";
import { WALLET_BACKUP_KIND } from "../../helpers/wallet";
import { setBackupContent } from "../wallet";

const user = new FakeUser();

describe("setBackupContent", () => {
  it("should throw if kind is not wallet kind", async () => {
    const note = user.note();

    await expect(
      setBackupContent(note, user)({ kind: WALLET_BACKUP_KIND, tags: [], created_at: unixNow(), content: "" }),
    ).rejects.toThrow();
  });

  it("should throw if pubkey does not match", async () => {
    const wallet = await WalletFactory.create([], generateSecretKey()).as(user).sign();
    const user2 = new FakeUser();

    await expect(
      setBackupContent(wallet, user2)({ kind: WALLET_BACKUP_KIND, tags: [], created_at: unixNow(), content: "" }),
    ).rejects.toThrow();
  });

  it("should copy the content of the wallet event", async () => {
    const wallet = await WalletFactory.create([], generateSecretKey()).as(user).sign();

    expect(
      await setBackupContent(wallet, user)({ kind: WALLET_BACKUP_KIND, tags: [], created_at: unixNow(), content: "" }),
    ).toEqual(expect.objectContaining({ content: wallet.content }));
  });
});
