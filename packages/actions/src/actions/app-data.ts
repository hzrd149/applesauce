import { AppDataBlueprint } from "applesauce-common/factories/app-data";
import { APP_DATA_KIND, getAppDataEncryption } from "applesauce-common/helpers/app-data";
import * as AppData from "applesauce-common/operations/app-data";
import { Action } from "../action-runner.js";

export function UpdateAppData<T>(identifier: string, data: T): Action {
  return async ({ self, factory, events, user, publish, sign }) => {
    const event = events.getReplaceable(APP_DATA_KIND, self, identifier);
    const encryption = !!event && getAppDataEncryption(event);

    const signed = event
      ? await factory.modify(event, AppData.setContent(data, encryption)).then(sign)
      : await factory.create(AppDataBlueprint, identifier, data, encryption).then(sign);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
