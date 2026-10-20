import { kinds, LRU, type NostrEvent } from "applesauce-core/helpers";
import { map, type MonoTypeOperatorFunction } from "rxjs";

import { extractNspamFeatures } from "./features.js";
import { loadNspamModel, predictNspam, type NspamModel, type NspamScore } from "./model.js";

/** The most replies per author the model reads, it is trained on bundles of 1-10 replies */
export const NSPAM_MAX_BUNDLE = 10;

/** Checks if an event is a kind 1 reply, the only kind of note nspam is trained on */
export function isNspamReply(event: NostrEvent): boolean {
  return event.kind === kinds.ShortTextNote && event.tags.some((t) => t[0] === "e");
}

/** Options for {@link NspamClassifier} */
export type NspamClassifierOptions = {
  /** The calibrated score at or above which an author is considered a spammer, defaults to 0.5 */
  threshold?: number;
  /** The maximum number of authors to keep reply bundles for, defaults to 10000 */
  maxAuthors?: number;
};

type Bundle = { notes: NostrEvent[]; score?: NspamScore };

/** Scores reply authors with the on-device nspam spam model by collecting each author's newest replies */
export class NspamClassifier {
  /** The calibrated score at or above which an author is considered a spammer */
  threshold: number;

  protected bundles: LRU<Bundle>;

  constructor(
    readonly model: NspamModel,
    options: NspamClassifierOptions = {},
  ) {
    this.threshold = options.threshold ?? 0.5;
    this.bundles = new LRU(options.maxAuthors ?? 10_000);
  }

  /**
   * Downloads the nspam model and creates a classifier
   * @throws if the model fails to download or parse
   */
  static async load(options?: NspamClassifierOptions & { url?: string }): Promise<NspamClassifier> {
    return new NspamClassifier(await loadNspamModel(options?.url), options);
  }

  /**
   * Scores a bundle of replies from a single author without remembering them
   * @throws if there are no replies or they are from more than one author
   */
  score(events: NostrEvent[]): NspamScore {
    const replies = events.filter(isNspamReply).sort((a, b) => b.created_at - a.created_at);
    if (replies.length === 0) throw new Error("nspam can only score kind 1 replies");
    if (replies.some((e) => e.pubkey !== replies[0].pubkey)) throw new Error("nspam scores one author at a time");
    return predictNspam(this.model, extractNspamFeatures(replies.slice(0, NSPAM_MAX_BUNDLE)));
  }

  /** Adds a reply to its author's bundle, returns false if the event is not a reply or did not change the bundle */
  add(event: NostrEvent): boolean {
    if (!isNspamReply(event)) return false;

    const bundle = this.bundles.get(event.pubkey) ?? { notes: [] };
    if (bundle.notes.some((e) => e.id === event.id)) return false;

    const notes = [...bundle.notes, event].sort((a, b) => b.created_at - a.created_at).slice(0, NSPAM_MAX_BUNDLE);
    if (!notes.includes(event)) return false;

    // Scores are computed lazily so adding a batch of replies only scores each author once
    this.bundles.set(event.pubkey, { notes });
    return true;
  }

  /** Returns the score for an author's bundle, or undefined if no replies from them have been added */
  getScore(pubkey: string): NspamScore | undefined {
    const bundle = this.bundles.get(pubkey);
    if (!bundle) return undefined;
    bundle.score ??= predictNspam(this.model, extractNspamFeatures(bundle.notes));
    return bundle.score;
  }

  /** Adds a reply to its author's bundle and checks if the author scores at or above the threshold */
  isSpam(event: NostrEvent): boolean {
    if (!isNspamReply(event)) return false;
    this.add(event);
    return (this.getScore(event.pubkey)?.score ?? 0) >= this.threshold;
  }
}

/** Removes replies from authors the classifier scores as spammers, using every reply in the timeline as evidence */
export function filterSpam(classifier: NspamClassifier): MonoTypeOperatorFunction<NostrEvent[]> {
  return map((events) => {
    for (const event of events) classifier.add(event);
    return events.filter((event) => !classifier.isSpam(event));
  });
}
