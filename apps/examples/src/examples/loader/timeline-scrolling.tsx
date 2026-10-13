/**
 * Visualize timeline events on a canvas with time-based scrolling and relay visualization
 * @tags loader, timeline, scrolling, visualization
 * @related loader/paginated-timeline, feed/relay-timeline
 */
import { use$ } from "applesauce-react/hooks";
import { BehaviorSubject, tap, throttleTime } from "rxjs";

import { EventStore } from "applesauce-core";
import { getSeenRelays, mergeRelaySets, unixNow } from "applesauce-core/helpers";
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { useMemo, useRef, useCallback } from "react";

const pool = new RelayPool();

const COLORS = ["red", "green", "blue", "orange", "purple", "darkcyan"];

export default function TimelineExample() {
  const now = useMemo(() => unixNow(), []);
  const limit$ = useMemo(() => new BehaviorSubject(50), []);
  const limit = use$(limit$);

  const frame$ = useMemo(() => new BehaviorSubject(60 * 60), []);
  const frame = use$(frame$);

  const relays$ = useMemo(
    () =>
      new BehaviorSubject(
        mergeRelaySets([
          "wss://nostrue.com/",
          "wss://nos.lol/",
          "wss://nostr.bitcoiner.social/",
          "wss://relay.damus.io/",
          "wss://nostrelites.org/",
          "wss://nostr.wine/",
        ]),
      ),
    [],
  );
  const relays = use$(relays$);

  const seconds$ = useMemo(() => new BehaviorSubject(0), []);
  const seconds = use$(seconds$);

  // Create a new timeline loader when the relays change
  const loader = useMemo(() => {
    return createTimelineLoader(pool, relays, [{ kinds: [1] }], { limit });
  }, [relays, limit]);

  // throttle how fast the seconds change
  const secondsThrottled =
    use$(() => seconds$.pipe(throttleTime(1000, undefined, { leading: true, trailing: true })), [seconds$]) ?? 0;

  use$(
    () =>
      loader(now - secondsThrottled).pipe(
        tap((event) => {
          store.add(event);
          const from = Array.from(getSeenRelays(event) || [])[0];
          const context = ctx.current;
          if (!from || !context) return;
          context.fillStyle = COLORS[relays.indexOf(from)] || "black";
          context.fillRect(now - event.created_at, relays.indexOf(from) * 32, 1, 32);
        }),
      ),
    [secondsThrottled, loader, now, relays],
  );

  const canvas = useRef<HTMLCanvasElement | null>(null);
  const ctx = useRef<CanvasRenderingContext2D | null>(null);

  const setCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvas.current = node;
      ctx.current = node?.getContext("2d") ?? null;
      if (ctx.current) ctx.current.clearRect(0, 0, frame, relays.length * 32);
    },
    [loader, frame, relays],
  );
  const store = useMemo(() => new EventStore(), []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="join">
        <button className="btn join-item" onClick={() => limit$.next(50)}>
          50
        </button>
        <button className="btn join-item" onClick={() => limit$.next(100)}>
          100
        </button>
        <button className="btn join-item" onClick={() => limit$.next(200)}>
          200
        </button>
      </div>

      <div className="flex flex-row gap-2 text-sm p-1">
        {relays.map((relay, i) => (
          <code key={relay} style={{ color: COLORS[i] }}>
            {relay}
          </code>
        ))}
      </div>

      <canvas
        width={frame}
        height={relays.length * 32}
        style={{ width: "100%" }}
        ref={setCanvas}
        className="border border-base-300"
      />

      <input
        type="range"
        className="range w-full"
        min={0}
        max={frame}
        value={seconds}
        onInput={(e) => {
          const v = parseInt(e.currentTarget.value);
          if (Number.isFinite(v)) seconds$.next(v);
        }}
      />

      <p className="text-sm">scroll: {seconds}s</p>
    </div>
  );
}
