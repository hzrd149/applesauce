import { blankEventTemplate, EventFactory, TagOperation, toEventTemplate } from "applesauce-core/factories";
import { getTagValue, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations/tags";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setContent } from "applesauce-core/operations/content";
import { isValidNappletHandlers, NAPPLET_HANDLERS_KIND } from "../helpers/napplet-handlers.js";
import { createNappletConvention, parseNappletConvention } from "../helpers/napplet.js";
import {
  addNappletHandlerTag,
  addNappletIntentHandlerTag,
  clearNappletHandlerTags,
  NappletHandlerInput,
  preferNappletHandlerTag,
  preferNappletIntentHandlerTag,
  removeNappletHandlerTag,
  removeNappletIntentHandlerTag,
} from "../operations/napplet-handlers.js";

/** An event template for napplet handler preferences */
export type NappletHandlersTemplate = KnownEventTemplate<typeof NAPPLET_HANDLERS_KIND>;

/**
 * Returns the convention identity for an intent name or identity within an archetype
 * @throws if the identity is invalid or belongs to another archetype
 */
function getConventionIdentity(archetype: string, intent: string): string {
  if (!intent.startsWith("napplet:")) return createNappletConvention(archetype, intent);

  // Shells ignore `i` tags for another archetype, so refuse to write one
  const convention = parseNappletConvention(intent);
  if (convention?.archetype !== archetype) throw new Error(`Intent ${intent} is not for archetype ${archetype}`);

  return intent;
}

/** A factory for napplet handler preferences (kind 31129) */
export class NappletHandlersFactory extends EventFactory<typeof NAPPLET_HANDLERS_KIND, NappletHandlersTemplate> {
  /** Creates handler preferences for an archetype */
  static create(archetype: string): NappletHandlersFactory {
    return new NappletHandlersFactory((res) => res(blankEventTemplate(NAPPLET_HANDLERS_KIND))).chain(
      includeSingletonTag(["d", archetype], true),
    );
  }

  /**
   * Creates a factory configured to modify existing handler preferences
   * @throws if the event is not a valid handler preferences event
   */
  static modify(event: NostrEvent): NappletHandlersFactory {
    if (!isValidNappletHandlers(event)) throw new Error("Expected a napplet handler preferences event");
    return new NappletHandlersFactory((res) => res(toEventTemplate(event)));
  }

  /** Applies a tag operation to the public or private tags */
  protected modifyHandlerTags(operation: TagOperation, hidden: boolean) {
    return hidden ? this.modifyHiddenTags(operation) : this.modifyPublicTags(operation);
  }

  /** Applies an intent tag operation once the archetype is known from the draft's `d` tag */
  protected modifyIntentTags(intent: string, hidden: boolean, build: (identity: string) => TagOperation) {
    return this.chain(async (draft) => {
      const identity = getConventionIdentity(getTagValue(draft, "d") ?? "", intent);
      const operation = build(identity);

      return hidden ? modifyHiddenTags(this.signer, operation)(draft) : modifyPublicTags(operation)(draft);
    });
  }

  /** Adds an archetype-wide handler as the last fallback */
  handler(input: NappletHandlerInput, hidden = false) {
    return this.modifyHandlerTags(addNappletHandlerTag(input), hidden);
  }
  /** Makes an archetype-wide handler the preferred one */
  preferHandler(input: NappletHandlerInput, hidden = false) {
    return this.modifyHandlerTags(preferNappletHandlerTag(input), hidden);
  }
  /** Removes an archetype-wide handler */
  removeHandler(input: NappletHandlerInput, hidden = false) {
    return this.modifyHandlerTags(removeNappletHandlerTag(input), hidden);
  }

  /** Adds a handler for one intent (`"edit"` or `"napplet:<archetype>/edit"`) as the last fallback */
  intentHandler(intent: string, input: NappletHandlerInput, hidden = false) {
    return this.modifyIntentTags(intent, hidden, (identity) => addNappletIntentHandlerTag(identity, input));
  }
  /** Makes a handler the preferred one for an intent */
  preferIntentHandler(intent: string, input: NappletHandlerInput, hidden = false) {
    return this.modifyIntentTags(intent, hidden, (identity) => preferNappletIntentHandlerTag(identity, input));
  }
  /** Removes one handler for an intent, or every handler for it when no input is given */
  removeIntentHandler(intent: string, input?: NappletHandlerInput, hidden = false) {
    return this.modifyIntentTags(intent, hidden, (identity) => removeNappletIntentHandlerTag(identity, input));
  }

  /** Removes every public and private entry, leaving an empty preferences event */
  clear() {
    return this.modifyPublicTags(clearNappletHandlerTags()).chain(setContent(""));
  }
}
