import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { NostrEvent } from "applesauce-core/helpers/event";
import { isETag, isNameValueTag, isPTag } from "applesauce-core/helpers/tags";

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

export type ReportedUser = { type: "user"; event: NostrEvent; pubkey: string; reason?: ReportReason; comment?: string };
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
export function getReported(report: NostrEvent): ReportedEvent | ReportedUser | null {
  return getOrComputeCachedValue(report, ParsedReportSymbol, () => {
    const pTag = report.tags.find(isPTag);
    if (!pTag) return null;

    const comment = report.content ? report.content.trim() : undefined;
    const eTag = report.tags.find(isETag);

    // Event report
    if (eTag) {
      const blobs = report.tags.filter((t) => t[0] === "x" && t[1]).map((t) => t[1]);
      return {
        type: "event",
        event: report,
        comment,
        id: eTag[1],
        pubkey: pTag[1],
        reason: eTag[2] as unknown as ReportReason,
        blobs,
      };
    }

    // User report
    return { type: "user", event: report, comment, pubkey: pTag[1], reason: pTag[2] as unknown as ReportReason };
  });
}

/** Gets the server tags from a report event (for blob reports) */
export function getReportServers(report: NostrEvent): string[] {
  return report.tags.filter((t) => isNameValueTag(t, "server") && t[1]).map((t) => t[1]);
}
