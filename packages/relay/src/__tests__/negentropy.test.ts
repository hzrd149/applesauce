import { describe, expect, it, vi } from "vitest";
import { Observable, Subject } from "rxjs";

import { Negentropy, NegentropyStorageVector } from "../lib/negentropy.js";
import { buildStorageVector, negentropySync } from "../negentropy.js";

const item = (n: number) => ({ id: n.toString(16).padStart(64, "0"), created_at: n });

class NegentropySocket extends Subject<any[]> {
  sent: any[][] = [];
  server: Negentropy | undefined;

  override next(message: any[]) {
    this.sent.push(message);
    void this.respond(message);
  }

  multiplex(open: () => any[], close: () => any[], matches: (message: any[]) => boolean) {
    return new Observable<any[]>((subscriber) => {
      const sub = this.asObservable().subscribe({
        next: (message) => matches(message) && subscriber.next(message),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.error(new Error("transport closed before negotiation completed")),
      });
      this.next(open());
      return () => {
        sub.unsubscribe();
        this.next(close());
      };
    });
  }

  private async respond(message: any[]) {
    if (!this.server || (message[0] !== "NEG-OPEN" && message[0] !== "NEG-MSG")) return;
    const [reply] = await this.server.reconcile<string>(message[3] ?? message[2]);
    if (reply !== null) super.next(["NEG-MSG", message[1], reply]);
  }
}

function server(items: ReturnType<typeof item>[]) {
  const storage = new NegentropyStorageVector();
  for (const value of items) storage.insert(value.created_at, value.id);
  storage.seal();
  return new Negentropy(storage, 4096);
}

describe("negentropySync", () => {
  it("drives a genuine multi-round negotiation and writes each follow-up before emitting", async () => {
    const local = Array.from({ length: 96 }, (_, n) => item(n));
    const remote = Array.from({ length: 96 }, (_, n) => item(n + 48));
    const socket = new NegentropySocket();
    socket.server = server(remote);
    const wireCounts: number[] = [];

    const done = new Promise<void>((resolve, reject) => {
      negentropySync(buildStorageVector(local), socket, { kinds: [1] }, { id: "multi", frameSizeLimit: 4096 }).subscribe({
        next: () => wireCounts.push(socket.sent.filter((message) => message[0] === "NEG-MSG").length),
        error: reject,
        complete: resolve,
      });
    });

    await done;
    expect(socket.sent.filter((message) => message[0] === "NEG-MSG").length).toBeGreaterThan(0);
    expect(wireCounts.every((count) => count > 0)).toBe(true);
    expect(socket.sent.filter((message) => message[0] === "NEG-CLOSE")).toEqual([["NEG-CLOSE", "multi"]]);
  });

  it("shares one execution, emits the terminal round, and closes once", async () => {
    const socket = new NegentropySocket();
    socket.server = server([]);
    const interaction = negentropySync(buildStorageVector([]), socket, {}, { id: "shared" });
    const first = vi.fn();
    const second = vi.fn();

    await Promise.all([
      new Promise<void>((resolve, reject) => interaction.subscribe({ next: first, error: reject, complete: resolve })),
      new Promise<void>((resolve, reject) => interaction.subscribe({ next: second, error: reject, complete: resolve })),
    ]);

    expect(socket.sent.filter((message) => message[0] === "NEG-OPEN")).toHaveLength(1);
    expect(socket.sent.filter((message) => message[0] === "NEG-CLOSE")).toHaveLength(1);
    expect(first).toHaveBeenCalledWith({ have: [], need: [] });
    expect(second).toHaveBeenCalledWith({ have: [], need: [] });
  });
});
