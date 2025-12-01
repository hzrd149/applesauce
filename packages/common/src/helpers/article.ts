import { getTagValue, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

/** Type for validated article events */
export type ArticleEvent = KnownEvent<kinds.LongFormArticle>;

/** Returns an articles title, if it exists */
export function getArticleTitle(article: ArticleEvent): string;
export function getArticleTitle(article: NostrEvent): string | undefined;
export function getArticleTitle(article: NostrEvent): string | undefined {
  return getTagValue(article, "title");
}

/** Returns an articles image, if it exists */
export function getArticleImage(article: NostrEvent): string | undefined {
  return getTagValue(article, "image");
}

/** Returns an articles summary, if it exists */
export function getArticleSummary(article: NostrEvent): string | undefined {
  return getTagValue(article, "summary");
}

/** Returns an articles published date, if it exists */
export function getArticlePublished(article: NostrEvent): number {
  const ts = getTagValue(article, "published_at");

  if (ts && !Number.isNaN(parseInt(ts))) return parseInt(ts);
  else return article.created_at;
}

/** validates that an event is a valid article event */
export function isValidArticle(article: NostrEvent): article is ArticleEvent {
  return article.kind === kinds.LongFormArticle && getArticleTitle(article) !== undefined && article.content.length > 0;
}
