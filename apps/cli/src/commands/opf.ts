// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Optimal Power Flow Subcommand (`msx opf <action> [files...]`).
 *
 * Provides two-tier optimization operations for electrical power networks:
 * - `msx opf solve <file>`: Solve DC or AC OPF using Tier 2 (Direct Zero-GC) or Tier 1 (AMPL)
 * - `msx opf to-ampl <file>`: Export network case to AMPL mathematical model (.mod) and data (.dat)
 * - `msx opf to-exago <file>`: Export exascale bundle for PNNL ExaGO (MATPOWER case, INI, and Slurm script)
 */

import { gridToAmplOpf } from "@modelscript/ampl";
import { parseRaw } from "@modelscript/psse";
import {
  exportExagoDeck,
  parseMatpower,
  solveAcOpfAsync,
  solveDcOpfAsync,
  type GenericPowerCase,
  type OpfSolution,
} from "@modelscript/simulate/opf";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

function loadGridCase(filePath: string): GenericPowerCase {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".m" || ext === ".matpower") {
    return parseMatpower(content);
  }
  if (ext === ".raw") {
    return parseRaw(content);
  }
  if (ext === ".json") {
    return JSON.parse(content) as GenericPowerCase;
  }

  // Fallback heuristic: check if content resembles MATPOWER or JSON
  if (content.includes("mpc.bus") || content.includes("function mpc")) {
    return parseMatpower(content);
  }
  return JSON.parse(content) as GenericPowerCase;
}

export const OpfCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "opf <action> [files...]",
  describe: "Optimal Power Flow: solve DC/AC OPF, export to AMPL or ExaGO, and compute LMPs",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (solve, to-ampl, to-exago)",
        type: "string",
        choices: ["solve", "to-ampl", "to-exago"],
        demandOption: true,
      })
      .positional("files", {
        description: "Power network case file(s) (.m, .raw, .json)",
        type: "string",
        array: true,
      })
      .option("tier", {
        type: "string",
        choices: ["direct", "ampl"],
        default: "direct",
        describe: "Solver tier: 'direct' (Tier 2 Zero-GC CLP/Simplex/IPOPT) or 'ampl' (Tier 1 algebraic)",
      })
      .option("formulation", {
        type: "string",
        choices: ["dc", "ac"],
        default: "dc",
        describe: "OPF formulation: 'dc' (linearized active power) or 'ac' (full nonlinear)",
      })
      .option("solver", {
        type: "string",
        describe: "Optimizer name ('simplex', 'clp', 'cbc', 'ipopt', 'highs')",
      })
      .option("thermal-limits", {
        type: "boolean",
        default: true,
        describe: "Enforce transmission branch thermal flow limits (rateA)",
      })
      .option("format", {
        type: "string",
        choices: ["report", "table", "json"],
        default: "report",
        describe: "Result presentation format",
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe: "Output destination path or directory",
      })
      .option("app", {
        type: "string",
        choices: ["scopflow", "opflow"],
        default: "scopflow",
        describe: "ExaGO optimization application",
      })
      .option("mpi-ranks", {
        type: "number",
        default: 4,
        describe: "MPI rank count for ExaGO execution script",
      });
  },
  handler: async (argv) => {
    const action = String(argv["action"] ?? "solve");
    const rawFiles = (argv["files"] as string[]) ?? [];

    if (rawFiles.length === 0) {
      console.error("Error: At least one power case file (.m, .raw, .json) is required.");
      process.exit(1);
    }

    const filePath = path.resolve(process.cwd(), rawFiles[0]!);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const powerCase = loadGridCase(filePath);
    const caseName = path.basename(filePath, path.extname(filePath));

    if (action === "solve") {
      const tier = (argv["tier"] as "direct" | "ampl") || "direct";
      const formulation = (argv["formulation"] as "dc" | "ac") || "dc";
      const solver = argv["solver"] as any;
      const enforceThermalLimits = argv["thermal-limits"] !== false;
      const format = (argv["format"] as string) || "report";
      const outPath = argv["out"] ? path.resolve(process.cwd(), String(argv["out"])) : undefined;

      let sol: OpfSolution;
      if (formulation === "dc") {
        sol = await solveDcOpfAsync(powerCase, {
          tier,
          solver,
          enforceThermalLimits,
          caseTitle: caseName,
        });
      } else {
        sol = await solveAcOpfAsync(powerCase, {
          tier,
          solver,
          enforceThermalLimits,
          caseTitle: caseName,
        });
      }

      if (format === "json") {
        const jsonStr = JSON.stringify(sol, null, 2);
        if (outPath) {
          fs.writeFileSync(outPath, jsonStr, "utf-8");
          console.log(`Saved JSON solution to ${outPath}`);
        } else {
          console.log(jsonStr);
        }
      } else if (format === "table") {
        console.log(`\n=== OPF Dispatch Summary (${sol.status}) ===`);
        console.log(
          `Total Demand: ${sol.totalLoadMw} MW | Total Gen: ${sol.totalGenMw} MW | Cost: $${sol.objectiveValue}/h`,
        );
        console.log("\nGenerators:");
        console.table(
          sol.generators.map((g) => ({
            Bus: g.busNumber,
            GenId: g.genId,
            "Pg (MW)": g.pgMw,
            "Qg (Mvar)": g.qgMvar ?? 0.0,
            "Cost ($/h)": g.totalCostPerHour,
            "At Limit": g.atMaxLimit ? "MAX" : g.atMinLimit ? "MIN" : "NO",
          })),
        );
        const congestedBranches = sol.branches.filter((b) => b.congested);
        if (congestedBranches.length > 0) {
          console.log("\nCongested Branches:");
          console.table(
            congestedBranches.map((b) => ({
              From: b.fromBus,
              To: b.toBus,
              Ckt: b.ckt,
              "Flow (MW)": b.pFlowMw,
              "Limit (MVA)": b.rateMva,
              "Loading %": b.loadingPercent,
              "Shadow Price": b.shadowPrice,
            })),
          );
        }
      } else {
        if (outPath) {
          fs.writeFileSync(outPath, sol.reportText, "utf-8");
          console.log(`Saved OPF report to ${outPath}`);
        } else {
          console.log(sol.reportText);
        }
      }
      return;
    }

    if (action === "to-ampl") {
      const formulation = (argv["formulation"] as "dc" | "ac") || "dc";
      const { modText, datText } = gridToAmplOpf(powerCase, { formulation });
      const outOpt = argv["out"] ? String(argv["out"]) : undefined;

      let modPath: string;
      let datPath: string;

      if (outOpt) {
        const resolved = path.resolve(process.cwd(), outOpt);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          modPath = path.join(resolved, `${caseName}.mod`);
          datPath = path.join(resolved, `${caseName}.dat`);
        } else {
          modPath = `${resolved}.mod`;
          datPath = `${resolved}.dat`;
        }
      } else {
        modPath = path.join(process.cwd(), `${caseName}.mod`);
        datPath = path.join(process.cwd(), `${caseName}.dat`);
      }

      fs.writeFileSync(modPath, modText, "utf-8");
      fs.writeFileSync(datPath, datText, "utf-8");
      console.log(`Successfully exported AMPL OPF formulation (${formulation.toUpperCase()}):`);
      console.log(`  Model: ${modPath}`);
      console.log(`  Data:  ${datPath}`);
      return;
    }

    if (action === "to-exago") {
      const outDir = path.resolve(process.cwd(), argv["out"] ? String(argv["out"]) : `./${caseName}_exago`);
      fs.mkdirSync(outDir, { recursive: true });

      const app = (argv["app"] as "scopflow" | "opflow") || "scopflow";
      const mpiRanks = Number(argv["mpi-ranks"] ?? 4);

      const deck = exportExagoDeck(powerCase, {
        caseName,
        app,
        mpiRanks,
      });

      const mPath = path.join(outDir, `${caseName}.m`);
      const iniPath = path.join(outDir, `${caseName}.ini`);
      const shPath = path.join(outDir, "run_exago.sh");

      fs.writeFileSync(mPath, deck.matpowerCase, "utf-8");
      fs.writeFileSync(iniPath, deck.configFile, "utf-8");
      fs.writeFileSync(shPath, deck.slurmScript, { encoding: "utf-8", mode: 0o755 });

      if (deck.contingenciesCont) {
        const contPath = path.join(outDir, `${caseName}.cont`);
        fs.writeFileSync(contPath, deck.contingenciesCont, "utf-8");
      }

      console.log(`Successfully generated ExaGO optimization deck in ${outDir}:`);
      console.log(`  MATPOWER case: ${mPath}`);
      console.log(`  Configuration: ${iniPath}`);
      console.log(`  Slurm script:  ${shPath}`);
      return;
    }

    console.error(`Unknown action: ${action}`);
    process.exit(1);
  },
};
