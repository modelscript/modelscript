// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: NASA ROCETS Subcommand.
 *
 * Provides headless CLI operations for NASA ROCETS (.roc, .deck) liquid rocket propulsion models:
 * - `msx rocets lint <path>`
 * - `msx rocets summary <path>`
 * - `msx rocets balance <path> [--target-pc=15E6] [--mr=6.0]`
 * - `msx rocets simulate <path> [--t-end=2.0]`
 * - `msx rocets to-modelica <path> [--out=Engine.mo]`
 * - `msx rocets to-ssp <path> [--out=SystemStructure.ssd]`
 * - `msx rocets diagram <path> [--out=pid.svg]`
 */

import {
  lintRocets,
  parseRocetsDeck,
  renderRocetsPidSvg,
  rocetsToDae,
  rocetsToModelica,
  rocetsToSsp,
  simulateRocetsTransient,
  solveRocetsBalance,
} from "@modelscript/rocets";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const RocetsCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "rocets <action> [files...]",
  describe: "Inspect, lint, balance, simulate, and project NASA ROCETS propulsion decks (.roc, .deck)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (lint, summary, inspect, balance, simulate, to-modelica, to-ssp, to-dae, diagram)",
        type: "string",
        choices: ["lint", "summary", "inspect", "balance", "simulate", "to-modelica", "to-ssp", "to-dae", "diagram"],
        demandOption: true,
      })
      .positional("files", {
        description: "ROCETS deck file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (for code generation or SVG diagram)",
        type: "string",
      })
      .option("target-pc", {
        description: "Target chamber pressure in Pascals for balance solve",
        type: "number",
      })
      .option("mr", {
        description: "Target oxidizer-to-fuel mixture ratio for balance solve",
        type: "number",
      })
      .option("t-end", {
        description: "End time for transient trajectory simulation (seconds)",
        type: "number",
        default: 2.0,
      })
      .option("format", {
        alias: "f",
        description: "Output format: 'terminal' or 'json'",
        type: "string",
        choices: ["terminal", "json"],
        default: "terminal",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const outPath = argv["out"] as string | undefined;
    const format = argv["format"] as "terminal" | "json";
    const targetPc = argv["target-pc"] as number | undefined;
    const targetMr = argv["mr"] as number | undefined;
    const tEnd = (argv["t-end"] as number) ?? 2.0;

    if (files.length === 0) {
      process.stderr.write("Error: No ROCETS deck file provided.\n");
      process.exitCode = 1;
      return;
    }

    const filePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`Error: File not found: ${filePath}\n`);
      process.exitCode = 1;
      return;
    }

    const sourceText = fs.readFileSync(filePath, "utf-8");
    const model = parseRocetsDeck(sourceText);

    switch (action) {
      case "lint": {
        const diags = lintRocets(model);
        if (format === "json") {
          process.stdout.write(JSON.stringify(diags, null, 2) + "\n");
        } else {
          if (diags.length === 0) {
            process.stdout.write(`✓ No issues found in '${model.name}'.\n`);
          } else {
            process.stdout.write(`Found ${diags.length} diagnostic(s) in '${model.name}':\n`);
            for (const d of diags) {
              const loc = d.line ? `:${d.line}:${d.column ?? 1}` : "";
              process.stdout.write(`  [${d.severity.toUpperCase()}] [${d.id}] ${filePath}${loc} - ${d.message}\n`);
            }
          }
        }
        if (diags.some((d) => d.severity === "error")) {
          process.exitCode = 1;
        }
        break;
      }

      case "inspect":
      case "summary": {
        if (format === "json") {
          process.stdout.write(
            JSON.stringify(
              {
                name: model.name,
                title: model.title,
                moduleCount: model.components.size,
                connectionCount: model.connections.length,
                modules: Array.from(model.components.entries()).map(([id, c]) => ({
                  id,
                  type: c.type,
                  title: c.title,
                  ports: Object.keys(c.ports),
                })),
              },
              null,
              2,
            ) + "\n",
          );
        } else {
          process.stdout.write(`========================================\n`);
          process.stdout.write(`NASA ROCETS Engine Model: ${model.name}\n`);
          if (model.title) process.stdout.write(`Title: ${model.title}\n`);
          process.stdout.write(`Modules (${model.components.size}):\n`);
          for (const [id, c] of model.components) {
            process.stdout.write(`  - ${id.padEnd(12)} [${c.type}] ${c.title || ""}\n`);
          }
          process.stdout.write(`Flow Connections (${model.connections.length}):\n`);
          for (const conn of model.connections) {
            process.stdout.write(`  ${conn.fromComponent}.${conn.fromPort} -> ${conn.toComponent}.${conn.toPort}\n`);
          }
          process.stdout.write(`========================================\n`);
        }
        break;
      }

      case "balance": {
        const balance = solveRocetsBalance(model, {
          ...(targetPc !== undefined ? { targetPcPa: targetPc } : {}),
          ...(targetMr !== undefined ? { mixtureRatio: targetMr } : {}),
        });

        if (format === "json") {
          process.stdout.write(JSON.stringify(balance, null, 2) + "\n");
        } else {
          process.stdout.write(`========================================\n`);
          process.stdout.write(`ROCETS Steady-State Engine Balance: ${model.name}\n`);
          process.stdout.write(`Converged: ${balance.converged ? "YES" : "NO"} (${balance.iterations} iterations)\n`);
          process.stdout.write(`Chamber Pressure: ${(balance.chamberPressurePa / 1e6).toFixed(2)} MPa\n`);
          process.stdout.write(`Mixture Ratio (O/F): ${balance.mixtureRatio.toFixed(2)}\n`);
          process.stdout.write(
            `Total Mass Flow: ${balance.totalMassFlowKgS.toFixed(2)} kg/s (Ox: ${balance.oxMassFlowKgS.toFixed(2)}, Fuel: ${balance.fuelMassFlowKgS.toFixed(2)})\n`,
          );
          process.stdout.write(`Shaft Speed: ${balance.shaftSpeedRpm.toFixed(0)} RPM\n`);
          process.stdout.write(`Vacuum Thrust: ${(balance.thrustVacN / 1e3).toFixed(1)} kN\n`);
          process.stdout.write(`Sea Level Thrust: ${(balance.thrustSlN / 1e3).toFixed(1)} kN\n`);
          process.stdout.write(`Vacuum Isp: ${balance.ispVacSec.toFixed(1)} s\n`);
          process.stdout.write(`Sea Level Isp: ${balance.ispSlSec.toFixed(1)} s\n`);
          process.stdout.write(`========================================\n`);
        }
        break;
      }

      case "simulate": {
        const sim = simulateRocetsTransient(model, {
          tStart: 0.0,
          tEnd,
          dt: 0.01,
        });

        if (format === "json") {
          process.stdout.write(JSON.stringify(sim, null, 2) + "\n");
        } else {
          process.stdout.write(`========================================\n`);
          process.stdout.write(`ROCETS Dynamic Ignition & Ramp Transient: ${model.name}\n`);
          process.stdout.write(`Time(s)    Pc(MPa)     Thrust(kN)   RPM        Tw(K)\n`);
          process.stdout.write(`------------------------------------------------------\n`);
          for (let i = 0; i < sim.times.length; i += 20) {
            const t = sim.times[i]!;
            const p = (sim.pcPa[i]! / 1e6).toFixed(2);
            const th = (sim.thrustN[i]! / 1e3).toFixed(1);
            const r = sim.speedRpm[i]!.toFixed(0);
            const w = sim.wallTempK[i]!.toFixed(0);
            process.stdout.write(`${t.toFixed(2).padEnd(10)} ${p.padEnd(11)} ${th.padEnd(12)} ${r.padEnd(10)} ${w}\n`);
          }
          process.stdout.write(`========================================\n`);
        }
        break;
      }

      case "to-modelica": {
        const code = rocetsToModelica(model);
        if (outPath) {
          fs.writeFileSync(path.resolve(process.cwd(), outPath), code, "utf-8");
          process.stdout.write(`Wrote Modelica 3.x projection to: ${outPath}\n`);
        } else {
          process.stdout.write(code + "\n");
        }
        break;
      }

      case "to-ssp": {
        const xml = rocetsToSsp(model);
        if (outPath) {
          fs.writeFileSync(path.resolve(process.cwd(), outPath), xml, "utf-8");
          process.stdout.write(`Wrote FMI SSP SystemStructure.ssd to: ${outPath}\n`);
        } else {
          process.stdout.write(xml + "\n");
        }
        break;
      }

      case "to-dae": {
        process.stdout.write(`[rocets] Lowering ${path.basename(filePath)} to linear-memory DAE arena...\n`);
        const dae = rocetsToDae(model);
        process.stdout.write(`✔ DAE arena lowered successfully:\n`);
        process.stdout.write(`  Variables : ${dae.varCount}\n`);
        process.stdout.write(`  Equations : ${dae.eqCount}\n`);
        if (outPath) {
          fs.writeFileSync(
            path.resolve(process.cwd(), outPath),
            JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2),
            "utf-8",
          );
          process.stdout.write(`✔ DAE metadata written to: ${outPath}\n`);
        }
        break;
      }

      case "diagram": {
        const svg = renderRocetsPidSvg(model);
        if (outPath) {
          fs.writeFileSync(path.resolve(process.cwd(), outPath), svg, "utf-8");
          process.stdout.write(`Wrote SVG P&ID diagram to: ${outPath}\n`);
        } else {
          process.stdout.write(svg + "\n");
        }
        break;
      }

      default:
        process.stderr.write(`Unknown action: ${action}\n`);
        process.exitCode = 1;
    }
  },
};
