// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { ModelScriptCompiler } from "../src/index.js";

test("Dogfooding: Tarjan Strongly Connected Components (BLT Decomposition) in ModelScript", async () => {
  const compiler = new ModelScriptCompiler();
  await compiler.init();

  const code = `
function tarjanSCC(adj: Array<Array<i32>>, n: i32): Array<Array<i32>> {
  let index = 0;
  let indices = [];
  let lowlink = [];
  let onStack = [];
  let stack = [];
  let sccs = [];

  let i = 0;
  while (i < n) {
    indices.push(-1);
    lowlink.push(-1);
    onStack.push(false);
    i = i + 1;
  }

  function strongConnect(v: i32) {
    indices[v] = index;
    lowlink[v] = index;
    index = index + 1;
    stack.push(v);
    onStack[v] = true;

    let neighbors = adj[v];
    let j = 0;
    while (j < neighbors.length) {
      let w = neighbors[j];
      if (indices[w] < 0) {
        strongConnect(w);
        if (lowlink[w] < lowlink[v]) {
          lowlink[v] = lowlink[w];
        }
      } else {
        if (onStack[w]) {
          if (indices[w] < lowlink[v]) {
            lowlink[v] = indices[w];
          }
        }
      }
      j = j + 1;
    }

    if (lowlink[v] == indices[v]) {
      let scc = [];
      let w = -1;
      while (w != v) {
        w = stack.pop();
        onStack[w] = false;
        scc.push(w);
      }
      sccs.push(scc);
    }
  }

  let k = 0;
  while (k < n) {
    if (indices[k] < 0) {
      strongConnect(k);
    }
    k = k + 1;
  }

  return sccs;
}

// 5 equations/variables:
// Eq 0 -> [1]
// Eq 1 -> [2]
// Eq 2 -> [0, 3]  (creates cycle 0-1-2)
// Eq 3 -> [4]
// Eq 4 -> []      (scalar assignment)
let graph = [
  [1],
  [2],
  [0, 3],
  [4],
  []
];

let blocks = tarjanSCC(graph, 5);

// Use JSONiq FLWOR to separate algebraic loops from scalar assignments:
let algebraicLoops = 
  for b in blocks
  where b.length > 1
  return { blockSize: b.length, nodes: b };

let scalarBlocks = 
  for b in blocks
  where b.length == 1
  return b[0];

return {
  totalBlocks: blocks.length,
  algebraicLoops: algebraicLoops,
  scalarBlocks: scalarBlocks
};
`;

  const result = compiler.executeJs(code) as any;

  assert.equal(result.totalBlocks, 3, "Graph with a 3-cycle and 2 downstream nodes should yield 3 SCC blocks");
  assert.equal(result.algebraicLoops.length, 1, "Should find 1 algebraic loop");
  assert.equal(result.algebraicLoops[0].blockSize, 3, "Algebraic loop should contain 3 equations [0, 2, 1]");

  // The 3 cycle nodes: 0, 1, 2
  const cycleNodes = result.algebraicLoops[0].nodes.sort();
  assert.deepEqual(cycleNodes, [0, 1, 2]);

  // Downstream scalar assignments: node 4 and node 3
  const scalarNodes = result.scalarBlocks.sort();
  assert.deepEqual(scalarNodes, [3, 4]);
});
