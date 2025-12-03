import hash_sum from "hash-sum";
import { Observable, ReplaySubject, finalize, share, timer } from "rxjs";
import { NostrEvent } from "../helpers/event.js";
import { Filter } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer, ProfilePointer } from "../helpers/pointers.js";
import { ProfileContent } from "../helpers/profile.js";
import { EventModel, FiltersModel, ReplaceableModel, TimelineModel } from "../models/base.js";
import { ContactsModel } from "../models/contacts.js";
import { MailboxesModel } from "../models/mailboxes.js";
import { ProfileModel } from "../models/profile.js";
import { IAsyncEventStore, IEventStore, ModelConstructor } from "./interface.js";

/**
 * Core helpful subscriptions interface.
 * Contains only methods that use models from the core package.
 * Other packages (like applesauce-common) can extend this interface via module augmentation.
 */
export interface IEventStoreModels {
  /** Subscribe to a users profile */
  profile(user: string | ProfilePointer): Observable<ProfileContent | undefined>;
  /** Subscribe to a users contacts */
  contacts(user: string | ProfilePointer): Observable<ProfilePointer[]>;
  /** Subscribe to a users mailboxes */
  mailboxes(user: string | ProfilePointer): Observable<{ inboxes: string[]; outboxes: string[] } | undefined>;
}

/**
 * Base class that provides model functionality for both sync and async event stores.
 * This class can be extended by other packages to add additional helpful subscription methods.
 *
 * @example
 * ```ts
 * // In another package (e.g., applesauce-common)
 * import { EventModels } from "applesauce-core/event-store";
 *
 * // Add methods to the prototype
 * EventModels.prototype.mutes = function(user) {
 *   return this.model(MuteModel, user);
 * };
 *
 * // Extend the type via module augmentation
 * declare module "applesauce-core/event-store" {
 *   interface EventModels {
 *     mutes(user: string | ProfilePointer): Observable<Mutes | undefined>;
 *   }
 * }
 * ```
 */
export class EventModels<
  TStore extends IEventStore | IAsyncEventStore = IEventStore | IAsyncEventStore,
> implements IEventStoreModels {
  /** A directory of all active models */
  models = new Map<ModelConstructor<any, any[], TStore>, Map<string, Observable<any>>>();

  /** How long a model should be kept "warm" while nothing is subscribed to it */
  modelKeepWarm = 60_000;

  /** Get or create a model on the event store */
  model<T extends unknown, Args extends Array<any>>(
    constructor: ModelConstructor<T, Args, TStore>,
    ...args: Args
  ): Observable<T> {
    let models = this.models.get(constructor);
    if (!models) {
      models = new Map();
      this.models.set(constructor, models);
    }

    const key = constructor.getKey ? constructor.getKey(...args) : hash_sum(args);
    let model: Observable<T> | undefined = models.get(key);

    // Create the model if it does not exist
    if (!model) {
      const cleanup = () => {
        // Remove the model from the cache if its the same one
        if (models.get(key) === model) models.delete(key);
      };

      model = constructor(...args)(this as any).pipe(
        // remove the model when its unsubscribed
        finalize(cleanup),
        // only subscribe to models once for all subscriptions
        share({
          connector: () => new ReplaySubject(1),
          resetOnComplete: () => timer(this.modelKeepWarm),
          resetOnRefCountZero: () => timer(this.modelKeepWarm),
        }),
      );

      // Add the model to the cache
      models.set(key, model);
    }

    return model;
  }

  /**
   * Creates an observable that streams all events that match the filter
   * @param filters
   * @param [onlyNew=false] Only subscribe to new events
   */
  filters(filters: Filter | Filter[], onlyNew = false): Observable<NostrEvent> {
    return this.model(FiltersModel, filters, onlyNew);
  }

  // Helper methods for creating models

  /** Creates a {@link EventModel} */
  event(pointer: string | EventPointer): Observable<NostrEvent | undefined> {
    if (typeof pointer === "string") pointer = { id: pointer };
    return this.model(EventModel, pointer);
  }

  /** Subscribe to a replaceable event by pointer */
  replaceable(pointer: AddressPointer | AddressPointerWithoutD): Observable<NostrEvent | undefined>;
  replaceable(kind: number, pubkey: string, identifier?: string): Observable<NostrEvent | undefined>;
  replaceable(...args: any[]): Observable<NostrEvent | undefined> {
    let pointer: AddressPointer | AddressPointerWithoutD | undefined;

    // Parse arguments
    if (args.length === 1) {
      pointer = args[0] as AddressPointer | AddressPointerWithoutD;
    } else if (args.length === 3 || args.length === 2) {
      let [kind, pubkey, identifier] = args as [number, string, string | undefined];
      pointer = { kind, pubkey, identifier };
    }

    if (!pointer) throw new Error("Invalid arguments, expected address pointer or kind, pubkey, identifier");

    return this.model(ReplaceableModel, pointer);
  }

  /** Subscribe to an addressable event by pointer */
  addressable(pointer: AddressPointer): Observable<NostrEvent | undefined> {
    return this.model(ReplaceableModel, pointer);
  }

  /** Creates a {@link TimelineModel} */
  timeline(filters: Filter | Filter[], includeOldVersion = false): Observable<NostrEvent[]> {
    return this.model(TimelineModel, filters, includeOldVersion);
  }

  /** Subscribe to a users profile */
  profile(user: string | ProfilePointer) {
    typeof user === "string" ? { pubkey: user } : user;
    return this.model(ProfileModel, user);
  }

  /** Subscribe to a users contacts */
  contacts(user: string | ProfilePointer) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(ContactsModel, user);
  }

  /** Subscribe to a users mailboxes */
  mailboxes(user: string | ProfilePointer) {
    if (typeof user === "string") user = { pubkey: user };
    return this.model(MailboxesModel, user);
  }
}
