import { Subscription, timer } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Relay } from "../relay.js";

// Control error and close independently: browser wrappers and constructor
// failures do not necessarily provide the close notification a mock server does.
class ControlledSocket extends EventTarget implements WebSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  protocol = "";
  readyState: number = this.CONNECTING;
  onopen: WebSocket["onopen"] = null;
  onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null;
  onmessage: WebSocket["onmessage"] = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = this.CLOSED;
  });

  static sockets: ControlledSocket[] = [];

  constructor(readonly url: string) {
    super();
    ControlledSocket.sockets.push(this);
  }

  open() {
    this.readyState = this.OPEN;
    this.onopen?.call(this, new Event("open"));
  }

  fail() {
    this.onerror?.call(this, new Event("error"));
  }

  finish(wasClean = false) {
    this.readyState = this.CLOSED;
    // Node does not expose CloseEvent in every supported version.
    const event = Object.assign(new Event("close"), { wasClean, code: wasClean ? 1000 : 1006, reason: "" });
    this.onclose?.call(this, event);
  }
}

class WatchedRelay extends Relay {
  watch() {
    return this.watchTower.subscribe();
  }
}

describe("transport reconnect backoff", () => {
  let relay: WatchedRelay;
  let subscription: Subscription;
  let attempts: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    ControlledSocket.sockets = [];
    attempts = [];
    relay = new WatchedRelay("wss://test", { WebSocket: ControlledSocket });
    relay.keepAlive = 0;
    relay.reconnectTimer = (_error, attempt) => {
      attempts.push(attempt);
      return timer(100 * 2 ** (attempt - 1));
    };
    subscription = relay.watch();
  });

  afterEach(() => {
    subscription.unsubscribe();
    relay.close();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("advances backoff across errors without close notifications", () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const socket = ControlledSocket.sockets.at(-1)!;
      socket.fail();
      expect(attempts).toEqual(Array.from({ length: attempt }, (_, index) => index + 1));
      expect(relay.ready).toBe(false);

      const count = ControlledSocket.sockets.length;
      const delay = 100 * 2 ** (attempt - 1);
      vi.advanceTimersByTime(delay - 1);
      expect(ControlledSocket.sockets).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(ControlledSocket.sockets).toHaveLength(count + 1);
    }
  });

  it("counts an error followed by an unclean close only once", () => {
    const socket = ControlledSocket.sockets[0];
    socket.fail();
    socket.finish();
    expect(attempts).toEqual([1]);
    expect(relay.attempts$.value).toBe(1);
    vi.advanceTimersByTime(100);
    ControlledSocket.sockets[1].fail();
    expect(attempts).toEqual([1, 2]);
  });

  it("advances backoff when the WebSocket constructor throws", () => {
    subscription.unsubscribe();
    relay.close();
    class ThrowingSocket extends ControlledSocket {
      constructor(url: string) {
        super(url);
        throw new Error("Connection blocked");
      }
    }
    relay = new WatchedRelay("wss://test", { WebSocket: ThrowingSocket });
    relay.reconnectTimer = (_error, attempt) => {
      attempts.push(attempt);
      return timer(100);
    };
    subscription = relay.watch();
    expect(attempts).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(attempts).toEqual([1, 2]);
  });

  it("counts an unclean close without an error", () => {
    ControlledSocket.sockets[0].finish();
    expect(attempts).toEqual([1]);
    expect(relay.ready).toBe(false);
  });

  it("does not count or retry clean closes", () => {
    ControlledSocket.sockets[0].open();
    ControlledSocket.sockets[0].finish(true);
    expect(attempts).toEqual([]);
    expect(relay.attempts$.value).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(ControlledSocket.sockets).toHaveLength(1);
  });

  it("resets the backoff after a successful connection", () => {
    ControlledSocket.sockets[0].fail();
    vi.advanceTimersByTime(100);
    ControlledSocket.sockets[1].open();
    expect(relay.attempts$.value).toBe(0);
    expect(relay.error$.value).toBeNull();
    ControlledSocket.sockets[1].finish();
    expect(attempts).toEqual([1, 1]);
  });

  it("enters recovery before notifying error observers", () => {
    const states: Array<{ ready: boolean; attempts: number }> = [];
    const observer = relay.error$.subscribe((error) => {
      if (error && states.length === 0) {
        states.push({ ready: relay.ready, attempts: relay.attempts$.value });
        ControlledSocket.sockets[0].finish();
      }
    });
    ControlledSocket.sockets[0].fail();
    expect(states).toEqual([{ ready: false, attempts: 1 }]);
    expect(attempts).toEqual([1]);
    observer.unsubscribe();
  });

  it("does not reconnect after the last watcher unsubscribes", () => {
    ControlledSocket.sockets[0].fail();
    subscription.unsubscribe();
    vi.advanceTimersByTime(1000);
    expect(ControlledSocket.sockets).toHaveLength(1);
  });

  it("cancels pending recovery when the relay is closed", () => {
    ControlledSocket.sockets[0].fail();
    relay.close();
    vi.advanceTimersByTime(1000);
    expect(relay.ready).toBe(false);
    expect(ControlledSocket.sockets).toHaveLength(1);
  });
});
