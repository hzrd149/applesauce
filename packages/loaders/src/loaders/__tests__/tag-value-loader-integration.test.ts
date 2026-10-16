import { afterEach, expect, it, vi } from "vitest";
import { of, toArray } from "rxjs";
import { WS } from "vitest-websocket-mock";
import { RelayPool } from "../../../../relay/src/pool.js";
import { Relay } from "../../../../relay/src/relay.js";
import { FakeUser } from "../../__tests__/fake-user.js";
import { createTagValueLoader } from "../tag-value-loader.js";
import { createReactionsLoader } from "../reactions-loader.js";
import { createZapsLoader } from "../zaps-loader.js";

const pools: RelayPool[] = [];
afterEach(() => {
  pools.forEach((pool) => pool.relays.forEach((relay) => relay.close()));
  pools.length = 0;
  WS.clean();
  vi.restoreAllMocks();
});

it("keeps a healthy websocket request alive when another relay rejects its request", async () => {
  vi.spyOn(Relay, "fetchInformationDocument").mockResolvedValue(null);
  const bad = new WS("wss://bad.test/", { jsonProtocol: true });
  const good = new WS("wss://good.test/", { jsonProtocol: true });
  const pool = new RelayPool();
  pools.push(pool);
  const onError = vi.fn();
  const loader = createTagValueLoader(pool, "e", { bufferSize: 1, onError });
  const user = new FakeUser();
  const target = "a".repeat(64);
  const reaction = user.event({ kind: 7, tags: [["e", target]] });
  const result = new Promise((resolve, reject) =>
    loader({ value: target, relays: ["wss://bad.test/", "wss://good.test/"] })
      .pipe(toArray())
      .subscribe({ next: resolve, error: reject }),
  );
  await bad.connected;
  await good.connected;
  const rejected = (await bad.nextMessage) as [string, string, unknown];
  const accepted = (await good.nextMessage) as [string, string, unknown];
  expect(accepted[0]).toBe("REQ");
  expect(accepted[2]).toEqual({ "#e": [target] });
  bad.send(["CLOSED", rejected[1], "error: unavailable"]);
  good.send(["EVENT", accepted[1], reaction]);
  good.send(["EOSE", accepted[1]]);
  expect(await result).toEqual([JSON.parse(JSON.stringify(reaction))]);
  expect(onError).toHaveBeenCalledWith(expect.anything(), { source: "relay", relay: "wss://bad.test/" });
  expect(await good.nextMessage).toEqual(["CLOSE", accepted[1]]);
  loader.stop();
});

it("sends CLOSE for an active websocket request when stopped", async () => {
  vi.spyOn(Relay, "fetchInformationDocument").mockResolvedValue(null);
  const server = new WS("wss://stop.test/", { jsonProtocol: true });
  const pool = new RelayPool();
  pools.push(pool);
  const loader = createTagValueLoader(pool, "e", { bufferSize: 1 });
  let complete = false;
  loader({ value: "a".repeat(64), relays: ["wss://stop.test/"] }).subscribe({
    complete: () => {
      complete = true;
    },
  });
  await server.connected;
  const message = (await server.nextMessage) as [string, string];
  loader.stop();
  expect(complete).toBe(true);
  expect(await server.nextMessage).toEqual(["CLOSE", message[1]]);
});

it.each([
  [createReactionsLoader, 7],
  [createZapsLoader, 9735],
] as const)("routes wrapper %s through event and address filters for kind %i", async (create, kind) => {
  const user = new FakeUser();
  const note = user.event();
  const article = user.event({ kind: 30023, tags: [["d", "article"]] });
  const address = `30023:${user.pubkey}:article`;
  const reaction = user.event({ kind, tags: [["e", note.id]] });
  const addressed = user.event({ kind, tags: [["a", address]] });
  const request = vi.fn((_relays, filters) => {
    return of(filters[0]["#e"] ? reaction : addressed);
  });
  const controller = new AbortController();
  const loader = create(request, { bufferSize: 1, signal: controller.signal });
  const values: unknown[] = [];
  loader(note, ["wss://wrapper.test/"]).subscribe((e) => values.push(e));
  loader(article, ["wss://wrapper.test/"]).subscribe((e) => values.push(e));
  expect(request.mock.calls).toEqual([
    [["wss://wrapper.test/"], [{ kinds: [kind], "#e": [note.id] }]],
    [["wss://wrapper.test/"], [{ kinds: [kind], "#a": [address] }]],
  ]);
  expect(values).toEqual([reaction, addressed]);
  controller.abort();
});
