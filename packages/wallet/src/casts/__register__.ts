import { Note, Stream } from "applesauce-common/casts";
import { User } from "applesauce-common/casts/user";
import { castEventStream, castTimelineStream, ChainableObservable } from "applesauce-common/observable";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers";
import { switchMap } from "rxjs";
import { NUTZAP_KIND } from "../helpers/nutzap.js";
import { WALLET_KIND } from "../helpers/wallet.js";
import { NUTZAP_INFO_KIND } from "../helpers/nutzap-info.js";
import { NutzapInfo } from "./nutzap-info.js";
import { Nutzap } from "./nutzap.js";
import { Wallet } from "./wallet.js";

// Extend the User class with wallet$ observable
declare module "applesauce-common/casts/user" {
  interface User {
    readonly wallet$: ChainableObservable<Wallet | undefined>;
    readonly nutzap$: ChainableObservable<NutzapInfo | undefined>;
  }
}
declare module "applesauce-common/casts/stream" {
  interface Stream {
    readonly nutzaps$: ChainableObservable<Nutzap[]>;
  }
}
declare module "applesauce-common/casts/note" {
  interface Note {
    nutzaps$(): ChainableObservable<Nutzap[]>;
  }
}

Object.defineProperty(User.prototype, "wallet$", {
  get: function (this: User) {
    return this.$$ref("wallet$", (store) =>
      this.outboxes$.pipe(
        switchMap((outboxes) =>
          store
            .replaceable({ kind: WALLET_KIND, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(Wallet, store)),
        ),
      ),
    );
  },
  enumerable: true,
  configurable: false,
});
Object.defineProperty(User.prototype, "nutzap$", {
  get: function (this: User) {
    return this.$$ref("nutzap$", (store) =>
      store.replaceable(NUTZAP_INFO_KIND, this.pubkey).pipe(castEventStream(NutzapInfo, store)),
    );
  },
  enumerable: true,
  configurable: false,
});

Note.prototype.nutzaps$ = function (this: Note) {
  return this.$$ref("nutzaps$", (store) =>
    store
      .timeline(buildCommonEventRelationFilters({ kinds: [NUTZAP_KIND] }, this.event))
      .pipe(castTimelineStream(Nutzap, store)),
  );
};
Object.defineProperty(Stream.prototype, "nutzaps$", {
  get: function (this: Stream) {
    return this.$$ref("nutzaps$", (store) =>
      store
        .timeline(buildCommonEventRelationFilters({ kinds: [NUTZAP_KIND] }, this.event))
        .pipe(castTimelineStream(Nutzap, store)),
    );
  },
  enumerable: true,
  configurable: false,
});
