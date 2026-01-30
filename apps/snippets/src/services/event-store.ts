import { EventStore } from "applesauce-core";

export const eventStore = new EventStore();

if (import.meta.env.DEV) {
  // @ts-ignore
  window.eventStore = eventStore;
}
