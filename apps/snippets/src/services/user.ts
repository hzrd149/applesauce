import { castUser } from "applesauce-common/casts/user";
import { chainable } from "applesauce-common/observable/chainable";
import { map, shareReplay } from "rxjs";
import { accounts } from "./accounts";
import { eventStore } from "./event-store";

export const user$ = chainable(
  accounts.active$.pipe(
    map((account) => {
      console.log("account", account);
      return account ? castUser(account.pubkey, eventStore) : undefined;
    }),
    shareReplay(1),
  ),
);
