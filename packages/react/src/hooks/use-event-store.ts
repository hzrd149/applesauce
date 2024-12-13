import { useContext } from "react";
import { EventStoreContext } from "../providers/store-provider.js";

/**
 * Gets the EventStore from a parent {@link EventStoreProvider} component
 * If there is none it throws an error
 */
export function useEventStore() {
  const store = useContext(EventStoreContext);
  if (!store) throw new Error("Missing EventStoreProvider");
  return store;
}
