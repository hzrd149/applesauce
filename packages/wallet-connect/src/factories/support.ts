import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setContent } from "applesauce-core/operations/content";
import { WALLET_INFO_KIND, WalletSupport } from "../helpers/support.js";
import { TWalletMethod } from "../helpers/methods.js";

export type WalletInfoTemplate = KnownEventTemplate<typeof WALLET_INFO_KIND>;

export class WalletInfoFactory extends EventFactory<typeof WALLET_INFO_KIND, WalletInfoTemplate> {
  static create<Methods extends TWalletMethod>(
    info: WalletSupport<Methods>,
    client?: string,
    overrideRelay?: string,
  ): WalletInfoFactory {
    const factory = new WalletInfoFactory((res) => res(blankEventTemplate(WALLET_INFO_KIND))).methods(info.methods);
    if (info.encryption) factory.encryption(info.encryption);
    if (info.notifications) factory.notifications(info.notifications);
    if (client) factory.client(client, overrideRelay);
    return factory;
  }

  methods(methods: string[]) {
    return this.chain((draft) => setContent(methods.join(" "))(draft));
  }

  encryption(methods: string[]) {
    return this.chain((draft) => includeSingletonTag(["encryption", methods.join(" ")])(draft));
  }

  notifications(types: string[]) {
    return this.chain((draft) => includeSingletonTag(["notifications", types.join(" ")])(draft));
  }

  client(pubkey: string, relay?: string) {
    return this.chain((draft) => includeSingletonTag(relay ? ["p", pubkey, relay] : ["p", pubkey])(draft));
  }
}
