import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NOSTR_WEB_TOKEN_KIND, NostrWebTokenClaims } from "../helpers/nostr-web-token.js";
import * as NostrWebToken from "../operations/nostr-web-token.js";

export type NostrWebTokenTemplate = KnownEventTemplate<typeof NOSTR_WEB_TOKEN_KIND>;

/** Factory for Nostr Web Token events (kind 27519). */
export class NostrWebTokenFactory extends EventFactory<typeof NOSTR_WEB_TOKEN_KIND, NostrWebTokenTemplate> {
  /** Creates a Nostr Web Token factory. */
  static create(claims?: Partial<NostrWebTokenClaims>): NostrWebTokenFactory {
    const factory = new NostrWebTokenFactory((res) => res(blankEventTemplate(NOSTR_WEB_TOKEN_KIND)));

    if (!claims) return factory;

    let result = factory;
    if (claims.issuer !== undefined) result = result.issuer(claims.issuer);
    if (claims.subject !== undefined) result = result.subject(claims.subject);
    if (claims.audiences !== undefined) result = result.audiences(claims.audiences);
    if (claims.issuedAt !== undefined) result = result.issuedAt(claims.issuedAt);
    if (claims.expiration !== undefined) result = result.expiration(claims.expiration);
    if (claims.notBefore !== undefined) result = result.notBefore(claims.notBefore);
    if (claims.claims) {
      for (const [name, values] of Object.entries(claims.claims)) {
        result = result.clearClaim(name);
        for (const value of values) result = result.addClaim(name, value, false);
      }
    }

    return result;
  }

  /** Creates a factory configured to modify an existing Nostr Web Token. */
  static modify(event: NostrEvent): NostrWebTokenFactory {
    if (event.kind !== NOSTR_WEB_TOKEN_KIND) throw new Error("Expected a Nostr Web Token event");
    return new NostrWebTokenFactory((res) => res(toEventTemplate(event) as NostrWebTokenTemplate));
  }

  /** Sets or removes the issuer claim. */
  issuer(value: string | null) {
    return this.chain(NostrWebToken.setIssuer(value));
  }

  /** Sets or removes the subject claim. */
  subject(value: string | null) {
    return this.chain(NostrWebToken.setSubject(value));
  }

  /** Replaces all audience claims. */
  audiences(values: string[]) {
    return this.chain(NostrWebToken.setAudiences(values));
  }

  /** Adds an audience claim. */
  addAudience(value: string, replace = true) {
    return this.chain(NostrWebToken.addAudience(value, replace));
  }

  /** Removes a matching audience claim. */
  removeAudience(value: string) {
    return this.chain(NostrWebToken.removeAudience(value));
  }

  /** Clears all audience claims. */
  clearAudiences() {
    return this.chain(NostrWebToken.clearAudiences());
  }

  /** Sets or removes the issued-at claim. */
  issuedAt(value: number | null) {
    return this.chain(NostrWebToken.setIssuedAt(value));
  }

  /** Sets or removes the expiration claim. */
  expiration(value: number | null) {
    return this.chain(NostrWebToken.setExpiration(value));
  }

  /** Sets or removes the not-before claim. */
  notBefore(value: number | null) {
    return this.chain(NostrWebToken.setNotBefore(value));
  }

  /** Sets or removes a singleton claim. */
  claim(name: string, value: string | number | null) {
    return this.chain(NostrWebToken.setClaim(name, value));
  }

  /** Adds an application-defined claim. */
  addClaim(name: string, value: string | number, replace = true) {
    return this.chain(NostrWebToken.addClaim(name, value, replace));
  }

  /** Removes matching values for a claim, or all tags with the claim name when value is omitted. */
  removeClaim(name: string, value?: string | number) {
    return this.chain(NostrWebToken.removeClaim(name, value));
  }

  /** Clears all tags with the claim name. */
  clearClaim(name: string) {
    return this.chain(NostrWebToken.clearClaim(name));
  }

  /** Sets the human-readable signing message. */
  message(content: string) {
    return this.content(content);
  }
}
