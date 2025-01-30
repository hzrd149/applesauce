import { AccountManager } from "../manager.js";
import { ExtensionAccount } from "./extension-account.js";
import { NostrConnectAccount } from "./nostr-connect-account.js";
import { PasswordAccount } from "./password-account.js";
import { ReadonlyAccount } from "./readonly-account.js";
import { SimpleAccount } from "./simple-account.js";

/** Registers the most common account types to a account manager */
export function registerCommonAccountTypes(manager: AccountManager) {
  manager.registerType(ExtensionAccount);
  manager.registerType(PasswordAccount);
  manager.registerType(ReadonlyAccount);
  manager.registerType(SimpleAccount);
  manager.registerType(NostrConnectAccount);
}
