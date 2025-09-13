import hash_sum from "hash-sum";
import { Filter, NostrEvent } from "nostr-tools";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";
import { EMPTY, Observable, ReplaySubject, filter, finalize, from, merge, mergeMap, share, timer } from "rxjs";

import { matchFilters } from "../helpers/filter.js";
import { AddressPointerWithoutD } from "../helpers/pointers.js";
import {
  IAsyncEventStore,
  IEventHelpfulSubscriptions,
  IEventModelMixin,
  IEventStore,
  ModelConstructor,
} from "./interface.js";

// Model imports
import { UserBlossomServersModel } from "../models/blossom.js";
import { EventModel, EventsModel, ReplaceableModel, ReplaceableSetModel, TimelineModel } from "../models/common.js";
import { ContactsModel } from "../models/contacts.js";
import { CommentsModel, ThreadModel } from "../models/index.js";
import { MailboxesModel } from "../models/mailboxes.js";
import { MuteModel } from "../models/mutes.js";
import { ProfileModel } from "../models/profile.js";
import { ReactionsModel } from "../models/reactions.js";

/** A mixin that provides model functionality for both sync and async event stores */
export function EventStoreModelMixin<
  T extends new (...args: any[]) => any,
  TStore extends IEventStore | IAsyncEventStore,
>(Base: T) {
  return class extends Base implements IEventModelMixin<TStore>, IEventHelpfulSubscriptions {
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
      filters = Array.isArray(filters) ? filters : [filters];

      const getByFiltersResult = (this as any).getByFilters(filters);

      // Create the existing events observable
      const existingEvents$: Observable<NostrEvent> = onlyNew
        ? EMPTY
        : // Check if result is a Promise (async) or direct Set (sync)
          getByFiltersResult && typeof getByFiltersResult.then === "function"
          ? from(getByFiltersResult as Promise<Set<NostrEvent>>).pipe(
              mergeMap((events: Set<NostrEvent>) => from(Array.from(events))),
            )
          : from(Array.from(getByFiltersResult as Set<NostrEvent>));

      // Create the new events observable
      const newEvents$: Observable<NostrEvent> = (this as any).insert$.pipe(
        filter((e: NostrEvent) => matchFilters(filters, e)),
      );

      return merge(existingEvents$, newEvents$);
    }

    // Helper methods for creating models

    /** Creates a {@link EventModel} */
    event(pointer: string | EventPointer): Observable<NostrEvent | undefined> {
      if (typeof pointer === "string") pointer = { id: pointer };
      return this.model(EventModel, pointer);
    }

    /** Creates a {@link ReplaceableModel} */
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
      return this.model(ProfileModel, user);
    }
    /** Subscribe to a users contacts */
    contacts(user: string | ProfilePointer) {
      if (typeof user === "string") user = { pubkey: user };
      return this.model(ContactsModel, user);
    }
    /** Subscribe to a users mutes */
    mutes(user: string | ProfilePointer) {
      if (typeof user === "string") user = { pubkey: user };
      return this.model(MuteModel, user);
    }
    /** Subscribe to a users NIP-65 mailboxes */
    mailboxes(user: string | ProfilePointer) {
      if (typeof user === "string") user = { pubkey: user };
      return this.model(MailboxesModel, user);
    }
    /** Subscribe to a users blossom servers */
    blossomServers(user: string | ProfilePointer) {
      if (typeof user === "string") user = { pubkey: user };
      return this.model(UserBlossomServersModel, user);
    }
    /** Subscribe to an event's reactions */
    reactions(event: NostrEvent) {
      return this.model(ReactionsModel, event);
    }
    /** Subscribe to a thread */
    thread(root: string | EventPointer | AddressPointer) {
      return this.model(ThreadModel, root);
    }
    /** Subscribe to a event's comments */
    comments(event: NostrEvent) {
      return this.model(CommentsModel, event);
    }

    /** @deprecated use multiple {@link EventModel} instead */
    events(ids: string[]): Observable<Record<string, NostrEvent | undefined>> {
      return this.model(EventsModel, ids);
    }
    /** @deprecated use multiple {@link ReplaceableModel} instead */
    replaceableSet(
      pointers: { kind: number; pubkey: string; identifier?: string }[],
    ): Observable<Record<string, NostrEvent | undefined>> {
      return this.model(ReplaceableSetModel, pointers);
    }
  };
}
