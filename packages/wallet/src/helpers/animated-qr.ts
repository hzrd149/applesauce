import { getEncodedToken, Token } from "@cashu/cashu-ts";
import { UR, URDecoder, UREncoder } from "@gandlaf21/bc-ur/dist/lib/es6/index.js";
import { defer, filter, interval, map, Observable, OperatorFunction, shareReplay } from "rxjs";

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
  return defer(() => {
    let str = typeof token === "string" ? token : getEncodedToken(token);
    let utf8 = new TextEncoder();
    let buffer = utf8.encode(str);
    let ur = UR.from(buffer);
    let encoder = new UREncoder(ur, options?.fragmentLength ?? 100, 0);

    return interval(options?.interval ?? ANIMATED_QR_INTERVAL.FAST).pipe(map(() => encoder.nextPart()));
  });
}

/** An operator that decodes UR, emits progress percent and completes with final result or error */
function urDecoder(): OperatorFunction<string, string | number> {
  return (source) =>
    new Observable((observer) => {
      const decoder = new URDecoder();

      return source.subscribe((part) => {
        decoder.receivePart(part);

        if (decoder.isComplete() && decoder.isSuccess()) {
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
          // emit error
          const reason = decoder.resultError();
          observer.error(new Error(reason));
        } else {
          // emit progress
          const progress = decoder.estimatedPercentComplete();
          observer.next(progress);
        }
      });
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
    shareReplay(1),
  );
}
