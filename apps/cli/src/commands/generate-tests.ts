// SPDX-License-Identifier: AGPL-3.0-or-later

import { RegionDecomposer } from "@modelscript/runtime";
import { BoundaryTestSynthesizer, extractActivityGraphFromText, parseGuardConstraints } from "@modelscript/sysml2";
import fs from "node:fs";
import type { CommandModule } from "yargs";

export interface GenerateTestsArgs {
  paths: string[];
  format: "terminal" | "json" | "ctrf" | "junit" | "modelica";
  mcdc: boolean;
  output?: string | undefined;
  model: string;
}

export const GenerateTests: CommandModule<{}, GenerateTestsArgs> = {
  command: "generate-tests <paths..>",
  describe: "Synthesize formal boundary-condition and 100% MC/DC test suites from SysML v2 models",

  builder: (yargs) => {
    return yargs
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "Path(s) to .sysml files containing decision activities",
        type: "string",
      })
      .option("format", {
        alias: "f",
        choices: ["terminal", "json", "ctrf", "junit", "modelica"] as const,
        default: "terminal" as const,
        description: "Output report format (terminal, json, ctrf, junit, modelica)",
        type: "string",
      })
      .option("mcdc", {
        description: "Enforce 100% MC/DC condition-outcome test pair synthesis",
        type: "boolean",
        default: true,
      })
      .option("output", {
        alias: "o",
        description: "Write generated test suite to file instead of stdout",
        type: "string",
      })
      .option("model", {
        alias: "m",
        description: "Target model name when generating Modelica .mos simulation scripts",
        type: "string",
        default: "Model",
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

        const decomp = RegionDecomposer.decomposeBranches(branches);
        const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomp, {
          suiteName: `${graph.name || "Activity"}_${d.name}_Suite`,
          includeMcdc: args.mcdc,
        });

        let outputContent = "";
        if (args.format === "json") {
          outputContent = JSON.stringify(suite, null, 2);
        } else if (args.format === "ctrf") {
          outputContent = BoundaryTestSynthesizer.exportToCtrfJson(suite);
        } else if (args.format === "junit") {
          outputContent = BoundaryTestSynthesizer.exportToJUnitXml(suite);
        } else if (args.format === "modelica") {
          outputContent = BoundaryTestSynthesizer.exportToModelicaMos(suite, args.model ?? "Model");
        } else {
          // Terminal format
          console.log(`\nSynthesized Test Suite: ${suite.name}`);
          console.log("=".repeat(60));
          console.log(`Summary: ${suite.summary}`);
          console.log(
            `Coverage: Regions ${suite.coverageMetrics.regionsCovered}/${suite.coverageMetrics.totalRegions} | MC/DC Pairs: ${suite.coverageMetrics.mcdcPairsCount}`,
          );
          console.log(`\nTest Vectors (${suite.testCases.length}):`);
          for (const tc of suite.testCases) {
            console.log(`  - [${tc.category.toUpperCase()}] ${tc.id}: ${tc.description}`);
            console.log(`    Inputs:   ${JSON.stringify(tc.inputs)}`);
            console.log(`    Expected: ${tc.expectedOutcome ?? tc.expectedRegionId}`);
          }
        }

        if (outputContent) {
          if (args.output) {
            fs.writeFileSync(args.output, outputContent, "utf-8");
            console.log(`Report written to ${args.output}`);
          } else {
            console.log(outputContent);
          }
        }
      }
    }
  },
};
