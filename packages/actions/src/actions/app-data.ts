import { APP_DATA_KIND, getAppDataEncryption } from "applesauce-core/helpers/app-data";
import { AppDataBlueprint } from "applesauce-factory/blueprints/app-data";
import { AppData } from "applesauce-factory/operations";
import { Action } from "../action-hub.js";

export function UpdateAppData<T>(identifier: string, data: T): Action {
  return async function* ({ self, factory, events }) {
    const event = events.getReplaceable(APP_DATA_KIND, self, identifier);
    const encryption = !!event && getAppDataEncryption(event);

    const draft = event
      ? await factory.modify(event, AppData.setContent(data, encryption))
      : await factory.create(AppDataBlueprint, identifier, data, encryption);

    yield await factory.sign(draft);
  };
}
