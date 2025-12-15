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
import { EventCast } from "./cast.js";

export class Article extends EventCast<ArticleEvent> {
  constructor(event: NostrEvent) {
    if (!isValidArticle(event)) throw new Error("Invalid article");
    super(event);
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
}
