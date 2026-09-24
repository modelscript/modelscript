// SPDX-License-Identifier: AGPL-3.0-or-later

import { RegionDecomposer } from "@modelscript/runtime";
import { extractActivityGraphFromText, parseGuardConstraints } from "@modelscript/sysml2";
import fs from "node:fs";
import type { CommandModule } from "yargs";

export interface DecomposeArgs {
  paths: string[];
  maxRegions?: number;
  maxDepth?: number;
  json?: boolean;
}

export const Decompose: CommandModule<{}, DecomposeArgs> = {
  command: "decompose <paths..>",
  describe: "Perform symbolic state-space region decomposition over SysML v2 decision conditions",

  builder: (yargs) => {
    return yargs
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "Path(s) to .sysml files to decompose",
        type: "string",
      })
      .option("max-regions", {
        alias: "r",
        description: "Maximum number of regions to partition (default: 64)",
        type: "number",
        default: 64,
      })
      .option("max-depth", {
        alias: "d",
        description: "Maximum branch condition exploration depth (default: 8)",
        type: "number",
        default: 8,
      })
      .option("json", {
        description: "Output regions in JSON format",
        type: "boolean",
        default: false,
      });
  },

  handler: async (args) => {
    for (const filePath of args.paths) {
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const graph = extractActivityGraphFromText(content);
      const decideNodes = graph.nodes.filter((n) => n.kind === "decide");

      for (const d of decideNodes) {
        const outgoing = graph.flows.filter((f) => f.source === d.name);
        const branches = outgoing.map((f, idx) => {
          const raw = f.guard ? parseGuardConstraints(f.guard) : [];
          const constraints = raw.map((g) => {
            const varName = g.variable.includes(".") ? (g.variable.split(".").pop() ?? g.variable) : g.variable;
            const rel =
              g.operator === "<" || g.operator === "<="
                ? "<="
                : g.operator === ">" || g.operator === ">="
                  ? ">="
                  : "==";
            return {
              expr: { kind: "var" as const, name: varName },
              rel: rel as "<=" | ">=" | "==",
              rhs: g.value,
            };
          });
          return {
            id: `${d.name}_b${idx + 1}`,
            constraints,
            terminalValue: f.target,
          };
        });

        const decomp = RegionDecomposer.decomposeBranches(branches, {
          ...(args.maxRegions !== undefined ? { maxRegions: args.maxRegions } : {}),
          ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
        });

        if (args.json) {
          console.log(JSON.stringify(decomp, null, 2));
        } else {
          console.log(`\nSymbolic Region Decomposition: ${filePath} [Decide Node: ${d.name}]`);
          console.log("=".repeat(60));
          console.log(decomp.summary);
          console.log(`\nRegions (${decomp.regions.length}):`);
          for (const r of decomp.regions) {
            console.log(`  - [${r.id}] -> Target: ${r.terminalValue ?? "leaf"}`);
            console.log(`    Bounding Box:     ${JSON.stringify(r.boundingPolytope)}`);
            console.log(`    Interior Witness: ${JSON.stringify(r.interiorWitness)}`);
          }
          if (decomp.frontierEdges.length > 0) {
            console.log(`\nFrontier Boundaries (${decomp.frontierEdges.length}):`);
            for (const fe of decomp.frontierEdges) {
              console.log(`  - ${fe.sourceRegion} <---> ${fe.targetRegion} on facet [${fe.sharedFacet}]`);
            }
          }
        }
      }
    }
  },
};
