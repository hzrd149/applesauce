import { isWrappedMessage, getConversationParticipants } from "applesauce-common/helpers";
import { kinds, type Rumor } from "applesauce-core/helpers";
import { Observable, Subscription, defer, firstValueFrom, fromEvent, merge, takeUntil, timeout } from "rxjs";
import type { GiftWrapReceiver } from "../../gift-wrap/receiver.js";

/** Reads stored rumors and explicitly decrypts a finite envelope snapshot or subsequent store arrivals */
export function readWrappedMessages$(
  receiver: GiftWrapReceiver,
  messages$: Observable<Rumor[]>,
  options: { signal: AbortSignal; history: boolean; timeout: number },
): Observable<Rumor> {
  return new Observable<Rumor>((subscriber) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([options.signal, controller.signal]);
    const subscriptions = new Subscription();
    const emitted = new Set<string>();
    const visited = new Set<string>();
    const inbox = { kinds: [kinds.GiftWrap], "#p": [receiver.pubkey] };
    // Retain IDs rather than queuing envelope objects behind an interactive signer.
    const pending = new Set(receiver.eventStore.getByFilters(inbox).map((event) => event.id));
    let dirty = true;
    let draining = false;
    let initialized = false;

    const emit = (rumor: Rumor) => {
      if (!isWrappedMessage(rumor) || !getConversationParticipants(rumor).includes(receiver.pubkey)) return;
      if (emitted.has(rumor.id)) return;
      emitted.add(rumor.id);
      subscriber.next(rumor);
    };

    const drain = async () => {
      if (!initialized || draining || signal.aborted) return;
      draining = true;
      try {
        while (dirty && !signal.aborted) {
          dirty = false;
          for (const id of pending) {
            signal.throwIfAborted();
            pending.delete(id);
            if (visited.has(id)) continue;
            visited.add(id);
            const event = receiver.eventStore.getEvent(id);
            if (!event) continue;
            try {
              emit(await receiver.unlock(event, { signal }));
            } catch {
              // The receiver reports individual failures; cancellation ends this reader.
              signal.throwIfAborted();
            }
          }
        }
        if (options.history) subscriber.complete();
      } catch (error) {
        if (!signal.aborted) subscriber.error(error);
      } finally {
        draining = false;
      }
    };

    if (!options.history) {
      subscriptions.add(
        merge(receiver.eventStore.insert$, receiver.eventStore.update$).subscribe((event) => {
          if (event.kind !== kinds.GiftWrap || !event.tags.some((tag) => tag[0] === "p" && tag[1] === receiver.pubkey))
            return;
          if (visited.has(event.id)) return;
          pending.add(event.id);
          dirty = true;
          void drain();
        }),
      );
      subscriptions.add(receiver.eventStore.remove$.subscribe((event) => pending.delete(event.id)));
      subscriptions.add(
        messages$.subscribe({ next: (messages) => messages.forEach(emit), error: (error) => subscriber.error(error) }),
      );
    }

    const initialize = async () => {
      signal.throwIfAborted();
      const messages = await firstValueFrom(
        defer(async () => receiver.rumorStore.getByFilters({})).pipe(
          timeout({ first: options.timeout }),
          takeUntil(fromEvent(signal, "abort")),
        ),
      );
      signal.throwIfAborted();
      messages.forEach(emit);
      await receiver.ready();
      signal.throwIfAborted();
      initialized = true;
      await drain();
    };
    void initialize().catch((error) => {
      if (!signal.aborted) subscriber.error(error);
    });

    return () => {
      controller.abort();
      subscriptions.unsubscribe();
    };
  }).pipe(takeUntil(fromEvent(options.signal, "abort")));
}
