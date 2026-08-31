import type { NostrEvent } from "applesauce-core/helpers/event";
import { Relay } from "../src/relay.js";

declare const event: NostrEvent;
const relay = new Relay("wss://example.com");

relay.event(event);
relay.auth(event);

// @ts-expect-error EVENT/AUTH routing is selected by the public method, never by an argument.
relay.event(event, "AUTH");
