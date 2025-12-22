import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { of } from "rxjs";
import { getReportServers, getReported, ReportReason, ReportedEvent, ReportedUser } from "../helpers/reports.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { castUser } from "./user.js";
import { addRelayHintsToPointer, EventPointer } from "applesauce-core/helpers";

const REPORT_KIND = 1984;

function isValidReport(event: NostrEvent): event is KnownEvent<typeof REPORT_KIND> {
  return event.kind === REPORT_KIND;
}

/** Cast a kind 1984 event to a Report */
export class Report extends EventCast<KnownEvent<typeof REPORT_KIND>> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidReport(event)) throw new Error("Invalid report");
    super(event, store);
  }

  /** Get the parsed report data (either a user or event report) */
  get reported(): ReportedEvent | ReportedUser | null {
    return getReported(this.event);
  }

  /** Check if this is a user report */
  get isUserReport(): boolean {
    return this.reported?.type === "user";
  }

  /** Check if this is an event report */
  get isEventReport(): boolean {
    return this.reported?.type === "event";
  }

  /** Get the reason for the report */
  get reason(): ReportReason | undefined {
    return this.reported?.reason;
  }

  /** Get the comment/content of the report */
  get comment(): string | undefined {
    if (!this.reported) return undefined;
    return this.reported.type === "event" ? this.reported.comment : this.reported.comment;
  }

  /** Get the pubkey of the user being reported */
  get reportedPubkey(): string | undefined {
    return this.reported?.pubkey;
  }

  /** Get the User being reported */
  get reportedUser() {
    const pubkey = this.reportedPubkey;
    if (!pubkey) return undefined;
    return castUser(pubkey, this.store);
  }

  /** Get the event ID being reported (for event reports) */
  get reportedEventId(): string | undefined {
    return this.reported?.type === "event" ? this.reported.id : undefined;
  }

  /** Get the event being reported (for event reports) */
  get reportedEvent$() {
    return this.$$ref("reportedEvent$", (store) => {
      const eventId = this.reportedEventId;
      if (!eventId) return of(undefined);

      const pointer: EventPointer = {
        id: eventId,
      };

      return store.event(addRelayHintsToPointer(pointer, this.seen));
    });
  }

  /** Get the blob hashes being reported (for event reports with x tags) */
  get blobs(): string[] | undefined {
    return this.reported?.type === "event" ? this.reported.blobs : undefined;
  }

  /** Get the server URLs for blob reports */
  get servers(): string[] {
    return getReportServers(this.event);
  }
}
