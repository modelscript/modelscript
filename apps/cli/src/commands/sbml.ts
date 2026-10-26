// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: SBML Subcommand.
 *
 * Provides headless CLI operations for Systems Biology Markup Language (.sbml, .xml):
 * - `msx sbml inspect <file>`
 * - `msx sbml lint <file>`
 * - `msx sbml simulate <file>`
 * - `msx sbml to-dae <file>`
 * - `msx sbml to-modelica <file>`
 */

import { lintSbml, lowerSbmlToDae, parseSbml, sbmlToModelica, solveReactions } from "@modelscript/sbml";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SbmlCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "sbml <action> [files...]",
  describe: "Inspect, lint, simulate biochemical networks, and lower SBML models (.sbml, .xml)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, simulate, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "simulate", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "SBML file(s) (.sbml, .xml) to process",
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
      console.error("[sbml] No SBML file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[sbml] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const doc = parseSbml(content, path.basename(absPath));
      const model = doc.model;

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== SBML Model Summary: ${path.basename(file)} ===`);
          console.log(`Model ID:       ${model.id}`);
          console.log(`Model Name:     ${model.name || "(unnamed)"}`);
          console.log(`SBML Version:   Level ${doc.level} Version ${doc.version}`);
          console.log(`Compartments:   ${model.compartments.size}`);
          for (const [id, c] of model.compartments) {
            console.log(`  - ${id} (size=${c.size}, dim=${c.spatialDimensions})`);
          }
          console.log(`Species:        ${model.species.size}`);
          for (const [id, s] of model.species) {
            const qty = s.initialConcentration ?? s.initialAmount ?? 0;
            console.log(`  - ${id} in [${s.compartment}] (init=${qty})`);
          }
          console.log(`Parameters:     ${model.parameters.size}`);
          console.log(`Reactions:      ${model.reactions.size}`);
          for (const [id, r] of model.reactions) {
            const arrow = r.reversible ? "<=>" : "=>";
            const react = r.reactants.map((ref) => ref.species).join(" + ");
            const prod = r.products.map((ref) => ref.species).join(" + ");
            console.log(`  - ${id}: ${react} ${arrow} ${prod}`);
          }
          break;
        }

        case "lint": {
          const diagnostics = lintSbml(doc);
          if (diagnostics.length === 0) {
            console.log(`[sbml] ✓ ${path.basename(file)} passed all pre-flight checks (0 diagnostics).`);
          } else {
            console.log(`[sbml] Found ${diagnostics.length} diagnostic(s) in ${path.basename(file)}:`);
            for (const d of diagnostics) {
              const prefix = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
              console.log(`  [M${d.code}] ${prefix} (${d.rule}): ${d.message}`);
            }
          }
          break;
        }

        case "simulate": {
          const res = solveReactions(doc, { duration: duration ?? 10.0 });
          console.log(`\n=== Biochemical Simulation Results: ${path.basename(file)} ===`);
          console.log(`Model:               ${res.modelId}`);
          console.log(`Time Steps Solved:   ${res.stepsCount}`);
          console.log(`Species Concentrations:`);
          for (const s of res.speciesNames) {
            const initVal = res.initialConcentrations[s] ?? 0;
            const finalVal = res.finalConcentrations[s] ?? 0;
            console.log(`  - [${s}]: ${initVal.toExponential(3)} -> ${finalVal.toExponential(3)} mol/L`);
          }
          break;
        }

        case "to-dae": {
          const dae = lowerSbmlToDae(doc);
          console.log(`\n=== Lowered DAE Summary: ${path.basename(file)} ===`);
          console.log(`Variables:           ${dae.variables().length}`);
          console.log(`Equations:           ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const modelName = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_]/g, "_");
          const moCode = sbmlToModelica(doc, modelName);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[sbml] Modelica model written to: ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        default:
          console.error(`[sbml] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
