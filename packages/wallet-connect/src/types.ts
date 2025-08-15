import { Filter, NostrEvent } from "nostr-tools";
import { Observable } from "rxjs";

/** A method used to subscribe to events on a set of relays */
export type NostrSubscriptionMethod = (relays: string[], filters: Filter[]) => Observable<NostrEvent | string>;

/** A method used for publishing an event, can return a Promise that completes when published or an Observable that completes when published*/
export type NostrPublishMethod = (relays: string[], event: NostrEvent) => Promise<any> | Observable<any>;

/** A simple pool type that combines the subscription and publish methods */
export type NostrPool = {
  subscription: NostrSubscriptionMethod;
  publish: NostrPublishMethod;
};
