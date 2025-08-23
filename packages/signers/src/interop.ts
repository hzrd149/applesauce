import { EventTemplate, Filter, NostrEvent } from "nostr-tools";
import { ObservableInput } from "rxjs";

export type ISigner = {
  getPublicKey: () => Promise<string>;
  signEvent: (template: EventTemplate) => Promise<NostrEvent>;
  nip04?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
  nip44?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
};

/** @deprecated Use ISigner instead */
export type Nip07Interface = ISigner;

/** A method used to subscribe to events on a set of relays */
export type NostrSubscriptionMethod = (relays: string[], filters: Filter[]) => ObservableInput<NostrEvent | string>;

/** A method used for publishing an event, can return a Promise that completes when published or an Observable that completes when published*/
export type NostrPublishMethod = (relays: string[], event: NostrEvent) => Promise<any> | ObservableInput<any>;

/** A simple pool type that combines the subscription and publish methods */
export type NostrPool = {
  subscription: NostrSubscriptionMethod;
  publish: NostrPublishMethod;
};

/** Options for setting the subscription and publish methods */
export type NostrConnectionMethodsOptions = {
  /** An optional method for subscribing to relays */
  subscriptionMethod?: NostrSubscriptionMethod;
  /** An optional method for publishing events */
  publishMethod?: NostrPublishMethod;
  /** An optional pool for connection methods */
  pool?: NostrPool;
};

/** A class that implements has global fallback methods for subscription and publish methods */
export interface NostrConnectionClassMethods {
  new (...args: any[]): any;
  /** A fallback method to use for subscriptionMethod if none is passed in when creating the client */
  subscriptionMethod: NostrSubscriptionMethod | undefined;
  /** A fallback method to use for publishMethod if none is passed in when creating the client */
  publishMethod: NostrPublishMethod | undefined;
  /** A fallback pool to use if none is pass in when creating the signer */
  pool: NostrPool | undefined;
}

/** Get the subscription and publish methods for a NostrConnect class */
export function getConnectionMethods(
  options: NostrConnectionMethodsOptions,
  cls?: NostrConnectionClassMethods,
): {
  subscriptionMethod: NostrSubscriptionMethod;
  publishMethod: NostrPublishMethod;
} {
  const subscriptionMethod =
    options.subscriptionMethod ||
    options.pool?.subscription.bind(options.pool) ||
    cls?.subscriptionMethod ||
    cls?.pool?.subscription.bind(cls.pool);
  if (!subscriptionMethod)
    throw new Error("Missing subscriptionMethod, either pass a method or set subscriptionMethod globally on the class");
  const publishMethod =
    options.publishMethod ||
    options.pool?.publish.bind(options.pool) ||
    cls?.publishMethod ||
    cls?.pool?.publish.bind(cls.pool);
  if (!publishMethod)
    throw new Error("Missing publishMethod, either pass a method or set publishMethod globally on the class");

  return {
    subscriptionMethod,
    publishMethod,
  };
}
