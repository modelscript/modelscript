// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: MATPOWER Subcommand (`msx matpower <action> [files...]`).
 *
 * Provides headless CLI operations for MATPOWER (.m) power flow cases:
 * - `msx matpower lint <files...>`: Pre-flight syntax, topological, and parameter diagnostics
 * - `msx matpower summary <files...>`: Network summary (buses, branches, generation, demand)
 * - `msx matpower solve <files...>`: Run DC/AC Optimal Power Flow or Newton-Raphson power flow
 * - `msx matpower to-psse <files...>`: Project to PSS/E RAW (.raw) transmission case
 * - `msx matpower to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import { lintMatpowerCase, lowerMatpowerToDae, matpowerToPsseRaw, parseMatpowerCase } from "@modelscript/matpower";
import { serializeRaw } from "@modelscript/psse";
import { printArenaDAE } from "@modelscript/runtime";
import { solveAcOpfAsync, solveDcOpfAsync, type GenericPowerCase } from "@modelscript/simulate/opf";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const MatpowerCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "matpower <action> [files...]",
  describe: "Inspect, lint, solve, and convert MATPOWER power network cases (.m)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, solve, to-psse, to-dae)",
        type: "string",
        choices: ["lint", "summary", "solve", "to-psse", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "MATPOWER case file(s) (.m)",
        type: "string",
        array: true,
      })
      .option("formulation", {
        type: "string",
        choices: ["dc", "ac"],
        default: "dc",
        describe: "OPF formulation for solve action: 'dc' or 'ac'",
      })
      .option("tier", {
        type: "string",
        choices: ["direct", "ampl"],
        default: "direct",
        describe: "Solver tier for solve action: 'direct' (Tier 2) or 'ampl' (Tier 1)",
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe: "Output destination path",
      });
  },
  handler: async (argv) => {
    const action = String(argv["action"] ?? "summary");
    const rawFiles = (argv["files"] as string[]) ?? [];

    if (rawFiles.length === 0) {
      console.error("Error: At least one MATPOWER (.m) file is required.");
      process.exit(1);
    }

    for (const rawFile of rawFiles) {
      const filePath = path.resolve(process.cwd(), rawFile);
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const baseName = path.basename(filePath, path.extname(filePath));
      const mpc = parseMatpowerCase(content);

      if (action === "lint") {
        const diagnostics = lintMatpowerCase(mpc);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No lint errors or warnings found.`);
        } else {
          console.log(`\nDiagnostics for ${rawFile}:`);
          for (const d of diagnostics) {
            const sev = d.severity === "error" ? "ERROR" : "WARN";
            const busInfo = d.busNumber !== undefined ? ` [Bus ${d.busNumber}]` : "";
            console.log(`  [${sev}]${busInfo} [${d.code}] ${d.message}`);
          }
        }
        continue;
      }

      if (action === "summary") {
        let totalPd = 0;
        let totalQd = 0;
        let totalPgCap = 0;
        for (const b of mpc.bus) {
          totalPd += b.pd;
          totalQd += b.qd;
        }
        for (const g of mpc.gen) {
          if (g.status !== 0) totalPgCap += g.pmax;
        }

        console.log(`\n================================================================================`);
        console.log(`                    MATPOWER NETWORK SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Base MVA:              ${mpc.baseMVA.toFixed(1)} MVA`);
        console.log(` Version:               ${mpc.version || "2"}`);
        console.log(` Buses:                 ${mpc.bus.length}`);
        console.log(` Branches / Lines:      ${mpc.branch.length}`);
        console.log(` Generators:            ${mpc.gen.length}`);
        console.log(` Generator Cost Curves: ${mpc.gencost ? mpc.gencost.length : 0}`);
        console.log(` Total Active Demand:   ${totalPd.toFixed(2)} MW`);
        console.log(` Total Reactive Demand: ${totalQd.toFixed(2)} Mvar`);
        console.log(` Total Gen Capacity:    ${totalPgCap.toFixed(2)} MW`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "to-psse") {
        const psseCase = matpowerToPsseRaw(mpc);
        const rawContent = serializeRaw(psseCase);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.raw`);
        fs.writeFileSync(outPath, rawContent, "utf-8");
        console.log(`Successfully converted ${rawFile} to PSS/E RAW:\n  ${outPath}`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerMatpowerToDae(mpc);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Saved DAE to ${outPath}`);
        } else {
          console.log(printed);
        }
        continue;
      }

      if (action === "solve") {
        const formulation = (argv["formulation"] as "dc" | "ac") || "dc";
        const tier = (argv["tier"] as "direct" | "ampl") || "direct";

        // Convert mpc to GenericPowerCase for OPF
        const busMap = new Map<number, any>();
        for (const b of mpc.bus) {
          busMap.set(b.bus_i, {
            i: b.bus_i,
            name: b.name ?? `BUS_${b.bus_i}`,
            baseKv: b.baseKv > 0 ? b.baseKv : 138.0,
            ide: b.type,
            vm: b.vm,
            va: b.va,
            vMin: b.vmin,
            vMax: b.vmax,
          });
        }
        const loads = mpc.bus
          .filter((b: any) => b.pd !== 0 || b.qd !== 0)
          .map((b: any) => ({ i: b.bus_i, pl: b.pd, ql: b.qd, status: 1 }));
        const generators = mpc.gen.map((g: any, idx: number) => ({
          i: g.bus,
          id: String(idx + 1),
          pg: g.pg,
          qg: g.qg,
          pb: g.pmin,
          pt: g.pmax,
          qb: g.qmin,
          qt: g.qmax,
          stat: g.status,
        }));
        const branches = mpc.branch.map((br: any) => ({
          i: br.fbus,
          j: br.tbus,
          ckt: "1",
          r: br.r,
          x: br.x,
          b: br.b,
          rateA: br.rateA > 0 ? br.rateA : 9999.0,
          rateB: br.rateB,
          rateC: br.rateC,
          ratio: br.ratio,
          angle: br.angle,
          st: br.status,
        }));

        const powerCase: GenericPowerCase = {
          header: { sbase: mpc.baseMVA, basfrq: 60.0 },
          title1: baseName,
          buses: busMap,
          loads,
          generators,
          branches,
        };

        const sol =
          formulation === "dc"
            ? await solveDcOpfAsync(powerCase, { tier, caseTitle: baseName })
            : await solveAcOpfAsync(powerCase, { tier, caseTitle: baseName });

        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, sol.reportText, "utf-8");
          console.log(`Saved OPF report to ${outPath}`);
        } else {
          console.log(sol.reportText);
        }
      }
    }
  },
};
