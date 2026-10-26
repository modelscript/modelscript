// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: PSS/E Subcommand.
 *
 * Provides headless CLI operations for PSS/E RAW (.raw) power flow base cases:
 * - `msx psse lint <path>`
 * - `msx psse summary <path>`
 * - `msx psse diagram <path> [--out=grid.svg]`
 * - `msx psse netlist <path>`
 */

import { renderPsseSvg } from "@modelscript/diagram/psse-diagram-builder";
import {
  extractPowerFlowNetlist,
  lintPsse,
  lowerPsseToDae,
  parseRaw,
  psseToModelica,
  solvePowerFlow,
} from "@modelscript/psse";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const PsseCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "psse <action> [files...]",
  describe: "Inspect, lint, and visualize PSS/E RAW power flow cases (.raw)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, diagram, netlist, solve)",
        type: "string",
        choices: ["inspect", "to-dae", "to-modelica", "lint", "summary", "diagram", "netlist", "solve"],
        demandOption: true,
      })
      .positional("files", {
        description: "PSS/E RAW file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g. for SVG diagram)",
        type: "string",
      })
      .option("algorithm", {
        alias: "alg",
        description: "Power flow algorithm: 'nr' (Newton-Raphson) or 'fdpf' (Fast Decoupled)",
        type: "string",
        choices: ["nr", "fdpf"],
        default: "nr",
      })
      .option("tol", {
        description: "Convergence tolerance in p.u.",
        type: "number",
        default: 1e-4,
      })
      .option("max-iter", {
        description: "Maximum allowable power flow iterations",
        type: "number",
        default: 25,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const algorithm = (argv["algorithm"] as string) === "fdpf" ? "fast_decoupled" : "newton_raphson";
    const tolerance = (argv["tol"] as number) ?? 1e-4;
    const maxIterations = (argv["max-iter"] as number) ?? 25;

    if (files.length === 0) {
      console.error("[psse] No PSS/E .raw files specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[psse] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const parsed = parseRaw(text);

      switch (action) {
        case "lint": {
          console.log(`[psse] Linting ${path.basename(file)}...`);
          const diags = lintPsse(parsed);
          if (diags.length === 0) {
            console.log("  ✔ No electrical or parameter diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [${d.code}] Line ${d.line ?? "?"}: ${d.message}`);
            }
            const errors = diags.filter((d) => d.severity === "error");
            if (errors.length > 0) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "inspect":
        case "summary": {
          console.log(`=== PSS/E Base Case: ${parsed.title1 || path.basename(file)} ===`);
          console.log(`  Revision:      v${parsed.header.rev}`);
          console.log(`  Base MVA:      ${parsed.header.sbase} MVA`);
          console.log(`  Frequency:     ${parsed.header.basfrq} Hz`);
          console.log(`  Buses:         ${parsed.buses.size}`);
          console.log(`  Generators:    ${parsed.generators.length}`);
          console.log(`  Loads:         ${parsed.loads.length}`);
          console.log(`  Branches:      ${parsed.branches.length}`);
          console.log(`  Transformers:  ${parsed.transformers.length}`);
          console.log(`  SwitchedShunts:${parsed.switchedShunts.length}`);

          const netlist = extractPowerFlowNetlist(parsed);
          console.log(
            `  Total Gen:     ${netlist.metrics.totalGenMw.toFixed(1)} MW / ${netlist.metrics.totalGenMvar.toFixed(1)} MVAR`,
          );
          console.log(
            `  Total Load:    ${netlist.metrics.totalLoadMw.toFixed(1)} MW / ${netlist.metrics.totalLoadMvar.toFixed(1)} MVAR`,
          );
          break;
        }

        case "to-dae": {
          console.log(`[psse] Lowering ${path.basename(file)} to linear-memory DAE arena...`);
          const dae = lowerPsseToDae(parsed);
          console.log(`✔ DAE arena lowered successfully:`);
          console.log(`  Variables : ${dae.varCount}`);
          console.log(`  Equations : ${dae.eqCount}`);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(
              outPath,
              JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2),
              "utf-8",
            );
            console.log(`✔ DAE metadata written to: ${outPath}`);
          }
          break;
        }

        case "to-modelica": {
          const mo = psseToModelica(parsed);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, mo, "utf-8");
            console.log(`✔ Modelica projection written to: ${outPath}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "diagram": {
          const svg = renderPsseSvg(parsed);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, svg, "utf-8");
            console.log(`[psse] Single-Line Diagram SVG exported to: ${outPath}`);
          } else {
            process.stdout.write(svg);
          }
          break;
        }

        case "netlist": {
          const netlist = extractPowerFlowNetlist(parsed);
          console.log(`[psse] Netlist extracted for ${netlist.nBuses} buses.`);
          console.log(
            `  Matrix non-zeros (G): ${Array.from(netlist.ybus.g.values()).reduce((acc, m) => acc + m.size, 0)}`,
          );
          console.log(
            `  Matrix non-zeros (B): ${Array.from(netlist.ybus.b.values()).reduce((acc, m) => acc + m.size, 0)}`,
          );
          break;
        }

        case "solve": {
          console.log(`[psse] Solving AC Power Flow for ${path.basename(file)} (algorithm: ${algorithm})...`);
          const solution = solvePowerFlow(parsed, {
            algorithm: algorithm as "newton_raphson" | "fast_decoupled",
            tolerance,
            maxIterations,
          });
          if (solution.converged) {
            console.log(
              `  ✔ Converged in ${solution.iterations} iterations (max mismatch: ${solution.maxMismatchPu.toExponential(3)} pu)`,
            );
          } else {
            console.log(`  ✖ Failed to converge within ${solution.iterations} iterations`);
            process.exitCode = 1;
          }
          console.log(
            `  Total Generation: ${solution.totalGenMw.toFixed(1)} MW / ${solution.totalGenMvar.toFixed(1)} MVAR`,
          );
          console.log(
            `  Total Demand:     ${solution.totalLoadMw.toFixed(1)} MW / ${solution.totalLoadMvar.toFixed(1)} MVAR`,
          );
          console.log(`  Active Losses:    ${solution.totalLossMw.toFixed(2)} MW`);

          // Voltage violations (< 0.95 or > 1.05 pu)
          const violations = solution.buses.filter((b) => b.vm < 0.95 || b.vm > 1.05);
          if (violations.length > 0) {
            console.log(`\n  ▲ Voltage Violations (${violations.length} buses outside 0.95-1.05 pu):`);
            for (const b of violations) {
              const tag = b.vm < 0.95 ? "UNDER-VOLTAGE" : "OVER-VOLTAGE";
              console.log(`    Bus ${b.busNumber} (${b.name.trim()}): ${b.vm.toFixed(4)} pu [${tag}]`);
            }
          }

          // Branch thermal overloads (> 100% Rate A)
          const overloads = solution.branches.filter((br) => br.loadingPercent && br.loadingPercent > 100);
          if (overloads.length > 0) {
            console.log(`\n  ▲ Branch Overloads (${overloads.length} lines exceeding Rate A):`);
            for (const br of overloads) {
              console.log(
                `    Line ${br.fromBus}->${br.toBus} (${br.ckt}): ${br.mvaFlow.toFixed(1)} MVA / ${br.rateMva} MVA (${br.loadingPercent?.toFixed(1)}%)`,
              );
            }
          }

          console.log("\n  Bus Voltage Profile (First 10 buses):");
          console.log("  Bus #   Name            Base kV   Type    Vm (pu)   Va (deg)");
          console.log("  -------------------------------------------------------------");
          for (const b of solution.buses.slice(0, 10)) {
            console.log(
              `  ${String(b.busNumber).padEnd(7)} ${b.name.padEnd(15)} ${b.baseKv.toFixed(1).padEnd(9)} ${b.type.padEnd(7)} ${b.vm.toFixed(4).padEnd(9)} ${b.va.toFixed(2)}°`,
            );
          }
          if (solution.buses.length > 10) {
            console.log(`  ... and ${solution.buses.length - 10} more buses.`);
          }
          break;
        }
      }
    }
  },
};
