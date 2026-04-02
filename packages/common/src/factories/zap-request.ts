import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent, ProfilePointer } from "applesauce-core/helpers";
import * as ZapRequest from "../operations/zap-request.js";

export type ZapRequestTemplate = KnownEventTemplate<typeof kinds.ZapRequest>;

export class ZapRequestFactory extends EventFactory<typeof kinds.ZapRequest, ZapRequestTemplate> {
  /**
   * Creates a new zap request event
   * @param event - The NostrEvent being zapped
   * @param amount - The amount in millisatoshis
   * @param relays - The relays to use for the zap request
   */
  static create(event: NostrEvent, amount: number, relays: string[]): ZapRequestFactory {
    return new ZapRequestFactory((res) => res(blankEventTemplate(kinds.ZapRequest)))
      .eventTarget(event)
      .amount(amount)
      .relays(relays);
  }

  /** Creates a zap request for a profile */
  static profile(pubkey: string | ProfilePointer, amount: number, relays: string[], hint?: string): ZapRequestFactory {
    return new ZapRequestFactory((res) => res(blankEventTemplate(kinds.ZapRequest)))
      .amount(amount)
      .relays(relays)
      .profileTarget(pubkey, hint);
  }

  /** Creates a zap request for an event */
  static event(event: NostrEvent, amount: number, relays: string[], hint?: string): ZapRequestFactory {
    return new ZapRequestFactory((res) => res(blankEventTemplate(kinds.ZapRequest)))
      .amount(amount)
      .relays(relays)
      .eventTarget(event, hint);
  }

  /** Sets the relays for the zap request */
  relays(urls: string[]) {
    return this.chain(ZapRequest.setRelays(urls));
  }

  /** Sets the event target. Sets the k (kind), e (event id), a (coordinate for replaceable events), and p (recipient) tags */
  eventTarget(event: NostrEvent, hint?: string) {
    return this.chain(ZapRequest.setEventTarget(event, hint));
  }

  /** Sets the profile target. Sets the p tag (recipient) */
  profileTarget(pubkey: string | ProfilePointer, hint?: string) {
    return this.chain(ZapRequest.setProfileTarget(pubkey, hint));
  }

  /** Sets the amount in millisatoshis */
  amount(amount: number) {
    return this.chain(ZapRequest.setAmount(amount));
  }

  /** Sets the lnurl (bech32-encoded) */
  lnurl(lnurl: string) {
    return this.chain(ZapRequest.setLnurl(lnurl));
  }

  /** Sets the zap message */
  message(text: string) {
    return this.content(text);
  }
}
