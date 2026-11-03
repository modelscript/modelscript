// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import {
  buildPackageZip,
  collectPackageFiles,
  formatBytes,
  validatePackageManifest,
  type PackageFileEntry,
} from "../util/package-files.js";
import { parsePackageMo } from "../util/package-mo.js";
import { computePackageContentHash } from "../util/package-verify.js";

export interface PackArgs {
  path?: string | undefined;
  out?: string | undefined;
  dryRun?: boolean | undefined;
  json?: boolean | undefined;
  preIndex?: boolean | undefined;
}

export function formatArchiveFilename(name: string, version: string, isBundle = false): string {
  const cleanName = name.startsWith("@") ? name.slice(1).replace(/[/\\]/g, "-") : name;
  return isBundle ? `${cleanName}-${version}.lsp-bundle.zip` : `${cleanName}-${version}.msx.zip`;
}

export const Pack: CommandModule<{}, PackArgs> = {
  command: "pack [path]",
  describe: "Create an offline distribution zip archive from a package",
  builder: ((yargs: Argv) => {
    return yargs
      .positional("path", {
        description: "Path to the package directory or single Modelica file (defaults to current working directory)",
        type: "string",
        default: ".",
      })
      .option("out", {
        alias: "o",
        description: "Output directory for the generated archive",
        type: "string",
      })
      .option("dry-run", {
        alias: "d",
        description: "Inspect files and archive details without creating the file",
        type: "boolean",
        default: false,
      })
      .option("pre-index", {
        description:
          "Pre-index package symbols, metadata, and diagrams into an .lsp-bundle.zip for instant O(1) loading",
        type: "boolean",
        default: false,
      })
      .option("json", {
        description: "Output archive metadata as JSON",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, PackArgs>["builder"],
  handler: async (args) => {
    const targetPath = path.resolve(args.path || ".");

    if (!existsSync(targetPath)) {
      console.error(`Error: Path does not exist: ${targetPath}`);
      process.exit(1);
    }

    const stat = statSync(targetPath);
    let name: string | null = null;
    let version: string | null = null;
    let zip: AdmZip;
    let files: PackageFileEntry[] = [];

    if (stat.isDirectory()) {
      const packageJsonPath = path.join(targetPath, "package.json");
      const packageMoPath = path.join(targetPath, "package.mo");

      if (existsSync(packageJsonPath)) {
        try {
          const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
          if (!parsed.name) {
            console.error(`Error: 'name' field is missing in ${packageJsonPath}`);
            process.exit(1);
          }
          name = parsed.name;
          version = parsed.version || "0.0.0";
        } catch (err) {
          console.error(`Error: Failed to parse ${packageJsonPath}: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      } else if (existsSync(packageMoPath)) {
        const content = readFileSync(packageMoPath, "utf-8");
        const parsed = parsePackageMo(content);

        if (!parsed.name) {
          console.error(`Error: Could not determine package name from ${packageMoPath}`);
          process.exit(1);
        }

        name = parsed.name;
        version = parsed.version || "0.0.0";
      } else {
        console.error(`Error: Directory must contain either a 'package.json' or 'package.mo' file: ${targetPath}`);
        process.exit(1);
      }

      files = collectPackageFiles(targetPath);
      zip = buildPackageZip(files);
    } else if (stat.isFile() && targetPath.endsWith(".mo")) {
      const content = readFileSync(targetPath, "utf-8");
      const parsed = parsePackageMo(content);

      if (!parsed.name) {
        console.error(`Error: Could not determine package name from file: ${targetPath}`);
        process.exit(1);
      }

      name = parsed.name;
      version = parsed.version || "0.0.0";

      zip = new AdmZip();
      zip.addFile("package.mo", Buffer.from(content, "utf-8"));
      files = [{ relPath: "package.mo", fullPath: targetPath, size: stat.size }];
    } else {
      console.error(`Error: Path must be a directory or a single .mo file`);
      process.exit(1);
    }

    const validation = validatePackageManifest(name!, version!, stat.isDirectory() ? targetPath : undefined);
    if (!validation.valid) {
      console.error(`Pre-flight package verification failed:\n  - ${validation.errors.join("\n  - ")}`);
      process.exit(1);
    }

    let preIndexedClassCount = 0;
    if (args.preIndex) {
      const symbolsArr: Array<
        [number, { id: number; name: string; kind: string; resourceId: string; startOffset: number; endOffset: number }]
      > = [];
      const byNameMap = new Map<string, number[]>();
      const classesArr: Array<{
        className: string;
        classKind: string;
        description: string | null;
        components: unknown[];
      }> = [];
      let symIdCounter = 1;

      for (const file of files) {
        try {
          const content = readFileSync(file.fullPath, "utf-8");
          // Mirror source under sources/ in bundle for linear VFS
          zip.addFile(`sources/${file.relPath}`, Buffer.from(content, "utf-8"));

          const ext = path.extname(file.relPath).toLowerCase();
          if (ext === ".mo") {
            const classRegex = /(?:class|model|record|block|connector|package|function)\s+([A-Za-z0-9_]+)/g;
            let m: RegExpExecArray | null;
            while ((m = classRegex.exec(content)) !== null) {
              const shortName = m[1]!;
              const fqName = shortName === name ? shortName : `${name}.${shortName}`;
              const symId = symIdCounter++;
              symbolsArr.push([
                symId,
                {
                  id: symId,
                  name: shortName,
                  kind: "class",
                  resourceId: `sources/${file.relPath}`,
                  startOffset: m.index,
                  endOffset: m.index + m[0].length,
                },
              ]);
              if (!byNameMap.has(shortName)) {
                byNameMap.set(shortName, []);
              }
              byNameMap.get(shortName)!.push(symId);
              classesArr.push({
                className: fqName,
                classKind: "model",
                description: `Pre-indexed declaration from ${file.relPath}`,
                components: [],
              });
            }
          } else if (ext === ".sysml" || ext === ".kerml") {
            const sysmlRegex =
              /(?:part|package|action|item|port|connection|calc|constraint)\s+(?:def\s+)?([A-Za-z0-9_]+)/g;
            let m: RegExpExecArray | null;
            while ((m = sysmlRegex.exec(content)) !== null) {
              const shortName = m[1]!;
              const fqName = shortName === name ? shortName : `${name}::${shortName}`;
              const symId = symIdCounter++;
              symbolsArr.push([
                symId,
                {
                  id: symId,
                  name: shortName,
                  kind: "class",
                  resourceId: `sources/${file.relPath}`,
                  startOffset: m.index,
                  endOffset: m.index + m[0].length,
                },
              ]);
              if (!byNameMap.has(shortName)) {
                byNameMap.set(shortName, []);
              }
              byNameMap.get(shortName)!.push(symId);
              classesArr.push({
                className: fqName,
                classKind: "part",
                description: `Pre-indexed SysML declaration from ${file.relPath}`,
                components: [],
              });
            }
          }
        } catch {
          // ignore read failure
        }
      }

      preIndexedClassCount = classesArr.length;

      const indexJson = JSON.stringify(
        {
          symbols: symbolsArr,
          byName: Array.from(byNameMap.entries()),
          childrenOf: [],
        },
        null,
        2,
      );

      const metadataJson = JSON.stringify(
        {
          name: name!,
          version: version!,
          classes: classesArr,
          fileCount: files.length,
        },
        null,
        2,
      );

      const manifestJson = JSON.stringify(
        {
          name: name!,
          version: version!,
          preIndexed: true,
          totalClasses: preIndexedClassCount,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      );

      zip.addFile("index.json", Buffer.from(indexJson, "utf-8"));
      zip.addFile("metadata.json", Buffer.from(metadataJson, "utf-8"));
      zip.addFile("manifest.json", Buffer.from(manifestJson, "utf-8"));
      zip.addFile("icons.json", Buffer.from(JSON.stringify({}), "utf-8"));
    }

    const zipBuffer = zip.toBuffer();
    const contentHash = computePackageContentHash(zipBuffer);
    const totalUncompressedBytes = files.reduce((acc, f) => acc + f.size, 0);
    const archiveFilename = formatArchiveFilename(name!, version!, Boolean(args.preIndex));
    const outDir = path.resolve(args.out || process.cwd());
    const archivePath = path.join(outDir, archiveFilename);

    if (args.json) {
      const output = {
        name,
        version,
        filename: archiveFilename,
        outDir,
        destination: archivePath,
        dryRun: Boolean(args.dryRun),
        preIndexed: Boolean(args.preIndex),
        classesIndexed: preIndexedClassCount,
        contentHash,
        fileCount: files.length,
        uncompressedSize: totalUncompressedBytes,
        archiveSize: zipBuffer.length,
        files: files.map((f) => ({ path: f.relPath, size: f.size })),
      };
      console.log(JSON.stringify(output, null, 2));
      if (!args.dryRun) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(archivePath, zipBuffer);
      }
      return;
    }

    if (args.dryRun) {
      console.log(`📦 Inspecting archive package for ${name}@${version}`);
      for (let i = 0; i < files.length; i++) {
        const prefix = i === files.length - 1 ? "└── " : "├── ";
        console.log(`${prefix}${files[i]!.relPath} (${formatBytes(files[i]!.size)})`);
      }
      console.log(`\nArchive Summary:`);
      console.log(`- Target File: ${archiveFilename}`);
      console.log(`- Total Files: ${files.length}`);
      console.log(`- Pre-Indexed: ${Boolean(args.preIndex)} (${preIndexedClassCount} classes)`);
      console.log(`- Uncompressed Size: ${formatBytes(totalUncompressedBytes)}`);
      console.log(`- Archive Size: ${formatBytes(zipBuffer.length)}`);
      console.log(`- Content Hash (SHA-256): ${contentHash}`);
      console.log(`\nNotice: Dry run complete. No archive written to disk.`);
      return;
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(archivePath, zipBuffer);

    console.log(`📦 Successfully created package archive:`);
    console.log(`- Archive: ${path.relative(process.cwd(), archivePath) || archiveFilename}`);
    console.log(`- Package: ${name}@${version}`);
    if (args.preIndex) {
      console.log(`- Pre-Indexed: true (${preIndexedClassCount} classes indexed into index.json & metadata.json)`);
    }
    console.log(`- Total Files: ${files.length}`);
    console.log(`- Uncompressed Size: ${formatBytes(totalUncompressedBytes)}`);
    console.log(`- Archive Size: ${formatBytes(zipBuffer.length)}`);
    console.log(`- Content Hash: ${contentHash}`);
  },
};
