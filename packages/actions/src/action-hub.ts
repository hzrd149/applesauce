import { from, isObservable, lastValueFrom, Observable, switchMap, tap, toArray } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventFactory } from "applesauce-factory";
import { IEventStoreActions, IEventStoreRead } from "applesauce-core";

/** A callback used to tell the upstream app to publish an event */
export type PublishMethod = (event: NostrEvent) => void | Promise<void>;

/** The context that is passed to actions for them to use to preform actions */
export type ActionContext = {
  /** The event store to load events from */
  events: IEventStoreRead;
  /** The pubkey of the signer in the event factory */
  self: string;
  /** The event factory used to build and modify events */
  factory: EventFactory;
};

/** An action that can be run in a context to preform an action */
export type Action = (
  ctx: ActionContext,
) => Observable<NostrEvent> | AsyncGenerator<NostrEvent> | Generator<NostrEvent>;

export type ActionConstructor<Args extends Array<any>> = (...args: Args) => Action;

/** The main class that runs actions */
export class ActionHub {
  /** Whether to save all events created by actions to the event store */
  saveToStore = true;

  constructor(
    public events: IEventStoreRead & IEventStoreActions,
    public factory: EventFactory,
    public publish?: PublishMethod,
  ) {}

  protected context: ActionContext | undefined = undefined;
  protected async getContext() {
    if (this.context) return this.context;
    else {
      if (!this.factory.context.signer) throw new Error("Missing signer");
      const self = await this.factory.context.signer.getPublicKey();
      this.context = { self, events: this.events, factory: this.factory };
      return this.context;
    }
  }

  /** Runs an action in a ActionContext and converts the result to an Observable */
  static runAction(ctx: ActionContext, action: Action): Observable<NostrEvent> {
    const result = action(ctx);

    if (isObservable(result)) return result;
    else return from(result);
  }

  /** Run an action and publish events using the publish method */
  async run<Args extends Array<any>>(Action: ActionConstructor<Args>, ...args: Args): Promise<void> {
    if (!this.publish) throw new Error("Missing publish method, use ActionHub.exec");

    // wait for action to complete and group events
    const events = await lastValueFrom(this.exec<Args>(Action, ...args).pipe(toArray()));

    // publish events
    for (const event of events) await this.publish(event);
  }

  /** Run an action without publishing the events */
  exec<Args extends Array<any>>(Action: ActionConstructor<Args>, ...args: Args): Observable<NostrEvent> {
    return from(this.getContext()).pipe(
      switchMap((ctx) => {
        const action = Action(...args);
        return ActionHub.runAction(ctx, action);
      }),
      tap((event) => this.saveToStore && this.events.add(event)),
    );
  }
}
