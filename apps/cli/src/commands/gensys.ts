// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  evaluateEn14363,
  gensysToModelica,
  lintGensysModel,
  lowerGensysToDae,
  parseGensysDeck,
} from "@modelscript/gensys";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const GensysCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "gensys <action> [files...]",
  describe: "Inspect, lint, and verify GENSYS railway vehicle models (.calc, .run, .sub)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: lint | to-modelica | verify | simulate | to-fmu",
        choices: ["lint", "to-modelica", "verify", "simulate", "to-fmu"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input GENSYS files (.calc, .sub, .run)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path",
      })
      .option("stop-time", {
        type: "number",
        default: 5.0,
        describe: "Simulation stop time [s]",
      })
      .option("step", {
        type: "number",
        default: 0.005,
        describe: "Simulation time step [s]",
      })
      .option("y-force", {
        type: "number",
        default: 25.0,
        describe: "Lateral wheel force Y [kN] for EN 14363 verification",
      })
      .option("q-force", {
        type: "number",
        default: 80.0,
        describe: "Vertical wheel force Q [kN] for EN 14363 verification",
      })
      .option("axle-load", {
        type: "number",
        default: 160.0,
        describe: "Nominal axle load 2*Q0 [kN] for Prud'homme limit",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    if (action === "verify") {
      const res = evaluateEn14363({
        lateralForceY: argv["y-force"] as number,
        verticalForceQ: argv["q-force"] as number,
        nominalAxleLoadQ0: argv["axle-load"] as number,
      });

      console.log(`--- EN 14363 Railway Vehicle Assessment ---`);
      console.log(
        `Derailment Quotient (Y/Q): ${res.yOverQ.toFixed(4)} [Limit <= 0.80] -> ${res.derailmentRiskPassed ? "PASS" : "FAIL"}`,
      );
      console.log(
        `Prud'homme Lateral Shift:  ${(argv["y-force"] as number).toFixed(2)} kN [Limit <= ${res.prudhommeLimit.toFixed(2)} kN] -> ${res.prudhommeLimitPassed ? "PASS" : "FAIL"}`,
      );
      return;
    }

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        continue;
      }

      const content = fs.readFileSync(file, "utf-8");
      const modelName = path.basename(file, path.extname(file));
      const model = parseGensysDeck(content, modelName);

      if (action === "lint") {
        const diagnostics = lintGensysModel(model);
        if (diagnostics.length === 0) {
          console.log(
            `[PASS] ${file}: 0 issues found (${model.bodies.size} bodies, ${model.couplings.size} couplings).`,
          );
        } else {
          console.log(`[FAIL] ${file}: ${diagnostics.length} diagnostic(s):`);
          for (const d of diagnostics) {
            console.log(`  - [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
          }
        }
      } else if (action === "to-modelica") {
        const mo = gensysToModelica(model);
        if (argv["out"]) {
          fs.writeFileSync(argv["out"] as string, mo, "utf-8");
          console.log(`Exported Modelica model to ${argv["out"]}`);
        } else {
          console.log(mo);
        }
      } else if (action === "simulate") {
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");

        await initBltWasm();
        const dae = lowerGensysToDae(model);
        const stopTime = (argv["stop-time"] as number) ?? 5.0;
        const step = (argv["step"] as number) ?? 0.005;

        console.log(
          `Simulating GENSYS vehicle model '${model.name}' (${dae.varCount} vars, ${dae.eqCount} eqs) to t=${stopTime}s...`,
        );
        const result = simulateArena(dae, { startTime: 0, stopTime, step });
        console.log(
          `Simulation complete: ${result.t.length} steps computed across states [${result.states.slice(0, 6).join(", ")}${result.states.length > 6 ? ", ..." : ""}].`,
        );

        if (argv["out"]) {
          const outPath = argv["out"] as string;
          const header = ["time", ...result.states].join(",");
          const lines = [header];
          for (let i = 0; i < result.t.length; i++) {
            const row = [result.t[i], ...result.y[i]!].join(",");
            lines.push(row);
          }
          fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
          console.log(`Wrote trajectory data to ${outPath}`);
        }
      } else if (action === "to-fmu") {
        const { exportGensysFmu } = await import("@modelscript/exchange");
        const fmuResult = exportGensysFmu(model);
        const outPath = (argv["out"] as string) ?? `${modelName}.fmu`;
        fs.writeFileSync(outPath, fmuResult.archive);
        console.log(
          `Exported FMI 2.0 Co-Simulation FMU (${fmuResult.archive.byteLength} bytes, ${fmuResult.variableCount} vars) to ${outPath}`,
        );
      }
    }
  },
};
