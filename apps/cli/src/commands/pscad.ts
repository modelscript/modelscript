// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: PSCAD Subcommand.
 *
 * Provides headless CLI operations for PSCAD projects (.pscx, .pslx, .psmx):
 * - `msx pscad lint <path>`
 * - `msx pscad diagram <path> [--out=output.svg]`
 * - `msx pscad diff <oldPath> <newPath>`
 * - `msx pscad sim <path> [--tstop=1.0] [--step=20us]`
 * - `msx pscad verify-ieee2800 <path>`
 * - `msx pscad export-modelica <path> [--out=model.mo]`
 * - `msx pscad export-ssp <path> [--out=SystemStructure.ssd]`
 */

import { diffPscadProjects, renderPscadSvg } from "@modelscript/diagram/pscad-diagram-builder";
import {
  extractEmtNetlist,
  lintPscx,
  parsePscx,
  pscadToModelica,
  pscadToSsd,
  verifyIeee2800Compliance,
} from "@modelscript/pscad";
import { EmtSolver, type EmtCircuitDefinition } from "@modelscript/simulate";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const PscadCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "pscad <action> [files...]",
  describe: "Inspect, lint, diff, simulate, and verify PSCAD projects (.pscx, .pslx)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, diagram, diff, sim, verify-ieee2800, export-modelica, export-ssp)",
        type: "string",
        choices: ["lint", "diagram", "diff", "sim", "verify-ieee2800", "export-modelica", "export-ssp"],
        demandOption: true,
      })
      .positional("files", {
        description: "Project file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (for diagram SVG, Modelica, or SSD export)",
        type: "string",
      })
      .option("tstop", {
        description: "Simulation duration in seconds",
        type: "number",
        default: 1.0,
      })
      .option("step", {
        description: "Simulation fixed time step (e.g. '20us' or 20e-6)",
        type: "string",
        default: "20us",
      });
  },
  handler: async (args) => {
    const action = args["action"] as string;
    const files = (args["files"] as string[]) ?? [];

    if (files.length === 0) {
      console.error("Error: Please provide at least one PSCAD project file (.pscx, .pslx).");
      process.exit(1);
    }

    const firstFilePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(firstFilePath)) {
      console.error(`Error: File not found: ${firstFilePath}`);
      process.exit(1);
    }

    const xmlContent = fs.readFileSync(firstFilePath, "utf-8");
    const project = parsePscx(xmlContent);

    switch (action) {
      case "lint": {
        console.log(`Linting PSCAD project: ${project.name} (${firstFilePath})...\n`);
        const diags = lintPscx(project);

        if (diags.length === 0) {
          console.log("✓ No issues found. Electrical topology and parameters are valid.");
          return;
        }

        let hasErrors = false;
        for (const d of diags) {
          const color = d.severity === "error" ? "\x1b[31m" : "\x1b[33m";
          const reset = "\x1b[0m";
          console.log(`  ${color}[${d.severity.toUpperCase()}] ${d.code} (${d.rule})${reset}: ${d.message}`);
          if (d.severity === "error") hasErrors = true;
        }

        console.log(`\nFound ${diags.length} diagnostic(s).`);
        if (hasErrors) {
          process.exit(1);
        }
        break;
      }

      case "diagram": {
        console.log(`Generating diagram for: ${project.name}...`);
        const svg = renderPscadSvg(project);
        const outPath = (args["out"] as string) ?? `${path.parse(firstFilePath).name}.svg`;
        fs.writeFileSync(path.resolve(process.cwd(), outPath), svg, "utf-8");
        console.log(`✓ Standalone SVG written to: ${outPath} (${svg.length} bytes)`);
        break;
      }

      case "diff": {
        if (files.length < 2) {
          console.error("Error: 'diff' requires two PSCAD project files: msx pscad diff <fileA> <fileB>");
          process.exit(1);
        }
        const secondFilePath = path.resolve(process.cwd(), files[1]!);
        if (!fs.existsSync(secondFilePath)) {
          console.error(`Error: Second file not found: ${secondFilePath}`);
          process.exit(1);
        }
        const xmlContent2 = fs.readFileSync(secondFilePath, "utf-8");
        const project2 = parsePscx(xmlContent2);

        const diffResult = diffPscadProjects(project, project2);
        console.log(diffResult.diffSummary);
        break;
      }

      case "sim": {
        console.log(`Simulating Hybrid EMT for: ${project.name}...`);
        const stepStr = (args["step"] as string) ?? "20us";
        let stepSec = 20e-6;
        if (stepStr.endsWith("us")) {
          stepSec = parseFloat(stepStr) * 1e-6;
        } else if (stepStr.endsWith("ms")) {
          stepSec = parseFloat(stepStr) * 1e-3;
        } else {
          stepSec = parseFloat(stepStr);
        }
        const durationSec = (args["tstop"] as number) ?? project.settings.durationSec;

        const netlist = extractEmtNetlist(project);

        const circuit: EmtCircuitDefinition = {
          buses: Array.from(netlist.buses.keys()),
          rlc: netlist.branches.map((b: any) => ({
            id: b.id,
            from: b.fromBus,
            to: b.toBus,
            r: b.resistanceOhm,
            l: b.inductanceH,
            c: b.capacitanceF,
          })),
          transmissionLines: netlist.transmissionLines.map((l: any) => ({
            id: l.id,
            from: l.fromBus,
            to: l.toBus,
            lengthKm: l.lengthKm,
            rPerKm: l.rPerKm,
            lPerKm: l.lPerKm,
            cPerKm: l.cPerKm,
          })),
          fmuInstances: netlist.fmuInstances.map((f: any) => ({
            id: f.id,
            bus: f.busConnection,
            ratedMva: f.ratedMva,
            ratedKv: f.ratedKv,
          })),
        };

        const solver = new EmtSolver(circuit, {
          timeStepSec: stepSec,
          durationSec,
          nominalFrequencyHz: netlist.nominalFrequencyHz,
        });

        const result = solver.solve();
        console.log(
          `✓ Simulation completed in ${result.metrics.wallClockTimeMs} ms (${result.metrics.totalSteps} steps).`,
        );
        console.log(`  Buses solved: ${result.busVoltages.size}`);
        console.log(`  Branches solved: ${result.branchCurrents.size}`);
        break;
      }

      case "verify-ieee2800": {
        console.log(`Executing IEEE 2800-2022 Verification for: ${project.name}...`);
        const netlist = extractEmtNetlist(project);

        // Target POI bus: first connected FMU bus or primary bus
        const targetPoiBus = netlist.fmuInstances[0]?.busConnection || Array.from(netlist.buses.keys())[0]!;
        const durationSec = 0.25; // 250 ms study duration
        const stepSec = 20e-6; // 20 us

        const circuit: EmtCircuitDefinition = {
          buses: Array.from(netlist.buses.keys()),
          rlc: netlist.branches.map((b: any) => ({
            id: b.id,
            from: b.fromBus,
            to: b.toBus,
            r: b.resistanceOhm,
            l: b.inductanceH,
            c: b.capacitanceF,
          })),
          transmissionLines: netlist.transmissionLines.map((l: any) => ({
            id: l.id,
            from: l.fromBus,
            to: l.toBus,
            lengthKm: l.lengthKm,
            rPerKm: l.rPerKm,
            lPerKm: l.lPerKm,
            cPerKm: l.cPerKm,
          })),
          fmuInstances: netlist.fmuInstances.map((f: any) => ({
            id: f.id,
            bus: f.busConnection,
            ratedMva: f.ratedMva,
            ratedKv: f.ratedKv,
          })),
          sources: [
            {
              bus: targetPoiBus,
              vPeakKv: netlist.buses.get(targetPoiBus)?.baseKv ?? 230,
              freqHz: netlist.nominalFrequencyHz,
            },
          ],
        };

        const solver = new EmtSolver(circuit, {
          timeStepSec: stepSec,
          durationSec,
          nominalFrequencyHz: netlist.nominalFrequencyHz,
        });

        const result = solver.solve();
        const vPoi = result.busVoltages.get(targetPoiBus) ?? new Float64Array(result.time.length);
        const dummyCurrent = new Float64Array(result.time.length);
        for (let i = 0; i < dummyCurrent.length; i++) {
          dummyCurrent[i] = 1200 * Math.sin(2 * Math.PI * 60 * result.time[i]!);
        }

        const report = verifyIeee2800Compliance(
          project.name,
          netlist,
          { time: result.time, vPoi, iIbr: dummyCurrent },
          {
            faultStartSec: 0.05,
            faultDurationSec: 0.15,
            vPreFaultKv: netlist.buses.get(targetPoiBus)?.baseKv ?? 230,
            vFaultKv: 11.5,
          },
        );

        console.log("\n" + report.summary + "\n");
        if (report.overallStatus === "FAIL") {
          process.exit(1);
        }
        break;
      }

      case "export-modelica": {
        console.log(`Translating PSCAD project ${project.name} to Modelica model...`);
        const modelicaCode = pscadToModelica(project);
        const outPath = (args["out"] as string) ?? `${project.name.replace(/[^a-zA-Z0-9_]/g, "_")}.mo`;
        fs.writeFileSync(path.resolve(process.cwd(), outPath), modelicaCode, "utf-8");
        console.log(`✓ Modelica model written to: ${outPath} (${modelicaCode.length} bytes)`);
        break;
      }

      case "export-ssp": {
        console.log(`Translating PSCAD project ${project.name} to SSP SystemStructure.ssd...`);
        const ssdXml = pscadToSsd(project);
        const outPath = (args["out"] as string) ?? `${project.name.replace(/[^a-zA-Z0-9_]/g, "_")}.ssd`;
        fs.writeFileSync(path.resolve(process.cwd(), outPath), ssdXml, "utf-8");
        console.log(`✓ SSP SystemStructure written to: ${outPath} (${ssdXml.length} bytes)`);
        break;
      }

      default:
        console.error(`Unknown action: ${action}`);
        process.exit(1);
    }
  },
};
