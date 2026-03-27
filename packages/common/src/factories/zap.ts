import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import * as Zap from "../operations/zap.js";

export type ZapTemplate = KnownEventTemplate<typeof kinds.Zap>;

export class ZapFactory extends EventFactory<typeof kinds.Zap, ZapTemplate> {
  /** Creates a new zap event from a validated zap request */
  static create(zapRequest: NostrEvent, bolt11: string): ZapFactory {
    return new ZapFactory((res) => res(blankEventTemplate(kinds.Zap))).request(zapRequest).bolt11(bolt11);
  }

  /** Sets the zap request. Validates, then sets description, P (sender), and copies p, e, a, k, amount tags */
  request(zapRequest: NostrEvent) {
    return this.chain(Zap.setRequest(zapRequest));
  }

  /** Sets the bolt11 invoice */
  bolt11(invoice: string) {
    return this.chain(Zap.setBolt11(invoice));
  }

  /** Sets the preimage for the bolt11 invoice */
  preimage(preimage: string) {
    return this.chain(Zap.setPreimage(preimage));
  }
}
