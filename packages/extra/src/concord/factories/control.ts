// CORD-04 Control-Plane rumor factories: editions and the dissolution
// tombstone. Each builds an unsigned kind 3308 rumor template; the plaintext
// seal + wrap are applied by ../stream.js.

import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { CONTROL_KIND } from "../helpers/control.js";
import type { EditionInput } from "../helpers/editions.js";
import { includeEdition, setDissolution } from "../operations/control.js";

/** A factory for kind 3308 control editions (CORD-04). */
export class EditionFactory extends EventFactory<typeof CONTROL_KIND> {
  static create(input: EditionInput): EditionFactory {
    return new EditionFactory((res) => res(blankEventTemplate(CONTROL_KIND))).edition(input);
  }

  /** Fills this edition's content + edition-machinery tags (CORD-04) */
  edition(input: EditionInput) {
    return this.chain(includeEdition(input));
  }
}

/** A factory for the kind 3308 dissolution tombstone (vsk 10, CORD-04). */
export class DissolutionFactory extends EventFactory<typeof CONTROL_KIND> {
  static create(): DissolutionFactory {
    return new DissolutionFactory((res) => res(blankEventTemplate(CONTROL_KIND))).dissolution();
  }

  /** Sets the chainless dissolution tombstone (vsk 10), published at dissolved_pk */
  dissolution() {
    return this.chain(setDissolution());
  }
}
