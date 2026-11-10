// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: GE PSLF Subcommand.
 *
 * Provides headless CLI operations for GE PSLF power flow (.epc) and dynamic (.dyd) cases:
 * - `msx pslf inspect <case.epc>`
 * - `msx pslf summary <case.epc>`
 * - `msx pslf lint <case.epc> [case.dyd]`
 * - `msx pslf solve <case.epc>`
 * - `msx pslf to-psse <case.epc> [--dyr=case.dyd] [--out=case.raw]`
 * - `msx pslf from-psse <case.raw> [--dyr=case.dyr] [--out=case.epc]`
 */

import {
  lintPslfDyd,
  lintPslfEpc,
  parsePslfDyd,
  parsePslfEpc,
  pslfDydToPsseDyr,
  pslfEpcToPsseRaw,
  psseDyrToPslfDyd,
  psseRawToPslfEpc,
  writePslfDyd,
  writePslfEpc,
  type PslfDiagnostic,
} from "@modelscript/pslf";
import { formatPowerFlowReport, parseDyr, parseRaw, serializeDyrCase, solvePowerFlow, writeRaw } from "@modelscript/psse";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const PslfCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "pslf <action> [files...]",
  describe: "Inspect, lint, solve, and convert GE PSLF power flow (.epc) and dynamic (.dyd) cases",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, solve, to-psse, from-psse)",
        type: "string",
        choices: ["inspect", "summary", "lint", "solve", "to-psse", "from-psse"],
        demandOption: true,
      })
      .positional("files", {
        description: "PSLF file(s) to process (.epc, .dyd, .raw, .dyr)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for converted .raw or .epc)",
        type: "string",
      })
      .option("dyr", {
        description: "Associated PSS/E DYR or PSLF DYD dynamics data file",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const dyrOpt = argv["dyr"] as string | undefined;

    if (files.length === 0) {
      console.error("[pslf] No input file specified. Usage: msx pslf <action> <file.epc>");
      process.exit(1);
    }

    const firstFile = files[0]!;
    const absPath = path.resolve(process.cwd(), firstFile);
    if (!fs.existsSync(absPath)) {
      console.error(`[pslf] File not found: ${absPath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(absPath, "utf-8");

    switch (action) {
      case "inspect":
      case "summary": {
        console.log(`[pslf] Inspecting GE PSLF model: ${path.basename(firstFile)}...`);
        if (firstFile.endsWith(".dyd")) {
          const dyd = parsePslfDyd(content);
          console.log(`  Dynamic Models:     ${dyd.models.length}`);
          const modelCounts = new Map<string, number>();
          for (const m of dyd.models) {
            modelCounts.set(m.modelType, (modelCounts.get(m.modelType) ?? 0) + 1);
          }
          for (const [mType, count] of modelCounts.entries()) {
            console.log(`    - ${mType.padEnd(10, " ")}: ${count}`);
          }
        } else {
          const epc = parsePslfEpc(content);
          let totalGenMw = 0;
          let totalLoadMw = 0;
          for (const g of epc.generators) if (g.status) totalGenMw += g.pgMw;
          for (const l of epc.loads) if (l.status) totalLoadMw += l.plMw;

          console.log(`  Case Title:         ${epc.title1}`);
          console.log(`  Buses:              ${epc.buses.size}`);
          console.log(`  Generators:         ${epc.generators.length} (Dispatched: ${totalGenMw.toFixed(1)} MW)`);
          console.log(`  Loads:              ${epc.loads.length} (Total Load: ${totalLoadMw.toFixed(1)} MW)`);
          console.log(`  Transmission Lines: ${epc.branches.length}`);
          console.log(`  Transformers:       ${epc.transformers.length}`);
          console.log(`  Shunts:             ${epc.shunts.length}`);
          console.log(`  Areas:              ${epc.areas.length}`);
        }
        break;
      }

      case "lint": {
        console.log(`[pslf] Linting GE PSLF case: ${path.basename(firstFile)}...`);
        if (firstFile.endsWith(".dyd")) {
          const dyd = parsePslfDyd(content);
          const diags = lintPslfDyd(dyd);
          if (diags.length === 0) {
            console.log("  ✔ No dynamic model errors or invalid parameters found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : "▲ WARN";
              console.log(`  ${tag} [${d.code}] ${d.element ? `(${d.element}) ` : ""}${d.message}`);
            }
          }
        } else {
          const epc = parsePslfEpc(content);
          const diags = lintPslfEpc(epc);
          if (files[1] && fs.existsSync(path.resolve(process.cwd(), files[1]))) {
            const dyd = parsePslfDyd(fs.readFileSync(path.resolve(process.cwd(), files[1]), "utf-8"));
            diags.push(...lintPslfDyd(dyd, epc));
          }
          if (diags.length === 0) {
            console.log("  ✔ No topological or data integrity diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : "▲ WARN";
              console.log(`  ${tag} [${d.code}] ${d.element ? `(${d.element}) ` : ""}${d.message}`);
            }
            if (diags.some((d: PslfDiagnostic) => d.severity === "error")) {
              process.exitCode = 1;
            }
          }
        }
        break;
      }

      case "solve": {
        console.log(`[pslf] Solving steady-state AC Power Flow for ${path.basename(firstFile)}...`);
        const epc = parsePslfEpc(content);
        const psseCase = pslfEpcToPsseRaw(epc);
        const sol = solvePowerFlow(psseCase, { algorithm: "newton_raphson" });
        console.log(`  Convergence:        ${sol.converged ? "CONVERGED" : "FAILED"}`);
        console.log(`  Iterations:         ${sol.iterations}`);
        console.log(`  Active Losses:      ${sol.totalLossMw.toFixed(3)} MW`);
        console.log(`  Reactive Losses:    ${sol.totalLossMvar.toFixed(3)} Mvar`);
        console.log("\n" + formatPowerFlowReport(sol, `GE PSLF: ${epc.title1}`));
        if (!sol.converged) {
          process.exitCode = 1;
        }
        break;
      }

      case "to-psse": {
        console.log(`[pslf] Converting GE PSLF model to PSS/E RAW & DYR...`);
        const epc = parsePslfEpc(content);
        const psseRaw = pslfEpcToPsseRaw(epc);
        const rawText = writeRaw(psseRaw);

        const outRaw = out ?? `${path.basename(firstFile, path.extname(firstFile))}.raw`;
        fs.writeFileSync(path.resolve(process.cwd(), outRaw), rawText, "utf-8");
        console.log(`  ✔ Exported PSS/E RAW power flow case to ${outRaw} (${psseRaw.buses.size} buses)`);

        const dydPath = dyrOpt ?? (files[1] && files[1].endsWith(".dyd") ? files[1] : undefined);
        if (dydPath && fs.existsSync(path.resolve(process.cwd(), dydPath))) {
          const dyd = parsePslfDyd(fs.readFileSync(path.resolve(process.cwd(), dydPath), "utf-8"));
          const psseDyr = pslfDydToPsseDyr(dyd);
          const dyrText = serializeDyrCase(psseDyr);
          const outDyr = `${path.basename(outRaw, path.extname(outRaw))}.dyr`;
          fs.writeFileSync(path.resolve(process.cwd(), outDyr), dyrText, "utf-8");
          console.log(`  ✔ Exported PSS/E DYR dynamics file to ${outDyr} (${psseDyr.records.length} records)`);
        }
        break;
      }

      case "from-psse": {
        console.log(`[pslf] Converting PSS/E RAW & DYR to GE PSLF EPC & DYD...`);
        const rawCase = parseRaw(content);
        const epc = psseRawToPslfEpc(rawCase);
        const epcText = writePslfEpc(epc);

        const outEpc = out ?? `${path.basename(firstFile, path.extname(firstFile))}.epc`;
        fs.writeFileSync(path.resolve(process.cwd(), outEpc), epcText, "utf-8");
        console.log(`  ✔ Exported GE PSLF EPC power flow case to ${outEpc} (${epc.buses.size} buses)`);

        const dyrPath = dyrOpt ?? (files[1] && files[1].endsWith(".dyr") ? files[1] : undefined);
        if (dyrPath && fs.existsSync(path.resolve(process.cwd(), dyrPath))) {
          const dyrCase = parseDyr(fs.readFileSync(path.resolve(process.cwd(), dyrPath), "utf-8"));
          const pslfDyd = psseDyrToPslfDyd(dyrCase);
          const dydText = writePslfDyd(pslfDyd);
          const outDyd = `${path.basename(outEpc, path.extname(outEpc))}.dyd`;
          fs.writeFileSync(path.resolve(process.cwd(), outDyd), dydText, "utf-8");
          console.log(`  ✔ Exported GE PSLF DYD dynamics file to ${outDyd} (${pslfDyd.models.length} models)`);
        }
        break;
      }
    }
  },
};
