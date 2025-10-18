import { OperatorFunction, ObservableInput, ObservedValueOf, Subscriber, from } from "rxjs";
import { createOperatorSubscriber } from "rxjs/internal/operators/OperatorSubscriber";
import { operate } from "rxjs/internal/util/lift";

/**
 * Like switchMap, but subscribes to the new observable before unsubscribing from the old one.
 * This prevents gaps in subscription coverage.
 *
 * @param project A function that, when applied to an item emitted by the source Observable,
 * returns an Observable.
 */
export function reverseSwitchMap<T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O,
): OperatorFunction<T, ObservedValueOf<O>> {
  return operate((source, subscriber) => {
    let innerSubscriber: Subscriber<ObservedValueOf<O>> | null = null;
    let index = 0;
    // Whether or not the source subscription has completed
    let isComplete = false;

    // We only complete the result if the source is complete AND we don't have an active inner subscription.
    // This is called both when the source completes and when the inners complete.
    const checkComplete = () => {
      if (isComplete && !innerSubscriber) subscriber.complete();
    };

    source.subscribe(
      createOperatorSubscriber(
        subscriber,
        (value) => {
          const outerIndex = index++;

          const oldSubscriber = innerSubscriber;

          // Create the new inner subscription FIRST
          // Immediately assign the new subscriber because observables can emit and complete synchronously
          const self = (innerSubscriber = createOperatorSubscriber(
            subscriber,
            (innerValue) => subscriber.next(innerValue as ObservedValueOf<O>),
            () => {
              // The inner has completed. Null out the inner subscriber to
              // free up memory and to signal that we have no inner subscription
              // currently. Only do this if this is still the active inner subscriber.
              if (innerSubscriber === self || innerSubscriber === null) {
                innerSubscriber = null!;
                checkComplete();
              }
            },
          ));

          // Subscribe to the new observable FIRST
          from(project(value, outerIndex)).subscribe(innerSubscriber);

          // THEN unsubscribe from the previous inner subscription
          oldSubscriber?.unsubscribe();
        },
        () => {
          isComplete = true;
          checkComplete();
        },
      ),
    );
  });
}
