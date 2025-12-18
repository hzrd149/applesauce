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
import {
  filter,
  from,
  identity,
  isObservable,
  lastValueFrom,
  mergeWith,
  Observable,
  Subject,
  switchMap,
  tap,
  toArray,
} from "rxjs";

/** A callback used to tell the upstream app to publish an event */
export type PublishMethod = (event: NostrEvent, relays?: string[]) => void | Promise<void> | Observable<any>;
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
  /** Execute a sub-action within the current action context */
  exec: <Args extends Array<any>>(builder: ActionBuilder<Args>, ...args: Args) => Observable<NostrEvent>;
  /** Run a sub-action within the current action context and return the events */
  run: <Args extends Array<any>>(builder: ActionBuilder<Args>, ...args: Args) => Promise<void>;
};

function unwrap(result: ReturnType<Action>): Observable<NostrEvent | void> {
  if (isObservable(result)) return result;
  else return from(result);
}

/** An action that can be run in a context to preform an action */
export type Action = (
  context: ActionContext,
) => Promise<void | NostrEvent> | Observable<NostrEvent> | AsyncGenerator<NostrEvent> | Generator<NostrEvent>;

/** A function that takes arguments and returns an action */
export type ActionBuilder<Args extends Array<any>> = (...args: Args) => Action;

/** The main class that runs actions */
export class ActionHub {
  /** Whether to save all events created by actions to the event store */
  saveToStore = true;

  constructor(
    public events: IEventStoreRead & IEventStoreStreams & IEventSubscriptions & IEventStoreActions & EventModels,
    public factory: EventFactory,
    private publishMethod?: UpstreamPool,
  ) {}

  protected context: ActionContext | undefined = undefined;
  protected async getContext() {
    if (this.context) return this.context;
    else {
      if (!this.factory.context.signer) throw new Error("Missing signer");
      const self = await this.factory.context.signer.getPublicKey();
      const user = castUser(self, this.events);
      this.context = {
        self,
        user,
        events: this.events,
        signer: this.factory.context.signer,
        factory: this.factory,
        publish: this.publish.bind(this),
        exec: this.exec.bind(this),
        run: this.run.bind(this),
        sign: this.factory.sign.bind(this.factory),
      };
      return this.context;
    }
  }

  /** Internal method for publishing events to relays */
  async publish(event: NostrEvent | NostrEvent[], relays?: string[]): Promise<void> {
    if (!this.publishMethod) throw new Error("Missing publish method, use ActionHub.exec");

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
    if (!this.publishMethod) throw new Error("Missing publish method, use ActionHub.exec");

    // wait for action to complete and group events
    const context = await this.getContext();
    const events = await lastValueFrom(
      unwrap(builder(...args)(context)).pipe(
        filter((event) => event !== undefined),
        toArray(),
      ),
    );

    // Publish yielded events
    await this.publish(events);

    // publish events
    await Promise.allSettled(events.map((event) => this.publish(event)));
  }

  /**
   * Run an action without publishing the events
   * @deprecated Use ActionHub.run() instead
   */
  exec<Args extends Array<any>>(builder: ActionBuilder<Args>, ...args: Args): Observable<NostrEvent> {
    return from(this.getContext()).pipe(
      // Run the action
      switchMap((ctx) => {
        const publish$ = new Subject<NostrEvent>();
        const context: ActionContext = {
          ...ctx,
          publish: async (event) =>
            Array.isArray(event) ? event.forEach((e) => publish$.next(e)) : publish$.next(event),
        };

        return unwrap(builder(...args)(context)).pipe(
          filter((event) => event !== undefined),
          // Merge the publish() events into the stream
          mergeWith(publish$),
        );
      }),
      // NOTE: its necessary to add a tap() here because we are overwriting the publish method above
      // Optionally save all events to the store
      this.saveToStore ? tap((event) => this.events.add(event)) : identity,
    );
  }
}
