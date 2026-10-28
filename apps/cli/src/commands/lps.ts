// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: PipelineStudio (LPS / TGNET & TLNET) Subcommand.
 *
 * Provides headless CLI operations for PipelineStudio models:
 * - `msx lps lint <path>`
 * - `msx lps solve <path>`
 * - `msx lps linepack <path>`
 * - `msx lps simulate <path>`
 * - `msx lps sysml <path>`
 * - `msx lps verify <path>`
 */

import {
  CheckpointEngine,
  GasEulerDaeSolver,
  LinePackEngine,
  lintLpsModel,
  lowerLpsToDae,
  lpsToModelica,
  lpsToSysml2,
  parseLps,
  PipelineVerifier,
  SlackLineSolver,
  SoilThermalEngine,
  SteadyNetworkSolver,
  type EquationOfState,
} from "@modelscript/lps";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

import { normalizeDomainAction, resolveOutputFormat, resolveOutputPath } from "../util/cli-options.js";

const LPS_ACTIONS = [
  "inspect",
  "summary",
  "to-dae",
  "to-modelica",
  "lint",
  "solve",
  "linepack",
  "simulate",
  "sysml",
  "to-sysml",
  "verify",
] as const;

export const LpsCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "lps <action> [files..]",
  describe: "Inspect, lint, simulate, and verify PipelineStudio gas & liquid networks (.lps, .tgx, .tlx, .tgn, .tln)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, to-dae, to-modelica, lint, solve, linepack, simulate, sysml, verify)",
        type: "string",
        choices: LPS_ACTIONS,
        demandOption: true,
      })
      .positional("files", {
        description: "PipelineStudio model file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for SysML or Modelica export)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format: terminal or json",
        choices: ["terminal", "json"],
        default: "terminal",
        type: "string",
      })
      .option("json", {
        description: "Output results in JSON format",
        type: "boolean",
        default: false,
      })
      .option("duration", {
        alias: ["stop-time", "tstop"],
        description: "Simulation duration in seconds for transient run",
        type: "number",
        default: 3600,
      })
      .option("step", {
        alias: ["step-size", "dt"],
        description: "Transient simulation timestep in seconds",
        type: "number",
        default: 10,
      })
      .option("restart", {
        description: "Path to .sav checkpoint file to resume simulation from",
        type: "string",
      })
      .option("save-checkpoint", {
        description: "Path to write output .sav state snapshot",
        type: "string",
      })
      .option("eos", {
        description: "Equation of state to use (AGA8, GERG2008, PENG_ROBINSON, IDEAL)",
        type: "string",
        choices: ["AGA8", "GERG2008", "PENG_ROBINSON", "IDEAL"],
      })
      .option("soil", {
        description: "Run 1D radial cylindrical soil thermal conduction simulation",
        type: "boolean",
        default: false,
      })
      .option("slack", {
        description: "Evaluate open-channel slack line gravity flow on downhill pipes",
        type: "boolean",
        default: false,
      });
  },
  handler: async (argv) => {
    const rawAction = String(argv["action"] ?? "inspect");
    const action =
      rawAction === "summary"
        ? "inspect"
        : rawAction === "to-sysml"
          ? "sysml"
          : normalizeDomainAction(rawAction, LPS_ACTIONS);
    const files = (argv["files"] as string[]) ?? [];
    const outFile = resolveOutputPath(argv);
    const format = resolveOutputFormat(argv);

    if (files.length === 0) {
      console.error("Error: No input files specified.");
      process.exit(1);
    }

    for (const filePath of files) {
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${filePath}`);
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const model = parseLps(content, fullPath);

      if (argv["eos"]) {
        model.simulationControls.equationOfState = argv["eos"] as EquationOfState;
      }

      if (action === "inspect") {
        if (format === "json") {
          const summary = {
            file: path.basename(filePath),
            title: model.title || model.id,
            type: model.type,
            nodes: model.nodes.length,
            pipes: model.pipes.length,
            compressors: model.compressors.length,
          };
          const jsonStr = JSON.stringify(summary, null, 2);
          if (outFile) fs.writeFileSync(path.resolve(outFile), jsonStr, "utf-8");
          else console.log(jsonStr);
          continue;
        }
        console.log(`[PipelineStudio Network] File: ${path.basename(filePath)}`);
        console.log(`  Title: ${model.title || model.id}`);
        console.log(`  Simulation Type: ${model.type}`);
        console.log(`  Nodes: ${model.nodes.length}`);
        for (const n of model.nodes) {
          console.log(
            `    - Node '${n.name}' [${n.type}]: Elev=${n.elevation}m, P=${((n.pressure ?? 0) / 1e5).toFixed(1)} bar`,
          );
        }
        console.log(`  Pipes: ${model.pipes.length}`);
        for (const p of model.pipes) {
          console.log(
            `    - Pipe '${p.name}': ${p.fromNode} -> ${p.toNode} (L=${(p.length / 1000).toFixed(1)}km, D=${(p.diameter * 1000).toFixed(0)}mm)`,
          );
        }
        console.log(`  Compressors: ${model.compressors.length}`);
        for (const c of model.compressors) {
          console.log(
            `    - Compressor '${c.name}': ${c.fromNode} -> ${c.toNode} (${(c.maxPower / 1e6).toFixed(1)} MW, PR=${c.maxPressureRatio})`,
          );
        }
      } else if (action === "to-dae") {
        console.log(
          `Lowering PipelineStudio network '${model.title || model.id}' to ModelScript linear-memory DAE arena...`,
        );
        const dae = lowerLpsToDae(model);
        console.log(`✔ DAE arena lowered successfully:`);
        console.log(`  Variables : ${dae.varCount}`);
        console.log(`  Equations : ${dae.eqCount}`);
        if (outFile) {
          const outPath = path.resolve(outFile);
          fs.writeFileSync(outPath, JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2), "utf-8");
          console.log(`✔ DAE metadata written to ${outPath}`);
        }
      } else if (action === "to-modelica") {
        const mo = lpsToModelica(model);
        if (outFile) {
          const outPath = path.resolve(outFile);
          fs.writeFileSync(outPath, mo, "utf-8");
          console.log(`✔ Modelica projection written to ${outPath}`);
        } else {
          console.log(mo);
        }
      } else if (action === "lint") {
        const diagnostics = lintLpsModel(model);
        if (format === "json") {
          console.log(JSON.stringify(diagnostics, null, 2));
        } else if (diagnostics.length === 0) {
          console.log(`[LPS] ${filePath}: Clean! No diagnostics found.`);
        } else {
          console.log(`[LPS] ${filePath}: ${diagnostics.length} diagnostic(s) found:`);
          for (const d of diagnostics) {
            const prefix = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
            console.log(`  [${prefix}] ${d.code} (${d.rule}): ${d.message}`);
          }
        }
        if (diagnostics.some((d) => d.severity === "error")) {
          process.exitCode = 1;
        }
      } else if (action === "solve") {
        const steady = SteadyNetworkSolver.solve(model);
        if (format === "json") {
          const jsonStr = JSON.stringify(steady, null, 2);
          if (outFile) fs.writeFileSync(path.resolve(outFile), jsonStr, "utf-8");
          else console.log(jsonStr);
          continue;
        }
        console.log(`=== PipelineStudio Steady-State Hydraulics: ${model.title} ===`);
        console.log(`EOS: ${model.simulationControls.equationOfState ?? "AGA8"}`);
        console.log(`Nodes (${model.nodes.length}):`);
        for (const [name, state] of Object.entries(steady.nodeStates)) {
          console.log(
            `  ${name.padEnd(25)} P = ${(state.pressure / 1e5).toFixed(2).padStart(6)} bar | T = ${state.temperature.toFixed(1)} K`,
          );
        }
        console.log(`\nPipes (${model.pipes.length}):`);
        for (const [name, state] of Object.entries(steady.pipeStates)) {
          console.log(
            `  ${name.padEnd(20)} Flow = ${state.massFlow.toFixed(1).padStart(6)} kg/s | Vel = ${state.velocity.toFixed(1)} m/s | Loss = ${(state.frictionLossPa / 1e5).toFixed(2)} bar`,
          );
        }
        console.log(
          `\nTotal Network Line Pack: ${(steady.totalLinePackSm3 / 1e6).toFixed(3)} MMSm³ (${(steady.totalLinePackKg / 1000).toFixed(1)} tonnes)`,
        );

        if (argv["slack"]) {
          console.log("\n--- Downhill Slack Line Analysis ---");
          for (const pipe of model.pipes) {
            const fromZ = model.nodes.find((n) => n.name === pipe.fromNode)?.elevation ?? 0;
            const toZ = model.nodes.find((n) => n.name === pipe.toNode)?.elevation ?? 0;
            const pOut = steady.pipeStates[pipe.name]?.outletPressure ?? 50e5;
            const slack = SlackLineSolver.evaluateSegment(pipe, fromZ, toZ, pOut, 0.4, {
              densityKgM3: 850,
              vaporPressurePa: 40e3,
            });
            if (slack.isSlackFlow) {
              console.log(
                `  Pipe '${pipe.name}': SLACK FLOW DETECTED! Void fraction = ${(slack.voidFraction * 100).toFixed(1)}% | Void vol = ${slack.voidVolumeM3.toFixed(1)} m³ | Collapse surge = ${(slack.slackCollapseSurgePa / 1e5).toFixed(2)} bar`,
              );
            } else {
              console.log(
                `  Pipe '${pipe.name}': Pressurized full-pipe flow (slope = ${(slack.slope * 100).toFixed(2)}%)`,
              );
            }
          }
        }

        if (argv["soil"]) {
          console.log("\n--- 1D Radial Cylindrical Soil Thermal Conduction ---");
          const firstPipe = model.pipes[0];
          if (firstPipe) {
            const cd = SoilThermalEngine.simulateCooldown(firstPipe, 24.0, 313.15, 283.15);
            console.log(
              `  Pipe '${firstPipe.name}' 24h Cooldown: initial = ${cd.fluidTempsK[0]!.toFixed(1)} K -> 24h = ${cd.fluidTempsK[cd.fluidTempsK.length - 1]!.toFixed(1)} K (ambient = 283.2 K)`,
            );
          }
        }
      } else if (action === "linepack") {
        const steady = SteadyNetworkSolver.solve(model);
        const analysis = LinePackEngine.analyze(model, steady);
        console.log(`=== PipelineStudio Line Pack & Storage Analytics: ${model.title} ===`);
        console.log(
          `Total Gas In Place:     ${(analysis.totalLinePackSm3 / 1e6).toFixed(3)} MMSm³ (${(analysis.totalLinePackKg / 1000).toFixed(1)} tonnes)`,
        );
        console.log(`Deliverable Line Pack:  ${(analysis.deliverableLinePackSm3 / 1e6).toFixed(3)} MMSm³`);
        console.log(`Energy Stored:          ${analysis.totalEnergyStoredGWh.toFixed(2)} GWh`);
        console.log(`Energy Density (GHV):   ${analysis.energyDensityMJperSm3.toFixed(2)} MJ/Sm³`);
        console.log(`Hydrogen Blend:         ${analysis.hydrogenVolumePercent.toFixed(1)} vol%`);
        console.log(
          `Peak Drafting Buffer:   ${analysis.exhaustionTimeHours >= 999 ? "Sustained" : analysis.exhaustionTimeHours.toFixed(1) + " hours"}`,
        );
      } else if (action === "simulate") {
        const duration = (argv["duration"] as number) ?? 3600;
        const dt = (argv["step"] as number) ?? 10;
        const restartFile = argv["restart"] as string | undefined;

        let restored: ReturnType<typeof CheckpointEngine.applySnapshot> | undefined;
        if (restartFile && fs.existsSync(restartFile)) {
          const checkpointContent = fs.readFileSync(restartFile, "utf-8");
          const checkpoint = CheckpointEngine.deserialize(checkpointContent);
          restored = CheckpointEngine.applySnapshot(model, checkpoint);
          console.log(
            `[LPS] Resuming simulation from snapshot '${restartFile}' (t = ${checkpoint.simulationTime}s)...`,
          );
        }

        console.log(
          `Simulating 1D transient gas dynamics for ${duration}s (dt = ${dt}s, EOS = ${model.simulationControls.equationOfState})...`,
        );
        const trajectory = GasEulerDaeSolver.simulate(model, {
          durationSeconds: duration,
          timeStep: dt,
          ...(restored
            ? {
                initialP: restored.initialP,
                initialW: restored.initialW,
                startTime: restored.simulationStartTime,
              }
            : {}),
        });
        console.log(`Simulation completed: ${trajectory.times.length} time steps.`);
        console.log(
          `Final total line pack: ${(trajectory.linePackHistory[trajectory.linePackHistory.length - 1]! / 1000).toFixed(1)} tonnes.`,
        );

        const savePath = argv["save-checkpoint"] as string | undefined;
        if (savePath) {
          const steady = SteadyNetworkSolver.solve(model);
          const finalNodeStates = { ...steady.nodeStates };
          for (const [nodeName, pSeries] of Object.entries(trajectory.nodePressures)) {
            const finalP = pSeries[pSeries.length - 1];
            if (finalP !== undefined && finalNodeStates[nodeName]) {
              finalNodeStates[nodeName] = { ...finalNodeStates[nodeName]!, pressure: finalP };
            }
          }
          const finalPipeStates = { ...steady.pipeStates };
          for (const [pipeName, wSeries] of Object.entries(trajectory.pipeFlows)) {
            const finalW = wSeries[wSeries.length - 1];
            const pipeDef = model.pipes.find((p) => p.name === pipeName);
            if (finalW !== undefined && finalPipeStates[pipeName]) {
              const pIn =
                (pipeDef ? finalNodeStates[pipeDef.fromNode]?.pressure : undefined) ??
                finalPipeStates[pipeName]!.inletPressure;
              const pOut =
                (pipeDef ? finalNodeStates[pipeDef.toNode]?.pressure : undefined) ??
                finalPipeStates[pipeName]!.outletPressure;
              finalPipeStates[pipeName] = {
                ...finalPipeStates[pipeName]!,
                massFlow: finalW,
                inletPressure: pIn,
                outletPressure: pOut,
              };
            }
          }
          const finalTime = trajectory.times[trajectory.times.length - 1] ?? duration;
          const snap = CheckpointEngine.createSnapshot(model, finalTime, finalNodeStates, finalPipeStates);
          fs.writeFileSync(savePath, CheckpointEngine.serialize(snap), "utf-8");
          console.log(`[LPS] Checkpoint snapshot saved to: ${savePath}`);
        }
      } else if (action === "sysml") {
        const sysmlText = lpsToSysml2(model);
        if (outFile) {
          fs.writeFileSync(path.resolve(outFile), sysmlText, "utf-8");
          console.log(`Exported SysML v2 model to: ${outFile}`);
        } else {
          console.log(sysmlText);
        }
      } else if (action === "verify") {
        const steady = SteadyNetworkSolver.solve(model);
        const report = PipelineVerifier.verifySteady(model, steady);
        console.log(`=== PipelineStudio Design & Safety Verification: ${model.title} ===`);
        console.log(`Status: ${report.passed ? "PASSED" : "FAILED"} (${report.totalChecks} checks evaluated)`);
        console.log(`  Max Observed Pressure:  ${report.summary.maxObservedPressureBar.toFixed(1)} bar`);
        console.log(`  Min Delivery Pressure:  ${report.summary.minDeliveryPressureBar.toFixed(1)} bar`);
        console.log(`  Max Gas Velocity:       ${report.summary.maxVelocityMps.toFixed(1)} m/s`);
        if (report.violations.length > 0) {
          console.log("\nViolations:");
          for (const v of report.violations) {
            console.log(`  [VIOLATION] ${v.criterion} on '${v.target}': ${v.message}`);
          }
          process.exitCode = 1;
        }
      }
    }
  },
};
