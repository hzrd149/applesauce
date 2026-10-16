import { firstValueFrom, filter } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";
import { RelayPool } from "../../../../relay/src/pool.js";
import { Relay } from "../../../../relay/src/relay.js";
import { createCountService, nip85CountSource, relayCountSource } from "../index.js";
import { FakeUser } from "../../__tests__/fake-user.js";

const pools: RelayPool[] = [];
afterEach(() => {
  pools.forEach((pool) => pool.relays.forEach((relay) => relay.close()));
  pools.length = 0;
  WS.clean();
  vi.restoreAllMocks();
});

it("adapts actual RelayPool COUNT outcomes from a controlled websocket", async () => {
  vi.spyOn(Relay, "fetchInformationDocument").mockResolvedValue(null);
  const server = new WS("wss://count.test/", { jsonProtocol: true });
  const pool = new RelayPool();
  pools.push(pool);
  const counts = createCountService({
    sources: [relayCountSource({ relays: ["wss://count.test/"], count: pool.count.bind(pool) })],
  });
  const result = firstValueFrom(
    counts.event({ id: "a".repeat(64), kind: 1, created_at: 0 }).reactions$.pipe(filter((v) => v !== undefined)),
  );
  await server.connected;
  const message = (await server.nextMessage) as [string, string, unknown];
  expect(message[0]).toBe("COUNT");
  expect(message[2]).toEqual({ kinds: [7], "#e": ["a".repeat(64)] });
  server.send(["COUNT", message[1], { count: 0, approximate: true }]);
  expect(await result).toBe(0);
  counts.stop();
});

it("verifies signed NIP-85 events through a finite RelayPool request", async () => {
  vi.spyOn(Relay, "fetchInformationDocument").mockResolvedValue(null);
  const server = new WS("wss://assertions.test/", { jsonProtocol: true });
  const pool = new RelayPool();
  pools.push(pool);
  const user = new FakeUser();
  const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
  const assertion = user.event({
    kind: 30383,
    tags: [
      ["d", target.id],
      ["reaction_cnt", "11"],
    ],
  });
  const counts = createCountService({
    sources: [
      nip85CountSource({
        request: pool.request.bind(pool),
        providers: () => [
          { kind: 30383, tag: "reaction_cnt", servicePubkey: user.pubkey, relay: "wss://assertions.test/" },
        ],
      }),
    ],
  });
  const result = firstValueFrom(counts.event(target).reactions$.pipe(filter((v) => v !== undefined)));
  await server.connected;
  const message = (await server.nextMessage) as [string, string, unknown];
  expect(message[0]).toBe("REQ");
  server.send(["EVENT", message[1], assertion]);
  server.send(["EOSE", message[1]]);
  expect(await result).toBe(11);
  counts.stop();
});
