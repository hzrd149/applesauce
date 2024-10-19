type Item<T> = {
  key: string;
  prev: Item<T> | null;
  value: T;
  next: Item<T> | null;
  expiry: number;
};

/**
 * Copied from tiny-lru and modified to support typescript
 * @see https://github.com/avoidwork/tiny-lru/blob/master/src/lru.js
 */
export class LRU<T extends unknown> {
  first: Item<T> | null = null;
  items: Record<string, Item<T>> = Object.create(null);
  last: Item<T> | null = null;

  max: number;
  resetTtl: boolean;
  size: number;
  ttl: number;

  constructor(max = 0, ttl = 0, resetTtl = false) {
    this.first = null;
    this.items = Object.create(null);
    this.last = null;
    this.max = max;
    this.resetTtl = resetTtl;
    this.size = 0;
    this.ttl = ttl;
  }

  clear() {
    this.first = null;
    this.items = Object.create(null);
    this.last = null;
    this.size = 0;

    return this;
  }

  delete(key: string) {
    if (this.has(key)) {
      const item = this.items[key];

      delete this.items[key];
      this.size--;

      if (item.prev !== null) {
        item.prev.next = item.next;
      }

      if (item.next !== null) {
        item.next.prev = item.prev;
      }

      if (this.first === item) {
        this.first = item.next;
      }

      if (this.last === item) {
        this.last = item.prev;
      }
    }

    return this;
  }

  entries(keys = this.keys()) {
    return keys.map((key) => [key, this.get(key)]);
  }

  evict(bypass = false) {
    if (bypass || this.size > 0) {
      const item = this.first!;

      delete this.items[item.key];

      if (--this.size === 0) {
        this.first = null;
        this.last = null;
      } else {
        this.first = item.next;
        this.first!.prev = null;
      }
    }

    return this;
  }

  expiresAt(key: string) {
    let result;

    if (this.has(key)) {
      result = this.items[key].expiry;
    }

    return result;
  }

  get(key: string) {
    let result;

    if (this.has(key)) {
      const item = this.items[key];

      if (this.ttl > 0 && item.expiry <= Date.now()) {
        this.delete(key);
      } else {
        result = item.value;
        this.set(key, result, true);
      }
    }

    return result;
  }

  has(key: string) {
    return key in this.items;
  }

  keys() {
    const result = [];
    let x = this.first;

    while (x !== null) {
      result.push(x.key);
      x = x.next;
    }

    return result;
  }

  set(key: string, value: T, bypass = false, resetTtl = this.resetTtl) {
    let item;

    if (bypass || this.has(key)) {
      item = this.items[key];
      item.value = value;

      if (bypass === false && resetTtl) {
        item.expiry = this.ttl > 0 ? Date.now() + this.ttl : this.ttl;
      }

      if (this.last !== item) {
        const last = this.last,
          next = item.next,
          prev = item.prev;

        if (this.first === item) {
          this.first = item.next;
        }

        item.next = null;
        item.prev = this.last;
        last!.next = item;

        if (prev !== null) {
          prev.next = next;
        }

        if (next !== null) {
          next.prev = prev;
        }
      }
    } else {
      if (this.max > 0 && this.size === this.max) {
        this.evict(true);
      }

      item = this.items[key] = {
        expiry: this.ttl > 0 ? Date.now() + this.ttl : this.ttl,
        key: key,
        prev: this.last,
        next: null,
        value,
      };

      if (++this.size === 1) {
        this.first = item;
      } else {
        this.last!.next = item;
      }
    }

    this.last = item;

    return this;
  }

  values(keys = this.keys()) {
    return keys.map((key) => this.get(key)!);
  }
}
