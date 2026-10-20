import { EventStore } from "applesauce-core";
import { firstValueFrom } from "rxjs";
import { expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { Report } from "../report.js";
import { Note } from "../note.js";
import { castUser } from "../user.js";
import { ReportReason } from "../../helpers/reports.js";

it("resolves users, all events, and blob context through casts", async () => {
  const user = new FakeUser(),
    other = new FakeUser(),
    store = new EventStore();
  const first = store.add(user.note("first"))!,
    second = store.add(other.note("second"))!;
  const hash = "c".repeat(64);
  const event = store.add(
    user.event({
      kind: 1984,
      content: " explanation ",
      tags: [
        ["p", other.pubkey, "spam"],
        ["e", first.id, "illegal"],
        ["e", second.id],
        ["x", hash, "malware"],
        ["server", "https://example.com/file.jpg"],
      ],
    }),
  )!;
  const report = new Report(event, store);
  expect(report.reason).toBe(ReportReason.illegal);
  expect(report.comment).toBe("explanation");
  expect(report.isBlobReport).toBe(true);
  expect(report.reportedUsers.map((u) => u.pubkey)).toEqual([other.pubkey]);
  expect(report.reportedUser?.pubkey).toBe(other.pubkey);
  expect(report.blobs).toEqual([hash]);
  expect(report.servers).toEqual(["https://example.com/file.jpg"]);
  expect((await firstValueFrom(report.reportedEvent$))?.id).toBe(first.id);
  expect((await report.reportedEvents$.$first()).map((e) => e?.id)).toEqual([first.id, second.id]);
  expect((await new Note(first, store).reports$.$first()).map((r) => r.id)).toEqual([event.id]);
  expect((await castUser(other.pubkey, store).reports$.$first()).map((r) => r.id)).toEqual([event.id]);
  expect((await castUser(user.pubkey, store).reportsSent$.$first()).map((r) => r.id)).toEqual([event.id]);
});
it("reacts to incoming reports and excludes invalid report events", async () => {
  const user = new FakeUser(),
    store = new EventStore();
  const note = store.add(user.note("target"))!;
  const counts: number[] = [];
  const subscription = new Note(note, store).reports$.subscribe((reports) => counts.push(reports.length));
  store.add(
    user.event({
      kind: 1984,
      tags: [
        ["e", note.id],
        ["p", user.pubkey],
      ],
    }),
  );
  const valid = store.add(
    user.event({
      kind: 1984,
      tags: [
        ["e", note.id, "spam"],
        ["p", user.pubkey],
      ],
    }),
  )!;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(counts[0]).toBe(0);
  expect(counts.at(-1)).toBe(1);
  store.remove(valid);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(counts.at(-1)).toBe(0);
  subscription.unsubscribe();
});
it("handles profile-only reports and rejects malformed reports", async () => {
  const user = new FakeUser(),
    store = new EventStore();
  const report = new Report(user.event({ kind: 1984, tags: [["p", user.pubkey, "spam"]] }), store);
  expect(report.isUserReport).toBe(true);
  expect(report.reportedEventPointers).toEqual([]);
  expect(await firstValueFrom(report.reportedEvent$)).toBeUndefined();
  expect(await report.reportedEvents$.$first()).toEqual([]);
  expect(() => new Report(user.note(), store)).toThrow("Invalid report");
  expect(() => new Report(user.event({ kind: 1984, tags: [["p", "", "spam"]] }), store)).toThrow("Invalid report");
});
