import { type Proof, type Token } from "@cashu/cashu-ts";
import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent, EventTemplate } from "applesauce-core/helpers";
import { AddressPointer, EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { NUTZAP_KIND } from "../helpers/nutzap.js";
import { setProofs, setMint, setRecipient, setEvent, setComment } from "../operations/nutzap.js";

export type NutzapTemplate = KnownEventTemplate<typeof NUTZAP_KIND>;

export class NutzapFactory extends EventFactory<typeof NUTZAP_KIND, NutzapTemplate> {
  static forEvent(event: NostrEvent, token: Token, comment?: string): NutzapFactory {
    const factory = new NutzapFactory((res) => res(blankEventTemplate(NUTZAP_KIND)))
      .event(event)
      .recipient(event.pubkey)
      .mint(token.mint)
      .proofs(token.proofs);
    return comment ? factory.comment(comment) : factory;
  }

  static forProfile(profile: string | ProfilePointer, token: Token, comment?: string): NutzapFactory {
    const factory = new NutzapFactory((res) => res(blankEventTemplate(NUTZAP_KIND)))
      .recipient(profile)
      .mint(token.mint)
      .proofs(token.proofs);
    return comment ? factory.comment(comment) : factory;
  }

  event(event: EventPointer | AddressPointer | NostrEvent) {
    return this.chain((draft) => setEvent(event)(draft));
  }

  recipient(profile: string | ProfilePointer) {
    return this.chain((draft) => setRecipient(profile)(draft));
  }

  mint(url: string) {
    return this.chain((draft) => setMint(url)(draft));
  }

  proofs(proofs: Proof[]) {
    return this.chain((draft) => setProofs(proofs)(draft));
  }

  comment(text: string) {
    return this.chain((draft) => setComment(text)(draft));
  }
}

// Legacy blueprint functions for backwards compatibility
export function NutzapBlueprint(event: NostrEvent, token: Token, comment?: string) {
  return async (_services: any): Promise<EventTemplate> => {
    return NutzapFactory.forEvent(event, token, comment);
  };
}

export function ProfileNutzapBlueprint(profile: string | ProfilePointer, token: Token, comment?: string) {
  return async (_services: any): Promise<EventTemplate> => {
    return NutzapFactory.forProfile(profile, token, comment);
  };
}
