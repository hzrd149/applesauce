import { EventStore } from "applesauce-core";
import { ReportReason, isValidReport } from "applesauce-common/helpers/reports";
import { expect, it, vi } from "vitest";
import { firstValueFrom } from "rxjs";
import { ActionRunner } from "../action-runner.js";
import { ReportBlob, ReportEvent, ReportUser } from "../actions/report.js";
import { FakeUser } from "./fake-user.js";

it("signs and stores reports and routes them to reporter outboxes", async () => {
  const user = new FakeUser(),
    target = new FakeUser(),
    store = new EventStore();
  store.add(user.event({ kind: 10002, tags: [["r", "wss://reporter.test", "write"]] }));
  const publish = vi.fn().mockResolvedValue(undefined);
  const runner = new ActionRunner(store, user, publish);
  await runner.run(ReportUser, target.pubkey, ReportReason.spam, "spam account");
  const [event, relays] = publish.mock.calls[0];
  expect(event.pubkey).toBe(user.pubkey);
  expect(event.content).toBe("spam account");
  expect(event.tags).toEqual([["p", target.pubkey, "spam"]]);
  expect(relays).toEqual(["wss://reporter.test/"]);
  expect(store.hasEvent(event.id)).toBe(true);
  expect(isValidReport(event)).toBe(true);
});
it("creates event and blob reports without a publish callback through exec", async () => {
  const user = new FakeUser(),
    store = new EventStore();
  const runner = new ActionRunner(store, user);
  const target = user.note("target"),
    hash = "c".repeat(64);
  const event = await firstValueFrom(runner.exec(ReportEvent, target, ReportReason.illegal));
  expect(event.tags).toEqual([
    ["p", user.pubkey],
    ["e", target.id, "illegal"],
  ]);
  const blob = await firstValueFrom(
    runner.exec(ReportBlob, hash, target, ReportReason.malware, "unsafe", ["https://example.com/file"]),
  );
  expect(blob.tags).toEqual([
    ["p", user.pubkey],
    ["e", target.id],
    ["x", hash, "malware"],
    ["server", "https://example.com/file"],
  ]);
  expect(isValidReport(blob)).toBe(true);
});
it("passes absent routing to the publisher and propagates publish failures", async () => {
  const user = new FakeUser(),
    store = new EventStore();
  const publish = vi.fn().mockRejectedValue(new Error("publish failed"));
  const runner = new ActionRunner(store, user, publish);
  await expect(runner.run(ReportUser, user.pubkey, ReportReason.spam)).rejects.toThrow("publish failed");
  expect(publish.mock.calls[0][1]).toBeUndefined();
});
