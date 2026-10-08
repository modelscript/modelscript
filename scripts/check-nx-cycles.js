// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";

const graph = JSON.parse(fs.readFileSync("graph.json", "utf8")).graph;
const nodes = Object.keys(graph.nodes);
const adj = new Map();
for (const n of nodes) {
  adj.set(
    n,
    (graph.dependencies[n] || []).map((d) => d.target),
  );
}

const visited = new Set();
const inStack = new Set();
const cycles = [];

function dfs(u, path) {
  visited.add(u);
  inStack.add(u);
  path.push(u);

  for (const v of adj.get(u) || []) {
    if (!visited.has(v)) {
      dfs(v, path);
    } else if (inStack.has(v)) {
      const cycleStart = path.indexOf(v);
      cycles.push(path.slice(cycleStart).concat(v));
    }
  }

  path.pop();
  inStack.delete(u);
}

for (const n of nodes) {
  if (!visited.has(n)) {
    dfs(n, []);
  }
}

console.log(`Cycles detected: ${cycles.length}`);
try {
  fs.unlinkSync("graph.json");
} catch {}

if (cycles.length > 0) {
  for (const c of cycles) {
    console.log("CYCLE:", c.join(" -> "));
  }
  process.exit(1);
} else {
  console.log("Graph is completely acyclic! 0 cycles.");
  process.exit(0);
}
