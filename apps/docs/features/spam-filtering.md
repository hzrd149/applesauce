---
description: Hide reply spam on-device with the nspam classifier
---

# Spam Filtering

`applesauce-extra` includes a port of [nspam](https://huggingface.co/barrydeen/nspam), an on-device classifier for Nostr reply spam. It is a small gradient-boosted tree model, so it runs in plain JavaScript without an ML runtime and scores an author in about a millisecond.

nspam scores **authors, not single notes**. It reads up to 10 of an author's newest kind 1 replies (events with `e` tags) and returns the probability that the author is a reply spammer.

## Loading the classifier

`NspamClassifier.load()` downloads the model (about 9 MB) from a pinned Hugging Face commit and parses it. Load it once and share it.

```ts
import { NspamClassifier } from "applesauce-extra/nspam";

const nspam$ = defer(() => NspamClassifier.load()).pipe(shareReplay(1));
```

To host or cache the files yourself, pass a `url` to the directory containing `model.txt` and `calibration.npz`, or call `parseNspamModel(modelText, calibration)` with files you loaded.

## Filtering a timeline

Pipe a timeline through `filterSpam`. Every reply in the timeline is added to its author's bundle before filtering, so authors are judged on all the replies the classifier has seen.

```ts
const replies$ = eventStore.timeline({ kinds: [1], "#e": [root.id] }).pipe(filterSpam(nspam));
```

Events that are not kind 1 replies pass through untouched. For single events, use the predicate:

```ts
if (nspam.isSpam(event)) return null;
```

**Example:** [Hide Spam Replies](https://applesauce.build/examples/#/example/feed/hide-spam-replies)

## Scores and thresholds

`getScore(pubkey)` returns `{ raw, score }` for an author, where `score` is the calibrated probability. Authors at or above `threshold` (default `0.5`) are spam.

```ts
const nspam = new NspamClassifier(model, { threshold: 0.8, maxAuthors: 5000 });

nspam.getScore(pubkey)?.score; // 0.97
nspam.score(replies); // score a bundle without remembering it
```

The classifier keeps bundles for the most recent `maxAuthors` authors (default 10000).

## Integration

Combine the score with the viewer's own signals instead of hard-blocking on it. Skip classification for people the user follows and still apply [mutes](/features/moderation):

```ts
const replies$ = combineLatest([eventStore.timeline(filter), user.contacts$]).pipe(
  map(([events, contacts]) => events.filter((e) => contacts?.some((c) => c.pubkey === e.pubkey) || !nspam.isSpam(e))),
);
```

## Best Practices

- Load the model once at module level, it is 9 MB and the classifier is stateful
- Collapse or dim flagged replies rather than deleting them, the model has false positives
- Expect weaker scores for authors with fewer than 3 replies and for non-English text
- Only score kind 1 replies, nspam is not trained on root notes or other kinds
