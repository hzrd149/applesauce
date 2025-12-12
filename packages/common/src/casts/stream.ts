import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { of } from "rxjs";
import {
  getStreamChatMessageStream,
  isValidStreamChatMessage,
  StreamChatMessageEvent,
} from "../helpers/stream-chat.js";
import {
  getStreamEndTime,
  getStreamGoalPointer,
  getStreamHashtags,
  getStreamHost,
  getStreamImage,
  getStreamMaxViewers,
  getStreamParticipants,
  getStreamRecording,
  getStreamRelays,
  getStreamStartTime,
  getStreamStatus,
  getStreamStreamingURLs,
  getStreamSummary,
  getStreamTitle,
  getStreamViewers,
  StreamStatus,
} from "../helpers/stream.js";
import { ReactionsModel } from "../models/reactions.js";
import { StreamChatMessagesModel } from "../models/stream.js";
import { EventZapsModel } from "../models/zaps.js";
import { castEvent, castEvents } from "../observable/cast-event.js";
import { Cast } from "./cast.js";
import { Profile } from "./profile.js";
import { Zap } from "./zap.js";
import { isAudioURL, isStreamURL, isVideoURL } from "applesauce-core/helpers";

function isValidStream(event: NostrEvent): event is KnownEvent<kinds.LiveEvent> {
  return event.kind === kinds.LiveEvent;
}

/** Cast a kind 30311 event to a Stream (NIP-53) */
export class Stream extends Cast<KnownEvent<kinds.LiveEvent>> {
  constructor(event: NostrEvent) {
    if (!isValidStream(event)) throw new Error("Invalid stream");
    super(event);
  }
  get title() {
    return getStreamTitle(this.event);
  }
  get summary() {
    return getStreamSummary(this.event);
  }
  get image() {
    return getStreamImage(this.event);
  }
  get status(): StreamStatus {
    return getStreamStatus(this.event);
  }
  get host() {
    return getStreamHost(this.event);
  }
  get participants() {
    return getStreamParticipants(this.event);
  }
  get goalPointer(): EventPointer | undefined {
    return getStreamGoalPointer(this.event);
  }
  get streamingURLs(): string[] {
    return getStreamStreamingURLs(this.event);
  }
  get streamingVideos() {
    return this.streamingURLs.filter((url) => isVideoURL(url) || isStreamURL(url));
  }
  get streamingAudio() {
    return this.streamingURLs.filter((url) => isAudioURL(url) || isStreamURL(url));
  }
  get recording(): string | undefined {
    return getStreamRecording(this.event);
  }
  get relays(): string[] | undefined {
    return getStreamRelays(this.event);
  }
  get startTime(): number | undefined {
    return getStreamStartTime(this.event);
  }
  get endTime(): number | undefined {
    return getStreamEndTime(this.event);
  }
  get viewers(): number | undefined {
    return getStreamViewers(this.event);
  }
  get maxViewers(): number | undefined {
    return getStreamMaxViewers(this.event);
  }
  get hashtags(): string[] {
    return getStreamHashtags(this.event);
  }

  /** An observable of the stream host profile */
  get host$() {
    return this.$$ref("host$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.host.pubkey }).pipe(castEvent(Profile)),
    );
  }

  /** An observable of all zaps on this stream */
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castEvents(Zap)));
  }

  /** An observable of all chat messages for this stream */
  get chat$() {
    return this.$$ref("chat$", (store) => store.model(StreamChatMessagesModel, this.event)).pipe(
      castEvents(StreamChatMessage),
    );
  }

  /** An observable of the goal event if this stream has a goal */
  get goal$() {
    return this.$$ref("goal$", (store) => {
      const goalPointer = this.goalPointer;
      if (!goalPointer) return of(undefined);
      return store.event(goalPointer.id);
    });
  }
}

/** A cast for a stream chat message */
export class StreamChatMessage extends Cast<StreamChatMessageEvent> {
  constructor(event: NostrEvent) {
    if (!isValidStreamChatMessage(event)) throw new Error("Invalid stream chat message");
    super(event);
  }

  get stream() {
    return getStreamChatMessageStream(this.event);
  }

  get author$() {
    return this.$$ref("author$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.event.pubkey }).pipe(castEvent(Profile)),
    );
  }
  get stream$() {
    return this.$$ref("stream$", (store) => store.replaceable(this.stream).pipe(castEvent(Stream)));
  }
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castEvents(Zap)));
  }
  get reactions$() {
    return this.$$ref("reactions$", (store) => store.model(ReactionsModel, this.event));
  }
}
