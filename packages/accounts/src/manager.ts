import { Nip07Interface } from "applesauce-signer";
import { BehaviorSubject } from "rxjs";

import { IAccount, IAccountConstructor, SerializedAccount } from "./types.js";

export class AccountManager<Metadata extends unknown = any> {
  active = new BehaviorSubject<IAccount<any, any, Metadata> | null>(null);
  accounts = new BehaviorSubject<Record<string, IAccount<any, any, Metadata>>>({});
  types = new Map<string, IAccountConstructor<any, any, Metadata>>();

  // Account type CRUD

  /** Add account type class */
  registerType<S extends Nip07Interface>(accountType: IAccountConstructor<S, any, Metadata>) {
    if (!accountType.type) throw new Error(`Account class missing static "type" field`);
    if (this.types.has(accountType.type)) throw new Error(`An account type of ${accountType.type} already exists`);
    this.types.set(accountType.type, accountType);
  }

  /** Remove account type */
  unregisterType(type: string) {
    this.types.delete(type);
  }

  // Accounts CRUD

  /** gets an account in the manager */
  getAccount<S extends Nip07Interface>(
    id: string | IAccount<S, any, Metadata>,
  ): IAccount<S, any, Metadata> | undefined {
    if (typeof id === "string") return this.accounts.value[id];
    else if (this.accounts.value[id.id]) return id;
    else return undefined;
  }

  /** adds an account to the manager */
  addAccount(account: IAccount<any, any, Metadata>) {
    if (this.getAccount(account.id)) return;

    this.accounts.next({
      ...this.accounts.value,
      [account.id]: account,
    });
  }

  /** Removes an account from the manager */
  removeAccount(account: string | IAccount<any, any, Metadata>) {
    const id = typeof account === "string" ? account : account.id;
    const next = { ...this.accounts.value };
    delete next[id];
    this.accounts.next(next);
  }

  /** Replaces an account with another */
  replaceAccount(old: string | IAccount<any, any, Metadata>, account: IAccount<any, any, Metadata>) {
    this.addAccount(account);

    // if the old account was active, switch to the new one
    const id = typeof account === "string" ? account : account.id;
    if (this.active.value?.id === id) this.setActive(account);

    this.removeAccount(old);
  }

  // Active account methods

  /** Returns the currently active account */
  getActive() {
    return this.active.value;
  }
  /** Sets the currently active account */
  setActive(id: string | IAccount<any, any, Metadata>) {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");

    if (this.active.value?.id !== account.id) {
      this.active.next(account);
    }
  }
  /** Clears the currently active account */
  clearActive() {
    this.active.next(null);
  }

  // Metadata CRUD

  /** sets the metadata on an account */
  setAccountMetadata(id: string | IAccount<any, any, Metadata>, metadata: Metadata) {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");
    account.metadata = metadata;
  }

  /** Removes all metadata on the account */
  clearAccountMetadata(id: string | IAccount<any, any, Metadata>) {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");
    account.metadata = undefined;
  }

  // Serialize / Deserialize

  /** Returns an array of serialized accounts */
  toJSON(): SerializedAccount<any, Metadata>[] {
    return Array.from(Object.values(this.accounts)).map((account) => account.toJSON());
  }

  /**
   * Restores all accounts from an array of serialized accounts
   * NOTE: this will clear all existing accounts
   */
  fromJSON(accounts: SerializedAccount<any, Metadata>[], quite = false) {
    for (const json of accounts) {
      try {
        const AccountType = this.types.get(json.type);

        if (!AccountType) {
          if (!quite) throw new Error(`Missing account type ${json.type}`);
          else continue;
        }

        const account = AccountType.fromJSON(json);
        this.addAccount(account);
      } catch (error) {
        if (!quite) throw error;
      }
    }
  }
}
