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
import { parsePsseSld, renderSldSvg } from "@modelscript/diagram/psse-sld-parser";
import {
  analyzeN1Contingencies,
  analyzeSmallSignalStability,
  auditNercCompliance,
  calculateShortCircuit,
  executeIdv,
  extractPowerFlowNetlist,
  lintPsse,
  lowerPsseToDae,
  parseDyr,
  parseRaw,
  psseToModelica,
  solveContinuationPowerFlow,
  solvePowerFlow,
} from "@modelscript/psse";
import { solveAcOpf, solveDcOpf } from "@modelscript/simulate/opf";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const PsseCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "psse <action> [files...]",
  describe: "Inspect, lint, and analyze PSS/E-compatible RAW power flow cases (.raw)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (lint, summary, diagram, netlist, solve, opf, fault, modes, n1, sld, idv, verify-nerc)",
        type: "string",
        choices: [
          "inspect",
          "to-dae",
          "to-modelica",
          "lint",
          "summary",
          "diagram",
          "netlist",
          "solve",
          "opf",
          "fault",
          "modes",
          "n1",
          "cpf",
          "sld",
          "idv",
          "verify-nerc",
          "to-cgmes",
          "from-cgmes",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "PSS/E file(s) to process (.raw, .sld, .drw, .idv)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for SVG diagram or report)",
        type: "string",
      })
      .option("raw", {
        description: "Associated PSS/E RAW power flow base case file",
        type: "string",
      })
      .option("dyr", {
        description: "Associated PSS/E DYR dynamic models data file",
        type: "string",
      })
      .option("algorithm", {
        alias: "alg",
        description:
          "Power flow algorithm: 'nr' (Newton-Raphson), 'fdpf' (Fast Decoupled), or 'helm' (Holomorphic Embedding)",
        type: "string",
        choices: ["nr", "fdpf", "helm"],
        default: "nr",
      })
      .option("formulation", {
        alias: "form",
        description: "OPF formulation: 'dc' (linearized) or 'ac' (nonlinear)",
        type: "string",
        choices: ["dc", "ac"],
        default: "dc",
      })
      .option("tol", {
        description: "Convergence tolerance in p.u.",
        type: "number",
        default: 1e-4,
      })
      .option("max-iter", {
        description: "Maximum allowable power flow iterations / HELM orders",
        type: "number",
        default: 25,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const rawAlg = argv["algorithm"] as string;
    const algorithm = rawAlg === "helm" ? "helm" : rawAlg === "fdpf" ? "fast_decoupled" : "newton_raphson";
    const tolerance = (argv["tol"] as number) ?? 1e-4;
    const maxIterations = (argv["max-iter"] as number) ?? 25;

    if (files.length === 0) {
      console.error("[psse] No PSS/E or CGMES files specified.");
      process.exit(1);
    }

    if (action === "from-cgmes") {
      console.log(`[psse] Converting CGMES profile(s) to PSS/E RAW format...`);
      const { parseCgmesFiles, cgmesToPsse } = await import("@modelscript/cgmes");
      const { writeRaw } = await import("@modelscript/psse");

      const sources = files.map((f) => {
        const p = path.resolve(process.cwd(), f);
        if (!fs.existsSync(p)) {
          console.error(`[psse] File not found: ${p}`);
          process.exit(1);
        }
        return fs.readFileSync(p, "utf-8");
      });

      const cgmesModel = parseCgmesFiles(sources);
      const { psseCase } = cgmesToPsse(cgmesModel);
      const rawOutput = writeRaw(psseCase);

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        fs.writeFileSync(outPath, rawOutput, "utf-8");
        console.log(
          `  ✔ Exported PSS/E RAW base case to ${outPath} (${psseCase.buses.size} buses, ${psseCase.branches.length} branches, ${psseCase.generators.length} gens)`,
        );
      } else {
        console.log(rawOutput);
      }
      return;
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[psse] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const parsed = action === "sld" || action === "idv" ? (null as any) : parseRaw(text);

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

        case "opf": {
          const form = (argv["formulation"] as string) === "ac" ? "ac" : "dc";
          console.log(
            `[psse] Running Optimal Power Flow (${form.toUpperCase()}-OPF) dispatch & LMP analysis on ${path.basename(file)}...`,
          );
          const opfSol =
            form === "ac"
              ? solveAcOpf(parsed, { enforceThermalLimits: true, caseTitle: parsed.title1 || path.basename(file) })
              : solveDcOpf(parsed, { enforceThermalLimits: true, caseTitle: parsed.title1 || path.basename(file) });
          console.log(opfSol.reportText);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), opfSol.reportText);
          }
          break;
        }

        case "fault": {
          console.log(`[psse] Running IEC 60909 / ANSI C37 short-circuit analysis on ${path.basename(file)}...`);
          const sc = calculateShortCircuit(parsed);
          console.log(sc.reportText);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), sc.reportText);
          }
          break;
        }

        case "modes": {
          console.log(`[psse] Running small-signal stability modal analysis on ${path.basename(file)}...`);
          const modal = analyzeSmallSignalStability(parsed);
          console.log(modal.reportText);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), modal.reportText);
          }
          break;
        }

        case "n1": {
          console.log(`[psse] Running N-1 contingency security screening on ${path.basename(file)}...`);
          const n1 = analyzeN1Contingencies(parsed);
          console.log(n1.reportText);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), n1.reportText);
          }
          break;
        }

        case "cpf": {
          console.log(`[psse] Running Continuation Power Flow (CPF) P-V curve tracing on ${path.basename(file)}...`);
          const cpf = solveContinuationPowerFlow(parsed);
          console.log(cpf.reportText);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), cpf.reportText);
          }
          break;
        }

        case "sld": {
          console.log(`[psse] Ingesting PSS/E Single-Line Diagram (.sld/.drw): ${path.basename(file)}...`);
          const drawing = parsePsseSld(text);
          console.log(`  Title:      ${drawing.title}`);
          console.log(`  Buses:      ${drawing.buses.size} busbars mapped`);
          console.log(`  Branches:   ${drawing.branches.length} transmission lines`);
          console.log(`  Equipment:  ${drawing.components.length} equipment glyphs`);
          console.log(`  Labels:     ${drawing.annotations.length} annotations`);

          const rawOpt = argv["raw"] as string | undefined;
          let rawCase = undefined;
          if (rawOpt) {
            const rawAbs = path.resolve(process.cwd(), rawOpt);
            if (fs.existsSync(rawAbs)) {
              rawCase = parseRaw(fs.readFileSync(rawAbs, "utf-8"));
              console.log(`  Linked to RAW base case: ${path.basename(rawOpt)}`);
            }
          }

          const svg = renderSldSvg(drawing, rawCase);
          const outPath = out || `${path.basename(file, path.extname(file))}.svg`;
          fs.writeFileSync(path.resolve(process.cwd(), outPath), svg, "utf-8");
          console.log(`  ✔ Rendered standalone SVG diagram to ${outPath}`);
          break;
        }

        case "idv": {
          console.log(`[psse] Executing PSS/E .idv macro script: ${path.basename(file)}...`);
          const rawOpt = argv["raw"] as string | undefined;
          let initialCase = undefined;
          if (rawOpt) {
            const rawAbs = path.resolve(process.cwd(), rawOpt);
            if (fs.existsSync(rawAbs)) {
              initialCase = parseRaw(fs.readFileSync(rawAbs, "utf-8"));
            }
          }

          const result = executeIdv(text, undefined, { initialCase });
          console.log(`  Executed: ${result.commandsExecuted} / ${result.totalCommands} commands.`);
          for (const l of result.logs) {
            console.log(`  ℹ ${l}`);
          }
          if (result.errors.length > 0) {
            for (const e of result.errors) {
              console.error(`  ✖ ${e}`);
            }
            process.exitCode = 1;
          } else {
            console.log(`  ✔ All IDV batch commands completed successfully.`);
          }
          if (out) {
            const outText = result.logs.concat(result.errors).join("\n");
            fs.writeFileSync(path.resolve(process.cwd(), out), outText, "utf-8");
          }
          break;
        }

        case "verify-nerc": {
          console.log(`[psse] Running automated NERC compliance audit on ${path.basename(file)}...`);
          const dyrOpt = argv["dyr"] as string | undefined;
          if (dyrOpt) {
            const dyrAbs = path.resolve(process.cwd(), dyrOpt);
            if (fs.existsSync(dyrAbs)) {
              parsed.dyr = parseDyr(fs.readFileSync(dyrAbs, "utf-8"));
              console.log(`  Attached dynamic models from: ${path.basename(dyrOpt)}`);
            }
          }

          const report = auditNercCompliance(parsed, {
            caseTitle: parsed.title1 || path.basename(file),
          });
          console.log(report.markdownReport);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), report.markdownReport, "utf-8");
            console.log(`  ✔ Exported compliance report to ${out}`);
          }
          if (report.overallStatus === "NON-COMPLIANT") {
            process.exitCode = 1;
          }
          break;
        }

        case "to-cgmes": {
          console.log(`[psse] Converting ${path.basename(file)} to ENTSO-E CGMES (CIM / IEC 61970-301)...`);
          const { psseToCgmes, exportCgmesArchive } = await import("@modelscript/cgmes");
          const { model } = psseToCgmes(parsed);
          const archive = exportCgmesArchive(model);

          const outDir = out ? path.resolve(process.cwd(), out) : path.dirname(absPath);
          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
          }

          const baseName = path.basename(file, path.extname(file));
          const eqPath = path.join(outDir, `${baseName}_EQ.xml`);
          const tpPath = path.join(outDir, `${baseName}_TP.xml`);
          const sshPath = path.join(outDir, `${baseName}_SSH.xml`);
          const svPath = path.join(outDir, `${baseName}_SV.xml`);

          fs.writeFileSync(eqPath, archive.eqXml, "utf-8");
          fs.writeFileSync(tpPath, archive.tpXml, "utf-8");
          fs.writeFileSync(sshPath, archive.sshXml, "utf-8");
          fs.writeFileSync(svPath, archive.svXml, "utf-8");

          console.log(`  ✔ Exported CGMES profiles to ${outDir}:`);
          console.log(
            `    - Equipment (EQ): ${path.basename(eqPath)} (${model.lines.size} lines, ${model.transformers.size} xfmrs, ${model.generators.size} gens)`,
          );
          console.log(`    - Topology (TP): ${path.basename(tpPath)} (${model.nodes.size} topological nodes)`);
          console.log(`    - Steady State Hypothesis (SSH): ${path.basename(sshPath)}`);
          console.log(`    - State Variables (SV): ${path.basename(svPath)} (${model.svVoltages.size} node voltages)`);
          break;
        }
      }
    }
  },
};
