// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  evaluateQifSpc,
  lintQifDocument,
  lowerQifToDae,
  parseQif,
  qifToModelica,
  qifToSysML2,
  reconcileStepWithQif,
  synthesizeQifFromStep,
} from "@modelscript/qif";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const QifCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "qif <action> [files...]",
  describe:
    "Inspect, validate ASME Y14.5 GD&T & NIST QIF rules, compute SPC capability (Cp/Cpk/TUR), reconcile STEP AP242, and project ISO 23952 QIF models (.qif)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe:
          "Action to perform: inspect | validate | spc | reconcile-step | from-step | to-sysml | to-modelica | to-dae",
        choices: ["inspect", "validate", "spc", "reconcile-step", "from-step", "to-sysml", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input QIF (.qif) or STEP (.step) files",
      })
      .option("step", {
        type: "string",
        describe: "Companion STEP AP242 file for 'reconcile-step'",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, "utf-8");

      if (action === "from-step") {
        const synthDoc = synthesizeQifFromStep(content);
        console.log(JSON.stringify(synthDoc, null, 2));
        continue;
      }

      const doc = parseQif(content, file);

      switch (action) {
        case "inspect": {
          console.log(`QIF Document (QPID: ${doc.qpId}, Version: ${doc.version})`);
          console.log(`  Datums: ${doc.datumDefinitions.length}`);
          console.log(`  Features: ${doc.features.length}`);
          console.log(`  GD&T Characteristics: ${doc.characteristics.length}`);
          console.log(`  Measurement Devices: ${doc.devices.length}`);
          console.log(`  Inspection Plan Steps: ${doc.planSteps.length}`);
          console.log(`  Measured Actuals: ${doc.actuals.length}`);
          break;
        }

        case "validate": {
          const diagnostics = lintQifDocument(doc);
          if (diagnostics.length === 0) {
            console.log(`[PASS] ${file}: 0 NIST QIF / ASME Y14.5 GD&T diagnostics detected.`);
          } else {
            console.log(`Found ${diagnostics.length} diagnostic(s) in ${file}:`);
            for (const d of diagnostics) {
              const prefix = d.severity === "error" ? "ERROR" : "WARNING";
              console.log(
                `  [${file}:${d.range.startLine}:${d.range.startColumn}] ${prefix} [${d.code}]: ${d.message}`,
              );
            }
          }
          break;
        }

        case "spc": {
          const spc = evaluateQifSpc(doc);
          const outPath = argv["out"] as string | undefined;
          const jsonOut = JSON.stringify(spc, null, 2);
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), jsonOut, "utf-8");
            console.log(`Saved QIF SPC capability report to: ${outPath}`);
          } else {
            console.log(jsonOut);
          }
          break;
        }

        case "reconcile-step": {
          const stepFile = argv["step"] as string | undefined;
          if (!stepFile) {
            console.error("Error: --step <model.step> is required for 'reconcile-step'.");
            process.exit(1);
          }
          const stepText = fs.readFileSync(path.resolve(process.cwd(), stepFile), "utf-8");
          const reconciliation = reconcileStepWithQif(stepText, doc);
          console.log(JSON.stringify(reconciliation, null, 2));
          break;
        }

        case "to-sysml": {
          const sysml = qifToSysML2(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), sysml, "utf-8");
            console.log(`Saved SysML v2 metrology specification to: ${outPath}`);
          } else {
            console.log(sysml);
          }
          break;
        }

        case "to-modelica": {
          const mo = qifToModelica(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), mo, "utf-8");
            console.log(`Saved Modelica 3.x tolerance model to: ${outPath}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerQifToDae(doc);
          console.log(`Lowered QIF Metrology Model to DAE Arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
