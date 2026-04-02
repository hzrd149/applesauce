import { Observable, Subject, type OperatorFunction, type Subscription } from "rxjs";

/** Sentinel to distinguish "no value yet" from a real value */
const NOT_YET = Symbol("NOT_YET");

/**
 * Dynamic counterpart to `switchMap(() => combineLatest(...))` for records,
 * with stable branches by key.
 *
 * Each record key gets its own long-lived branch. Branches are only
 * created/removed when keys are added/removed; value updates are pushed through
 * the existing key branch.
 */
export function combineLatestByKey<Input extends Record<string, unknown>, R>(
  project: (
    source$: Observable<Input[Extract<keyof Input, string>]>,
    key: Extract<keyof Input, string>,
  ) => Observable<R>,
): OperatorFunction<Input, Record<Extract<keyof Input, string>, R>> {
  return (source$: Observable<Input>): Observable<Record<Extract<keyof Input, string>, R>> =>
    new Observable<Record<Extract<keyof Input, string>, R>>((subscriber) => {
      type Key = Extract<keyof Input, string>;
      type Value = Input[Key];
      type Slot = {
        input: Subject<Value>;
        sub?: Subscription;
        value: R | typeof NOT_YET;
        completed: boolean;
      };

      const slots = new Map<Key, Slot>();
      let sourceCompleted = false;
      let currentKeys: Key[] = [];
      let batchingSourceNext = false;
      let emittedDuringBatch = false;

      function checkComplete() {
        if (!sourceCompleted) return;
        for (const slot of slots.values()) {
          if (!slot.completed) return;
        }
        subscriber.complete();
      }

      function tryEmit() {
        for (const key of currentKeys) {
          const slot = slots.get(key);
          if (!slot || slot.value === NOT_YET) return;
        }

        const out = {} as Record<Key, R>;
        for (const key of currentKeys) {
          const slot = slots.get(key);
          if (!slot) return;
          out[key] = slot.value as R;
        }

        subscriber.next(out);
        if (batchingSourceNext) emittedDuringBatch = true;
      }

      function createSlot(key: Key): Slot | undefined {
        const input = new Subject<Value>();
        const slot: Slot = { input, value: NOT_YET, completed: false };
        let child$: Observable<R>;

        try {
          child$ = project(input, key);
        } catch (err) {
          input.complete();
          subscriber.error(err);
          return undefined;
        }

        slot.sub = child$.subscribe({
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
        next(input) {
          batchingSourceNext = true;
          emittedDuringBatch = false;

          const entries = Object.entries(input) as [Key, Value][];
          currentKeys = entries.map(([key]) => key);
          const newKeysSet = new Set(currentKeys);

          for (const [key, slot] of slots) {
            if (!newKeysSet.has(key)) {
              slot.sub?.unsubscribe();
              slot.input.complete();
              slots.delete(key);
            }
          }

          for (const key of currentKeys) {
            if (!slots.has(key)) {
              const slot = createSlot(key);
              if (!slot) {
                batchingSourceNext = false;
                return;
              }
              slots.set(key, slot);
            }
          }

          for (const [key, value] of entries) {
            if (subscriber.closed) {
              batchingSourceNext = false;
              return;
            }

            const slot = slots.get(key);
            if (!slot) {
              batchingSourceNext = false;
              return;
            }

            slot.input.next(value);
          }

          if (emittedDuringBatch || entries.length === 0) tryEmit();
          batchingSourceNext = false;
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          sourceCompleted = true;
          for (const slot of slots.values()) {
            slot.input.complete();
          }
          checkComplete();
        },
      });

      return () => {
        sourceSub.unsubscribe();
        for (const slot of slots.values()) {
          slot.sub?.unsubscribe();
          slot.input.complete();
        }
        slots.clear();
      };
    });
}
