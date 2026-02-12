import { EventOperation } from "applesauce-core/factories";
import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";
import { setContent as setPlaintextContent } from "applesauce-core/operations/content";
import { setHiddenContent } from "applesauce-core/operations/hidden-content";
import { includeSingletonTag } from "applesauce-core/operations/tags";

/** Sets the app data identifier */
export function setIdentifier(identifier: string): EventOperation {
  return includeSingletonTag(["d", identifier]);
}

/**
 * Sets the content of an application data event
 * @param data - Data to serialize and set as content
 * @param encryption - Boolean or EncryptionMethod for encryption
 * @param signer - EventSigner (required if encryption is enabled)
 */
export function setContent<T>(
  data: T,
  encryption?: boolean | EncryptionMethod,
  signer?: import("applesauce-core/factories").EventSigner,
): EventOperation {
  const json = JSON.stringify(data);

  switch (typeof encryption) {
    case "boolean":
      return encryption ? setHiddenContent(json, signer) : setPlaintextContent(json);
    case "string":
      return setHiddenContent(json, signer, encryption as EncryptionMethod);
    case "undefined":
      return setPlaintextContent(json);
    default:
      throw new Error("Invalid encrypted type");
  }
}
