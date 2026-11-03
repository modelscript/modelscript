// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getStdlibById,
  getStdlibCatalog,
  getStdlibsByPack,
  getStdlibsForLanguage,
  type StdlibEntry,
  type StdlibPackId,
} from "@modelscript/exchange";
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";

export interface StdlibArgs {
  action?: string | undefined;
  pack?: string | undefined;
  lang?: string | undefined;
  json?: boolean | undefined;
  outDir?: string | undefined;
  out?: string | undefined;
  fromDir?: string | undefined;
  file?: string | undefined;
  dest?: string | undefined;
  allowPlaceholders?: boolean | undefined;
}

export interface MsxpackManifest {
  format: "msxpack/v1";
  version: string;
  createdAt: string;
  packs: string[];
  libraries: Array<{
    id: string;
    packageName: string;
    version: string;
    language: string;
    domain: string;
    pack: string;
    tier: string;
    filename: string;
    sha256: string;
    size: number;
  }>;
}

export const Stdlib: CommandModule<{}, StdlibArgs> = {
  command: "stdlib [action] [pack]",
  describe: "Manage, list, and synchronize polyglot standard libraries across 44 languages",
  builder: ((yargs: Argv) => {
    return yargs
      .positional("action", {
        description: "Action to execute: 'list' (default), 'sync', 'info', 'export', or 'import'",
        type: "string",
        default: "list",
        choices: ["list", "sync", "info", "export", "import"],
      })
      .positional("pack", {
        description:
          "Domain pack to target (e.g. 'core', 'power-energy', 'mobility-auto', 'all') or path to .msxpack for import",
        type: "string",
        default: "core",
      })
      .option("lang", {
        description: "Filter by language identifier (e.g. 'modelica', 'sysml2', 'spice')",
        type: "string",
      })
      .option("out-dir", {
        description: "Custom output directory for synchronized libraries",
        type: "string",
      })
      .option("out", {
        alias: "o",
        description: "Output file path for exported .msxpack bundle",
        type: "string",
      })
      .option("from-dir", {
        description: "Source directory containing downloaded standard library archives",
        type: "string",
      })
      .option("file", {
        alias: "f",
        description: "Path to .msxpack bundle file for import",
        type: "string",
      })
      .option("dest", {
        alias: "d",
        description: "Destination directory to extract imported standard libraries",
        type: "string",
      })
      .option("allow-placeholders", {
        description: "Allow placeholder README archives when neither prebuilt archive nor workspace sources exist",
        type: "boolean",
        default: false,
      })
      .option("json", {
        description: "Output results as formatted JSON",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, StdlibArgs>["builder"],
  handler: async (args) => {
    const action = args.action || "list";
    const pack = (args.pack || "core") as StdlibPackId | "all";
    const catalog = getStdlibCatalog();

    if (action === "list") {
      let targets: StdlibEntry[] = [];
      if (args.lang) {
        targets = getStdlibsForLanguage(args.lang);
      } else if (pack === "all") {
        targets = catalog.libraries;
      } else {
        targets = getStdlibsByPack(pack);
      }

      if (args.json) {
        console.log(JSON.stringify(targets, null, 2));
        return;
      }

      console.log(`\nModelScript Polyglot Standard Libraries (Catalog v${catalog.version})`);
      console.log(`Targeting pack '${pack}'${args.lang ? ` for language '${args.lang}'` : ""}:\n`);

      const rows = targets.map((lib: StdlibEntry) => {
        return {
          ID: lib.id,
          Language: lib.language,
          Package: lib.packageName,
          Version: lib.version,
          Tier: lib.tier,
          Pack: lib.pack,
          License: lib.license,
        };
      });

      console.table(rows);
      console.log(`Total: ${targets.length} standard libraries.\n`);
      return;
    }

    if (action === "info") {
      const targetId = args.pack; // In `stdlib info <name>`, second arg is the target ID/name
      if (!targetId) {
        console.error(
          "Error: Please specify the library ID or package name to inspect (e.g. 'msx stdlib info modelica-msl-4.1.0').",
        );
        process.exit(1);
      }

      const found =
        getStdlibById(targetId) ||
        catalog.libraries.find((lib: StdlibEntry) => lib.packageName.toLowerCase() === targetId.toLowerCase());

      if (!found) {
        console.error(`Error: Standard library '${targetId}' not found in catalog.`);
        process.exit(1);
      }

      if (args.json) {
        console.log(JSON.stringify(found, null, 2));
        return;
      }

      console.log(`\nPackage:     ${found.packageName} (v${found.version})`);
      console.log(`ID:          ${found.id}`);
      console.log(`Language:    ${found.language}`);
      console.log(`Pack:        ${found.pack}`);
      console.log(`Tier:        ${found.tier}`);
      console.log(`Domain:      ${found.domain}`);
      console.log(`License:     ${found.license}`);
      console.log(`Description: ${found.description}`);
      console.log(`Archive:     ${found.filename}`);
      if (found.upstream?.url) {
        console.log(`Upstream:    ${found.upstream.url}`);
      }
      console.log();
      return;
    }

    if (action === "sync") {
      console.log(`Synchronizing standard libraries for pack: ${pack}...`);
      const targetDir = args.outDir ? path.resolve(args.outDir) : path.join(process.cwd(), "modelscript_libraries");
      fs.mkdirSync(targetDir, { recursive: true });

      const targets = pack === "all" ? catalog.libraries : getStdlibsByPack(pack);
      console.log(`Preparing ${targets.length} library packages into ${targetDir}...`);

      for (const lib of targets) {
        console.log(` - [${lib.language}] ${lib.packageName}@${lib.version} (${lib.filename})`);
      }
      console.log("\nSynchronization check complete.");
      return;
    }

    if (action === "export") {
      const requestedPacks = (args.pack || "core").split(",").map((p) => p.trim());
      const targetMap = new Map<string, StdlibEntry>();

      for (const p of requestedPacks) {
        const libs = p === "all" ? catalog.libraries : getStdlibsByPack(p as StdlibPackId);
        for (const lib of libs) {
          targetMap.set(lib.id, lib);
        }
      }

      const targets = Array.from(targetMap.values());
      if (targets.length === 0) {
        console.error(`Error: No standard libraries found matching pack '${args.pack}'.`);
        process.exit(1);
      }

      const zip = new AdmZip();
      const manifestLibs: MsxpackManifest["libraries"] = [];
      const cwd = process.cwd();

      console.log(`📦 Exporting ${targets.length} standard libraries for pack(s) [${requestedPacks.join(", ")}]...`);

      for (const lib of targets) {
        const candidatePaths = [
          args.fromDir ? path.resolve(args.fromDir, lib.filename) : null,
          path.resolve(cwd, "scripts", lib.filename),
          path.resolve(cwd, "apps/api/data/libraries", lib.packageName, `${lib.version}.zip`),
          path.resolve(cwd, "apps/api/data/libraries", lib.filename),
          path.resolve(cwd, "modelscript_libraries", lib.filename),
          path.resolve(cwd, lib.filename),
        ].filter(Boolean) as string[];

        let foundPath: string | null = null;
        for (const cand of candidatePaths) {
          if (fs.existsSync(cand)) {
            foundPath = cand;
            break;
          }
        }

        let fileBuffer: Buffer | null = null;
        if (foundPath) {
          fileBuffer = fs.readFileSync(foundPath);
        } else {
          // Attempt to build archive directly from workspace standard library / domain source directories
          const localSourceRel = (lib as StdlibEntry & { localSourcePath?: string }).localSourcePath;
          const sourceDirs = [
            localSourceRel ? path.resolve(cwd, localSourceRel) : null,
            path.resolve(cwd, "apps/api/data/libraries", lib.packageName, lib.version),
            path.resolve(cwd, "apps/api/data/libraries", lib.packageName),
            path.resolve(cwd, `languages/${lib.language}/stdlib`),
            path.resolve(cwd, `languages/${lib.language}/examples`),
          ].filter((d): d is string => Boolean(d && fs.existsSync(d) && fs.statSync(d).isDirectory()));

          if (sourceDirs.length > 0) {
            const tempZip = new AdmZip();
            let addedFiles = 0;
            const walk = (d: string, p = "") => {
              for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
                const subPath = p ? `${p}/${entry.name}` : entry.name;
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) {
                  walk(full, subPath);
                } else {
                  tempZip.addFile(subPath, fs.readFileSync(full));
                  addedFiles++;
                }
              }
            };
            walk(sourceDirs[0]!);
            if (addedFiles > 0) {
              fileBuffer = tempZip.toBuffer();
            }
          }
        }

        if (!fileBuffer) {
          if (!args.allowPlaceholders) {
            throw new Error(
              `Standard library archive for '${lib.id}' (${lib.filename}) not found on disk or in workspace sources. Run 'msx stdlib sync' first or pass '--allow-placeholders' to bundle a stub archive.`,
            );
          }
          console.warn(
            `⚠️  Warning: Archive for '${lib.id}' (${lib.filename}) not found on disk. Including placeholder (--allow-placeholders).`,
          );
          const placeholder = new AdmZip();
          placeholder.addFile(
            "README.md",
            Buffer.from(`# ${lib.packageName} v${lib.version}\n\n${lib.description}\n`, "utf-8"),
          );
          fileBuffer = placeholder.toBuffer();
        }

        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        zip.addFile(`packages/${lib.filename}`, fileBuffer);

        manifestLibs.push({
          id: lib.id,
          packageName: lib.packageName,
          version: lib.version,
          language: lib.language,
          domain: lib.domain,
          pack: lib.pack,
          tier: lib.tier,
          filename: lib.filename,
          sha256,
          size: fileBuffer.length,
        });

        console.log(
          `  ✓ Bundled [${lib.language}] ${lib.packageName}@${lib.version} (${(fileBuffer.length / 1024).toFixed(1)} KB) - SHA-256: ${sha256.substring(0, 12)}...`,
        );
      }

      const msxpackManifest: MsxpackManifest = {
        format: "msxpack/v1",
        version: catalog.version,
        createdAt: new Date().toISOString(),
        packs: requestedPacks,
        libraries: manifestLibs,
      };

      zip.addFile("msxpack-manifest.json", Buffer.from(JSON.stringify(msxpackManifest, null, 2), "utf-8"));

      const outName = args.out
        ? path.resolve(args.out)
        : path.resolve(cwd, `modelscript-${requestedPacks.join("-")}.msxpack`);

      fs.mkdirSync(path.dirname(outName), { recursive: true });
      const finalBuffer = zip.toBuffer();
      fs.writeFileSync(outName, finalBuffer);

      const bundleSha256 = crypto.createHash("sha256").update(finalBuffer).digest("hex");

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              archive: outName,
              manifest: msxpackManifest,
              size: finalBuffer.length,
              sha256: bundleSha256,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`\n🎉 Successfully exported appliance bundle:`);
      console.log(`- Path:      ${path.relative(cwd, outName) || outName}`);
      console.log(`- Libraries: ${manifestLibs.length}`);
      console.log(`- Size:      ${(finalBuffer.length / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`- SHA-256:   ${bundleSha256}\n`);
      return;
    }

    if (action === "import") {
      const archivePath = args.file || (args.pack !== "core" ? args.pack : undefined);
      if (!archivePath) {
        console.error(
          "Error: Please specify the .msxpack archive file to import (e.g. 'msx stdlib import ./bundle.msxpack').",
        );
        process.exit(1);
      }

      const resolvedArchive = path.resolve(archivePath);
      if (!fs.existsSync(resolvedArchive)) {
        console.error(`Error: Archive file does not exist: ${resolvedArchive}`);
        process.exit(1);
      }

      console.log(`📥 Reading appliance pack archive: ${resolvedArchive}...`);
      const zip = new AdmZip(resolvedArchive);
      const manifestEntry = zip.getEntry("msxpack-manifest.json");

      if (!manifestEntry) {
        console.error("Error: Invalid .msxpack archive: missing 'msxpack-manifest.json'.");
        process.exit(1);
      }

      const manifestStr = manifestEntry.getData().toString("utf-8");
      const manifest = JSON.parse(manifestStr) as MsxpackManifest;

      if (manifest.format !== "msxpack/v1") {
        console.error(`Error: Unsupported .msxpack format version: '${manifest.format}'.`);
        process.exit(1);
      }

      const destDir = args.dest
        ? path.resolve(args.dest)
        : fs.existsSync(path.resolve(process.cwd(), "apps/api/data/libraries"))
          ? path.resolve(process.cwd(), "apps/api/data/libraries")
          : path.resolve(process.cwd(), "modelscript_libraries");

      fs.mkdirSync(destDir, { recursive: true });
      console.log(`Target destination: ${destDir}`);
      console.log(`Importing ${manifest.libraries.length} standard libraries (catalog v${manifest.version})...\n`);

      const imported: Array<{ name: string; version: string; filename: string; verified: boolean }> = [];

      for (const lib of manifest.libraries) {
        const innerEntry = zip.getEntry(`packages/${lib.filename}`) || zip.getEntry(lib.filename);
        if (!innerEntry) {
          console.warn(`⚠️  Package file '${lib.filename}' missing in bundle archive.`);
          continue;
        }

        const data = innerEntry.getData();
        const actualSha256 = crypto.createHash("sha256").update(data).digest("hex");

        if (actualSha256 !== lib.sha256) {
          console.error(`❌ Integrity check failed for '${lib.filename}': expected ${lib.sha256}, got ${actualSha256}`);
          process.exit(1);
        }

        // Write directly as filename
        const outFlat = path.join(destDir, lib.filename);
        fs.writeFileSync(outFlat, data);

        // Also write into packageName/version.zip registry hierarchy if applicable
        const pkgDir = path.join(destDir, lib.packageName);
        fs.mkdirSync(pkgDir, { recursive: true });
        const outVer = path.join(pkgDir, `${lib.version}.zip`);
        fs.writeFileSync(outVer, data);

        imported.push({
          name: lib.packageName,
          version: lib.version,
          filename: lib.filename,
          verified: true,
        });

        console.log(`  ✓ Verified & unpacked [${lib.language}] ${lib.packageName}@${lib.version} -> ${lib.filename}`);
      }

      if (args.json) {
        console.log(JSON.stringify({ imported, destination: destDir }, null, 2));
        return;
      }

      console.log(`\n🎉 Successfully imported ${imported.length} standard libraries into ${destDir}.\n`);
      return;
    }
  },
};
