import { Observable, Subject, Subscription } from "rxjs";

/** Sentinel to distinguish "no value yet" from a real value */
const NOT_YET = Symbol("NOT_YET");

/**
 * Dynamic counterpart to `switchMap(() => combineLatest(...))` for arrays,
 * with stable branches by index.
 *
 * Each array index gets its own long-lived branch (`of(value).pipe(...)`
 * equivalent), and branches are only created/removed when indices are
 * added/removed.
 */
export function combineLatestByIndex<T, R>(
  project: (source$: Observable<T>, index: number) => Observable<R>,
): (source$: Observable<readonly T[]>) => Observable<R[]> {
  return (source$: Observable<readonly T[]>): Observable<R[]> =>
    new Observable<R[]>((subscriber) => {
      type Slot = {
        input: Subject<T>;
        sub?: Subscription;
        value: R | typeof NOT_YET;
        completed: boolean;
      };

      const slots: Slot[] = [];
      let sourceCompleted = false;
      let batchingSourceNext = false;
      let emittedDuringBatch = false;

      function checkComplete() {
        if (!sourceCompleted) return;
        for (const slot of slots) {
          if (!slot.completed) return;
        }
        subscriber.complete();
      }

      function tryEmit() {
        for (const slot of slots) {
          if (slot.value === NOT_YET) return;
        }
        subscriber.next(slots.map((slot) => slot.value as R));
      }

      function createSlot(index: number): Slot | undefined {
        const input = new Subject<T>();
        const slot: Slot = { input, value: NOT_YET, completed: false };
        let projected$: Observable<R>;
        try {
          projected$ = project(input, index);
        } catch (err) {
          input.complete();
          subscriber.error(err);
          return undefined;
        }

        slot.sub = projected$.subscribe({
          next(value) {
            slot.value = value;
            if (batchingSourceNext) {
              emittedDuringBatch = true;
              return;
            }
            tryEmit();
          },
          error(err) {
            subscriber.error(err);
          },
          complete() {
            slot.completed = true;
            checkComplete();
          },
        });

        return slot;
      }

      const sourceSub = source$.subscribe({
        next(items) {
          batchingSourceNext = true;
          emittedDuringBatch = false;

          while (slots.length > items.length) {
            const slot = slots.pop();
            if (!slot) break;
            slot.sub?.unsubscribe();
            slot.input.complete();
          }

          while (slots.length < items.length) {
            const slot = createSlot(slots.length);
            if (!slot) {
              batchingSourceNext = false;
              return;
            }
            slots.push(slot);
          }

          for (let i = 0; i < items.length; i++) {
            if (subscriber.closed) {
              batchingSourceNext = false;
              return;
            }

            const slot = slots[i];
            if (!slot) {
              batchingSourceNext = false;
              return;
            }

            slot.input.next(items[i]!);
          }

          // Emit once for this source update if possible.
          if (emittedDuringBatch || items.length === 0) tryEmit();
          batchingSourceNext = false;
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          sourceCompleted = true;
          for (const slot of slots) {
            slot.input.complete();
          }
          checkComplete();
        },
      });

      return () => {
        sourceSub.unsubscribe();
        for (const slot of slots) {
          slot.sub?.unsubscribe();
          slot.input.complete();
        }
        slots.length = 0;
      };
    });
}
