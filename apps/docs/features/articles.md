---
description: Read long-form articles and their reactions and comments
---

# Articles

Articles are addressable kind 30023 events whose content is markdown (NIP-23). Because they are addressable, an author can edit an article and clients keep only the latest version.

## Reading an article

Load an article with `store.replaceable()` and cast it with `Article`. The cast reads the metadata tags and falls back to `created_at` when there is no `published_at` tag.

```ts
const article = use$(
  () => store.replaceable(pointer).pipe(castEventStream(Article, store)),
  [pointer.kind, pointer.pubkey, pointer.identifier],
);

article.title;
article.image;
article.summary;
article.publishedDate; // Date, from published_at or created_at
```

To list articles, cast a timeline with `castTimelineStream(Article, store)`.

## Linking to an article

`article.pointer` and `article.address` give the `AddressPointer` and `naddr`. The `pointer$` and `address$` observables add up to three relay hints from the author's outboxes.

```ts
const naddr = use$(article.address$);
```

## Reactions and comments

`article.reactions$` returns the article's [reactions](/features/reactions-and-reposts) as `Reaction` casts. Articles are discussed with kind 1111 [comments](/features/comments), which `CommentsModel` reads and `CreateComment` publishes.

```ts
const comments = use$(
  () => store.model(CommentsModel, article.event).pipe(castTimelineStream(Comment, store)),
  [article.id],
);

await actions.run(CreateComment, article.event, "Great read");
```

## Rendering the content

Article content is markdown with `nostr:` mentions. Render it with `remarkNostrMentions` from `applesauce-content/markdown`, as shown in [Markdown](/apps/content/markdown).

## Helpers

- `isValidArticle(event)` checks for kind 30023 with a title and non-empty content, which the cast requires
- `getArticleTitle`, `getArticleImage`, `getArticleSummary`, and `getArticlePublished` read the metadata

**Example:** [Article rendering](https://applesauce.build/examples/#/example/articles/rendering)

## Best Practices

- Key subscriptions on the article's address, not its event id, since edits change the id
- Share `address$` instead of `address` so links carry relay hints
- Sanitize links when rendering article markdown
