// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: SINTEF Ocean SIMO / RIFLEX Subcommand.
 *
 * Provides headless CLI operations for offshore marine & slender dynamic models (.inp, .sima, .hyd):
 * - `msx sima lint <path>`
 * - `msx sima verify <path> [--consequence-class=2]`
 * - `msx sima summary <path>`
 * - `msx sima to-modelica <path> [--out=Platform.mo]`
 * - `msx sima to-ssp <path> [--out=SystemStructure.ssd]`
 */

import {
  evaluateOffsetLimits,
  lintSimaProject,
  parseSimaFile,
  simaToDae,
  simaToModelica,
  simaToSsp,
  simaToSysml2,
  verifyDnvMooringCompliance,
  type FairleadPoint,
  type SimaDiagnostic,
} from "@modelscript/sima";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SimaCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "sima <action> [files...]",
  describe: "Inspect, lint, verify, and project SINTEF Ocean SIMO / RIFLEX offshore models (.inp, .sima, .hyd)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (lint, verify, summary, inspect, offset, to-modelica, to-ssp, to-sysml2, to-dae)",
        type: "string",
        choices: ["lint", "verify", "summary", "inspect", "offset", "to-modelica", "to-ssp", "to-sysml2", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "SIMO/RIFLEX input deck or .sima file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (for code generation or exported manifests)",
        type: "string",
      })
      .option("consequence-class", {
        description: "DNV consequence class (1 or 2, default: 2)",
        type: "number",
        default: 2,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) || [];
    const out = argv["out"] as string | undefined;
    const consequenceClass = ((argv["consequence-class"] as number) === 1 ? 1 : 2) as 1 | 2;

    if (files.length === 0) {
      console.error("Error: At least one input file must be specified.");
      process.exitCode = 1;
      return;
    }

    for (const file of files) {
      const resolvedPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exitCode = 1;
        continue;
      }

      const text = fs.readFileSync(resolvedPath, "utf-8");
      const model = parseSimaFile(text, resolvedPath);

      switch (action) {
        case "lint": {
          const diags = lintSimaProject(model);
          const errors = diags.filter((d: SimaDiagnostic) => d.severity === "error");
          const warnings = diags.filter((d: SimaDiagnostic) => d.severity === "warning");

          console.log(`\nLinting ${path.basename(file)}:`);
          if (diags.length === 0) {
            console.log("  ✓ No errors or warnings found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "ERROR" : "WARNING";
              console.log(`  [${d.id}] ${tag}: ${d.message}`);
            }
            console.log(`\nSummary: ${errors.length} error(s), ${warnings.length} warning(s)`);
            if (errors.length > 0) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "verify": {
          const report = verifyDnvMooringCompliance(model, consequenceClass);
          console.log(`\nDNV-OS-E301 / DNV-ST-0119 Compliance Report: ${path.basename(file)}`);
          console.log(
            `Consequence Class: ${consequenceClass} (Required SF Intact >= ${consequenceClass === 2 ? "1.67" : "1.50"})`,
          );
          console.log(`--------------------------------------------------------------------------------`);
          console.log(`Line ID             MBL (kN)   T_intact (kN)  SF_intact  SF_damaged  Uplift  Status`);
          console.log(`--------------------------------------------------------------------------------`);
          for (const l of report.lines) {
            const mblKn = (l.mbl / 1000).toFixed(0).padStart(8);
            const tintKn = (l.tensionIntact / 1000).toFixed(1).padStart(12);
            const sfInt = l.safetyFactorIntact.toFixed(2).padStart(9);
            const sfDam = l.safetyFactorDamaged.toFixed(2).padStart(10);
            const upDeg = `${l.anchorUpliftDeg.toFixed(1)}°`.padStart(7);
            const stat = l.passedIntact && l.passedDamaged && l.anchorUpliftPassed ? "PASS" : "FAIL";
            console.log(`${l.lineId.padEnd(18)}  ${mblKn}  ${tintKn}  ${sfInt}  ${sfDam}  ${upDeg}   ${stat}`);
          }
          console.log(`--------------------------------------------------------------------------------`);
          console.log(
            `Overall: ${report.summary.allPassed ? "ALL LINES COMPLY WITH DNV" : "NON-COMPLIANT LINES DETECTED"}`,
          );
          if (!report.summary.allPassed) {
            process.exitCode = 1;
          }
          break;
        }

        case "inspect":
        case "summary": {
          console.log(`\nSINTEF Ocean SIMO/RIFLEX Model: ${model.title}`);
          console.log(
            `Water Depth: ${model.environment.waterDepth} m | Water Density: ${model.environment.waterDensity} kg/m³`,
          );
          console.log(
            `Waves: Hs = ${model.environment.wave.hs} m, Tp = ${model.environment.wave.tp} s (${model.environment.wave.spectrum})`,
          );
          console.log(
            `Wind: ${model.environment.wind.speed} m/s | Current: ${model.environment.current.surfaceSpeed} m/s`,
          );
          console.log(`\nVessels (${model.vessels.length}):`);
          for (const v of model.vessels) {
            console.log(
              `  - ${v.name} (${v.id}): Mass = ${(v.mass / 1000).toFixed(0)} t, Disp = ${v.displacement.toFixed(0)} m³, GMt = ${v.gmTransverse} m, GMl = ${v.gmLongitudinal} m`,
            );
            console.log(
              `    Fairleads (${v.fairleads.length}): ${v.fairleads.map((f: FairleadPoint) => f.name).join(", ")}`,
            );
          }
          console.log(`\nMooring Lines (${model.lines.length}):`);
          for (const l of model.lines) {
            console.log(
              `  - ${l.name} (${l.type}): Length = ${l.totalLength} m, Fairlead = ${l.fairleadId}, Anchor = [${l.anchorPosition.join(", ")}]`,
            );
            for (const s of l.segments) {
              console.log(
                `      Segment ${s.name}: Length = ${s.length} m, Diam = ${s.diameter} m, MBL = ${(s.mbl / 1000).toFixed(0)} kN`,
              );
            }
          }
          break;
        }

        case "to-dae": {
          console.log(`[sima] Lowering ${path.basename(file)} to linear-memory DAE arena...`);
          const dae = simaToDae(model);
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
          const className = path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_]/g, "_");
          const code = simaToModelica(model, className);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, code, "utf-8");
            console.log(`Wrote Modelica model to ${out}`);
          } else {
            console.log(code);
          }
          break;
        }

        case "offset": {
          const rep = evaluateOffsetLimits(model);
          console.log(`\nVessel Watch Circle & Offset Report: ${rep.vesselName}`);
          console.log(
            `Water Depth: ${rep.waterDepth} m | Watch Circle Limit: ${rep.watchCircleRadiusMeters.toFixed(1)} m`,
          );
          console.log(
            `Mean Offset: ${rep.meanOffsetMeters.total.toFixed(2)} m (X: ${rep.meanOffsetMeters.x.toFixed(2)} m, Y: ${rep.meanOffsetMeters.y.toFixed(2)} m)`,
          );
          console.log(
            `Excursion Utilization: ${(rep.excursionUtilization * 100).toFixed(1)}% [${rep.excursionPassed ? "PASS" : "FAIL"}]`,
          );
          console.log(`Lines:`);
          for (const l of rep.lines) {
            console.log(
              `  - ${l.lineName}: Fairlead Angle = ${l.fairleadAngleDeg.toFixed(1)}°, Grounded = ${l.touchdownDistanceToAnchor.toFixed(1)} m, Anchor Uplift = ${l.anchorUpliftDeg}° [${l.touchdownPassed ? "PASS" : "FAIL"}]`,
            );
          }
          break;
        }

        case "to-ssp": {
          const ssd = simaToSsp(model);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), ssd, "utf-8");
            console.log(`Wrote SystemStructure.ssd to ${out}`);
          } else {
            console.log(ssd);
          }
          break;
        }

        case "to-sysml2": {
          const sysml = simaToSysml2(model);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), sysml, "utf-8");
            console.log(`Wrote SysML v2 model to ${out}`);
          } else {
            console.log(sysml);
          }
          break;
        }
      }
    }
  },
};
