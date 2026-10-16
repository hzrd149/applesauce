import "./user.js";
import { ChainableObservable } from "applesauce-core";
import { User } from "applesauce-core/casts/user";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { getProfileContent, isValidProfile, ProfileContent } from "applesauce-core/helpers/profile";
import { map, of } from "rxjs";
import {
  AppHandlerEvent,
  createHandlerLink,
  getHandlerDescription,
  getHandlerIdentifier,
  getHandlerLatestPointer,
  getHandlerLinks,
  getHandlerLinkTemplate,
  getHandlerName,
  getHandlerNextPointer,
  getHandlerPicture,
  getHandlerPlatforms,
  getHandlerSupportedKinds,
  HandlerLinkPlatform,
  HandlerLinkType,
  isValidAppHandler,
} from "../helpers/app-handler.js";
import { UserAppHandlersModel } from "../models/app-handler.js";
import { AppNsitesModel } from "../models/nsite.js";
import { castEventStream, castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { NamedNsite, Nsite } from "./nsite.js";

/** Cast for NIP-89 handler information events (kind 31990) */
export class AppHandler extends EventCast<AppHandlerEvent> {
  /**
   * Creates a cast for a validated handler
   * @throws if the event is not a valid handler information event
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidAppHandler(event)) throw new Error("Invalid app handler");
    super(event, store);
  }

  /** The `d` tag identifier of the handler */
  get identifier() {
    return getHandlerIdentifier(this.event);
  }
  /** The address pointer of the handler */
  get pointer(): AddressPointer {
    return getAddressPointerForEvent(this.event)!;
  }
  /** The handler's display name from its metadata */
  get name() {
    return getHandlerName(this.event);
  }
  /** The handler's picture from its metadata */
  get picture() {
    return getHandlerPicture(this.event);
  }
  /** The handler's description from its metadata */
  get description() {
    return getHandlerDescription(this.event);
  }
  /** The handler's own kind:0-style metadata, or undefined when it uses the author's profile */
  get metadata(): ProfileContent | undefined {
    return isValidProfile(this.event) ? getProfileContent(this.event) : undefined;
  }
  /** The event kinds the handler supports */
  get supportedKinds() {
    return getHandlerSupportedKinds(this.event);
  }
  /** The named nsite the handler currently serves */
  get latestPointer() {
    return getHandlerLatestPointer(this.event);
  }
  /** The named nsite the handler is rolling out */
  get nextPointer() {
    return getHandlerNextPointer(this.event);
  }

  /** The platforms the handler has URL templates for */
  get platforms() {
    return getHandlerPlatforms(this.event);
  }

  /** Returns all URL templates for a platform */
  links(platform?: HandlerLinkPlatform) {
    return getHandlerLinks(this.event, platform);
  }
  /** Returns the URL template for a platform and NIP-19 entity type */
  linkTemplate(platform?: HandlerLinkPlatform, type?: HandlerLinkType) {
    return getHandlerLinkTemplate(this.event, platform, type);
  }
  /** Returns a URL that opens a pointer in the handler */
  link(pointer: AddressPointer | EventPointer | ProfilePointer, platform?: HandlerLinkPlatform) {
    return createHandlerLink(this.event, pointer, platform);
  }

  /** Subscribes to the handler's metadata, falling back to the author's kind:0 profile when its content is empty */
  get metadata$(): ChainableObservable<ProfileContent | undefined> {
    return this.$$ref("metadata$", (store) =>
      this.metadata
        ? of(this.metadata)
        : store
            .replaceable({ kind: kinds.Metadata, pubkey: this.event.pubkey })
            .pipe(map((profile) => (isValidProfile(profile) ? getProfileContent(profile) : undefined))),
    );
  }
  /** Subscribes to the named nsite from the `latest` tag */
  get latest$(): ChainableObservable<NamedNsite | undefined> {
    return this.$$ref("latest$", (store) =>
      this.latestPointer
        ? store.replaceable(this.latestPointer).pipe(castEventStream(NamedNsite, store))
        : of(undefined),
    );
  }
  /** Subscribes to the named nsite from the `next` tag */
  get next$(): ChainableObservable<NamedNsite | undefined> {
    return this.$$ref("next$", (store) =>
      this.nextPointer ? store.replaceable(this.nextPointer).pipe(castEventStream(NamedNsite, store)) : of(undefined),
    );
  }
  /** Subscribes to loaded nsite manifests whose NIP-5A `app` tag references this handler */
  get nsites$(): ChainableObservable<Nsite[]> {
    return this.$$ref("nsites$", (store) =>
      store.model(AppNsitesModel, this.event).pipe(castTimelineStream(Nsite, store)),
    );
  }
}

Object.defineProperty(User.prototype, "appHandlers$", {
  get(this: User) {
    return this.$$ref("appHandlers$", (store) =>
      store.model(UserAppHandlersModel, this.pubkey).pipe(castTimelineStream(AppHandler, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    /** Subscribes to the app handlers the user has published */
    get appHandlers$(): ChainableObservable<AppHandler[]>;
  }
}
