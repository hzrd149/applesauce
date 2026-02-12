import { EventFactory, toEventTemplate } from "applesauce-core/factories";
import { isKind, KnownEvent, KnownEventTemplate, NostrEvent, unixNow } from "applesauce-core/helpers";
import { EncryptionMethod } from "applesauce-core/helpers/encrypted-content";
import { APP_DATA_KIND } from "../helpers/app-data.js";
import { setContent } from "../operations/app-data.js";

export type AppDataTemplate = KnownEventTemplate<typeof APP_DATA_KIND>;

export class AppDataFactory<Data extends unknown = unknown> extends EventFactory<
  typeof APP_DATA_KIND,
  AppDataTemplate
> {
  /** Creates a new app data factory */
  static create<Data>(identifier: string, data: Data, encryption?: boolean | EncryptionMethod): AppDataFactory<Data> {
    return new AppDataFactory<Data>((res) =>
      res({ kind: APP_DATA_KIND, content: "", created_at: unixNow(), tags: [["d", identifier]] }),
    ).data(data, encryption);
  }

  /** Creates a new app data factory from an existing app data event */
  static modify<Data = unknown>(event: NostrEvent | KnownEvent<typeof APP_DATA_KIND>): AppDataFactory<Data> {
    if (!isKind(event, APP_DATA_KIND)) throw new Error("Event is not a app data event");
    return new AppDataFactory<Data>((res) => res(toEventTemplate(event)));
  }

  /** Sets the data for the app data */
  data(data: Data, encryption?: boolean | EncryptionMethod) {
    return this.chain(setContent(data, encryption));
  }
}
