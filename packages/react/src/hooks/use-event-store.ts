import { useContext } from "react";
import { IEventStore } from "applesauce-core/event-store";
import { EventStoreContext } from "../providers/store-provider.js";

/** Gets the {@link EventStore} from the {@link EventStoreProvider} */
export function useEventStore(): IEventStore {
  const store = useContext(EventStoreContext);
  if (!store) throw new Error("Missing EventStoreProvider");
  return store;
}
