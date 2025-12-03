import { EventOperation } from "../event-factory/types.js";
import {
  EncryptedContentSymbol,
  EncryptionMethod,
  getEncryptedContentEncryptionMethods,
} from "../helpers/encrypted-content.js";

/** Sets the content to be encrypted to the pubkey with optional override method */
export function setEncryptedContent(pubkey: string, content: string, override?: EncryptionMethod): EventOperation {
  return async (draft, { signer }) => {
    if (!signer) throw new Error("Signer required for encrypted content");

    // Set method based on kind if not provided
    const methods = getEncryptedContentEncryptionMethods(draft.kind, signer, override);

    // add the plaintext content on the draft so it can be carried forward
    const encrypted = await methods.encrypt(pubkey, content);
    return { ...draft, content: encrypted, [EncryptedContentSymbol]: content };
  };
}
