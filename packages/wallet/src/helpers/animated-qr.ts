import { getEncodedToken, Token } from "@cashu/cashu-ts";
import { defer, filter, interval, map, Observable, OperatorFunction, shareReplay, switchMap } from "rxjs";

/** Preset speeds for the animated qr code */
export const ANIMATED_QR_INTERVAL = {
  SLOW: 500,
  MEDIUM: 250,
  FAST: 150,
};

/** Presets for fragment length for animated qr code */
export const ANIMATED_QR_FRAGMENTS = {
  SHORT: 50,
  MEDIUM: 100,
  LONG: 150,
};

export type SendAnimatedOptions = {
  /**
   * The interval between the parts ( 150 - 500 )
   * @default 150
   */
  interval?: number;
  /**
   * max fragment length ( 50 - 200 )
   * @default 100
   */
  fragmentLength?: number;
};

/** Creates an observable that iterates through a multi-part animated qr code */
export function sendAnimated(token: Token | string, options?: SendAnimatedOptions): Observable<string> {
  // start the stream as soon as there is subscriber
  return defer(() => import("@gandlaf21/bc-ur/dist/lib/es6/index.js")).pipe(
    switchMap(({ UR, UREncoder }) => {
      let str = typeof token === "string" ? token : getEncodedToken(token);
      let utf8 = new TextEncoder();
      let buffer = utf8.encode(str);
      let ur = UR.from(buffer);
      let encoder = new UREncoder(ur, options?.fragmentLength ?? 100, 0);

      return interval(options?.interval ?? ANIMATED_QR_INTERVAL.FAST).pipe(map(() => encoder.nextPart()));
    }),
  );
}

type BcUrModule = typeof import("@gandlaf21/bc-ur/dist/lib/es6/index.js");
type URDecoderInstance = InstanceType<BcUrModule["URDecoder"]>;

/** A source signal captured before bc-ur finishes loading, replayed in arrival order once ready */
type QueuedSignal = { kind: "next"; value: string } | { kind: "error"; error: unknown } | { kind: "complete" };

/**
 * An operator that decodes UR, emits progress percent and completes with final result or error.
 * Subscribes to its source synchronously so fragments/terminal signals emitted by a hot source
 * while bc-ur is still loading are buffered in order and drained into one decoder once ready.
 */
function urDecoder(): OperatorFunction<string, string | number> {
  return (source) =>
    new Observable<string | number>((observer) => {
      let cancelled = false;
      let settled = false;
      let decoder: URDecoderInstance | null = null;
      const queue: QueuedSignal[] = [];

      const decode = (part: string) => {
        if (settled || !decoder) return;

        try {
          decoder.receivePart(part);

          if (decoder.isComplete() && decoder.isSuccess()) {
            settled = true;

            // emit progress
            const progress = decoder.estimatedPercentComplete();
            observer.next(progress);

            // emit result
            const ur = decoder.resultUR();
            const decoded = ur.decodeCBOR();
            const utf8 = new TextDecoder();
            const tokenStr = utf8.decode(decoded);
            observer.next(tokenStr);

            // complete
            observer.complete();
          } else if (decoder.isError()) {
            settled = true;

            // emit error
            const reason = decoder.resultError();
            observer.error(new Error(reason));
          } else {
            // emit progress
            const progress = decoder.estimatedPercentComplete();
            observer.next(progress);
          }
        } catch (error) {
          settled = true;
          observer.error(error);
        }
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        observer.error(error);
      };

      const complete = () => {
        if (settled) return;
        settled = true;
        observer.error(new Error("Animated QR input completed before a complete UR was decoded"));
      };

      const drain = (signal: QueuedSignal) => {
        if (signal.kind === "next") decode(signal.value);
        else if (signal.kind === "error") fail(signal.error);
        else complete();
      };

      // subscribe to the (possibly hot) source synchronously, before bc-ur has loaded
      const sourceSubscription = source.subscribe({
        next: (part) => {
          if (cancelled || settled) return;
          if (decoder) decode(part);
          else queue.push({ kind: "next", value: part });
        },
        error: (error) => {
          if (cancelled || settled) return;
          if (decoder) fail(error);
          else queue.push({ kind: "error", error });
        },
        complete: () => {
          if (cancelled || settled) return;
          if (decoder) complete();
          else queue.push({ kind: "complete" });
        },
      });

      // start loading without awaiting, so the source subscription above happens synchronously
      import("@gandlaf21/bc-ur/dist/lib/es6/index.js").then(
        ({ URDecoder }) => {
          if (cancelled || settled) return;

          try {
            decoder = new URDecoder();

            // drain buffered fragments/terminal signal in original arrival order
            while (queue.length > 0 && !settled) drain(queue.shift()!);
          } catch (error) {
            // a throw here (e.g. a module-shape mismatch) would otherwise escape as an
            // unhandled rejection, since promise.then(onFulfilled) never forwards its own throw
            fail(error);
          }
        },
        (error) => {
          if (cancelled || settled) return;
          fail(error);
        },
      );

      return () => {
        cancelled = true;
        queue.length = 0;
        sourceSubscription.unsubscribe();
      };
    });
}

/** Creates an observable that completes with decoded token */
export function receiveAnimated(input: Observable<string>): Observable<string | number> {
  return input.pipe(
    // convert to lower case
    map((str) => str.toLowerCase()),
    // filter out non UR parts
    filter((str) => str.startsWith("ur:bytes")),
    // decode UR and complete
    urDecoder(),
    // only run one decoder
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}
