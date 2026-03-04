import { AndroidNativeSigner } from "applesauce-signers/signers/android-native-signer";
import { AppInfo, NostrSignerPlugin } from "nostr-signer-capacitor-plugin";
import { BaseAccount } from "../account.js";
import { SerializedAccount } from "../types.js";
import { AccountManager } from "../manager.js";
import { registerCommonAccountTypes } from "./common.js";

type SignerData = {
  packageName: string;
};

export class AndroidNativeAccount<Metadata extends unknown> extends BaseAccount<
  AndroidNativeSigner,
  SignerData,
  Metadata
> {
  static readonly type = "android-native";

  static async getSignerApps() {
    return (await NostrSignerPlugin.getInstalledSignerApps()).apps;
  }

  toJSON() {
    return super.saveCommonFields({
      signer: { packageName: this.signer.packageName },
    });
  }

  static fromJSON<Metadata extends unknown>(
    json: SerializedAccount<SignerData, Metadata>,
  ): AndroidNativeAccount<Metadata> {
    const signer = new AndroidNativeSigner(json.signer.packageName);
    return new AndroidNativeAccount(json.pubkey, signer);
  }

  static async fromApp<Metadata extends unknown>(app: AppInfo): Promise<AndroidNativeAccount<Metadata>> {
    const signer = new AndroidNativeSigner(app.packageName);
    const pubkey = await signer.getPublicKey();
    return new AndroidNativeAccount<Metadata>(pubkey, signer);
  }
}

/** Setup common signers types for capacitor android apps */
export function registerAndroidAccounts(manager: AccountManager) {
  registerCommonAccountTypes(manager);
  manager.registerType(AndroidNativeAccount);
}
