export { createNdrMessageProtocol, type NdrMessageProtocol, type NdrMessageProtocolOptions } from "./ndr-protocol.js";

/** Compatibility exports for the standalone NDR transport */
export {
  createNdrTransport,
  type NdrTransport as KehtoNdrTransport,
  type NdrTransportOptions as KehtoNdrTransportOptions,
} from "../../../messages/ndr/index.js";
