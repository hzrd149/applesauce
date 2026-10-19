import { Filter } from "applesauce-core/helpers";
import { BehaviorSubject, Subscription } from "rxjs";

/**
 * A {@link BehaviorSubject} of the open REQ filters by subscription id that only rebuilds its record when observed or read.
 * Opening and closing a REQ is O(1) while nothing subscribes, instead of copying every open REQ.
 */
export class ReqsSubject extends BehaviorSubject<Record<string, Filter[]>> {
  private filters = new Map<string, Filter[]>();
  private dirty = false;

  constructor() {
    super({});
  }

  /** Gets the filters of an open REQ */
  get(id: string): Filter[] | undefined {
    return this.filters.get(id);
  }

  /** Sets the filters of an open REQ */
  set(id: string, filters: Filter[]): void {
    this.filters.set(id, filters);
    this.changed();
  }

  /** Removes a closed REQ */
  delete(id: string): void {
    if (this.filters.delete(id)) this.changed();
  }

  private changed() {
    if (this.observed) super.next(Object.fromEntries(this.filters));
    else this.dirty = true;
  }

  // Bring the record up to date before it is read or replayed to a new subscriber
  private sync() {
    if (!this.dirty) return;
    this.dirty = false;
    super.next(Object.fromEntries(this.filters));
  }

  override getValue(): Record<string, Filter[]> {
    this.sync();
    return super.getValue();
  }

  override subscribe(...args: any[]): Subscription {
    this.sync();
    return (super.subscribe as (...args: any[]) => Subscription)(...args);
  }
}
