/**
 * Persistent (Immutable) Radix Tries for Structural Sharing.
 * These structures provide O(log N) updates while sharing unmodified
 * branches with previous versions, eliminating O(N) copy overhead.
 */

// ---------------------------------------------------------------------------
// 1. IdTrie (32-ary Radix Tree for integer SymbolIds)
// ---------------------------------------------------------------------------

export class IdTrie<T> {
  private readonly root: IdNode<T>;
  public readonly size: number;

  constructor(root?: IdNode<T>, size = 0) {
    this.root = root ?? new IdNode<T>();
    this.size = size;
  }

  public get(id: number): T | undefined {
    let node = this.root;
    let shift = 0;
    while (node && shift <= 30) {
      const idx = (id >>> shift) & 0x1f;
      if (!node.children || !node.children[idx]) {
        return undefined;
      }
      if (shift === 30 || node.children[idx]?.isLeaf) {
        const leaf = node.children[idx] as LeafNode<T>;
        return leaf.id === id ? leaf.value : undefined;
      }
      node = node.children[idx] as IdNode<T>;
      shift += 5;
    }
    return undefined;
  }

  public set(id: number, value: T): IdTrie<T> {
    const { root: newRoot, added } = this._set(this.root, id, value, 0);
    if (newRoot === this.root) return this;
    return new IdTrie<T>(newRoot, added ? this.size + 1 : this.size);
  }

  private _set(node: IdNode<T>, id: number, value: T, shift: number): { root: IdNode<T>; added: boolean } {
    const idx = (id >>> shift) & 0x1f;
    const newNode = new IdNode<T>(node.children ? [...node.children] : new Array(32));

    if (shift >= 30) {
      const children = newNode.children as (IdNode<T> | LeafNode<T> | undefined)[];
      const existing = children[idx] as LeafNode<T> | undefined;
      children[idx] = new LeafNode(id, value);
      return { root: newNode, added: !existing };
    }

    const children = newNode.children as (IdNode<T> | LeafNode<T> | undefined)[];
    const child = children[idx];

    if (!child) {
      // Empty slot, add leaf
      children[idx] = new LeafNode(id, value);
      return { root: newNode, added: true };
    } else if (child.isLeaf) {
      const leaf = child as LeafNode<T>;
      if (leaf.id === id) {
        if (leaf.value === value) return { root: node, added: false };
        children[idx] = new LeafNode(id, value);
        return { root: newNode, added: false };
      }
      // Collision, push down
      const internal = new IdNode<T>();
      const { root: withLeaf } = this._set(internal, leaf.id, leaf.value, shift + 5);
      const { root: withBoth } = this._set(withLeaf, id, value, shift + 5);
      children[idx] = withBoth;
      return { root: newNode, added: true };
    } else {
      // Internal node
      const { root: newChild, added } = this._set(child as IdNode<T>, id, value, shift + 5);
      if (newChild === child) return { root: node, added: false };
      children[idx] = newChild;
      return { root: newNode, added };
    }
  }

  public delete(id: number): IdTrie<T> {
    const { root: newRoot, removed } = this._delete(this.root, id, 0);
    if (newRoot === this.root) return this;
    return new IdTrie<T>(newRoot, removed ? this.size - 1 : this.size);
  }

  private _delete(node: IdNode<T>, id: number, shift: number): { root: IdNode<T>; removed: boolean } {
    if (!node.children) return { root: node, removed: false };
    const idx = (id >>> shift) & 0x1f;
    const child = node.children[idx];
    if (!child) return { root: node, removed: false };

    const newNode = new IdNode<T>([...node.children]);
    const children = newNode.children as (IdNode<T> | LeafNode<T> | undefined)[];

    if (child.isLeaf) {
      const leaf = child as LeafNode<T>;
      if (leaf.id === id) {
        children[idx] = undefined;
        return { root: newNode, removed: true };
      }
      return { root: node, removed: false };
    } else {
      const { root: newChild, removed } = this._delete(child as IdNode<T>, id, shift + 5);
      if (newChild === child) return { root: node, removed: false };
      children[idx] = newChild.children?.every((c) => !c) ? undefined : newChild;
      return { root: newNode, removed };
    }
  }

  public has(id: number): boolean {
    return this.get(id) !== undefined;
  }

  public [Symbol.iterator](): IterableIterator<[number, T]> {
    return this.entries();
  }

  public *entries(): IterableIterator<[number, T]> {
    yield* this._entries(this.root);
  }

  public *keys(): IterableIterator<number> {
    for (const [k] of this.entries()) yield k;
  }

  public *values(): IterableIterator<T> {
    for (const [, v] of this.entries()) yield v;
  }

  private *_entries(node: IdNode<T>): IterableIterator<[number, T]> {
    if (!node.children) return;
    for (const child of node.children) {
      if (!child) continue;
      if (child.isLeaf) {
        const leaf = child as LeafNode<T>;
        yield [leaf.id, leaf.value];
      } else {
        yield* this._entries(child as IdNode<T>);
      }
    }
  }
}

class IdNode<T> {
  public readonly isLeaf = false;
  constructor(public children?: (IdNode<T> | LeafNode<T> | undefined)[]) {}
}

class LeafNode<T> {
  public readonly isLeaf = true;
  constructor(
    public readonly id: number,
    public readonly value: T,
  ) {}
}

// ---------------------------------------------------------------------------
// 2. StringTrie (Persistent mapping for string keys, backed by JS Immutable Record / HAMT logic)
// Since string hashing in JS is slow to write manually, we can implement
// a functional persistent wrapper over a shallow-cloned shallow tree.
// For strings, a 16-ary Radix Trie using character codes is fast.
// ---------------------------------------------------------------------------

export class StringTrie<T> {
  private readonly root: StringNode<T>;
  public readonly size: number;

  constructor(root?: StringNode<T>, size = 0) {
    this.root = root ?? new StringNode<T>();
    this.size = size;
  }

  public get(key: string): T | undefined {
    let node = this.root;
    for (let i = 0; i < key.length; i++) {
      if (!node.children) return undefined;
      const charCode = key.charCodeAt(i);
      const child = node.children.get(charCode);
      if (!child) return undefined;
      node = child;
    }
    return node.value;
  }

  public set(key: string, value: T): StringTrie<T> {
    const { root: newRoot, added } = this._set(this.root, key, value, 0);
    if (newRoot === this.root) return this;
    return new StringTrie<T>(newRoot, added ? this.size + 1 : this.size);
  }

  private _set(node: StringNode<T>, key: string, value: T, idx: number): { root: StringNode<T>; added: boolean } {
    if (idx === key.length) {
      if (node.hasValue && node.value === value) return { root: node, added: false };
      return { root: new StringNode<T>(node.children, value, true), added: !node.hasValue };
    }

    const charCode = key.charCodeAt(idx);
    const children = node.children ? new Map(node.children) : new Map();
    const child = children.get(charCode) ?? new StringNode<T>();
    const { root: newChild, added } = this._set(child, key, value, idx + 1);

    if (newChild === child) return { root: node, added: false };
    children.set(charCode, newChild);
    return { root: new StringNode<T>(children, node.value, node.hasValue), added };
  }

  public delete(key: string): StringTrie<T> {
    const { root: newRoot, removed } = this._delete(this.root, key, 0);
    if (newRoot === this.root) return this;
    return new StringTrie<T>(newRoot, removed ? this.size - 1 : this.size);
  }

  private _delete(node: StringNode<T>, key: string, idx: number): { root: StringNode<T>; removed: boolean } {
    if (idx === key.length) {
      if (!node.hasValue) return { root: node, removed: false };
      return { root: new StringNode<T>(node.children, undefined, false), removed: true };
    }

    if (!node.children) return { root: node, removed: false };
    const charCode = key.charCodeAt(idx);
    const child = node.children.get(charCode);
    if (!child) return { root: node, removed: false };

    const { root: newChild, removed } = this._delete(child, key, idx + 1);
    if (newChild === child) return { root: node, removed: false };

    const children = new Map(node.children);
    if (!newChild.hasValue && (!newChild.children || newChild.children.size === 0)) {
      children.delete(charCode);
    } else {
      children.set(charCode, newChild);
    }

    return { root: new StringNode<T>(children.size > 0 ? children : undefined, node.value, node.hasValue), removed };
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.entries();
  }

  public *entries(): IterableIterator<[string, T]> {
    yield* this._entries(this.root, "");
  }

  public *keys(): IterableIterator<string> {
    for (const [k] of this.entries()) yield k;
  }

  public *values(): IterableIterator<T> {
    for (const [, v] of this.entries()) yield v;
  }

  private *_entries(node: StringNode<T>, prefix: string): IterableIterator<[string, T]> {
    if (node.hasValue && node.value !== undefined) yield [prefix, node.value];
    if (node.children) {
      for (const [charCode, child] of node.children.entries()) {
        yield* this._entries(child, prefix + String.fromCharCode(charCode));
      }
    }
  }
}

class StringNode<T> {
  constructor(
    public readonly children?: Map<number, StringNode<T>>,
    public readonly value?: T,
    public readonly hasValue = false,
  ) {}
}

// ---------------------------------------------------------------------------
// 3. ImmutableList
// ---------------------------------------------------------------------------

export class ImmutableList<T> {
  constructor(private readonly items: readonly T[] = []) {}

  public get length(): number {
    return this.items.length;
  }

  public get(index: number): T | undefined {
    return this.items[index];
  }

  public push(...items: T[]): ImmutableList<T> {
    return new ImmutableList<T>([...this.items, ...items]);
  }

  public filter(predicate: (item: T) => boolean): ImmutableList<T> {
    const filtered = this.items.filter(predicate);
    if (filtered.length === this.items.length) return this;
    return new ImmutableList<T>(filtered);
  }

  public map<U>(callback: (item: T) => U): ImmutableList<U> {
    return new ImmutableList<U>(this.items.map(callback));
  }

  public [Symbol.iterator](): IterableIterator<T> {
    return this.items[Symbol.iterator]();
  }

  public toArray(): T[] {
    return [...this.items];
  }
}

// ---------------------------------------------------------------------------
// Adapters for Map Compatibility
// ---------------------------------------------------------------------------

export class IdTrieMap<T> {
  constructor(public trie: IdTrie<T> = new IdTrie<T>()) {}
  get size() {
    return this.trie.size;
  }
  clear() {
    this.trie = new IdTrie<T>();
  }
  delete(key: number) {
    const had = this.trie.has(key);
    this.trie = this.trie.delete(key);
    return had;
  }
  forEach(cb: (value: T, key: number, map: unknown) => void, thisArg?: unknown) {
    for (const [k, v] of this.trie) cb.call(thisArg, v, k, this);
  }
  get(key: number) {
    return this.trie.get(key);
  }
  getOrInsert(key: number, fallback: T): T {
    let val = this.get(key);
    if (val === undefined) {
      val = fallback;
      this.set(key, val);
    }
    return val;
  }
  getOrInsertComputed(key: number, compute: () => T): T {
    let val = this.get(key);
    if (val === undefined) {
      val = compute();
      this.set(key, val);
    }
    return val;
  }
  has(key: number) {
    return this.trie.has(key);
  }
  set(key: number, value: T) {
    this.trie = this.trie.set(key, value);
    return this;
  }
  [Symbol.iterator]() {
    return this.trie.entries();
  }
  entries() {
    return this.trie.entries();
  }
  keys() {
    return this.trie.keys();
  }
  values() {
    return this.trie.values();
  }
  readonly [Symbol.toStringTag] = "IdTrieMap";
}

export class StringTrieMap<T> {
  constructor(public trie: StringTrie<T> = new StringTrie<T>()) {}
  get size() {
    return this.trie.size;
  }
  clear() {
    this.trie = new StringTrie<T>();
  }
  delete(key: string) {
    const had = this.trie.has(key);
    this.trie = this.trie.delete(key);
    return had;
  }
  forEach(cb: (value: T, key: string, map: unknown) => void, thisArg?: unknown) {
    for (const [k, v] of this.trie) cb.call(thisArg, v, k, this);
  }
  get(key: string) {
    return this.trie.get(key);
  }
  getOrInsert(key: string, fallback: T): T {
    let val = this.get(key);
    if (val === undefined) {
      val = fallback;
      this.set(key, val);
    }
    return val;
  }
  getOrInsertComputed(key: string, compute: () => T): T {
    let val = this.get(key);
    if (val === undefined) {
      val = compute();
      this.set(key, val);
    }
    return val;
  }
  has(key: string) {
    return this.trie.has(key);
  }
  set(key: string, value: T) {
    this.trie = this.trie.set(key, value);
    return this;
  }
  [Symbol.iterator]() {
    return this.trie.entries();
  }
  entries() {
    return this.trie.entries();
  }
  keys() {
    return this.trie.keys();
  }
  values() {
    return this.trie.values();
  }
  readonly [Symbol.toStringTag] = "StringTrieMap";
}
