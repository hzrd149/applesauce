import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";
import { EventOperation } from "applesauce-core/event-factory";
import { setContent as setPlaintextContent, setHiddenContent } from "./content.js";
import { includeSingletonTag } from "./tags.js";

/** Sets the app data identifier */
export function setIdentifier(identifier: string): EventOperation {
  return includeSingletonTag(["d", identifier]);
}

/** Sets the content of an application data event */
export function setContent<T>(data: T, encryption?: boolean | EncryptionMethod): EventOperation {
  const json = JSON.stringify(data);

  switch (typeof encryption) {
    case "boolean":
      return encryption ? setHiddenContent(json) : setPlaintextContent(json);
    case "string":
      return setHiddenContent(json, encryption);
    case "undefined":
      return setPlaintextContent(json);
    default:
      throw new Error("Invalid encrypted type");
  }
}
