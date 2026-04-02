import { AppDataFactory } from "applesauce-common/factories";
import { APP_DATA_KIND, getAppDataEncryption } from "applesauce-common/helpers/app-data";
import { Action } from "../action-runner.js";

export function UpdateAppData<T>(identifier: string, data: T): Action {
  return async ({ signer, user, publish }) => {
    const event = await user.replaceable(APP_DATA_KIND, identifier).$first(1000, undefined);
    const encryption = !!event && getAppDataEncryption(event);

    const signed = event
      ? await AppDataFactory.modify(event).data(data, encryption).sign(signer)
      : await AppDataFactory.create(identifier, data, encryption).sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
