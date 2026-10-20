import { describe, expect, it } from "vitest";
import {
  getReported,
  getReportTargets,
  getReportServers,
  isValidReport,
  REPORT_KIND,
  ReportReason,
} from "../reports.js";
import type { NostrEvent } from "applesauce-core/helpers";

const pubkey = "a".repeat(64),
  id = "b".repeat(64),
  hash = "c".repeat(64);
const report = (tags: string[][], kind = REPORT_KIND): NostrEvent => ({
  kind,
  tags,
  content: " explanation ",
  id: "d".repeat(64),
  pubkey,
  created_at: 1,
  sig: "e".repeat(128),
});

describe("NIP-56 reports", () => {
  it("preserves multiple targets and their distinct reasons", () => {
    const event = report([
      ["p", pubkey, "spam"],
      ["e", id, "illegal"],
      ["x", hash, "malware"],
    ]);
    expect(getReportTargets(event)).toEqual([
      { type: "user", value: pubkey, reason: ReportReason.spam },
      { type: "event", value: id, reason: ReportReason.illegal },
      { type: "blob", value: hash, reason: ReportReason.malware },
    ]);
    expect(isValidReport(event)).toBe(true);
    expect(getReported(event)).toMatchObject({
      type: "event",
      pubkey,
      id,
      reason: "illegal",
      comment: "explanation",
      blobs: [hash],
    });
  });
  it("reads a reason carried only by the blob tag", () => {
    expect(
      getReported(
        report([
          ["p", pubkey],
          ["e", id],
          ["x", hash, "malware"],
        ]),
      )?.reason,
    ).toBe("malware");
  });
  it("reads profile reports and preserves media URLs", () => {
    const event = report([
      ["p", pubkey, "impersonation"],
      ["server", "https://example.com/file.jpg"],
    ]);
    expect(getReported(event)).toMatchObject({ type: "user", reason: "impersonation" });
    expect(getReportServers(event)).toEqual(["https://example.com/file.jpg"]);
  });
  it.each([
    [["p", "", "spam"]],
    [["p", pubkey, "unknown"]],
    [["e", id, "spam"]],
    [
      ["p", pubkey],
      ["x", hash, "malware"],
    ],
    [
      ["p", pubkey],
      ["e", id],
    ],
  ])("rejects incomplete or invalid reports %j", (...tags) => {
    expect(isValidReport(report(tags as string[][]))).toBe(false);
  });
  it("does not interpret unrelated events as reports", () => {
    const event = report([["p", pubkey, "spam"]], 1);
    expect(isValidReport(event)).toBe(false);
    expect(getReported(event)).toBeNull();
    expect(getReportTargets(event)).toEqual([]);
  });
  it("does not type unknown reasons as ReportReason", () => {
    expect(getReported(report([["p", pubkey, "unknown"]]))?.reason).toBeUndefined();
  });
});
