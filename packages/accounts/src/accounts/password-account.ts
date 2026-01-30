import { PasswordSigner } from "applesauce-signers/signers/password-signer";
import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";

export type PasswordAccountSignerData = {
  ncryptsec: string;
};

export class PasswordAccount<Metadata extends unknown = unknown> extends BaseAccount<
  PasswordSigner,
  PasswordAccountSignerData,
  Metadata
> {
  static readonly type = "ncryptsec";

  get unlocked() {
    return this.signer.unlocked;
  }

  /** called when PasswordAccount.unlock is called without a password */
  static requestUnlockPassword?: (account: PasswordAccount<any>) => Promise<string>;

  /**
   * Attempt to unlock the signer with a password
   * @throws
   */
  async unlock(password?: string) {
    if (!password) {
      if (!PasswordAccount.requestUnlockPassword)
        throw new Error(
          "Cant unlock PasswordAccount without a password. either pass one in or set PasswordAccount.requestUnlockPassword",
        );

      password = await PasswordAccount.requestUnlockPassword(this);
    }
    await this.signer.unlock(password);
  }

  protected override operation<T extends unknown>(operation: () => Promise<T>): Promise<T> {
    // If the account is not unlocked, wait for the unlock password to be provided
    if (!this.unlocked) {
      if (!PasswordAccount.requestUnlockPassword)
        throw new Error("Account is locked and there is no requestUnlockPassword method");

      return this.unlock().then(() => super.operation(operation));
    } else return super.operation(operation);
  }

  toJSON(): SerializedAccount<PasswordAccountSignerData, Metadata> {
    if (!this.signer.ncryptsec) throw new Error("Cant save account without ncryptsec");

    return super.saveCommonFields({
      signer: { ncryptsec: this.signer.ncryptsec },
    });
  }

  static fromJSON<Metadata extends unknown = unknown>(
    json: SerializedAccount<PasswordAccountSignerData, Metadata>,
  ): PasswordAccount<Metadata> {
    const signer = new PasswordSigner();
    signer.ncryptsec = json.signer.ncryptsec;
    const account = new PasswordAccount<Metadata>(json.pubkey, signer);
    return super.loadCommonFields(account, json);
  }

  /** Creates a new PasswordAccount from a ncryptsec string */
  static fromNcryptsec<Metadata extends unknown = unknown>(
    pubkey: string,
    ncryptsec: string,
  ): PasswordAccount<Metadata> {
    const signer = new PasswordSigner();
    signer.ncryptsec = ncryptsec;
    return new PasswordAccount(pubkey, signer);
  }
}
