import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import {
  addThumbnail,
  clearHeroImage,
  clearThumbnails,
  removeThumbnail,
  setDescription,
  setHeroImage,
  setIdentifier,
  setName,
} from "../operations/badge.js";

type ImageDimensions = {
  width?: number;
  height?: number;
};

export type BadgeTemplate = KnownEventTemplate<typeof kinds.BadgeDefinition>;

/** Factory for NIP-58 badge definition events (kind 30009) */
export class BadgeFactory extends EventFactory<typeof kinds.BadgeDefinition, BadgeTemplate> {
  /** Creates a fresh badge definition factory */
  static create(): BadgeFactory {
    return new BadgeFactory((res) => res(blankEventTemplate(kinds.BadgeDefinition)));
  }

  /** Creates a factory configured to modify an existing badge event */
  static modify(event: NostrEvent): BadgeFactory {
    if (event.kind !== kinds.BadgeDefinition) throw new Error("Expected a badge definition event");
    return new BadgeFactory((res) => res(toEventTemplate(event) as BadgeTemplate));
  }

  /** Sets the badge identifier */
  identifier(value: string) {
    return this.chain(setIdentifier(value));
  }

  /** Sets or clears the badge name */
  name(value: string | null) {
    return this.chain(setName(value));
  }

  /** Sets or clears the badge description */
  description(value: string | null) {
    return this.chain(setDescription(value));
  }

  /** Sets the hero image metadata */
  image(url: string, dimensions?: ImageDimensions) {
    const { width, height } = dimensions ?? {};
    return this.chain(setHeroImage(url, { width, height }));
  }

  /** Removes the hero image tag */
  clearImage() {
    return this.chain(clearHeroImage());
  }

  /** Adds or replaces a thumbnail entry */
  thumbnail(url: string, dimensions?: ImageDimensions) {
    const { width, height } = dimensions ?? {};
    return this.chain(addThumbnail(url, { width, height }));
  }

  /** Removes a thumbnail for the provided URL */
  removeThumbnail(url: string) {
    return this.chain(removeThumbnail(url));
  }

  /** Clears every thumbnail tag */
  clearThumbnails() {
    return this.chain(clearThumbnails());
  }
}
