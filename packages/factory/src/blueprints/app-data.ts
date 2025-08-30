import { EncryptionMethod } from "applesauce-core/helpers";
import { APP_DATA_KIND } from "applesauce-core/helpers/app-data";
import { blueprint } from "../event-factory.js";
import * as AppData from "../operations/app-data.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { EventBlueprint } from "../types.js";

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
