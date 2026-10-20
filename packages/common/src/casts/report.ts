import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { combineLatest, of } from "rxjs";
import {
  getReportTargets,
  isReportIdentifier,
  isValidReport,
  REPORT_KIND,
  getReportServers,
  getReported,
  ReportReason,
  ReportedEvent,
  ReportedUser,
} from "../helpers/reports.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { castUser } from "./user.js";
import { addRelayHintsToPointer, EventPointer } from "applesauce-core/helpers";

/** A NIP-56 report with typed targets and related users and events */
export class Report extends EventCast<KnownEvent<typeof REPORT_KIND>> {
  /**
   * Creates a report cast
   * @throws if the event lacks valid report targets or context
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidReport(event)) throw new Error("Invalid report");
    super(event, store);
  }

  /** Returns every explicitly reported target with its reason */
  get targets() {
    return getReportTargets(this.event);
  }

  /** Returns all explicitly reported users */
  get reportedUsers() {
    return this.targets.filter((t) => t.type === "user").map((t) => castUser(t.value, this.store));
  }

  /** Checks whether this report explicitly targets media */
  get isBlobReport(): boolean {
    return this.targets.some((t) => t.type === "blob");
  }

  /** Returns pointers to all reported events and blob context events */
  get reportedEventPointers(): EventPointer[] {
    return [...new Set(this.event.tags.filter((t) => t[0] === "e" && isReportIdentifier(t[1])).map((t) => t[1]))].map(
      (id) => addRelayHintsToPointer<EventPointer>({ id }, this.seen),
    );
  }

  /** Subscribes to all reported events and blob context events */
  get reportedEvents$() {
    return this.$$ref("reportedEvents$", (store) => {
      const pointers = this.reportedEventPointers;
      return pointers.length ? combineLatest(pointers.map((p) => store.event(p))) : of([]);
    });
  }

  /** Gets the parsed report data (either a user or event report) */
  get reported(): ReportedEvent | ReportedUser | null {
    return getReported(this.event);
  }

  /** Checks if this is a user report */
  get isUserReport(): boolean {
    return this.reported?.type === "user";
  }

  /** Checks if this is an event report */
  get isEventReport(): boolean {
    return this.reported?.type === "event";
  }

  /** Gets the reason for the report */
  get reason(): ReportReason | undefined {
    return this.reported?.reason;
  }

  /** Gets the comment/content of the report */
  get comment(): string | undefined {
    if (!this.reported) return undefined;
    return this.reported.comment;
  }

  /** Gets the pubkey of the user being reported */
  get reportedPubkey(): string | undefined {
    return this.reported?.pubkey;
  }

  /** Gets the User being reported */
  get reportedUser() {
    const pubkey = this.reportedPubkey;
    if (!pubkey) return undefined;
    return castUser(pubkey, this.store);
  }

  /** Gets the event ID being reported (for event reports) */
  get reportedEventId(): string | undefined {
    return this.reported?.type === "event" ? this.reported.id : undefined;
  }

  /** Gets the event being reported (for event reports) */
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

  /** Gets the blob hashes being reported (for event reports with x tags) */
  get blobs(): string[] | undefined {
    return this.reported?.type === "event" ? this.reported.blobs : undefined;
  }

  /** Gets the server URLs for blob reports */
  get servers(): string[] {
    return getReportServers(this.event);
  }
}
