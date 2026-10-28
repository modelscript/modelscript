// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Touchstone Subcommand.
 *
 * Provides headless CLI operations for Touchstone N-port scattering/admittance networks (.s1p ... .sNp, .ts):
 * - `msx touchstone inspect <file>`
 * - `msx touchstone lint <file>`
 * - `msx touchstone passivity <file>`
 * - `msx touchstone to-dae <file>`
 * - `msx touchstone to-modelica <file>`
 * - `msx touchstone fit <file>`
 */

import {
  fitStateSpaceModel,
  lintTouchstone,
  lowerTouchstoneToDae,
  parseTouchstone,
  touchstoneToModelica,
  verifyPassivity,
} from "@modelscript/touchstone";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const TouchstoneCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "touchstone <action> [files...]",
  describe: "Inspect, lint, verify passivity, and lower Touchstone N-Port models (.s1p ... .sNp, .ts)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, passivity, to-dae, to-modelica, fit)",
        type: "string",
        choices: ["inspect", "summary", "lint", "passivity", "to-dae", "to-modelica", "fit"],
        demandOption: true,
      })
      .positional("files", {
        description: "Touchstone file(s) (.s1p ... .sNp, .ts) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("order", {
        description: "Rational macromodel order for vector fitting",
        type: "number",
        default: 2,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const order = (argv["order"] as number) ?? 2;

    if (files.length === 0) {
      console.error("[touchstone] No Touchstone file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[touchstone] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const deck = parseTouchstone(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== Touchstone Network Summary: ${path.basename(file)} ===`);
          console.log(`Specification: Touchstone v${deck.version}`);
          console.log(`Port Count:    ${deck.numPorts}`);
          console.log(`Parameter:     ${deck.options.parameterType} (Scattering)`);
          console.log(`Format:        ${deck.options.format}`);
          console.log(`Ref Impedance: ${deck.options.referenceResistance} Ω`);
          console.log(`Frequencies:   ${deck.points.length} points (${deck.options.frequencyUnit})`);
          if (deck.points.length > 0) {
            const pFirst = deck.points[0]!;
            const pLast = deck.points[deck.points.length - 1]!;
            console.log(`Frequency Range: ${pFirst.frequency} to ${pLast.frequency} ${deck.options.frequencyUnit}`);
          }
          break;
        }

        case "lint": {
          const diags = lintTouchstone(deck);
          console.log(`\n=== Touchstone Lint Results: ${path.basename(file)} ===`);
          if (diags.length === 0) {
            console.log("✓ No issues detected (0 diagnostics).");
          } else {
            for (const d of diags) {
              const prefix = d.severity === "error" ? "ERROR" : "WARNING";
              console.log(`[${prefix}] [M${d.code}] Line ${d.range.startLine}: ${d.message}`);
            }
          }
          break;
        }

        case "passivity": {
          const report = verifyPassivity(deck);
          console.log(`\n=== Touchstone Passivity Report: ${path.basename(file)} ===`);
          console.log(`Passivity Status: ${report.isPassive ? "✓ PASSIVE" : "⚠ NON-PASSIVE"}`);
          console.log(`Max Spectral Norm ||S||_2: ${report.maxNorm.toFixed(4)}`);
          console.log(`Worst Frequency: ${(report.worstFrequencyHz / 1e9).toFixed(3)} GHz`);
          if (!report.isPassive) {
            console.log(`Passivity Violations Count: ${report.violations.length}`);
            for (const v of report.violations.slice(0, 5)) {
              console.log(
                `  Line ${v.line}: ${(v.frequencyHz / 1e9).toFixed(3)} GHz -> ||S|| = ${v.norm.toFixed(4)} > 1.0`,
              );
            }
            if (report.violations.length > 5) {
              console.log(`  ... and ${report.violations.length - 5} more points.`);
            }
          }
          break;
        }

        case "to-dae": {
          const dae = lowerTouchstoneToDae(deck, { macromodelOrder: order });
          console.log(`\n=== Touchstone DAE Lowering: ${path.basename(file)} ===`);
          console.log(`Model Name:      NPortMacromodel`);
          console.log(`Macromodel Order: ${order}`);
          console.log(`DAE Variables:   ${dae.variables().length}`);
          console.log(`DAE Equations:   ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = touchstoneToModelica(deck);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[touchstone] Exported Modelica model to ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "fit": {
          const ss = fitStateSpaceModel(deck, order);
          console.log(`\n=== Vector Fitting State Space Model: ${path.basename(file)} ===`);
          console.log(`Order:      ${ss.order}`);
          console.log(`Ports:      ${ss.numPorts}`);
          console.log(`States (M): ${ss.A.length}`);
          console.log(`Stable Poles Count: ${ss.poles.length}`);
          for (let k = 0; k < ss.poles.length; k++) {
            const p = ss.poles[k]!;
            console.log(`  Pole ${k + 1}: ${p.re.toExponential(3)} + ${p.im.toExponential(3)}j rad/s`);
          }
          break;
        }

        default:
          console.error(`[touchstone] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
