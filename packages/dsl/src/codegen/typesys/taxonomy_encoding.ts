// SPDX-License-Identifier: AGPL-3.0-or-later

export interface TaxonomyInterval {
  low: number;
  high: number;
}

export interface TaxonomyClassDef {
  name: string;
  superclasses?: string[];
  children?: string[];
}

/**
 * Pre-Order Interval Taxonomy Encoding for O(1) Polymorphic Subtyping.
 * Assigns each class C in an inheritance hierarchy an interval [low, high]
 * such that:
 *   Subtype(Child, Parent) <=> Parent.low <= Child.low && Child.high <= Parent.high.
 * This compiles directly into two scalar integer comparisons in WASM without table lookups.
 */
export class TaxonomyIndex {
  private intervals = new Map<string, TaxonomyInterval>();
  private classes = new Map<string, TaxonomyClassDef>();
  private dirty = false;

  has(className: string): boolean {
    return this.classes.has(className);
  }

  addClass(name: string, superclasses: string[] = []): void {
    this.dirty = true;
    if (!this.classes.has(name)) {
      this.classes.set(name, { name, superclasses, children: [] });
    } else {
      const c = this.classes.get(name)!;
      c.superclasses = superclasses;
    }

    for (const sup of superclasses) {
      if (!this.classes.has(sup)) {
        this.classes.set(sup, { name: sup, superclasses: [], children: [name] });
      } else {
        const p = this.classes.get(sup)!;
        p.children = p.children || [];
        if (!p.children.includes(name)) p.children.push(name);
      }
    }
  }

  computeIntervals(): Map<string, TaxonomyInterval> {
    let counter = 1;
    this.intervals.clear();
    const roots = [...this.classes.values()].filter((c) => !c.superclasses || c.superclasses.length === 0);

    const visited = new Set<string>();

    const dfs = (className: string) => {
      if (visited.has(className)) return;
      visited.add(className);

      const low = counter++;
      const node = this.classes.get(className);
      if (node && node.children) {
        for (const child of node.children) {
          dfs(child);
        }
      }
      const high = counter++;
      this.intervals.set(className, { low, high });
    };

    for (const root of roots) {
      dfs(root.name);
    }

    // Ensure all classes receive an interval even if disconnected
    for (const name of this.classes.keys()) {
      if (!visited.has(name)) dfs(name);
    }

    this.dirty = false;
    return this.intervals;
  }

  isSubtype(childClass: string, parentClass: string): boolean {
    if (childClass === parentClass) return true;
    if (this.dirty || (this.intervals.size === 0 && this.classes.size > 0)) {
      this.computeIntervals();
    }
    const child = this.intervals.get(childClass);
    const parent = this.intervals.get(parentClass);
    if (child && parent && parent.low <= child.low && child.high <= parent.high) {
      return true;
    }

    // Fallback traversal for multiple inheritance DAG paths
    const c = this.classes.get(childClass);
    if (!c || !c.superclasses || c.superclasses.length === 0) return false;
    const queue = [...c.superclasses];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === parentClass) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      const currNode = this.classes.get(curr);
      if (currNode && currNode.superclasses) {
        queue.push(...currNode.superclasses);
      }
    }
    return false;
  }

  getInterval(className: string): TaxonomyInterval | undefined {
    if (this.dirty || (this.intervals.size === 0 && this.classes.size > 0)) {
      this.computeIntervals();
    }
    return this.intervals.get(className);
  }
}
