// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DdpManifestParser,
  DdpPackager,
  ManifestLensEngine,
  type DdpFileEntry,
  type DdpManifest,
} from "@modelscript/exchange";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

interface DdpInspectArgs {
  file: string;
  format: "table" | "json";
}

interface DdpPackArgs {
  manifest: string;
  output?: string;
  files?: string[];
}

interface DdpToAasxArgs {
  file: string;
  output?: string;
  kind?: "Type" | "Instance";
}

const DdpInspectCommand: CommandModule<{}, DdpInspectArgs> = {
  command: "inspect <file>",
  describe: "Inspect a Digital Data Package (.ddp / .zip) manifest, domain artifacts, and traceability graph",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .ddp or .zip package file",
        type: "string",
      })
      .option("format", {
        description: "Output format",
        choices: ["table", "json"],
        default: "table",
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const buffer = fs.readFileSync(filePath);
    let extracted;
    try {
      extracted = DdpPackager.extractDdp(buffer);
    } catch (err) {
      console.error(`Error parsing DDP archive: ${(err as Error).message}`);
      process.exit(1);
    }

    const m = extracted.manifest;

    if (args.format === "json") {
      console.log(JSON.stringify(m, null, 2));
      return;
    }

    console.log("\n\x1b[1m=== Digital Data Package (prostep ivip PSI 21 / CASCaRA) ===\x1b[0m");
    console.log(`\x1b[36mTitle:\x1b[0m          ${m.title}`);
    console.log(`\x1b[36mPackage ID:\x1b[0m     ${m.packageId}`);
    console.log(`\x1b[36mVersion:\x1b[0m        ${m.version}`);
    console.log(`\x1b[36mSpecification:\x1b[0m  DDP ${m.ddpVersion}`);
    if (m.securityClassification) {
      console.log(`\x1b[36mClassification:\x1b[0m ${m.securityClassification}`);
    }
    if (m.creator) {
      console.log(`\x1b[36mCreator:\x1b[0m        ${m.creator.name} (${m.creator.organization ?? "N/A"})`);
    }
    if (m.recipient) {
      console.log(`\x1b[36mRecipient:\x1b[0m      ${m.recipient.name} (${m.recipient.organization ?? "N/A"})`);
    }
    if (m.description) {
      console.log(`\x1b[36mDescription:\x1b[0m    ${m.description}`);
    }

    console.log("\n\x1b[1m--- Domain Artifacts ---\x1b[0m");
    const printCategory = (label: string, items?: any[]) => {
      if (!items || items.length === 0) return;
      console.log(`\x1b[33m[${label}]\x1b[0m (${items.length} items):`);
      for (const it of items) {
        console.log(`  • \x1b[1m${it.id}\x1b[0m: ${it.path} (${it.format ?? it.contentType})`);
        if (it.description) console.log(`    \x1b[90m${it.description}\x1b[0m`);
      }
    };

    printCategory("Requirements / MBSE", m.artifacts.requirements);
    printCategory("3D CAD / Geometry", m.artifacts.geometry);
    printCategory("Behavior / Simulation", m.artifacts.behavior);
    printCategory("Parameters", m.artifacts.parameters);
    printCategory("Documentation", m.artifacts.documentation);

    if (m.relations && m.relations.length > 0) {
      console.log("\n\x1b[1m--- Cross-Domain Semantic Traceability Matrix ---\x1b[0m");
      for (const rel of m.relations) {
        const status = rel.status ? ` [${rel.status.toUpperCase()}]` : "";
        console.log(`  • ${rel.source} \x1b[35m--(${rel.relationType})-->\x1b[0m ${rel.target}${status}`);
        if (rel.description) {
          console.log(`    \x1b[90m${rel.description}\x1b[0m`);
        }
      }
    }

    console.log(`\nPackaged Files in Archive: ${extracted.files.size} supplementary entries.\n`);
  },
};

const DdpPackCommand: CommandModule<{}, DdpPackArgs> = {
  command: "pack <manifest>",
  describe: "Assemble engineering artifacts into a compliant .ddp container",
  builder: (yargs) => {
    return yargs
      .positional("manifest", {
        demandOption: true,
        description: "Path to ddp-manifest.json or workspace manifest",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Output file path (default: package.ddp)",
        type: "string",
      })
      .option("files", {
        alias: "f",
        description: "Additional files to bundle into package",
        type: "array",
      }) as any;
  },
  handler: async (args) => {
    const manifestPath = path.resolve(process.cwd(), args.manifest);
    if (!fs.existsSync(manifestPath)) {
      console.error(`Error: Manifest not found: ${manifestPath}`);
      process.exit(1);
    }

    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    let manifest: DdpManifest;
    try {
      manifest = DdpManifestParser.parse(manifestContent);
    } catch (err) {
      console.error(`Error parsing manifest: ${(err as Error).message}`);
      process.exit(1);
    }

    const validation = DdpManifestParser.validate(manifest);
    if (!validation.valid) {
      console.warn("\x1b[33mWarning: Manifest validation issues detected:\x1b[0m");
      for (const err of validation.errors) {
        console.warn(`  - ${err}`);
      }
    }

    const filesToBundle: DdpFileEntry[] = [];
    const baseDir = path.dirname(manifestPath);

    // Collect all files declared in manifest that exist on disk
    const allArtifacts = [
      ...(manifest.artifacts.requirements ?? []),
      ...(manifest.artifacts.geometry ?? []),
      ...(manifest.artifacts.behavior ?? []),
      ...(manifest.artifacts.parameters ?? []),
      ...(manifest.artifacts.documentation ?? []),
    ];

    for (const art of allArtifacts) {
      const candidatePath = path.resolve(baseDir, art.path);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        filesToBundle.push({
          path: art.path,
          data: fs.readFileSync(candidatePath),
          contentType: art.contentType,
        });
      }
    }

    // Include explicitly passed files
    if (args.files) {
      for (const f of args.files) {
        const filePath = path.resolve(process.cwd(), String(f));
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const relPath = path.relative(process.cwd(), filePath);
          filesToBundle.push({
            path: relPath,
            data: fs.readFileSync(filePath),
          });
        }
      }
    }

    const ddpBuffer = DdpPackager.buildDdp({
      manifest,
      files: filesToBundle,
    });

    const outPath = args.output
      ? path.resolve(process.cwd(), args.output)
      : path.resolve(process.cwd(), `${manifest.packageId.replace(/[^a-zA-Z0-9_-]/g, "_")}.ddp`);

    fs.writeFileSync(outPath, ddpBuffer);
    console.log(`\x1b[32mSuccessfully assembled DDP archive:\x1b[0m ${outPath} (${ddpBuffer.length} bytes)`);
  },
};

const DdpToAasxCommand: CommandModule<{}, DdpToAasxArgs> = {
  command: "to-aasx <file>",
  describe:
    "Cross-compile an engineering Digital Data Package (.ddp) into an operational Asset Administration Shell (.aasx)",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        demandOption: true,
        description: "Path to .ddp or .zip package file",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Output .aasx file path",
        type: "string",
      })
      .option("kind", {
        description: "Asset kind (Type or Instance)",
        choices: ["Type", "Instance"],
        default: "Type",
      }) as any;
  },
  handler: async (args) => {
    const filePath = path.resolve(process.cwd(), args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const ddpBuffer = fs.readFileSync(filePath);
    let aasxBuffer: Uint8Array;
    try {
      aasxBuffer = ManifestLensEngine.bridgeDdpToAasx(ddpBuffer, {
        assetKind: args.kind as "Type" | "Instance",
      });
    } catch (err) {
      console.error(`Error cross-compiling DDP to AASX: ${(err as Error).message}`);
      process.exit(1);
    }

    const outPath = args.output
      ? path.resolve(process.cwd(), args.output)
      : filePath.replace(/\.(ddp|zip|ddpz)$/i, "") + ".aasx";

    fs.writeFileSync(outPath, aasxBuffer);
    console.log(`\x1b[32mSuccessfully compiled DDP to AASX:\x1b[0m ${outPath} (${aasxBuffer.length} bytes)`);
  },
};

export const Ddp: CommandModule = {
  command: "ddp <action>",
  describe: "Digital Data Package (prostep ivip PSI 21 / OMG CASCaRA) packaging, inspection, and AASX bridging",
  builder: (yargs) => {
    return yargs
      .command(DdpInspectCommand)
      .command(DdpPackCommand)
      .command(DdpToAasxCommand)
      .demandCommand(1, "Please specify an action (inspect, pack, or to-aasx)") as any;
  },
  handler: () => {},
};
