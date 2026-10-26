// SPDX-License-Identifier: AGPL-3.0-or-later

import { epanetToModelica, lintEpanet, lowerEpanetToDae, parseInp, solveHydraulics } from "@modelscript/epanet";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const EpanetCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "epanet <action> [files...]",
  describe: "Inspect, validate, solve hydraulics, lower to DAE, and project US EPA EPANET water networks (.inp)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | lint | solve | to-modelica | to-dae",
        choices: ["inspect", "lint", "solve", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input EPANET network files (.inp)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path for generated Modelica code",
      })
      .option("max-iter", {
        type: "number",
        default: 40,
        describe: "Maximum Todini hydraulic iterations",
      })
      .option("tolerance", {
        type: "number",
        default: 0.001,
        describe: "Relative flow convergence tolerance",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const outFile = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const net = parseInp(content, file);

      switch (action) {
        case "inspect": {
          console.log(`\n=== US EPA EPANET Network: ${net.title ?? path.basename(file)} ===`);
          console.log(`Junctions: ${net.junctions.length}`);
          for (const j of net.junctions) {
            console.log(`  - Junction '${j.id}' (elev=${j.elevation} m, baseDemand=${j.demand} LPS)`);
          }
          console.log(`Reservoirs: ${net.reservoirs.length}`);
          for (const r of net.reservoirs) {
            console.log(`  - Reservoir '${r.id}' (head=${r.totalHead} m)`);
          }
          console.log(`Tanks: ${net.tanks.length}`);
          for (const t of net.tanks) {
            console.log(`  - Tank '${t.id}' (elev=${t.elevation} m, initLevel=${t.initLevel} m)`);
          }
          console.log(`Pipes: ${net.pipes.length}`);
          for (const p of net.pipes) {
            console.log(
              `  - Pipe '${p.id}': ${p.node1} -> ${p.node2} (L=${p.length} m, D=${p.diameter} mm, C=${p.roughness})`,
            );
          }
          console.log(`Pumps: ${net.pumps.length}`);
          console.log(`Valves: ${net.valves.length}`);
          break;
        }

        case "lint": {
          const diags = lintEpanet(net);
          if (diags.length === 0) {
            console.log(`[PASS] ${file}: 0 diagnostics reported.`);
          } else {
            console.log(`Found ${diags.length} diagnostic(s) in ${file}:`);
            for (const d of diags) {
              const loc = `${file}:${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${d.code}] [${d.severity.toUpperCase()}] ${loc} - ${d.message}`);
            }
          }
          break;
        }

        case "solve": {
          const maxIter = (argv["max-iter"] as number) ?? 40;
          const tol = (argv["tolerance"] as number) ?? 0.001;
          const res = solveHydraulics(net, { maxIterations: maxIter, tolerance: tol });
          console.log(`\n=== Todini Global Gradient Hydraulic Solution for ${net.title ?? path.basename(file)} ===`);
          console.log(
            `Status: ${res.converged ? "CONVERGED" : "FAILED"} in ${res.iterations} iterations (maxFlowDelta=${res.maxFlowChange.toExponential(4)})`,
          );
          console.log(`Nodal Heads & Pressures:`);
          for (const [nodeId, head] of res.nodeHeads) {
            const press = res.nodePressures.get(nodeId) ?? 0.0;
            console.log(`  Node '${nodeId}': Head = ${head.toFixed(2)} m, Pressure = ${press.toFixed(2)} m`);
          }
          console.log(`Link Flows:`);
          for (const [linkId, flow] of res.linkFlows) {
            console.log(`  Link '${linkId}': Flow = ${flow.toFixed(3)} LPS`);
          }
          break;
        }

        case "to-modelica": {
          const modelica = epanetToModelica(net);
          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), modelica, "utf-8");
            console.log(`Saved Modelica.Fluid water distribution model to ${outFile}`);
          } else {
            console.log(modelica);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerEpanetToDae(net);
          console.log(`Lowered EPANET water distribution network into linear DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
