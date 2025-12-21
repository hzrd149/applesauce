import { withImmediateValueOrDefault } from "applesauce-core";
import { addRelayHintsToPointer, getAddressPointerForEvent, naddrEncode, NostrEvent } from "applesauce-core/helpers";
import { map } from "rxjs";
import {
  ArticleEvent,
  getArticleImage,
  getArticlePublished,
  getArticleSummary,
  getArticleTitle,
  isValidArticle,
} from "../helpers/article.js";
import { ReactionsModel } from "../models/reactions.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Reaction } from "./reaction.js";

export class Article extends EventCast<ArticleEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidArticle(event)) throw new Error("Invalid article");
    super(event, store);
  }

  get title() {
    return getArticleTitle(this.event);
  }
  get image() {
    return getArticleImage(this.event);
  }
  get summary() {
    return getArticleSummary(this.event);
  }
  get published() {
    return getArticlePublished(this.event);
  }
  get publishedDate() {
    return new Date(this.published * 1000);
  }

  get pointer() {
    return getAddressPointerForEvent(this.event)!;
  }
  /** An observable of the address with relay hints from the authors outboxes */
  get pointer$() {
    return this.author.outboxes$.pipe(
      withImmediateValueOrDefault(undefined),
      map((outboxes) => (outboxes ? addRelayHintsToPointer(this.pointer, outboxes.slice(0, 3)) : this.pointer)),
    );
  }

  get address() {
    return naddrEncode(this.pointer);
  }
  /** An observable of the address with relay hints from the authors outboxes */
  get address$() {
    return this.pointer$.pipe(map((pointer) => naddrEncode(pointer)));
  }
  get reactions$() {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
}
