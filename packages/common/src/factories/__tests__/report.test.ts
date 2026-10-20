import { expect, it } from "vitest";
import { ReportFactory } from "../report.js";
import { ReportReason, isValidReport } from "../../helpers/reports.js";
import type { NostrEvent } from "applesauce-core/helpers";

const pubkey = "a".repeat(64),
  id = "b".repeat(64),
  hash = "c".repeat(64);
it("creates user, event, and media reports", async () => {
  const user = await ReportFactory.create(pubkey, ReportReason.spam).content("spam account");
  expect(user.kind).toBe(1984);
  expect(user.tags).toEqual([["p", pubkey, "spam"]]);
  expect(user.content).toBe("spam account");
  const media = await ReportFactory.create({ id, pubkey }, ReportReason.illegal)
    .reportBlob(hash, { id, pubkey }, ReportReason.malware)
    .server("https://example.com/file");
  expect(media.tags).toContainEqual(["e", id, "illegal"]);
  expect(media.tags).toContainEqual(["x", hash, "malware"]);
  expect(isValidReport(media as NostrEvent)).toBe(true);
});
it("modifies targets and servers while preserving unrelated metadata and the source", async () => {
  const original = { ...(await ReportFactory.create(pubkey, ReportReason.spam)), id, pubkey, sig: "" } as NostrEvent;
  original.tags.push(["L", "custom"]);
  const changed = await ReportFactory.modify(original)
    .reportUser(pubkey, ReportReason.other)
    .server("https://example.com")
    .removeServer("https://example.com");
  expect(changed.tags).toEqual([
    ["L", "custom"],
    ["p", pubkey, "other"],
  ]);
  expect(original.tags).toContainEqual(["p", pubkey, "spam"]);
  expect((await ReportFactory.modify(original).removeTarget("user", pubkey)).tags).toEqual([["L", "custom"]]);
  expect(() => ReportFactory.modify({ ...original, kind: 1 })).toThrow();
});
