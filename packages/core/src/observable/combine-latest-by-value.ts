import { Observable, type OperatorFunction, type Subscription } from "rxjs";

/** Sentinel to distinguish "no value yet" from a real value */
const NOT_YET = Symbol("NOT_YET");

/**
 * Dynamic counterpart to `switchMap((values) => combineLatest(values.map(...)))`
 * for arrays, with stable branches by value.
 *
 * A single branch is created per unique array value (Map key semantics) and is
 * only created/removed when values are added/removed across emissions. Duplicate
 * values in the same array share the same branch.
 */
export function combineLatestByValue<T, R>(
  project: (value: T) => Observable<R>,
): OperatorFunction<readonly T[], Map<T, R>> {
  return (source$: Observable<readonly T[]>): Observable<Map<T, R>> =>
    new Observable<Map<T, R>>((subscriber) => {
      type Slot = {
        sub?: Subscription;
        value: R | typeof NOT_YET;
        completed: boolean;
      };

      const slots = new Map<T, Slot>();
      let sourceCompleted = false;
      let currentValues: T[] = [];
      let batchingSourceNext = false;

      function checkComplete() {
        if (!sourceCompleted) return;
        for (const slot of slots.values()) {
          if (!slot.completed) return;
        }
        subscriber.complete();
      }

      function tryEmit() {
        for (const value of currentValues) {
          const slot = slots.get(value);
          if (!slot || slot.value === NOT_YET) return;
        }

        const out = new Map<T, R>();
        for (const value of currentValues) {
          const slot = slots.get(value);
          if (!slot) return;
          out.set(value, slot.value as R);
        }

        subscriber.next(out);
      }

      function createSlot(value: T): Slot | undefined {
        const slot: Slot = { value: NOT_YET, completed: false };
        let child$: Observable<R>;

        try {
          child$ = project(value);
        } catch (err) {
          subscriber.error(err);
          return undefined;
        }

        slot.sub = child$.subscribe({
          next(nextValue) {
            slot.value = nextValue;
            if (batchingSourceNext) {
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

          const uniqueValues: T[] = [];
          const nextValueSet = new Set<T>();
          for (const value of input) {
            if (nextValueSet.has(value)) continue;
            nextValueSet.add(value);
            uniqueValues.push(value);
          }
          currentValues = uniqueValues;

          for (const [value, slot] of slots) {
            if (!nextValueSet.has(value)) {
              slot.sub?.unsubscribe();
              slots.delete(value);
            }
          }

          for (const value of currentValues) {
            if (!slots.has(value)) {
              const slot = createSlot(value);
              if (!slot) {
                batchingSourceNext = false;
                return;
              }
              slots.set(value, slot);
            }
          }

          tryEmit();
          batchingSourceNext = false;
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          sourceCompleted = true;
          checkComplete();
        },
      });

      return () => {
        sourceSub.unsubscribe();
        for (const slot of slots.values()) {
          slot.sub?.unsubscribe();
        }
        slots.clear();
      };
    });
}
