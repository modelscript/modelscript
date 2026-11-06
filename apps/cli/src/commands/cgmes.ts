// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: CGMES Subcommand.
 *
 * Provides headless CLI operations for ENTSO-E CIM/CGMES grid profiles:
 * - `msx cgmes inspect <files...>`
 * - `msx cgmes lint <files...>`
 * - `msx cgmes to-psse <files...> [--out=grid.raw]`
 * - `msx cgmes to-modelica <files...> [--out=grid.mo]`
 * - `msx cgmes solve <files...> [--alg=nr|helm|dc-opf|ac-opf]`
 */

import {
  cgmesToModelica,
  cgmesToPsse,
  lintCgmesModel,
  parseCgmesFiles,
  processTopology,
} from "@modelscript/cgmes";
import { formatPowerFlowReport, solveHelmPowerFlow, solvePowerFlow } from "@modelscript/psse";
import { solveAcOpf, solveDcOpf } from "@modelscript/simulate/opf";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const CgmesCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "cgmes <action> [files...]",
  describe: "Inspect, lint, convert and solve ENTSO-E CIM / CGMES European grid models",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, to-psse, to-modelica, solve)",
        type: "string",
        choices: ["inspect", "lint", "to-psse", "to-modelica", "solve"],
        demandOption: true,
      })
      .positional("files", {
        description: "CGMES XML/RDF profile file(s) to process (EQ, TP, SSH, SV)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Target output file path",
        type: "string",
      })
      .option("alg", {
        description: "Solver algorithm for solve action: nr, helm, dc-opf, ac-opf",
        type: "string",
        default: "ac-opf",
      });
  },
  handler: async (argv) => {
    const action = String(argv["action"]);
    const files = (argv["files"] as string[]) || [];

    if (files.length === 0) {
      console.error("Error: No CGMES profile files specified.");
      process.exit(1);
    }

    const xmlSources: string[] = [];
    for (const f of files) {
      const resolved = path.resolve(process.cwd(), f);
      if (!fs.existsSync(resolved)) {
        console.error(`Error: File not found: ${resolved}`);
        process.exit(1);
      }
      xmlSources.push(fs.readFileSync(resolved, "utf8"));
    }

    const model = parseCgmesFiles(xmlSources);

    switch (action) {
      case "inspect": {
        const topo = processTopology(model);
        console.log("================================================================================");
        console.log("                        CGMES GRID MODEL INSPECTION                             ");
        console.log("================================================================================");
        console.log(`Substations:           ${model.substations.size}`);
        console.log(`Voltage Levels:        ${model.voltageLevels.size}`);
        console.log(`Topological Nodes:     ${model.nodes.size}`);
        console.log(`Connectivity Nodes:    ${model.connectivityNodes.size}`);
        console.log(`Terminals:             ${model.terminals.size}`);
        console.log(`AC Line Segments:      ${model.lines.size}`);
        console.log(`Power Transformers:    ${model.transformers.size}`);
        console.log(`Synchronous Machines:  ${model.generators.size}`);
        console.log(`Energy Consumers:      ${model.loads.size}`);
        console.log(`Shunt Compensators:    ${model.shunts.size}`);
        console.log(`State Var Voltages:    ${model.svVoltages.size}`);
        console.log(`State Var Flows:       ${model.svFlows.size}`);
        console.log(`Electrical Islands:    ${topo.islandCount}`);
        console.log("================================================================================");
        break;
      }

      case "lint": {
        const diags = lintCgmesModel(model);
        console.log(`Analyzed CGMES dataset. Found ${diags.length} diagnostic(s).`);
        for (const d of diags) {
          const prefix = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
          console.log(`[${prefix}] [${d.code}] ${d.message}${d.mRID ? ` (mRID: ${d.mRID})` : ""}`);
        }
        if (diags.some((d: { severity: string }) => d.severity === "error")) {
          process.exitCode = 1;
        }
        break;
      }

      case "to-psse": {
        const { psseCase } = cgmesToPsse(model);
        console.log(`Projected CGMES model into PSS/E base case:`);
        console.log(`  Buses:        ${psseCase.buses.size}`);
        console.log(`  Branches:     ${psseCase.branches.length}`);
        console.log(`  Transformers: ${psseCase.transformers.length}`);
        console.log(`  Generators:   ${psseCase.generators.length}`);
        console.log(`  Loads:        ${psseCase.loads.length}`);
        console.log(`  Shunts:       ${psseCase.fixedShunts.length}`);
        break;
      }

      case "to-modelica": {
        const moCode = cgmesToModelica(model);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, moCode, "utf8");
          console.log(`Exported Modelica model to: ${outPath}`);
        } else {
          console.log(moCode);
        }
        break;
      }

      case "solve": {
        const { psseCase } = cgmesToPsse(model);
        const alg = String(argv["alg"]).toLowerCase();

        if (alg === "dc-opf") {
          const sol = solveDcOpf(psseCase);
          console.log(sol.reportText);
        } else if (alg === "ac-opf") {
          const sol = solveAcOpf(psseCase);
          console.log(sol.reportText);
        } else if (alg === "helm") {
          const sol = solveHelmPowerFlow(psseCase);
          console.log(formatPowerFlowReport(sol, "CGMES PSS/E (HELM)"));
        } else {
          const sol = solvePowerFlow(psseCase, { algorithm: "newton_raphson" });
          console.log(formatPowerFlowReport(sol, "CGMES PSS/E (NR)"));
        }
        break;
      }
    }
  },
};
