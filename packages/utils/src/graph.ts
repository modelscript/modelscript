// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Finds strongly connected components (SCCs) in a directed graph using Tarjan's algorithm.
 *
 * @param nodes The set of all nodes in the graph.
 * @param edges A function returning the outgoing edges (dependencies) for a given node.
 * @returns A list of strongly connected components. Each component is an array of nodes.
 *          Components are returned in reverse topological order (leaves first).
 */
export function findSCCs<T>(nodes: Iterable<T>, edges: (node: T) => Iterable<T>): T[][] {
  let index = 0;
  const stack: T[] = [];
  const indices = new Map<T, number>();
  const lowlinks = new Map<T, number>();
  const onStack = new Set<T>();
  const sccs: T[][] = [];

  function strongConnect(v: T) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of edges(v)) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v) ?? 0, lowlinks.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: T[] = [];
      let w: T;
      do {
        const pop = stack.pop();
        if (pop === undefined) break;
        w = pop;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of nodes) {
    if (!indices.has(v)) {
      strongConnect(v);
    }
  }

  return sccs;
}
