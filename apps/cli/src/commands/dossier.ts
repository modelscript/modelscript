// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Regulatory Dossier Subcommand.
 *
 * Compiles automated NERC RSAW audit evidence packages and NIST OSCAL 1.1 assessment
 * results with FERC CEII watermarking and cryptographic Ed25519 digital signatures.
 *
 * Usage:
 * - `msx dossier build <manifest.json> [--out=dossier.zip]`
 * - `msx dossier inspect <manifest.json>`
 */

import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const DossierCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "dossier <action> [files...]",
  describe: "Compile, watermark, and cryptographically sign NERC RSAW & NIST OSCAL regulatory compliance dossiers",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (build, compile, inspect)",
        type: "string",
        choices: ["build", "compile", "inspect"],
        demandOption: true,
      })
      .positional("files", {
        description: "Dossier manifest JSON file(s)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. dossier.zip, rsaw.md, or oscal.json)",
        type: "string",
      })
      .option("key", {
        description: "Path to Ed25519 private key PEM for attestation signing",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const keyPath = argv["key"] as string | undefined;

    if (files.length === 0) {
      console.error("[dossier] No manifest file specified. Usage: msx dossier build <manifest.json>");
      process.exit(1);
    }

    const { buildRegulatoryDossier } = await import("@modelscript/ee");

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[dossier] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const manifestInput = JSON.parse(text);

      let privateKeyPem: string | undefined;
      if (keyPath && fs.existsSync(path.resolve(process.cwd(), keyPath))) {
        privateKeyPem = fs.readFileSync(path.resolve(process.cwd(), keyPath), "utf-8");
      }

      console.log(`[dossier] Compiling regulatory compliance dossier for ${manifestInput.plantName}...`);
      const dossier = buildRegulatoryDossier(manifestInput, privateKeyPem);

      console.log(`  ✔ Dossier ID:            ${dossier.dossierId}`);
      console.log(`  ✔ Organization:          ${dossier.organizationName}`);
      console.log(`  ✔ Overall Status:        ${dossier.overallStatus}`);
      console.log(`  ✔ NERC RSAW Length:      ${dossier.rsawMarkdown.length} bytes`);
      console.log(`  ✔ NIST OSCAL Length:     ${dossier.oscalAssessmentResultsJson.length} bytes`);
      console.log(`  ✔ FERC CEII Notice:      ${dossier.ceiiWatermarkNotice.split("\n")[0]}`);
      console.log(`  ✔ Cryptographic Token:   ${dossier.signedAttestation.bundleToken.slice(0, 32)}...`);

      if (action === "inspect") {
        console.log("\n" + dossier.rsawMarkdown.slice(0, 800) + "\n...\n");
        continue;
      }

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (outPath.endsWith(".json")) {
          fs.writeFileSync(outPath, dossier.oscalAssessmentResultsJson, "utf-8");
          console.log(`  ✔ Exported OSCAL 1.1 JSON to ${outPath}`);
        } else {
          fs.writeFileSync(outPath, dossier.rsawMarkdown, "utf-8");
          console.log(`  ✔ Exported NERC RSAW Markdown to ${outPath}`);
        }
      } else {
        const defaultOut = `${path.basename(file, path.extname(file))}_RSAW.md`;
        fs.writeFileSync(path.resolve(process.cwd(), defaultOut), dossier.rsawMarkdown, "utf-8");
        console.log(`  ✔ Exported NERC RSAW Markdown to ${defaultOut}`);
      }
    }
  },
};
