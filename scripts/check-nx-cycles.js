// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

/**
 * Detects directed cycles in an adjacency map.
 * @param {Map<string, string[]>} adj
 * @returns {string[][]}
 */
export function detectCyclesInAdjacencyMap(adj) {
  const visited = new Set();
  const inStack = new Set();
  const cycles = [];

  function dfs(u, currentPath) {
    visited.add(u);
    inStack.add(u);
    currentPath.push(u);

    for (const v of adj.get(u) || []) {
      if (!visited.has(v)) {
        dfs(v, currentPath);
      } else if (inStack.has(v)) {
        const cycleStart = currentPath.indexOf(v);
        cycles.push(currentPath.slice(cycleStart).concat(v));
      }
    }

    currentPath.pop();
    inStack.delete(u);
  }

  for (const n of adj.keys()) {
    if (!visited.has(n)) {
      dfs(n, []);
    }
  }

  return cycles;
}

/**
 * Validates architectural module boundaries across the Nx project dependency graph:
 *   1. Core engine (packages/*) and languages (languages/*) must NEVER depend on apps/* or ee.
 *   2. Open-core libraries must NEVER depend on the enterprise edition (@modelscript/ee).
 * @param {any} graph
 * @returns {string[]}
 */
export function detectBoundaryViolations(graph) {
  const violations = [];
  const nodes = graph.nodes || {};
  const deps = graph.dependencies || {};

  for (const [sourceName, depList] of Object.entries(deps)) {
    const sourceNode = nodes[sourceName];
    if (!sourceNode?.data?.root) continue;
    const sourceRoot = sourceNode.data.root.replace(/\\/g, "/");

    for (const dep of depList) {
      const targetName = dep.target;
      const targetNode = nodes[targetName];
      if (!targetNode?.data?.root) continue;
      const targetRoot = targetNode.data.root.replace(/\\/g, "/");

      // 1. Core engine (packages/*) and languages (languages/*) must NEVER depend on apps/* or ee
      const isSourceEngineOrLang = sourceRoot.startsWith("packages/") || sourceRoot.startsWith("languages/");
      const isTargetAppOrEe = targetRoot.startsWith("apps/") || targetRoot === "ee" || targetRoot.startsWith("ee/");

      if (isSourceEngineOrLang && isTargetAppOrEe) {
        if (!sourceRoot.startsWith("packages/examples/")) {
          violations.push(
            `Boundary violation: ${sourceName} (${sourceRoot}) must not depend on ${targetName} (${targetRoot})`,
          );
        }
      }

      // 2. Open-core (anything outside ee) must NEVER depend on ee
      const isSourceOpenCore = sourceRoot !== "ee" && !sourceRoot.startsWith("ee/");
      const isTargetEe = targetRoot === "ee" || targetRoot.startsWith("ee/");
      if (isSourceOpenCore && isTargetEe) {
        if (!sourceRoot.startsWith("apps/api")) {
          violations.push(
            `Enterprise boundary violation: open-core ${sourceName} (${sourceRoot}) must not depend on ${targetName} (${targetRoot})`,
          );
        }
      }
    }
  }

  return violations;
}

function parseGraphAndDetectCycles(graphPath, keepFile, generated) {
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")).graph;
  const nodes = Object.keys(graph.nodes);
  const adj = new Map();
  for (const n of nodes) {
    adj.set(
      n,
      (graph.dependencies[n] || []).map((d) => d.target),
    );
  }

  const cycles = detectCyclesInAdjacencyMap(adj);
  const boundaryViolations = detectBoundaryViolations(graph);

  if (!keepFile || generated) {
    try {
      fs.unlinkSync(graphPath);
    } catch {}
  }

  return { nodeCount: nodes.length, cycles, boundaryViolations };
}

/**
 * Checks for project dependency cycles using Nx graph.json (generating it if needed).
 * @param {{ graphFile?: string; keepFile?: boolean }} [options]
 * @returns {{ nodeCount: number; cycles: string[][]; boundaryViolations?: string[] }}
 */
export function checkNxCycles(options = {}) {
  const graphPath = path.resolve(repoRoot, options.graphFile || "graph.json");
  let generated = false;

  if (!fs.existsSync(graphPath)) {
    const nxBin = fs.existsSync(path.join(repoRoot, "node_modules", "nx", "bin", "nx.js"))
      ? path.join(repoRoot, "node_modules", "nx", "bin", "nx.js")
      : path.join(repoRoot, "node_modules", "nx", "dist", "bin", "nx.js");
    const res = spawnSync(process.execPath, [nxBin, "graph", `--file=${graphPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NX_TUI: "false" },
    });
    if (res.status !== 0 && !fs.existsSync(graphPath)) {
      throw new Error(`Failed to generate Nx project graph: ${(res.stderr || res.stdout || "").trim()}`);
    }
    generated = true;
  }

  return parseGraphAndDetectCycles(graphPath, options.keepFile, generated);
}

/**
 * Async version of checkNxCycles that spawns Nx graph generation without blocking the event loop.
 * @param {{ graphFile?: string; keepFile?: boolean }} [options]
 * @returns {Promise<{ nodeCount: number; cycles: string[][] }>}
 */
export function checkNxCyclesAsync(options = {}) {
  const graphPath = path.resolve(repoRoot, options.graphFile || "graph.json");
  if (fs.existsSync(graphPath)) {
    return Promise.resolve(parseGraphAndDetectCycles(graphPath, options.keepFile, false));
  }

  return new Promise((resolve, reject) => {
    const nxBin = fs.existsSync(path.join(repoRoot, "node_modules", "nx", "bin", "nx.js"))
      ? path.join(repoRoot, "node_modules", "nx", "bin", "nx.js")
      : path.join(repoRoot, "node_modules", "nx", "dist", "bin", "nx.js");
    const child = spawn(process.execPath, [nxBin, "graph", `--file=${graphPath}`], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NX_TUI: "false" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (code !== 0 && !fs.existsSync(graphPath)) {
        reject(new Error(`Failed to generate Nx project graph: ${(stderr || stdout || "").trim()}`));
        return;
      }
      try {
        resolve(parseGraphAndDetectCycles(graphPath, options.keepFile, true));
      } catch (err) {
        reject(err);
      }
    });
    child.on("error", reject);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const { cycles } = checkNxCycles();
  console.log(`Cycles detected: ${cycles.length}`);
  if (cycles.length > 0) {
    for (const c of cycles) {
      console.log("CYCLE:", c.join(" -> "));
    }
    process.exit(1);
  } else {
    console.log("Graph is completely acyclic! 0 cycles.");
    process.exit(0);
  }
}
