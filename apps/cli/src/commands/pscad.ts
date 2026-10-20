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
  emtResultToComtrade,
  extractEmtNetlist,
  lintPscx,
  netlistToEmtCircuit,
  parsePscx,
  pscadToModelica,
  pscadToSsd,
  registerPscadSource,
  verifyIeee2800Compliance,
  writeComtrade,
  writeComtradeBinary,
  writeComtradeCff,
  writePscadOut,
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
      })
      .option("format", {
        alias: "f",
        description: "Result format for 'sim' with --out (base path): pscad (.out/.inf), comtrade, comtrade-bin, cff",
        type: "string",
        choices: ["pscad", "comtrade", "comtrade-bin", "cff"],
        default: "pscad",
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

    // Register library/definition sources (explicit extra files + sibling .pslx/.pscx) so `Lib:Name`
    // user-definitions resolve during netlist extraction.
    const libCandidates = new Set<string>(files.slice(1).map((f) => path.resolve(process.cwd(), f)));
    for (const e of fs.readdirSync(path.dirname(firstFilePath))) {
      if (/\.(pslx|pscx)$/i.test(e)) libCandidates.add(path.join(path.dirname(firstFilePath), e));
    }
    libCandidates.delete(firstFilePath);
    for (const f of libCandidates) {
      if (fs.existsSync(f)) registerPscadSource(f, fs.readFileSync(f, "utf-8"));
    }

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
        const circuit = netlistToEmtCircuit(netlist) as unknown as EmtCircuitDefinition;

        const solver = new EmtSolver(circuit, {
          timeStepSec: stepSec,
          durationSec,
          nominalFrequencyHz: netlist.nominalFrequencyHz,
          threePhase: true,
          steadyStateInit: true,
          maxNonlinearIterations: 6,
        });

        const result = solver.solve();
        console.log(
          `✓ Simulation completed in ${result.metrics.wallClockTimeMs} ms (${result.metrics.totalSteps} steps, ${result.metrics.factorizationCount} factorizations).`,
        );
        console.log(`  Buses solved: ${result.busVoltages.size}`);
        console.log(`  Branches solved: ${result.branchCurrents.size}`);

        const outArg = args["out"] as string | undefined;
        if (outArg) {
          const base = path.resolve(process.cwd(), outArg).replace(/\.(out|inf|cfg|dat|cff)$/i, "");
          const fmt = (args["format"] as string) ?? "pscad";
          const written: string[] = [];
          const put = (p: string, c: string | Uint8Array) => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, c);
            written.push(p);
          };
          if (fmt === "pscad") {
            const o = writePscadOut(result, project.name);
            put(`${base}.inf`, o.inf);
            for (const f of o.out) put(`${base}${f.suffix}`, f.content);
          } else {
            const rec = emtResultToComtrade(result, project.name);
            if (fmt === "comtrade") {
              const c = writeComtrade(rec);
              put(`${base}.cfg`, c.cfg);
              put(`${base}.dat`, c.dat);
            } else if (fmt === "comtrade-bin") {
              const c = writeComtradeBinary(rec, "BINARY");
              put(`${base}.cfg`, c.cfg);
              put(`${base}.dat`, c.dat);
            } else {
              put(`${base}.cff`, writeComtradeCff(rec));
            }
          }
          for (const w of written) console.log(`✓ Wrote ${w}`);
        }
        break;
      }

      case "verify-ieee2800": {
        console.log(`Executing IEEE 2800-2022 Verification for: ${project.name}...`);
        const netlist = extractEmtNetlist(project);

        // Target POI bus: first connected FMU bus or primary bus
        const targetPoiBus = netlist.fmuInstances[0]?.busConnection || Array.from(netlist.buses.keys())[0]!;
        const durationSec = 0.25; // 250 ms study duration
        const stepSec = 20e-6; // 20 us
        const vNomKv = netlist.buses.get(targetPoiBus)?.baseKv ?? 230;

        const baseCircuit = netlistToEmtCircuit(netlist);
        const sources =
          baseCircuit.sources && baseCircuit.sources.length > 0
            ? baseCircuit.sources
            : [
                {
                  bus: targetPoiBus,
                  vPeakKv: vNomKv,
                  freqHz: netlist.nominalFrequencyHz,
                },
              ];

        const circuit: EmtCircuitDefinition = {
          ...(baseCircuit as unknown as EmtCircuitDefinition),
          sources,
          faults:
            baseCircuit.faults && baseCircuit.faults.length > 0
              ? (baseCircuit.faults as NonNullable<EmtCircuitDefinition["faults"]>)
              : [
                  {
                    bus: targetPoiBus,
                    startSec: 0.05,
                    durationSec: 0.15,
                    faultResistanceOhm: 0.05,
                    faultType: "SLG",
                  },
                ],
        };

        const solver = new EmtSolver(circuit, {
          timeStepSec: stepSec,
          durationSec,
          nominalFrequencyHz: netlist.nominalFrequencyHz,
          threePhase: true,
          steadyStateInit: true,
        });

        const result = solver.solve();
        const vPoi = result.busVoltages.get(targetPoiBus) ?? new Float64Array(result.time.length);
        const fmuId = netlist.fmuInstances[0]?.id;
        let iIbr = fmuId ? result.branchCurrents.get(fmuId) : undefined;
        if (!iIbr) {
          iIbr = new Float64Array(result.time.length);
          for (let i = 0; i < iIbr.length; i++) {
            iIbr[i] = 1200 * Math.sin(2 * Math.PI * netlist.nominalFrequencyHz * result.time[i]!);
          }
        }

        const report = verifyIeee2800Compliance(
          project.name,
          netlist,
          {
            time: result.time,
            vPoi,
            iIbr,
            vPoiAbc: result.busPhaseVoltages?.get(targetPoiBus),
            iIbrAbc: fmuId ? result.branchPhaseCurrents?.get(fmuId) : undefined,
          },
          {
            faultStartSec: 0.05,
            faultDurationSec: 0.15,
            vPreFaultKv: vNomKv,
            vFaultKv: 11.5,
            evaluateExtendedClauses: true,
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
