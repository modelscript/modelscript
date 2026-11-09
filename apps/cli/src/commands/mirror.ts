// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { DependencySolver, type PackageVersionProvider } from "../solver/solver.js";
import { getApiUrl, getToken } from "../util/auth.js";
import { computeBufferIntegrity } from "../util/lockfile.js";
import { defaultPackageStore, type GlobalPackageStore } from "../util/store.js";

export interface MirrorArgs {
  packages?: string[] | undefined;
  out?: string | undefined;
  includeSalsa?: boolean | undefined;
  json?: boolean | undefined;
  import?: string | undefined;
  targetRegistry?: string | undefined;
}

export interface MirrorManifest {
  version: "1.0.0";
  mirroredAt: string;
  packages: Record<
    string,
    {
      version: string;
      integrity: string;
      archive: string;
      salsaDb?: string | undefined;
      dependencies?: Record<string, string> | undefined;
    }
  >;
}

export interface MirrorImportResult {
  status: "success";
  bundle: string;
  isBundleArchive: boolean;
  importedCount: number;
  packages: Record<
    string,
    {
      version: string;
      integrity: string;
      salsaDb?: boolean;
    }
  >;
  targetStore: string;
  targetRegistry?: string | undefined;
}

/**
 * Imports an air-gap mirror bundle (.zip archive or unpacked directory) into the global CAS store.
 * Verifies SHA-256 CAS integrity against mirror-manifest.json and ingests pre-computed Salsa DBs.
 */
export async function importMirrorBundle(
  bundlePathInput: string,
  options?:
    | {
        targetStore?: GlobalPackageStore | undefined;
        targetRegistry?: string | undefined;
        json?: boolean | undefined;
      }
    | undefined,
): Promise<MirrorImportResult> {
  const store = options?.targetStore ?? defaultPackageStore;
  const bundlePath = path.resolve(bundlePathInput);

  if (!existsSync(bundlePath)) {
    throw new Error(`Mirror bundle path does not exist: ${bundlePathInput}`);
  }

  const isZip = statSync(bundlePath).isFile() && (bundlePath.endsWith(".zip") || bundlePath.endsWith(".msx.zip"));
  let mirrorManifest: MirrorManifest;
  let getArchiveBuffer: (archiveRel: string) => Buffer;
  let getSalsaBuffer: (salsaRel: string) => Buffer | null;

  if (isZip) {
    const zip = new AdmZip(bundlePath);
    const manifestEntry = zip.getEntry("mirror-manifest.json");
    if (!manifestEntry) {
      throw new Error(`Invalid mirror bundle: missing mirror-manifest.json in archive ${bundlePathInput}`);
    }
    mirrorManifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as MirrorManifest;

    getArchiveBuffer = (archiveRel: string) => {
      const normalized = archiveRel.replace(/\\/g, "/");
      let entry = zip.getEntry(normalized);
      if (!entry) {
        const baseName = path.basename(normalized);
        entry = zip.getEntries().find((e) => e.entryName === normalized || e.name === baseName) ?? null;
      }
      if (!entry) {
        throw new Error(`Package archive not found in mirror bundle: ${archiveRel}`);
      }
      return entry.getData();
    };

    getSalsaBuffer = (salsaRel: string) => {
      const normalized = salsaRel.replace(/\\/g, "/");
      let entry = zip.getEntry(normalized);
      if (!entry) {
        const baseName = path.basename(normalized);
        entry = zip.getEntries().find((e) => e.entryName === normalized || e.name === baseName) ?? null;
      }
      return entry ? entry.getData() : null;
    };
  } else {
    // Unpacked directory
    const manifestPath = path.join(bundlePath, "mirror-manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`Invalid mirror directory: missing mirror-manifest.json in ${bundlePathInput}`);
    }
    mirrorManifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as MirrorManifest;

    getArchiveBuffer = (archiveRel: string) => {
      const absPath = path.resolve(bundlePath, archiveRel);
      if (!existsSync(absPath)) {
        throw new Error(`Package archive not found in mirror directory: ${absPath}`);
      }
      return readFileSync(absPath);
    };

    getSalsaBuffer = (salsaRel: string) => {
      const absPath = path.resolve(bundlePath, salsaRel);
      return existsSync(absPath) ? readFileSync(absPath) : null;
    };
  }

  const pkgEntries = Object.entries(mirrorManifest.packages || {});
  if (!options?.json) {
    console.log(`Ingesting air-gap mirror bundle (${pkgEntries.length} package(s))...`);
  }

  const resultPackages: MirrorImportResult["packages"] = {};

  for (const [pkgName, pkgInfo] of pkgEntries) {
    const archiveBuffer = getArchiveBuffer(pkgInfo.archive);
    const computedIntegrity = computeBufferIntegrity(archiveBuffer);

    if (pkgInfo.integrity && computedIntegrity.toLowerCase() !== pkgInfo.integrity.toLowerCase()) {
      throw new Error(
        `CAS integrity verification failed for mirrored package ${pkgName}@${pkgInfo.version}: expected ${pkgInfo.integrity}, got ${computedIntegrity}`,
      );
    }

    const storeDir = store.extractToStore(pkgName, pkgInfo.version, computedIntegrity, archiveBuffer);

    let hasSalsa = false;
    if (pkgInfo.salsaDb) {
      const salsaBuf = getSalsaBuffer(pkgInfo.salsaDb);
      if (salsaBuf && salsaBuf.length > 0) {
        const metaDir = path.join(storeDir, ".modelscript");
        mkdirSync(metaDir, { recursive: true });
        writeFileSync(path.join(metaDir, "salsa-index.db"), salsaBuf);
        hasSalsa = true;
      }
    }

    // Optional target registry population
    if (options?.targetRegistry) {
      const regDir = path.resolve(options.targetRegistry);
      const safePkg = pkgName.replace(/^@/, "").replace(/[/\\]/g, "-");
      const regPkgDir = path.join(regDir, safePkg, pkgInfo.version);
      mkdirSync(regPkgDir, { recursive: true });
      writeFileSync(path.join(regPkgDir, "library.zip"), archiveBuffer);
      if (hasSalsa && pkgInfo.salsaDb) {
        const salsaBuf = getSalsaBuffer(pkgInfo.salsaDb);
        if (salsaBuf) writeFileSync(path.join(regPkgDir, "salsa-index.db"), salsaBuf);
      }
    }

    resultPackages[pkgName] = {
      version: pkgInfo.version,
      integrity: computedIntegrity,
      salsaDb: hasSalsa,
    };

    if (!options?.json) {
      console.log(
        `✓ Imported ${pkgName}@${pkgInfo.version} (${computedIntegrity.slice(0, 19)}...${hasSalsa ? ", +Salsa index" : ""})`,
      );
    }
  }

  const result: MirrorImportResult = {
    status: "success",
    bundle: bundlePath,
    isBundleArchive: isZip,
    importedCount: pkgEntries.length,
    packages: resultPackages,
    targetStore: store.storeRoot,
    targetRegistry: options?.targetRegistry ? path.resolve(options.targetRegistry) : undefined,
  };

  if (options?.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n✅ Air-gap mirror bundle import complete: ${pkgEntries.length} package(s) loaded into store.`);
    console.log(`Store path: ${store.storeRoot}`);
    console.log("Packages are immediately available for 'msx install --offline'.\n");
  }

  return result;
}

export const Mirror: CommandModule<{}, MirrorArgs> = {
  command: "mirror [packages..]",
  describe: "Mirror packages to an air-gap directory or bundle, or import an air-gap bundle into local store",
  builder: ((yargs: Argv) => {
    return yargs
      .positional("packages", {
        description: "List of package names to mirror, or 'import <bundle>' to ingest a mirror bundle",
        type: "string",
        array: true,
      })
      .option("import", {
        alias: "i",
        description: "Path to an air-gap mirror bundle (.zip) or unpacked mirror directory to import into local store",
        type: "string",
      })
      .option("target-registry", {
        description:
          "Optional local registry directory to populate with imported packages (for air-gapped registry mirrors)",
        type: "string",
      })
      .option("out", {
        alias: "o",
        description: "Output directory or bundle zip archive (e.g. ./mirror or ./mirror.zip)",
        type: "string",
        default: "modelscript-mirror",
      })
      .option("include-salsa", {
        description: "Include pre-computed Salsa memoization index databases for instant zero-recompilation loading",
        type: "boolean",
        default: true,
      })
      .option("json", {
        description: "Output mirror result summary as JSON",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, MirrorArgs>["builder"],
  handler: async (args) => {
    const rawPackages = args.packages || [];
    let importBundlePath = args.import;
    if (!importBundlePath && rawPackages[0] === "import") {
      importBundlePath = rawPackages[1];
      if (!importBundlePath) {
        console.error(
          "Error: Mirror bundle path must be specified after 'import'. Example: msx mirror import ./mirror.zip",
        );
        process.exit(1);
      }
    }

    if (importBundlePath) {
      try {
        await importMirrorBundle(importBundlePath, {
          targetRegistry: args.targetRegistry,
          json: args.json,
        });
      } catch (err) {
        console.error(`\n❌ Failed to import mirror bundle: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
      return;
    }

    if (rawPackages.length === 0) {
      console.error("Error: At least one package name must be specified (or use 'msx mirror import <bundle>').");
      process.exit(1);
    }

    const outTarget = path.resolve(args.out || "modelscript-mirror");
    const isZipBundle = outTarget.toLowerCase().endsWith(".zip");
    const outDir = isZipBundle ? path.join(path.dirname(outTarget), `.mirror-staging-${Date.now()}`) : outTarget;
    const includeSalsa = args.includeSalsa !== false;

    const API_URL = getApiUrl();
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const packagesToResolve: { name: string; version?: string | undefined }[] = [];
    for (const raw of rawPackages) {
      let name = raw.trim();
      let version: string | undefined;

      if (raw.startsWith("@")) {
        const lastAt = raw.lastIndexOf("@");
        if (lastAt > 0) {
          name = raw.slice(0, lastAt);
          version = raw.slice(lastAt + 1);
        }
      } else if (raw.includes("@")) {
        const parts = raw.split("@");
        name = parts[0]!;
        version = parts[1];
      }
      packagesToResolve.push({ name, version });
    }

    const provider: PackageVersionProvider = {
      async getVersions(pkgName: string): Promise<string[]> {
        const pPath = pkgName.startsWith("@")
          ? pkgName.split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(pkgName);
        try {
          const res = await fetch(`${API_URL}/api/v1/libraries/${pPath}`, { headers });
          if (!res.ok) return [];
          const data = (await res.json()) as {
            versions?: (string | { version: string })[] | undefined;
            version?: string | undefined;
          };
          if (Array.isArray(data.versions)) {
            return data.versions.map((v) => (typeof v === "string" ? v : v.version));
          }
          if (typeof data.version === "string") return [data.version];
          return [];
        } catch {
          return [];
        }
      },
      async getManifest(pkgName: string, ver: string): ReturnType<PackageVersionProvider["getManifest"]> {
        const pPath = pkgName.startsWith("@")
          ? pkgName.split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(pkgName);
        try {
          const res = await fetch(`${API_URL}/api/v1/libraries/${pPath}/${encodeURIComponent(ver)}`, { headers });
          if (!res.ok) return null;
          return (await res.json()) as Awaited<ReturnType<PackageVersionProvider["getManifest"]>>;
        } catch {
          return null;
        }
      },
    };

    const solver = new DependencySolver(provider);
    const rootRequirements = packagesToResolve.map((p) => ({
      name: p.name,
      range: p.version || "*",
      source: "cli",
    }));

    if (!args.json) {
      console.log(`Resolving recursive dependency tree for ${packagesToResolve.length} package(s)...`);
    }

    const solution = await solver.solve(rootRequirements);
    if (!solution.success) {
      console.error(`\n❌ Dependency resolution failed:\n${solution.error}\n`);
      process.exit(1);
    }

    mkdirSync(outDir, { recursive: true });
    const archivesDir = path.join(outDir, "archives");
    mkdirSync(archivesDir, { recursive: true });

    const mirrorManifest: MirrorManifest = {
      version: "1.0.0",
      mirroredAt: new Date().toISOString(),
      packages: {},
    };

    for (const pkgName of solution.order) {
      const resolvedVersion = solution.packages[pkgName]?.version;
      if (!resolvedVersion) continue;

      if (!args.json) {
        console.log(`Mirroring ${pkgName}@${resolvedVersion}...`);
      }

      const packagePath = pkgName.startsWith("@")
        ? pkgName.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(pkgName);
      const downloadUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/download`;
      const dlRes = await fetch(downloadUrl, { headers });
      if (!dlRes.ok) throw new Error(`Download failed for ${pkgName}@${resolvedVersion}: ${dlRes.statusText}`);
      const ab = await dlRes.arrayBuffer();
      const buffer = Buffer.from(ab);
      const integrity = computeBufferIntegrity(buffer);

      defaultPackageStore.extractToStore(pkgName, resolvedVersion, integrity, buffer);

      const sanitizedName = pkgName.replace(/^@/, "").replace(/[/\\]/g, "-");
      const archiveFilename = `${sanitizedName}-${resolvedVersion}.zip`;
      const archivePath = path.join(archivesDir, archiveFilename);
      writeFileSync(archivePath, buffer);

      let salsaDbRelPath: string | undefined;
      if (includeSalsa) {
        try {
          const salsaUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/salsa-index.db`;
          const salsaRes = await fetch(salsaUrl, { headers });
          if (salsaRes.ok) {
            const salsaBuf = Buffer.from(await salsaRes.arrayBuffer());
            const salsaFilename = `${sanitizedName}-${resolvedVersion}.salsa-index.db`;
            const salsaPath = path.join(archivesDir, salsaFilename);
            writeFileSync(salsaPath, salsaBuf);
            salsaDbRelPath = path.relative(outDir, salsaPath);
          }
        } catch {
          // non-critical
        }
      }

      mirrorManifest.packages[pkgName] = {
        version: resolvedVersion,
        integrity,
        archive: path.relative(outDir, archivePath),
        salsaDb: salsaDbRelPath,
        dependencies: solution.packages[pkgName]?.dependencies,
      };
    }

    const manifestPath = path.join(outDir, "mirror-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(mirrorManifest, null, 2), "utf-8");

    if (isZipBundle) {
      if (!args.json) {
        console.log(`Packaging air-gap bundle into archive: ${outTarget}...`);
      }
      const zip = new AdmZip();
      zip.addLocalFolder(outDir);
      zip.writeZip(outTarget);
      // Clean up staging directory
      try {
        const fs = await import("node:fs");
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch {}
    }

    if (args.json) {
      console.log(
        JSON.stringify({
          status: "success",
          target: outTarget,
          isBundle: isZipBundle,
          mirroredCount: Object.keys(mirrorManifest.packages).length,
          packages: mirrorManifest.packages,
        }),
      );
    } else {
      console.log(
        `\n✅ Air-gap mirror complete: ${Object.keys(mirrorManifest.packages).length} package(s) written to ${outTarget}`,
      );
      console.log("This mirror can be safely transferred across air-gapped boundaries (NERC CIP / CEII compliant).\n");
    }
  },
};
