import { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { isReportIdentifier, ReportReason, ReportTarget } from "../helpers/reports.js";

/** An event identity required when reporting an event or its media */
export type ReportEventTarget = {
  /** The event ID */
  id: string;
  /** The event author's public key */
  pubkey: string;
};

function check(value: string, reason?: ReportReason) {
  if (!isReportIdentifier(value)) throw new Error("Expected a 32-byte lowercase hex report target");
  if (reason !== undefined && !Object.values(ReportReason).includes(reason)) throw new Error("Invalid report reason");
}

function put(tags: string[][], name: string, value: string, reason?: ReportReason): string[][] {
  const existing = tags.find((t) => t[0] === name && t[1] === value);
  if (existing && reason === undefined) return tags;
  return [...tags.filter((t) => t[0] !== name || t[1] !== value), reason ? [name, value, reason] : [name, value]];
}

/**
 * Adds or updates a reported user
 * @throws if the public key or reason is invalid
 */
export function addReportUser(pubkey: string, reason: ReportReason): EventOperation {
  check(pubkey, reason);
  return modifyPublicTags((tags) => put(tags, "p", pubkey, reason));
}

/**
 * Adds or updates a reported event and includes its author
 * @throws if the event identity or reason is invalid
 */
export function addReportEvent(event: ReportEventTarget, reason: ReportReason): EventOperation {
  check(event.id, reason);
  check(event.pubkey);
  return modifyPublicTags((tags) => put(put(tags, "p", event.pubkey), "e", event.id, reason));
}

/**
 * Adds or updates a reported blob and includes its containing event and author
 * @throws if the hash, event identity, or reason is invalid
 */
export function addReportBlob(hash: string, event: ReportEventTarget, reason: ReportReason): EventOperation {
  check(hash, reason);
  check(event.id);
  check(event.pubkey);
  return modifyPublicTags((tags) => put(put(put(tags, "p", event.pubkey), "e", event.id), "x", hash, reason));
}

/** Removes matching target tags and preserves all other tags */
export function removeReportTarget(type: ReportTarget["type"], value: string): EventOperation {
  const name = { user: "p", event: "e", blob: "x" }[type];
  return modifyPublicTags((tags) => tags.filter((t) => t[0] !== name || t[1] !== value));
}

/**
 * Adds a media server or direct media URL without rewriting its path
 * @throws if the URL is invalid or does not use HTTP or HTTPS
 */
export function addReportServer(server: string): EventOperation {
  const url = new URL(server);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Expected an HTTP media URL");
  return modifyPublicTags((tags) =>
    tags.some((t) => t[0] === "server" && t[1] === server) ? tags : [...tags, ["server", server]],
  );
}

/** Removes a media server or direct media URL */
export function removeReportServer(server: string): EventOperation {
  return modifyPublicTags((tags) => tags.filter((t) => t[0] !== "server" || t[1] !== server));
}
