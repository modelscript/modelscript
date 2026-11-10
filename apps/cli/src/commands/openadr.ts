// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OpenADR Demand Response Subcommand.
 *
 * Provides headless CLI operations for OpenADR 2.0b XML and 3.0 JSON demand response payloads (.oadr/.xml/.json):
 * - `msx openadr inspect <file>`
 * - `msx openadr lint <file>`
 * - `msx openadr curtail <file>`
 * - `msx openadr to-dae <file>`
 */

import {
  evaluateCurtailment,
  lintOpenAdr,
  lowerOpenAdrToDae,
  parseOpenAdr,
} from "@modelscript/openadr";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpenAdrCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "openadr <action> [files...]",
  describe:
    "Inspect, lint, evaluate curtailment shed, and lower OpenADR 2.0b/3.0 demand response events (.oadr, .xml, .json)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, curtail, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "curtail", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "OpenADR event or program payload(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE dump)",
        type: "string",
      })
      .option("ven", {
        description: "Target Virtual End Node (VEN) ID for curtailment evaluation",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const ven = argv["ven"] as string | undefined;

    if (files.length === 0) {
      console.error("[openadr] No OpenADR event file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[openadr] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const deck = parseOpenAdr(text);

      switch (action) {
        case "lint": {
          console.log(`[openadr] Linting ${path.basename(file)}...`);
          const diags = lintOpenAdr(deck);
          if (diags.length === 0) {
            console.log("  ✔ No demand response event or timing diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [M${d.code}] Line ${d.line ?? 1}: ${d.message}`);
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
          console.log(`=== OpenADR Demand Response Program: ${path.basename(file)} ===`);
          console.log(`  Programs:    ${deck.programs.length}`);
          for (const prog of deck.programs) {
            console.log(`    - Program '${prog.id}' (${prog.name ?? "DR"}): Events=${prog.events.length}`);
          }
          console.log(`  Total Events:${deck.events.length}`);
          for (const ev of deck.events) {
            console.log(
              `    - Event '${ev.id}' [${ev.status}]: Signal=${ev.signalType}, VEN=${ev.targetVenId ?? "all"}, Intervals=${ev.intervals.length}`,
            );
          }
          break;
        }

        case "curtail":
        case "solve": {
          const points = evaluateCurtailment(deck, ven);
          console.log(`=== OpenADR Curtailment Shed Evaluation ===`);
          console.log(`  Target VEN:          ${ven ?? "all"}`);
          console.log(`  Schedule Intervals:  ${points.length}`);
          for (const pt of points) {
            console.log(
              `    - T=${pt.timeSeconds}s: Active Limit=${pt.activeLimitKW.toFixed(1)} kW (Type: ${pt.signalType})`,
            );
          }
          break;
        }

        case "to-dae": {
          const arena = lowerOpenAdrToDae(deck);
          console.log(`[openadr] Lowered demand response deck to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[openadr] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[openadr] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
