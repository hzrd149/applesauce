import { castUser, User } from "applesauce-common/casts/user";
import { EventFactory, EventSigner } from "applesauce-core/event-factory";
import {
  EventModels,
  IEventStoreActions,
  IEventStoreRead,
  IEventStoreStreams,
  IEventSubscriptions,
} from "applesauce-core/event-store";
import { EventTemplate, NostrEvent, UnsignedEvent } from "applesauce-core/helpers/event";
import { from, identity, isObservable, lastValueFrom, Observable, switchMap, tap } from "rxjs";

/** A callback used to tell the upstream app to publish an event */
export type PublishMethod = (event: NostrEvent, relays?: string[]) => void | Promise<any> | Observable<any>;
type UpstreamPool = PublishMethod | { publish: PublishMethod };

/** The context that is passed to actions for them to use to preform actions */
export type ActionContext = {
  /** The event store to load events from */
  events: IEventStoreRead & IEventStoreStreams & IEventSubscriptions & EventModels;
  /** The pubkey of the signer in the event factory */
  self: string;
  /** The {@link User} cast that is signing the events */
  user: User;
  /** The event signer used to sign events */
  signer?: EventSigner;
  /** The event factory used to build and modify events */
  factory: EventFactory;
  /** Sign an event using the event factory */
  sign: (draft: EventTemplate | UnsignedEvent) => Promise<NostrEvent>;
  /** The method to publish events to an optional list of relays */
  publish: (event: NostrEvent | NostrEvent[], relays?: string[]) => Promise<void>;
  /** Run a sub-action within the current action context and return the events */
  run: <Args extends Array<any>>(builder: ActionBuilder<Args>, ...args: Args) => Promise<void>;
};

/** An action that can be run in a context to preform an action */
export type Action = (context: ActionContext) => Promise<void>;

/** A function that takes arguments and returns an action */
export type ActionBuilder<Args extends Array<any>> = (...args: Args) => Action;

/** The main class that runs actions */
export class ActionRunner {
  /** Whether to save all events created by actions to the event store */
  saveToStore = true;

  constructor(
    public events: IEventStoreRead & IEventStoreStreams & IEventSubscriptions & IEventStoreActions & EventModels,
    public factory: EventFactory,
    private publishMethod?: UpstreamPool,
  ) {}

  protected async getContext() {
    if (!this.factory.services.signer) throw new Error("Missing signer");
    const self = await this.factory.services.signer.getPublicKey();
    const user = castUser(self, this.events);
    return {
      self,
      user,
      events: this.events,
      signer: this.factory.services.signer,
      factory: this.factory,
      publish: this.publish.bind(this),
      run: this.run.bind(this),
      sign: this.factory.sign.bind(this.factory),
    };
  }

  /** Internal method for publishing events to relays */
  async publish(event: NostrEvent | NostrEvent[], relays?: string[]): Promise<void> {
    if (!this.publishMethod) throw new Error("Missing publish method, use ActionRunner.exec");

    // Unwrap array of events to publish
    if (Array.isArray(event)) {
      await Promise.all(event.map((e) => this.publish(e, relays)));
      return;
    }

    if (this.publishMethod) {
      let result: void | Observable<any> | Promise<any>;

      if ("publish" in this.publishMethod) result = this.publishMethod.publish(event, relays);
      else if (typeof this.publishMethod === "function") result = this.publishMethod(event, relays);
      else throw new Error("Invalid publish method");

      if (isObservable(result)) {
        await lastValueFrom(result);
      } else if (result instanceof Promise) {
        await result;
      }

      // Optionally save the event to the store
      if (this.saveToStore) this.events.add(event);
    }
  }

  /** Run an action and publish events using the publish method */
  async run<Args extends Array<any>>(builder: ActionBuilder<Args>, ...args: Args): Promise<void> {
    // wait for action to complete and group events
    const context = await this.getContext();
    await builder(...args)(context);
  }

  /** Run an action without publishing the events */
  exec<Args extends Array<any>>(builder: ActionBuilder<Args>, ...args: Args): Observable<NostrEvent> {
    return from(this.getContext()).pipe(
      // Run the action
      switchMap((ctx) => {
        return new Observable<NostrEvent>((subscriber) => {
          const context: ActionContext = {
            ...ctx,
            publish: async (event) =>
              Array.isArray(event) ? event.forEach((e) => subscriber.next(e)) : subscriber.next(event),
            run: (builder, ...args) => builder(...args)(context),
          };

          builder(...args)(context).then(
            () => subscriber.complete(),
            (err) => subscriber.error(err),
          );
        });
      }),
      // NOTE: its necessary to add a tap() here because we are overwriting the publish method above
      // Optionally save all events to the store
      this.saveToStore ? tap((event) => this.events.add(event)) : identity,
    );
  }
}

/** @deprecated Use ActionRunner instead */
export const ActionHub = ActionRunner;
