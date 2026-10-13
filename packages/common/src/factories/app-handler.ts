import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { ProfileContent } from "applesauce-core/helpers/profile";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { APP_HANDLER_KIND, HandlerLinkPlatform, HandlerLinkType, isValidAppHandler } from "../helpers/app-handler.js";
import {
  addHandlerKind,
  removeHandlerKind,
  removeHandlerLink,
  setHandlerLatest,
  setHandlerLink,
  setHandlerMetadata,
  setHandlerNext,
} from "../operations/app-handler.js";

/** An event template for a NIP-89 handler information event */
export type AppHandlerTemplate = KnownEventTemplate<typeof APP_HANDLER_KIND>;

/** Factory for NIP-89 handler information events (kind 31990) */
export class AppHandlerFactory extends EventFactory<typeof APP_HANDLER_KIND, AppHandlerTemplate> {
  /** Creates a handler with the given identifier, or a random one */
  static create(identifier?: string): AppHandlerFactory {
    // The blank template already has a random identifier
    const factory = new AppHandlerFactory((res) => res(blankEventTemplate(APP_HANDLER_KIND)));
    return identifier ? factory.chain(includeSingletonTag(["d", identifier])) : factory;
  }

  /**
   * Creates a factory configured to modify an existing handler
   * @throws if the event is not a valid handler information event
   */
  static modify(event: NostrEvent): AppHandlerFactory {
    if (!isValidAppHandler(event)) throw new Error("Expected a NIP-89 handler information event");
    return new AppHandlerFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the kind:0-style metadata, or clears it to use the author's profile */
  metadata(metadata: ProfileContent | null) {
    return this.chain(setHandlerMetadata(metadata));
  }
  /** Adds a supported event kind */
  kind(kind: number) {
    return this.chain(addHandlerKind(kind));
  }
  /** Removes a supported event kind */
  removeKind(kind: number) {
    return this.chain(removeHandlerKind(kind));
  }
  /** Sets a URL template for a platform and NIP-19 entity type */
  link(platform: HandlerLinkPlatform, url: string, type?: HandlerLinkType) {
    return this.chain(setHandlerLink(platform, url, type));
  }
  /** Removes a URL template for a platform and NIP-19 entity type */
  removeLink(platform: HandlerLinkPlatform, type?: HandlerLinkType) {
    return this.chain(removeHandlerLink(platform, type));
  }
  /** Sets or removes the named nsite the handler currently serves */
  latest(site: AddressPointer | string | null) {
    return this.chain(setHandlerLatest(site));
  }
  /** Sets or removes the named nsite the handler is rolling out */
  next(site: AddressPointer | string | null) {
    return this.chain(setHandlerNext(site));
  }
}
