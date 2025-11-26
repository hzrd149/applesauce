import { blueprint, EventBlueprint } from "applesauce-core/event-factory";
import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { APP_DATA_KIND } from "../helpers/app-data.js";
import * as AppData from "../operations/app-data.js";

/** A blueprint for creating kind 30078 application data events */
export function AppDataBlueprint<T>(
  identifier: string,
  data: T,
  encryption?: boolean | EncryptionMethod,
  options?: MetaTagOptions,
): EventBlueprint {
  return blueprint(
    APP_DATA_KIND,
    AppData.setIdentifier(identifier),
    // Set the content as either encrypted or plaintext
    AppData.setContent(data, encryption),
    setMetaTags(options),
  );
}
