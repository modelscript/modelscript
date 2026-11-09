// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { DependencySolver, type PackageVersionProvider } from "../solver/solver.js";
import { getApiUrl, getToken } from "../util/auth.js";
import { computeBufferIntegrity, readLockfile } from "../util/lockfile.js";
import { parsePackageUses } from "../util/package-mo.js";
import { defaultPackageStore } from "../util/store.js";

export interface VendorArgs {
  path?: string | undefined;
  out?: string | undefined;
  cache?: boolean | undefined;
  json?: boolean | undefined;
}

export interface VendorManifest {
  version: "1.0.0";
  generatedAt: string;
  sourceWorkspace: string;
  packages: Record<
    string,
    {
      version: string;
      integrity: string;
      directory: string;
      archive?: string | undefined;
      dependencies?: Record<string, string> | undefined;
    }
  >;
}

export const Vendor: CommandModule<{}, VendorArgs> = {
  command: "vendor [path]",
  describe: "Vendor all workspace dependencies into a self-contained local directory for offline air-gap execution",
  builder: ((yargs: Argv) => {
    return yargs
      .positional("path", {
        description: "Path to the workspace or package directory (defaults to current working directory)",
        type: "string",
        default: ".",
      })
      .option("out", {
        alias: "o",
        description: "Target vendor directory (defaults to ./vendor)",
        type: "string",
        default: "vendor",
      })
      .option("cache", {
        description: "Store raw .zip distribution archives alongside extracted files in vendor directory",
        type: "boolean",
        default: true,
      })
      .option("json", {
        description: "Output vendoring result summary as JSON",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, VendorArgs>["builder"],
  handler: async (args) => {
    const cwd = path.resolve(args.path || ".");
    const outDir = path.resolve(cwd, args.out || "vendor");
    const saveArchives = args.cache !== false;

    if (!existsSync(cwd)) {
      console.error(`Error: Workspace path does not exist: ${cwd}`);
      process.exit(1);
    }

    const packagesToVendor: { name: string; version?: string | undefined }[] = [];
    const pkgJsonPath = path.join(cwd, "package.json");
    const lockfile = readLockfile(cwd);

    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        const deps = { ...pkgJson.dependencies, ...pkgJson.modelscript?.dependencies };
        for (const [depName, depVer] of Object.entries(deps)) {
          if (typeof depVer === "string") {
            const cleanVer = depVer.replace(/^[\^~>=<]/, "");
            packagesToVendor.push({ name: depName, version: cleanVer });
          }
        }
      } catch {
        console.error(`Error: Failed to parse package.json at ${pkgJsonPath}`);
        process.exit(1);
      }
    }

    const packageMoPath = path.join(cwd, "package.mo");
    if (existsSync(packageMoPath)) {
      try {
        const moContent = readFileSync(packageMoPath, "utf-8");
        const usesDeps = parsePackageUses(moContent);
        for (const [depName, depVer] of Object.entries(usesDeps)) {
          if (!packagesToVendor.some((p) => p.name === depName)) {
            const normalizedVer = DependencySolver.normalizeModelicaVersion(depVer);
            packagesToVendor.push({ name: depName, version: normalizedVer });
          }
        }
      } catch {
        // ignore
      }
    }

    if (packagesToVendor.length === 0) {
      if (!args.json) {
        console.log("No dependencies found in workspace to vendor.");
      } else {
        console.log(JSON.stringify({ status: "empty", vendoredCount: 0 }));
      }
      return;
    }

    const API_URL = getApiUrl();
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
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
    const rootRequirements = packagesToVendor.map((p) => ({
      name: p.name,
      range: p.version || "*",
      source: "project",
    }));

    if (!args.json) {
      console.log(`Resolving transitive dependency tree for ${rootRequirements.length} root package(s)...`);
    }

    const solution = await solver.solve(rootRequirements);
    if (!solution.success) {
      console.error(`\n❌ Dependency resolution failed:\n${solution.error}\n`);
      process.exit(1);
    }

    mkdirSync(outDir, { recursive: true });
    const archivesDir = path.join(outDir, "archives");
    if (saveArchives) {
      mkdirSync(archivesDir, { recursive: true });
    }

    const vendorManifest: VendorManifest = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      sourceWorkspace: cwd,
      packages: {},
    };

    for (const pkgName of solution.order) {
      const resolvedVersion = solution.packages[pkgName]?.version;
      if (!resolvedVersion) continue;

      if (!args.json) {
        console.log(`Vendoring ${pkgName}@${resolvedVersion}...`);
      }

      const packagePath = pkgName.startsWith("@")
        ? pkgName.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(pkgName);
      const downloadUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/download`;

      let buffer: Buffer;
      let integrity: string;

      const lockedPkg = lockfile?.packages[pkgName];
      const lockedIntegrity = lockedPkg?.integrity;

      if (lockedIntegrity && defaultPackageStore.hasPackage(pkgName, resolvedVersion, lockedIntegrity)) {
        const cachedArchive = defaultPackageStore.getCachedArchive(lockedIntegrity);
        if (cachedArchive) {
          buffer = cachedArchive;
          integrity = lockedIntegrity;
        } else {
          const storePath = defaultPackageStore.getPackageStorePath(pkgName, resolvedVersion, lockedIntegrity);
          const zip = new AdmZip();
          zip.addLocalFolder(storePath);
          buffer = zip.toBuffer();
          integrity = lockedIntegrity;
        }
      } else {
        const dlRes = await fetch(downloadUrl, { headers });
        if (!dlRes.ok) {
          throw new Error(`Failed to download ${pkgName}@${resolvedVersion} (${dlRes.status}): ${dlRes.statusText}`);
        }
        const ab = await dlRes.arrayBuffer();
        buffer = Buffer.from(ab);
        integrity = computeBufferIntegrity(buffer);
      }

      // Store in global store for fast caching
      defaultPackageStore.extractToStore(pkgName, resolvedVersion, integrity, buffer);

      // Extract to vendor directory: vendor/<sanitizedName>/<version>/
      const sanitizedName = pkgName.replace(/^@/, "").replace(/[/\\]/g, "-");
      const targetPkgDir = path.join(outDir, sanitizedName, resolvedVersion);
      mkdirSync(targetPkgDir, { recursive: true });

      const zip = new AdmZip(buffer);
      zip.extractAllTo(targetPkgDir, true);

      let archiveRelPath: string | undefined;
      if (saveArchives) {
        const archiveFilename = `${sanitizedName}-${resolvedVersion}.zip`;
        const archiveFile = path.join(archivesDir, archiveFilename);
        writeFileSync(archiveFile, buffer);
        archiveRelPath = path.relative(outDir, archiveFile);
      }

      vendorManifest.packages[pkgName] = {
        version: resolvedVersion,
        integrity,
        directory: path.relative(outDir, targetPkgDir),
        archive: archiveRelPath,
        dependencies: solution.packages[pkgName]?.dependencies,
      };
    }

    const manifestJsonPath = path.join(outDir, "vendor-manifest.json");
    writeFileSync(manifestJsonPath, JSON.stringify(vendorManifest, null, 2), "utf-8");

    if (args.json) {
      console.log(
        JSON.stringify({
          status: "success",
          outDir,
          vendoredCount: Object.keys(vendorManifest.packages).length,
          packages: vendorManifest.packages,
        }),
      );
    } else {
      console.log(
        `\n✅ Vendored ${Object.keys(vendorManifest.packages).length} package(s) into: ${path.relative(cwd, outDir) || outDir}`,
      );
      console.log(`Manifest written to: ${path.relative(cwd, manifestJsonPath)}`);
      console.log("Your workspace can now be built completely offline without registry connectivity.\n");
    }
  },
};
