// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OpenSCENARIO Subcommand.
 *
 * Provides headless CLI operations for ASAM OpenSCENARIO autonomous driving scenarios (.xosc, .osc):
 * - `msx openscenario inspect <file>`
 * - `msx openscenario lint <file>`
 * - `msx openscenario simulate <file>`
 * - `msx openscenario to-dae <file>`
 * - `msx openscenario to-modelica <file>`
 */

import {
  lintOpenScenario,
  lowerOpenScenarioToDae,
  openScenarioToModelica,
  parseOpenScenario,
  simulateScenario,
} from "@modelscript/openscenario";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpenScenarioCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "openscenario <action> [files...]",
  describe: "Inspect, lint, simulate, and lower ASAM OpenSCENARIO scenario files (.xosc, .osc)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, simulate, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "simulate", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "OpenSCENARIO scenario file(s) (.xosc, .osc) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("duration", {
        alias: "d",
        description: "Simulation duration in seconds (default: 10.0)",
        type: "number",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const duration = argv["duration"] as number | undefined;

    if (files.length === 0) {
      console.error("[openscenario] No OpenSCENARIO file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[openscenario] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const doc = parseOpenScenario(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== OpenSCENARIO Summary: ${path.basename(file)} ===`);
          console.log(`Description:    ${doc.header.description || "N/A"}`);
          console.log(`Version:        ASAM OpenSCENARIO v${doc.header.revMajor}.${doc.header.revMinor}`);
          console.log(`Author:         ${doc.header.author || "N/A"}`);
          console.log(`Entities:       ${doc.entities.size}`);
          for (const ent of doc.entities.values()) {
            console.log(
              `  - ${ent.name} (${ent.isEgo ? "Ego " : ""}${ent.objectType}) [max speed: ${ent.performance?.maxSpeed ?? 50} m/s]`,
            );
          }
          console.log(`Init Actions:   ${doc.initActions.length}`);
          console.log(`Stories:        ${doc.stories.length}`);
          for (const s of doc.stories) {
            console.log(`  Story '${s.name}': ${s.acts.length} acts`);
            for (const a of s.acts) {
              console.log(`    Act '${a.name}': ${a.maneuverGroups.length} maneuver groups`);
            }
          }
          break;
        }

        case "lint": {
          const diags = lintOpenScenario(doc);
          if (diags.length === 0) {
            console.log(`[openscenario] Clean scenario: 0 diagnostics in ${path.basename(file)}.`);
          } else {
            console.log(`[openscenario] Found ${diags.length} diagnostic(s) in ${path.basename(file)}:`);
            for (const d of diags) {
              const loc = d.range ? `:${d.range.startLine}:${d.range.startColumn}` : "";
              console.log(`  [${file}${loc}] ${d.severity.toUpperCase()}: [M${d.code}] ${d.message}`);
            }
            if (diags.some((d) => d.severity === "error")) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "simulate": {
          const simRes = simulateScenario(doc, { duration });
          console.log(`\n=== OpenSCENARIO Simulation: ${path.basename(file)} ===`);
          console.log(`Duration:         ${simRes.totalDuration.toFixed(1)} s (${simRes.stepsCount} steps)`);
          console.log(`Minimum TTC:      ${simRes.minTtc.toFixed(2)} s`);
          console.log(`Minimum Distance: ${simRes.minDistance.toFixed(2)} m`);
          console.log(`Collision State:  ${simRes.hasCollision ? "VIOLATION (Collision)" : "SAFE (No Collision)"}`);
          console.log(`Safety Warnings:  ${simRes.violations.length}`);
          if (simRes.violations.length > 0) {
            for (const v of simRes.violations) {
              console.log(`  - [${v.kind}] t=${v.time.toFixed(1)}s: ${v.description}`);
            }
          }
          console.log("Final Actor Positions:");
          for (const [name, state] of Object.entries(simRes.finalStates)) {
            console.log(
              `  - ${name}: x=${state.x.toFixed(1)}m, speed=${state.speed.toFixed(1)}m/s, lane=${state.lane}`,
            );
          }
          break;
        }

        case "to-dae": {
          const dae = lowerOpenScenarioToDae(doc);
          console.log(`\n=== OpenSCENARIO DAE Lowering: ${path.basename(file)} ===`);
          console.log(`Arena Variables:  ${dae.variables().length}`);
          console.log(`Arena Equations:  ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const modelName = path.basename(file, path.extname(file));
          const moCode = openScenarioToModelica(doc, modelName);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[openscenario] Exported Modelica model to ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }
      }
    }
  },
};
