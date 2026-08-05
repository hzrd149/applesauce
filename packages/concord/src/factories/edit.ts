// Chat Plane edit rumor factory (CORD-03 §3). Builds an unsigned kind 3302 edit
// rumor by chaining the operations in ../operations/edit.js onto a blank
// template. The rumor is sealed + wrapped later by ../stream.js; this factory
// never signs. Channel binding is applied at publish time via `bindToChannel`.

import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { EDIT_KIND } from "../helpers/edit.js";
import { includeEditTarget } from "../operations/edit.js";

/** A factory for kind 3302 chat edits (CORD-03 §3). */
export class EditFactory extends EventFactory<typeof EDIT_KIND> {
  static create(targetId: string, newText: string): EditFactory {
    return new EditFactory((res) => res(blankEventTemplate(EDIT_KIND))).content(newText).target(targetId);
  }

  /** Points this edit at the message it replaces (`e` tag) */
  target(id: string) {
    return this.chain(includeEditTarget(id));
  }
}
