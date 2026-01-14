import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";

/** Supported encryption methods */
export type WalletConnectEncryptionMethod = "nip44_v2" | "nip04";

/** Converts a NIP-47 encryption method name to a NIP-07 encryption method name */
export function nip47EncryptionMethodToNip07EncryptionMethod(method: WalletConnectEncryptionMethod): EncryptionMethod {
  return method === "nip44_v2" ? "nip44" : "nip04";
}
