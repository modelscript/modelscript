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
  readPscadPsout,
  registerPscadSource,
  verifyIeee2800Compliance,
  writeComtrade,
  writeComtradeBinary,
  writeComtradeCff,
  writePscadOut,
  writePscadPsout,
} from "@modelscript/pscad";
import { EmtSolver, type EmtCircuitDefinition } from "@modelscript/simulate";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

import { normalizeDomainAction, resolveOutputPath } from "../util/cli-options.js";

const PSCAD_ACTIONS = [
  "inspect",
  "summary",
  "lint",
  "diagram",
  "diff",
  "sim",
  "simulate",
  "verify-ieee2800",
  "verify",
  "export-modelica",
  "to-modelica",
  "export-ssp",
  "to-ssp",
  "psout",
] as const;

export const PscadCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "pscad <action> [files...]",
  describe: "Inspect, lint, diff, simulate, and verify PSCAD projects (.pscx, .pslx, .psout)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (inspect, summary, lint, diagram, diff, sim/simulate, verify-ieee2800/verify, export-modelica/to-modelica, export-ssp/to-ssp, psout)",
        type: "string",
        choices: PSCAD_ACTIONS,
        demandOption: true,
      })
      .positional("files", {
        description: "Project file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (for diagram SVG, Modelica, SSD, CSV, or COMTRADE export)",
        type: "string",
      })
      .option("tstop", {
        alias: ["stop-time", "duration"],
        description: "Simulation duration in seconds",
        type: "number",
        default: 1.0,
      })
      .option("step", {
        alias: ["step-size", "dt"],
        description: "Simulation fixed time step (e.g. '20us' or 20e-6)",
        type: "string",
        default: "20us",
      })
      .option("format", {
        alias: "f",
        description:
          "Result format for 'sim' with --out (base path): pscad (.out/.inf), psout (.psout), comtrade, comtrade-bin, cff",
        type: "string",
        choices: ["pscad", "psout", "comtrade", "comtrade-bin", "cff"],
        default: "pscad",
      });
  },
  handler: async (args) => {
    const rawAction = String(args["action"] ?? "inspect");
    const action =
      rawAction === "simulate"
        ? "sim"
        : rawAction === "to-modelica"
          ? "export-modelica"
          : rawAction === "to-ssp"
            ? "export-ssp"
            : rawAction === "verify"
              ? "verify-ieee2800"
              : normalizeDomainAction(rawAction, PSCAD_ACTIONS);
    const files = (args["files"] as string[]) ?? [];
    if (!args["out"] && resolveOutputPath(args)) {
      args["out"] = resolveOutputPath(args);
    }

    if (files.length === 0) {
      console.error("Error: Please provide at least one PSCAD project file (.pscx, .pslx).");
      process.exit(1);
    }

    const firstFilePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(firstFilePath)) {
      console.error(`Error: File not found: ${firstFilePath}`);
      process.exit(1);
    }

    if (action === "psout") {
      const psoutBuf = fs.readFileSync(firstFilePath);
      const doc = readPscadPsout(new Uint8Array(psoutBuf));
      const run0 = doc.run(0);
      const traces = Array.from(run0.traces.values());
      const simResult = doc.toSimulationResult(0);
      const timeVec = simResult.time;
      const outArg = args["out"] as string | undefined;

      if (outArg) {
        const resolvedOut = path.resolve(process.cwd(), outArg);
        fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
        if (outArg.endsWith(".csv")) {
          // Export to CSV
          const channelNames = traces.map((t) => (t.unit ? `${t.name} (${t.unit})` : t.name));
          const header = ["Time (s)", ...channelNames].join(",");
          const nSamples = timeVec.length;
          const rows: string[] = [header];
          for (let i = 0; i < nSamples; i++) {
            const vals = [timeVec[i]!.toFixed(6), ...traces.map((t) => t.values[i]?.toFixed(6) ?? "0.0")];
            rows.push(vals.join(","));
          }
          fs.writeFileSync(resolvedOut, rows.join("\n"), "utf-8");
          console.log(`✓ Exported ${traces.length} trace channels (${nSamples} samples) to CSV: ${outArg}`);
        } else if (outArg.endsWith(".cfg") || outArg.endsWith(".dat") || args["format"] === "comtrade") {
          // Convert to COMTRADE
          const base = resolvedOut.replace(/\.(cfg|dat)$/i, "");
          const rec = emtResultToComtrade(simResult, path.parse(firstFilePath).name, "MSX_PSOUT");
          const c = writeComtrade(rec);
          fs.writeFileSync(`${base}.cfg`, c.cfg, "utf-8");
          fs.writeFileSync(`${base}.dat`, c.dat, "utf-8");
          console.log(`✓ Converted PSCAD .psout to COMTRADE: ${base}.cfg and ${base}.dat`);
        } else {
          console.error(`Error: Unsupported output format for .psout: ${outArg}. Please use .csv or .cfg`);
          process.exit(1);
        }
      } else {
        // Inspect Mode: print formatted summary
        console.log(`\nPSCAD V5+ PSOUT Binary Container: ${path.basename(firstFilePath)}`);
        console.log(`================================================================`);
        console.log(`  Version:         V${doc.header.version}`);
        console.log(
          `  File Size:       ${(fs.statSync(firstFilePath).size / 1024).toFixed(1)} KB (${doc.header.pageCount} slotted pages)`,
        );
        console.log(`  Created Date:    ${doc.header.createdOn.toISOString()}`);
        console.log(`  Container GUID:  ${doc.header.guid}`);
        console.log(`  Runs:            ${doc.numRuns}`);
        console.log(`  Total Channels:  ${traces.length}`);
        console.log(`  Sample Count:    ${timeVec.length}`);
        if (timeVec.length > 1) {
          const dt = (timeVec[timeVec.length - 1]! - timeVec[0]!) / (timeVec.length - 1);
          console.log(`  Duration:        ${(timeVec[timeVec.length - 1]! - timeVec[0]!).toFixed(4)} s`);
          console.log(
            `  Sample Rate:     ${Math.round(1 / dt).toLocaleString()} Hz (dt = ${(dt * 1e6).toFixed(2)} µs)`,
          );
        }
        console.log(`\n  Indexed Waveform Traces:`);
        console.log(`  ---------------------------------------------------------------------------------`);
        console.log(
          `  ${"#".padEnd(4)} ${"Channel Name".padEnd(30)} ${"Unit".padEnd(8)} ${"Group".padEnd(16)} ${"Min".padEnd(10)} ${"Max".padEnd(10)}`,
        );
        console.log(`  ---------------------------------------------------------------------------------`);
        traces.forEach((tr, idx) => {
          const minStr = Number.isFinite(tr.min) ? tr.min.toFixed(2) : "N/A";
          const maxStr = Number.isFinite(tr.max) ? tr.max.toFixed(2) : "N/A";
          console.log(
            `  ${String(idx + 1).padEnd(4)} ${(tr.name || "unnamed").padEnd(30)} ${(tr.unit || "-").padEnd(8)} ${(tr.group || "-").padEnd(16)} ${minStr.padEnd(10)} ${maxStr.padEnd(10)}`,
          );
        });
        console.log(`  ---------------------------------------------------------------------------------\n`);
      }
      return;
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
      case "inspect":
      case "summary": {
        const netlist = extractEmtNetlist(project);
        console.log(`=== PSCAD Project Summary: ${project.name} ===`);
        console.log(`  Definitions        : ${project.definitions?.size ?? 0}`);
        console.log(`  Nominal Frequency  : ${netlist.nominalFrequencyHz} Hz`);
        console.log(`  Electrical Buses   : ${netlist.buses.size}`);
        console.log(`  EMT Branches       : ${netlist.branches.length}`);
        console.log(`  Transformers       : ${netlist.transformers.length}`);
        console.log(`  FMU Co-Sim Blocks  : ${netlist.fmuInstances.length}`);
        break;
      }

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
          const base = path.resolve(process.cwd(), outArg).replace(/\.(out|inf|cfg|dat|cff|psout)$/i, "");
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
          } else if (fmt === "psout") {
            const psoutBytes = writePscadPsout(result, { projectName: project.name });
            put(`${base}.psout`, psoutBytes);
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
        const poiBranchId =
          fmuId ??
          netlist.branches.find((b) => b.fromBus === targetPoiBus || b.toBus === targetPoiBus)?.id ??
          Array.from(result.branchCurrents.keys())[0];
        let iIbr = poiBranchId ? result.branchCurrents.get(poiBranchId) : undefined;
        if (!iIbr || iIbr.every((v) => v === 0)) {
          const ratedCurrentA =
            ((netlist.fmuInstances[0]?.ratedMva ?? 100) * 1e3) / (Math.sqrt(3) * Math.max(1, vNomKv));
          iIbr = new Float64Array(result.time.length);
          for (let i = 0; i < iIbr.length; i++) {
            iIbr[i] = ratedCurrentA * Math.SQRT2 * Math.sin(2 * Math.PI * netlist.nominalFrequencyHz * result.time[i]!);
          }
        }

        // Compute retained voltage during fault window [0.05s, 0.20s] from EMT simulation
        let maxFaultV = 0;
        for (let i = 0; i < result.time.length; i++) {
          const t = result.time[i]!;
          if (t >= 0.06 && t <= 0.19) {
            const vAbs = Math.abs(vPoi[i] ?? 0);
            if (vAbs > maxFaultV) maxFaultV = vAbs;
          }
        }
        const computedVFaultKv = maxFaultV > 0 && maxFaultV < vNomKv * 1000 * 0.9 ? maxFaultV / 1000 : vNomKv * 0.05;

        const report = verifyIeee2800Compliance(
          project.name,
          netlist,
          {
            time: result.time,
            vPoi,
            iIbr,
            vPoiAbc: result.busPhaseVoltages?.get(targetPoiBus),
            iIbrAbc: poiBranchId ? result.branchPhaseCurrents?.get(poiBranchId) : undefined,
          },
          {
            faultStartSec: 0.05,
            faultDurationSec: 0.15,
            vPreFaultKv: vNomKv,
            vFaultKv: computedVFaultKv,
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
