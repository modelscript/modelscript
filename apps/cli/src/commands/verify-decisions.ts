// SPDX-License-Identifier: AGPL-3.0-or-later

import { DecisionTableVerifier } from "@modelscript/sysml2";
import fs from "node:fs";
import type { CommandModule } from "yargs";

export interface VerifyDecisionsArgs {
  paths: string[];
  json?: boolean;
}

export const VerifyDecisions: CommandModule<{}, VerifyDecisionsArgs> = {
  command: "verify-decisions <paths..>",
  describe:
    "Formally verify SysML v2 decision tables, decide nodes, and state guards for exhaustiveness and disjointness",

  builder: (yargs) => {
    return yargs
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "Path(s) to .sysml files containing activities or state machines",
        type: "string",
      })
      .option("json", {
        description: "Output verification results in structured JSON format",
        type: "boolean",
        default: false,
      });
  },

  handler: async (args) => {
    let allPassed = true;
    const allResults: Record<string, any> = {};

    for (const filePath of args.paths) {
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const results = DecisionTableVerifier.verifyAllDecisionsFromText(content);

      allResults[filePath] = {};
      for (const [nodeName, res] of results.entries()) {
        allResults[filePath][nodeName] = res;
        if (!res.isExhaustive || !res.isDeterministic || res.hasDeadBranches) {
          allPassed = false;
        }
      }

      if (!args.json) {
        console.log(`\nDecision Table Verification: ${filePath}`);
        console.log("=".repeat(50));
        if (results.size === 0) {
          console.log("  No explicit decide nodes found in file.");
        }
        for (const [nodeName, res] of results.entries()) {
          console.log(`  Decide Node: '${nodeName}'`);
          console.log(
            `    Exhaustive:     ${res.isExhaustive ? "PASSED (No unhandled gaps)" : "FAILED (Unhandled gap detected)"}`,
          );
          if (res.unhandledScenarioBox) {
            console.log(`      Counterexample Gap: ${JSON.stringify(res.unhandledScenarioBox)}`);
          }
          console.log(
            `    Deterministic:  ${res.isDeterministic ? "PASSED (Mutually disjoint)" : "FAILED (Overlapping race conditions)"}`,
          );
          if (res.overlappingBranches.length > 0) {
            for (const ob of res.overlappingBranches) {
              console.log(
                `      Collision between '${ob.branchA}' and '${ob.branchB}' at ${JSON.stringify(ob.witnessBox)}`,
              );
            }
          }
          console.log(`    Dead Branches:  ${!res.hasDeadBranches ? "NONE" : res.deadBranches.join(", ")}`);
        }
      }
    }

    if (args.json) {
      console.log(JSON.stringify(allResults, null, 2));
    }

    if (!allPassed) {
      process.exitCode = 1;
    }
  },
};
