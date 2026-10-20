import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { NostrEvent } from "applesauce-core/helpers/event";
import { isETag, isNameValueTag, isPTag } from "applesauce-core/helpers/tags";

/** The NIP-56 report event kind */
export const REPORT_KIND = 1984;

/** The cache key for the legacy report projection */
export const ParsedReportSymbol = Symbol("parsed-report");

/** The standard NIP-56 report categories */
export enum ReportReason {
  nudity = "nudity",
  malware = "malware",
  profanity = "profanity",
  illegal = "illegal",
  spam = "spam",
  impersonation = "impersonation",
  other = "other",
}

/** A user report with its source event */
export type ReportedUser = {
  /** The report category */
  type: "user";
  /** The source report */
  event: NostrEvent;
  /** The reported public key */
  pubkey: string;
  /** The report reason */
  reason?: ReportReason;
  /** The reporter's explanation */
  comment?: string;
};
/** An event report with its source event */
export type ReportedEvent = {
  /** The report category */
  type: "event";
  /** The source report */
  event: NostrEvent;
  /** The reporter's explanation */
  comment?: string;
  /** The reported event ID */
  id: string;
  /** The reported public key */
  pubkey: string;
  /** The report reason */
  reason?: ReportReason;
  /** The reported blob hashes */
  blobs?: string[];
};

/** Reads a report event as either a user or event report */
export function getReported(report: NostrEvent): ReportedEvent | ReportedUser | null {
  if (report.kind !== REPORT_KIND) return null;
  return getOrComputeCachedValue(report, ParsedReportSymbol, () => {
    const pTag = report.tags.find((t) => isPTag(t) && isReportIdentifier(t[1]));
    if (!pTag) return null;

    const comment = report.content ? report.content.trim() : undefined;
    const eTag = report.tags.find((t) => isETag(t) && isReportIdentifier(t[1]));

    // Event report
    if (eTag) {
      const blobs = report.tags.filter((t) => t[0] === "x" && isReportIdentifier(t[1])).map((t) => t[1]);
      return {
        type: "event",
        event: report,
        comment,
        id: eTag[1],
        pubkey: pTag[1],
        reason: parseReason(eTag[2]) ?? getReportTargets(report).find((t) => t.type === "blob")?.reason,
        blobs,
      };
    }

    // User report
    return { type: "user", event: report, comment, pubkey: pTag[1], reason: parseReason(pTag[2]) };
  });
}

/** Gets the server tags from a report event (for blob reports) */
export function getReportServers(report: NostrEvent): string[] {
  return report.tags.filter((t) => isNameValueTag(t, "server") && t[1]).map((t) => t[1]);
}

/** A target explicitly assigned a report reason */
export type ReportTarget = {
  /** The target category */
  type: "user" | "event" | "blob";
  /** The public key, event ID, or blob hash */
  value: string;
  /** The report category for this target */
  reason: ReportReason;
};

/** Checks whether a value is a lowercase 32-byte hex identifier */
export function isReportIdentifier(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseReason(value: string | undefined): ReportReason | undefined {
  return Object.values(ReportReason).includes(value as ReportReason) ? (value as ReportReason) : undefined;
}

/** Returns all explicitly reported targets and their individual reasons */
export function getReportTargets(event: NostrEvent): ReportTarget[] {
  if (event.kind !== REPORT_KIND) return [];
  return event.tags.flatMap((tag): ReportTarget[] => {
    const type = tag[0] === "p" ? "user" : tag[0] === "e" ? "event" : tag[0] === "x" ? "blob" : undefined;
    const reason = parseReason(tag[2]);
    return type && isReportIdentifier(tag[1]) && reason ? [{ type, value: tag[1], reason }] : [];
  });
}

/** Checks whether an event has NIP-56 targets and required context tags */
export function isValidReport(event: NostrEvent): event is NostrEvent & { kind: typeof REPORT_KIND } {
  if (event.kind !== REPORT_KIND || !event.tags.some((t) => isPTag(t) && isReportIdentifier(t[1]))) return false;
  const targets = getReportTargets(event);
  return (
    targets.length > 0 &&
    (!targets.some((t) => t.type === "blob") || event.tags.some((t) => isETag(t) && isReportIdentifier(t[1])))
  );
}
