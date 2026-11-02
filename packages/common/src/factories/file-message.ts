import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { kinds, KnownEventTemplate } from "applesauce-core/helpers";
import { includeNameValueTag } from "applesauce-core/operations/tags";
import { FileMetadataFields } from "../helpers/file-metadata.js";
import { Rumor } from "../helpers/gift-wrap.js";
import { setFileMessage } from "../operations/file-message.js";
import { setParent, setSubject } from "../operations/wrapped-message.js";

export type FileMessageTemplate = KnownEventTemplate<kinds.FileMessage>;

/** A factory for NIP-17 kind 15 file messages, which carry the URL and decryption key of an encrypted file */
export class FileMessageFactory extends EventFactory<kinds.FileMessage, FileMessageTemplate> {
  /**
   * Creates a new file message
   * @param recipients A single recipient pubkey or an array of recipient pubkeys
   * @param file The uploaded file's URL, type, hashes, and decryption fields
   * @throws if the file has no URL
   */
  static create(recipients: string | string[], file: FileMetadataFields): FileMessageFactory {
    const recipientList = typeof recipients === "string" ? [recipients] : recipients;

    let factory: FileMessageFactory = new FileMessageFactory((res) => res(blankEventTemplate(kinds.FileMessage))).file(
      file,
    );
    for (const recipient of recipientList) {
      factory = factory.chain(includeNameValueTag(["p", recipient])) as FileMessageFactory;
    }
    return factory;
  }

  /**
   * Sets the file URL and file tags
   * @throws if the file has no URL
   */
  file(file: FileMetadataFields) {
    return this.chain(setFileMessage(file));
  }

  /** Sets the parent message "e" tag for NIP-17 reply threading */
  replyTo(parent: Rumor | string) {
    return this.chain(setParent(parent));
  }

  /** Sets the subject tag for the message thread */
  subject(subject: string) {
    return this.chain(setSubject(subject));
  }
}
