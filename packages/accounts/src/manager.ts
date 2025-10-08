import { ISigner } from "applesauce-signers";
import { BehaviorSubject } from "rxjs";

import { IAccount, IAccountConstructor, SerializedAccount } from "./types.js";
import { ProxySigner } from "./proxy-signer.js";

export class AccountManager<Metadata extends unknown = any> {
  types = new Map<string, IAccountConstructor<any, any, Metadata>>();

  active$ = new BehaviorSubject<IAccount<any, any, Metadata> | undefined>(undefined);
  get active() {
    return this.active$.value;
  }

  accounts$ = new BehaviorSubject<IAccount<any, any, Metadata>[]>([]);
  get accounts() {
    return this.accounts$.value;
  }

  /** Proxy signer for currently active account */
  signer: ISigner;

  /** Disable request queueing for any accounts added to this manager */
  disableQueue?: boolean;

  constructor() {
    this.signer = new ProxySigner(this.active$, "No active account");
  }

  // Account type CRUD

  /** Add account type class */
  registerType<S extends ISigner>(accountType: IAccountConstructor<S, any, Metadata>) {
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
  getAccount<Signer extends ISigner>(
    id: string | IAccount<Signer, any, Metadata>,
  ): IAccount<Signer, any, Metadata> | undefined {
    if (typeof id === "string") return this.accounts$.value.find((a) => a.id === id);
    else if (this.accounts$.value.includes(id)) return id;
    else return undefined;
  }

  /** Return the first account for a pubkey */
  getAccountForPubkey(pubkey: string): IAccount<any, any, Metadata> | undefined {
    return Object.values(this.accounts$.value).find((account) => account.pubkey === pubkey);
  }

  /** Returns all accounts for a pubkey */
  getAccountsForPubkey(pubkey: string): IAccount<any, any, Metadata>[] {
    return Object.values(this.accounts$.value).filter((account) => account.pubkey === pubkey);
  }

  /** adds an account to the manager */
  addAccount(account: IAccount<any, any, Metadata>) {
    if (this.getAccount(account.id)) return;

    // copy the disableQueue flag only if its set
    if (this.disableQueue !== undefined && account.disableQueue !== undefined) {
      account.disableQueue = this.disableQueue;
    }

    this.accounts$.next([...this.accounts$.value, account]);
  }

  /** Removes an account from the manager */
  removeAccount(account: string | IAccount<any, any, Metadata>) {
    const id = typeof account === "string" ? account : account.id;
    this.accounts$.next(this.accounts$.value.filter((a) => a.id !== id));

    // if the removed account was active, clear the active account
    if (this.active$.value?.id === id) this.active$.next(undefined);
  }

  /** Replaces an account with another */
  replaceAccount(old: string | IAccount<any, any, Metadata>, account: IAccount<any, any, Metadata>) {
    this.addAccount(account);

    // if the old account was active, switch to the new one
    const id = typeof account === "string" ? account : account.id;
    if (this.active$.value?.id === id) this.setActive(account);

    this.removeAccount(old);
  }

  // Active account methods

  /** Returns the currently active account */
  getActive() {
    return this.active$.value;
  }
  /** Sets the currently active account */
  setActive(id: string | IAccount<any, any, Metadata>) {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");

    if (this.active$.value?.id !== account.id) {
      this.active$.next(account);
    }
  }
  /** Clears the currently active account */
  clearActive() {
    this.active$.next(undefined);
  }

  // Metadata CRUD

  /** sets the metadata on an account */
  setAccountMetadata(id: string | IAccount<any, any, Metadata>, metadata: Metadata) {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");
    account.metadata = metadata;
  }

  /** sets the metadata on an account */
  getAccountMetadata(id: string | IAccount<any, any, Metadata>): Metadata | undefined {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");
    return account.metadata;
  }

  /** Removes all metadata on the account */
  clearAccountMetadata(id: string | IAccount<any, any, Metadata>) {
    const account = this.getAccount(id);
    if (!account) throw new Error("Cant find account with that ID");
    account.metadata = undefined;
  }

  // Serialize / Deserialize

  /** Returns an array of serialized accounts */
  toJSON(quite = false): SerializedAccount<any, Metadata>[] {
    const accounts: SerializedAccount<any, Metadata>[] = [];

    for (const account of this.accounts) {
      try {
        accounts.push(account.toJSON());
      } catch (error) {
        if (!quite) throw error;
      }
    }

    return accounts;
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
        else console.log(`Failed to load account`, error);
      }
    }
  }

  /** Create an account from a types array and a serialized account */
  static deserialize<
    Signer extends ISigner = ISigner,
    SignerData extends unknown = any,
    Metadata extends unknown = any,
  >(
    types: IAccountConstructor<any, any, any>[],
    json: SerializedAccount<SignerData, Metadata>,
  ): IAccount<Signer, SignerData, Metadata> {
    const account = types.find((type) => type.type === json.type)?.fromJSON(json);
    if (!account) throw new Error(`Missing account type ${json.type}`);
    return account;
  }
}
