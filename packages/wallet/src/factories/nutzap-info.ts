import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NUTZAP_INFO_KIND } from "../helpers/nutzap-info.js";
import {
  addNutzapInfoMint,
  addNutzapInfoRelay,
  removeNutzapInfoMint,
  removeNutzapInfoRelay,
  setNutzapInfoMints,
  setNutzapInfoPubkey,
  setNutzapInfoRelays,
} from "../operations/nutzap-info.js";

export type NutzapInfoTemplate = KnownEventTemplate<typeof NUTZAP_INFO_KIND>;

/** A factory class for building kind 10019 nutzap info events */
export class NutzapInfoFactory extends EventFactory<typeof NUTZAP_INFO_KIND, NutzapInfoTemplate> {
  /** Creates a new nutzap info factory */
  static create(): NutzapInfoFactory {
    return new NutzapInfoFactory((res) => res(blankEventTemplate(NUTZAP_INFO_KIND) as NutzapInfoTemplate));
  }

  /** Creates a new nutzap info factory from an existing nutzap info event */
  static modify(event: NostrEvent): NutzapInfoFactory {
    if (event.kind !== NUTZAP_INFO_KIND) throw new Error("Event is not a nutzap info event");
    return new NutzapInfoFactory((res) => res(toEventTemplate(event) as NutzapInfoTemplate));
  }

  /** Sets all relays, replacing existing ones */
  setRelays(relays: string[]) {
    return this.chain(setNutzapInfoRelays(relays));
  }

  /** Sets all mints, replacing existing ones */
  setMints(mints: Array<{ url: string; units?: string[] }>) {
    return this.chain(setNutzapInfoMints(mints));
  }

  /** Adds a relay */
  addRelay(url: string | URL) {
    return this.chain(addNutzapInfoRelay(url));
  }

  /** Removes a relay */
  removeRelay(url: string | URL) {
    return this.chain(removeNutzapInfoRelay(url));
  }

  /** Adds a mint */
  addMint(mint: { url: string; units?: string[] }) {
    return this.chain(addNutzapInfoMint(mint));
  }

  /** Removes a mint */
  removeMint(url: string) {
    return this.chain(removeNutzapInfoMint(url));
  }

  /** Sets the pubkey for receiving nutzaps */
  setPubkey(privateKey: Uint8Array) {
    return this.chain(setNutzapInfoPubkey(privateKey));
  }
}
