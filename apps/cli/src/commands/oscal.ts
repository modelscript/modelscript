// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  auditCpsArchitectureCompliance,
  lintOscalDocument,
  oscalToReqif,
  oscalToSysML2,
  parseOscal,
  resolveOscalProfile,
  serializeOscal,
} from "@modelscript/oscal";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OscalCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "oscal <action> [files...]",
  describe:
    "Inspect, resolve profiles, verify NIST SP 800-53 / SP 800-82 CPS compliance, convert, and project NIST OSCAL models (.oscal.json, .oscal.yaml, .oscal.xml)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: inspect | verify | resolve | audit-cps | convert | to-sysml | to-reqif",
        choices: ["inspect", "verify", "resolve", "audit-cps", "convert", "to-sysml", "to-reqif"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input OSCAL files (.oscal.json, .oscal.yaml, .oscal.xml, .oscal)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      })
      .option("format", {
        type: "string",
        choices: ["json", "yaml", "xml"],
        default: "json",
        describe: "Target serialization format for 'convert'",
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
      const doc = parseOscal(content, file);

      const components = doc.systemImplementation?.components ?? doc.components ?? [];
      const implementedRequirements = doc.controlImplementation?.implementedRequirements ?? [];

      switch (action) {
        case "inspect": {
          console.log(`OSCAL Document: ${doc.metadata.title} (${doc.kind})`);
          console.log(`  UUID: ${doc.uuid}`);
          console.log(`  OSCAL Version: ${doc.metadata.oscalVersion}`);
          console.log(`  Controls: ${(doc.controls ?? []).length}`);
          console.log(`  Components: ${components.length}`);
          console.log(`  Implemented Requirements: ${implementedRequirements.length}`);
          console.log(`  Findings: ${(doc.findings ?? []).length}`);
          console.log(`  POA&M Items: ${(doc.poamItems ?? []).length}`);
          break;
        }

        case "verify": {
          const diagnostics = lintOscalDocument(doc);
          if (diagnostics.length === 0) {
            console.log(`[PASS] ${file}: 0 NIST OSCAL constraint or CPS compliance diagnostics detected.`);
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

        case "resolve": {
          const resolved = resolveOscalProfile(doc);
          const jsonOut = JSON.stringify(resolved, null, 2);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), jsonOut, "utf-8");
            console.log(`Saved resolved OSCAL catalog (${resolved.controls.length} controls) to: ${outPath}`);
          } else {
            console.log(jsonOut);
          }
          break;
        }

        case "audit-cps": {
          const archComponents = components.map((c) => ({
            name: c.title,
            kind: c.type,
            isSafetyCritical: c.type === "plc" || c.type === "ied" || c.type === "ot-controller",
          }));
          const report = auditCpsArchitectureCompliance(doc, archComponents);
          console.log(JSON.stringify(report, null, 2));
          break;
        }

        case "convert": {
          const format = ((argv["format"] as string) || "json") as "json" | "yaml" | "xml";
          const serialized = serializeOscal(doc, format);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), serialized, "utf-8");
            console.log(`Converted OSCAL to ${format.toUpperCase()}: ${outPath}`);
          } else {
            console.log(serialized);
          }
          break;
        }

        case "to-sysml": {
          const sysml = oscalToSysML2(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), sysml, "utf-8");
            console.log(`Saved SysML v2 security specification to: ${outPath}`);
          } else {
            console.log(sysml);
          }
          break;
        }

        case "to-reqif": {
          const reqif = oscalToReqif(doc);
          const outPath = argv["out"] as string | undefined;
          if (outPath) {
            fs.writeFileSync(path.resolve(process.cwd(), outPath), reqif, "utf-8");
            console.log(`Saved ReqIF XML to: ${outPath}`);
          } else {
            console.log(reqif);
          }
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
