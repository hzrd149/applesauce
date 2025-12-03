import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { NostrEvent } from "applesauce-core/helpers/event";
import { isETag, isPTag } from "applesauce-core/helpers/tags";

export const ParsedReportSymbol = Symbol("parsed-report");

export enum ReportReason {
  nudity = "nudity",
  malware = "malware",
  profanity = "profanity",
  illegal = "illegal",
  spam = "spam",
  impersonation = "impersonation",
  other = "other",
}

export type ReportedUser = { type: "user"; event: NostrEvent; pubkey: string; reason?: ReportReason };
export type ReportedEvent = {
  type: "event";
  event: NostrEvent;
  comment?: string;
  id: string;
  pubkey: string;
  reason?: ReportReason;
  blobs?: string[];
};

/** Reads a report event as either a user or event report */
export function getReported(report: NostrEvent): ReportedEvent | ReportedUser {
  return getOrComputeCachedValue(report, ParsedReportSymbol, () => {
    const p = report.tags.find(isPTag);
    if (!p) throw new Error("Report missing p tag");

    const comment = report.content ? report.content.trim() : undefined;
    const e = report.tags.find(isETag);

    // Event report
    if (e) {
      const blobs = report.tags.filter((t) => t[0] === "x" && t[1]).map((t) => t[1]);
      return {
        type: "event",
        event: report,
        comment,
        id: e[1],
        pubkey: p[1],
        reason: e[2] as unknown as ReportReason,
        blobs,
      };
    }

    // User report
    return { type: "user", event: report, comment, pubkey: p[1], reason: p[2] as unknown as ReportReason };
  });
}
