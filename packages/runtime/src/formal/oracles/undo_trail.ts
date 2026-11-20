// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Reusable O(1) Push / O(mutations) Pop Undo Trail for Theory Oracles.
 *
 * Replaces O(depth * state) full-map cloning in `pushLevel()`/`popLevel()` with
 * lightweight mutation-triggered rollback closures. Zero overhead when `depth === 0`.
 */
export class UndoTrail {
  private ops: (() => void)[] = [];
  private marks: number[] = [];

  public get depth(): number {
    return this.marks.length;
  }

  public pushLevel(): void {
    this.marks.push(this.ops.length);
  }

  public popLevel(): void {
    const mark = this.marks.pop();
    if (mark === undefined) return;
    while (this.ops.length > mark) {
      this.ops.pop()!();
    }
  }

  public reset(): void {
    this.ops = [];
    this.marks = [];
  }

  public record(fn: () => void): void {
    if (this.marks.length > 0) {
      this.ops.push(fn);
    }
  }

  public mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (this.marks.length > 0) {
      const had = map.has(key);
      const prev = map.get(key);
      this.ops.push(() => {
        if (had) map.set(key, prev as V);
        else map.delete(key);
      });
    }
    map.set(key, value);
  }

  public mapDelete<K, V>(map: Map<K, V>, key: K): void {
    if (!map.has(key)) return;
    if (this.marks.length > 0) {
      const prev = map.get(key) as V;
      this.ops.push(() => {
        map.set(key, prev);
      });
    }
    map.delete(key);
  }

  public setAdd<T>(set: Set<T>, value: T): void {
    if (set.has(value)) return;
    if (this.marks.length > 0) {
      this.ops.push(() => {
        set.delete(value);
      });
    }
    set.add(value);
  }

  public setDelete<T>(set: Set<T>, value: T): void {
    if (!set.has(value)) return;
    if (this.marks.length > 0) {
      this.ops.push(() => {
        set.add(value);
      });
    }
    set.delete(value);
  }

  public arrayPush<T>(arr: T[], item: T): void {
    arr.push(item);
    if (this.marks.length > 0) {
      this.ops.push(() => {
        arr.pop();
      });
    }
  }
}
