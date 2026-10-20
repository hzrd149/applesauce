import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { REPORT_KIND, ReportReason, ReportTarget } from "../helpers/reports.js";
import {
  addReportBlob,
  addReportEvent,
  addReportServer,
  addReportUser,
  removeReportServer,
  removeReportTarget,
  ReportEventTarget,
} from "../operations/report.js";

/** A kind 1984 report draft */
export type ReportTemplate = KnownEventTemplate<typeof REPORT_KIND>;

/** A factory for NIP-56 reports */
export class ReportFactory extends EventFactory<typeof REPORT_KIND, ReportTemplate> {
  /**
   * Creates a user or event report
   * @throws if the target identity or reason is invalid
   */
  static create(target: string | ReportEventTarget, reason: ReportReason): ReportFactory {
    const factory = new ReportFactory((resolve) => resolve(blankEventTemplate(REPORT_KIND)));
    return typeof target === "string" ? factory.reportUser(target, reason) : factory.reportEvent(target, reason);
  }

  /**
   * Creates a blob report with its containing event and author
   * @throws if the hash, event identity, or reason is invalid
   */
  static blob(hash: string, event: ReportEventTarget, reason: ReportReason): ReportFactory {
    return new ReportFactory((resolve) => resolve(blankEventTemplate(REPORT_KIND))).reportBlob(hash, event, reason);
  }

  /**
   * Creates a factory from an existing report
   * @throws if the event is not kind 1984
   */
  static modify(event: NostrEvent): ReportFactory {
    if (event.kind !== REPORT_KIND) throw new Error("Expected a report event");
    return new ReportFactory((resolve) => resolve(toEventTemplate(event) as ReportTemplate));
  }

  /**
   * Adds or updates a reported user
   * @throws if the public key or reason is invalid
   */
  reportUser(pubkey: string, reason: ReportReason) {
    return this.chain(addReportUser(pubkey, reason));
  }

  /**
   * Adds or updates a reported event
   * @throws if the event identity or reason is invalid
   */
  reportEvent(event: ReportEventTarget, reason: ReportReason) {
    return this.chain(addReportEvent(event, reason));
  }

  /**
   * Adds or updates a reported blob
   * @throws if the hash, event identity, or reason is invalid
   */
  reportBlob(hash: string, event: ReportEventTarget, reason: ReportReason) {
    return this.chain(addReportBlob(hash, event, reason));
  }

  /** Removes a target tag while preserving unrelated tags */
  removeTarget(type: ReportTarget["type"], value: string) {
    return this.chain(removeReportTarget(type, value));
  }

  /**
   * Adds a media server or direct media URL
   * @throws if the URL is invalid or does not use HTTP or HTTPS
   */
  server(url: string) {
    return this.chain(addReportServer(url));
  }

  /** Removes a media server or direct media URL */
  removeServer(url: string) {
    return this.chain(removeReportServer(url));
  }
}
