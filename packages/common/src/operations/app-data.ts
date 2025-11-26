import { EventOperation } from "applesauce-core/event-factory";
import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";
import { setContent as setPlaintextContent } from "applesauce-core/operations/content";
import { setHiddenContent } from "applesauce-core/operations/hidden-content";
import { includeSingletonTag } from "applesauce-core/operations/tags";

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
