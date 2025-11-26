import { TextContentOptions } from "applesauce-core/operations";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventBlueprint } from "applesauce-core/event-factory";
import { blueprint } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { setMessage, setStream } from "../operations/stream-chat.js";

/** Creates a stream chat message */
export function StreamChatMessage(
  stream: AddressPointer | NostrEvent,
  content: string,
  options?: TextContentOptions,
): EventBlueprint {
  return blueprint(kinds.LiveChatMessage, setMessage(content, options), setStream(stream));
}
