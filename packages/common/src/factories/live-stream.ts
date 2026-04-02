import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { includeReplaceableIdentifier } from "applesauce-core/operations/index";
import { nanoid } from "nanoid";
import { StreamRole } from "../helpers/stream.js";
import * as Stream from "../operations/stream.js";

export type LiveStreamTemplate = KnownEventTemplate<kinds.LiveEvent>;

/** A factory class for building NIP-53 live stream events (kind 30311) */
export class LiveStreamFactory extends EventFactory<kinds.LiveEvent, LiveStreamTemplate> {
  /** Creates a new live stream factory with an auto-generated identifier */
  static create(title: string): LiveStreamFactory {
    return new LiveStreamFactory((res) => res(blankEventTemplate(kinds.LiveEvent))).identifier(nanoid()).title(title);
  }

  /** Creates a factory from an existing live stream event for editing */
  static modify(event: NostrEvent | KnownEvent<kinds.LiveEvent>): LiveStreamFactory {
    if (!isKind(event, kinds.LiveEvent)) throw new Error("Event is not a live stream event");
    return new LiveStreamFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the "d" identifier tag */
  identifier(id: string) {
    return this.chain(includeReplaceableIdentifier(id));
  }

  /** Sets the title of the live stream */
  title(title: string) {
    return this.chain(Stream.setTitle(title));
  }

  /** Sets the summary/description of the live stream */
  summary(summary: string) {
    return this.chain(Stream.setSummary(summary));
  }

  /** Sets the preview image for the live stream */
  image(url: string) {
    return this.chain(Stream.setImage(url));
  }

  /** Sets the streaming URL */
  streamingUrl(url: string | URL) {
    return this.chain(Stream.setStreamingUrl(url));
  }

  /** Sets the recording URL (typically after the stream ends) */
  recordingUrl(url: string | URL) {
    return this.chain(Stream.setRecordingUrl(url));
  }

  /** Sets the start time of the stream */
  startTime(time: number | Date) {
    return this.chain(Stream.setStartTime(time));
  }

  /** Sets the end time of the stream */
  endTime(time: number | Date) {
    return this.chain(Stream.setEndTime(time));
  }

  /** Sets the status of the stream */
  status(status: "planned" | "live" | "ended") {
    return this.chain(Stream.setStatus(status));
  }

  /** Sets the host of the stream */
  host(user: ProfilePointer) {
    return this.chain(Stream.setHost(user));
  }

  /** Adds a participant to the stream with a role */
  addParticipant(user: ProfilePointer, role: StreamRole) {
    return this.chain(Stream.addParticipant(user, role));
  }

  /** Removes a participant from the stream */
  removeParticipant(pubkey: string) {
    return this.chain(Stream.removeParticipant(pubkey));
  }

  /** Adds a relay to the stream's relay list */
  addRelay(relay: string | URL) {
    return this.chain(Stream.addRelay(relay));
  }

  /** Removes a relay from the stream's relay list */
  removeRelay(relay: string | URL) {
    return this.chain(Stream.removeRelay(relay));
  }

  /** Sets the pinned live chat message */
  pinnedMessage(eventId: string) {
    return this.chain(Stream.setPinnedMessage(eventId));
  }

  /** Removes the pinned live chat message */
  removePinnedMessage() {
    return this.chain(Stream.removePinnedMessage());
  }

  /** Adds a hashtag "t" tag to the stream */
  addHashtag(hashtag: string) {
    return this.chain(Stream.addHashtag(hashtag));
  }

  /** Removes a hashtag from the stream */
  removeHashtag(hashtag: string) {
    return this.chain(Stream.removeHashtag(hashtag));
  }
}
