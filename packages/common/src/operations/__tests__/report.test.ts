import { expect, it } from "vitest";
import {
  addReportBlob,
  addReportEvent,
  addReportUser,
  addReportServer,
  removeReportServer,
  removeReportTarget,
} from "../report.js";
import { ReportReason } from "../../helpers/reports.js";

const pubkey = "a".repeat(64),
  id = "b".repeat(64),
  hash = "c".repeat(64);
it("adds and updates targets immutably without overwriting user reasons with context", async () => {
  const draft = { kind: 1984, content: "", created_at: 1, tags: [["L", "custom"]] };
  const user = await addReportUser(pubkey, ReportReason.spam)(draft);
  const event = await addReportEvent({ id, pubkey }, ReportReason.illegal)(user);
  const blob = await addReportBlob(hash, { id, pubkey }, ReportReason.malware)(event);
  const updated = await addReportUser(pubkey, ReportReason.other)(blob);
  expect(draft.tags).toEqual([["L", "custom"]]);
  expect(user.tags).toContainEqual(["p", pubkey, "spam"]);
  expect(updated.tags).toEqual([
    ["L", "custom"],
    ["e", id, "illegal"],
    ["x", hash, "malware"],
    ["p", pubkey, "other"],
  ]);
  expect((await removeReportTarget("blob", hash)(updated)).tags).not.toContainEqual(["x", hash, "malware"]);
});
it("deduplicates and removes servers while preserving direct URLs", async () => {
  const draft = { kind: 1984, content: "", created_at: 1, tags: [] };
  const url = "https://example.com/path/file.jpg";
  const added = await addReportServer(url)(await addReportServer(url)(draft));
  expect(added.tags).toEqual([["server", url]]);
  expect((await removeReportServer(url)(added)).tags).toEqual([]);
});
it("rejects malformed identities, reasons, and unsafe URL schemes", () => {
  expect(() => addReportUser("bad", ReportReason.spam)).toThrow();
  expect(() => addReportEvent({ id, pubkey }, "bad" as ReportReason)).toThrow();
  expect(() => addReportBlob("bad", { id, pubkey }, ReportReason.spam)).toThrow();
  expect(() => addReportServer("javascript:alert(1)")).toThrow();
  expect(() => addReportServer("invalid")).toThrow();
});
