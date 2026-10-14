import { unixNow } from "applesauce-core/helpers";
import {
  DomainIdentityJson,
  getIdentitiesFromJson,
  Identity,
  IdentityStatus,
  normalizeIdentityJson,
} from "../helpers/dns-identity.js";

export type AsyncIdentityCache = {
  /** Saves a batch of identities */
  save: (identities: Record<string, Identity>) => Promise<void> | void;
  /** Loads a single identity */
  load: (address: string) => Promise<Identity | undefined> | Identity | undefined;
};

export class DnsIdentityLoader {
  identities = new Map<string, Identity>();

  /** The fetch implementation this class should use */
  fetch: (url: string, init: RequestInit) => Promise<Response> = fetch;

  /** How long an identity should be kept until its considered expired (in seconds) defaults to 1 week */
  expiration = 60 * 60 * 24 * 7;

  constructor(public cache?: AsyncIdentityCache) {}

  /** Makes an http request to fetch an identity */
  async fetchIdentity(name: string, domain: string): Promise<Identity> {
    const { fetch } = this;
    const checked = unixNow();

    try {
      const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`, { redirect: "manual" });
      if (res.status !== 200) throw Error("Wrong response code");

      const json = await (res.json() as Promise<DomainIdentityJson>).then(normalizeIdentityJson);
      const identities = getIdentitiesFromJson(domain, json, checked);

      // save all identities to cache
      if (this.cache && Object.values(identities).length > 0) this.cache.save(identities);

      for (const [address, identity] of Object.entries(identities)) this.identities.set(address, identity);

      return identities[name + "@" + domain] || { name, domain, checked, status: IdentityStatus.Missing };
    } catch (error) {
      if (error instanceof Error) return { name, domain, checked, status: IdentityStatus.Error, error: error.message };
      else return { name, domain, checked, status: IdentityStatus.Error, error: "Unknown" };
    }
  }

  /** Loads an identity from the cache or fetches it */
  async loadIdentity(name: string, domain: string): Promise<Identity> {
    let identity: Identity | undefined;
    if (this.cache) identity = await this.cache.load(name + "@" + domain);

    // fetch the identity if its not in cache, or if its expired
    if (!identity || unixNow() - identity.checked > this.expiration) return await this.fetchIdentity(name, domain);
    else return identity;
  }

  private requesting = new Map<string, Promise<Identity>>();
  /** Requests an identity to be loaded */
  requestIdentity(name: string, domain: string): Promise<Identity> {
    const key = name + "@" + domain;

    let existing = this.identities.get(key);
    if (existing) return Promise.resolve(existing);

    let ongoing = this.requesting.get(key);
    if (!ongoing) {
      ongoing = this.loadIdentity(name, domain);
      this.requesting.set(key, ongoing);
    }

    return ongoing;
  }

  /** Checks if an identity is loaded */
  getIdentity(name: string, domain: string): Identity | undefined {
    return this.identities.get(name + "@" + domain);
  }
}
