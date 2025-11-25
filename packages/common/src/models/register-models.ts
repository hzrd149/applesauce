import { AddressPointer, EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { NostrEvent } from "nostr-tools";
import { Observable } from "rxjs";

// Import EventModels as a value (class) to modify its prototype
// Using a side-effect import to ensure the class is available
import { EventModels } from "applesauce-core/event-store";

import { Mutes } from "../helpers/mutes.js";
import { UserBlossomServersModel } from "./blossom.js";
import { CommentsModel } from "./comments.js";
import { MuteModel } from "./mutes.js";
import { ReactionsModel } from "./reactions.js";
import { Thread, ThreadModel } from "./thread.js";

/**
 * Extends EventModels with common helpful subscription methods.
 * This modifies the prototype of EventModels to add methods for common models.
 *
 * This module should be imported to register the common helpful subscriptions.
 * Simply importing this module will add the methods to EventModels.
 */
// Add methods to EventModels prototype
EventModels.prototype.mutes = function (user: string | ProfilePointer) {
  if (typeof user === "string") user = { pubkey: user };
  return this.model(MuteModel, user);
};

EventModels.prototype.blossomServers = function (user: string | ProfilePointer) {
  if (typeof user === "string") user = { pubkey: user };
  return this.model(UserBlossomServersModel, user);
};

EventModels.prototype.reactions = function (event: NostrEvent) {
  return this.model(ReactionsModel, event);
};

EventModels.prototype.thread = function (root: string | EventPointer | AddressPointer) {
  return this.model(ThreadModel, root);
};

EventModels.prototype.comments = function (event: NostrEvent) {
  return this.model(CommentsModel, event);
};

/**
 * Type augmentation for EventModels to include common helpful subscriptions.
 * This extends the type definition to include the methods added to the prototype.
 */
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to a users mutes */
    mutes(user: string | ProfilePointer): Observable<Mutes | undefined>;
    /** Subscribe to a users NIP-65 mailboxes */
    mailboxes(user: string | ProfilePointer): Observable<{ inboxes: string[]; outboxes: string[] } | undefined>;
    /** Subscribe to a users blossom servers */
    blossomServers(user: string | ProfilePointer): Observable<URL[]>;
    /** Subscribe to an event's reactions */
    reactions(event: NostrEvent): Observable<NostrEvent[]>;
    /** Subscribe to a thread */
    thread(root: string | EventPointer | AddressPointer): Observable<Thread>;
    /** Subscribe to an event's comments */
    comments(event: NostrEvent): Observable<NostrEvent[]>;
  }
}
