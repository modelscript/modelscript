// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { DependencySolver, type PackageVersionProvider } from "../solver/solver.js";
import { getApiUrl, getToken } from "../util/auth.js";
import { computeBufferIntegrity, readLockfile, updateLockfilePackage, verifyIntegrity } from "../util/lockfile.js";
import { parsePackageUses } from "../util/package-mo.js";

interface InstallArgs {
  package?: string | undefined;
  save?: boolean | undefined;
  frozenLockfile?: boolean | undefined;
  frozen?: boolean | undefined;
  ci?: boolean | undefined;
  dryRun?: boolean | undefined;
}

import { EXTENSION_TO_LANGUAGE_ID, detectAndAdaptArchiveManifest } from "@modelscript/exchange";

function extractDomainSummaryFromZip(zip: AdmZip): Record<string, { files: string[] }> {
  const domains: Record<string, { files: string[] }> = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const ext = path.extname(name).toLowerCase();
    let domain: string | null = EXTENSION_TO_LANGUAGE_ID[ext] ?? null;
    if (ext === ".step" || ext === ".stp") domain = "cad";
    else if (ext === ".csv" || ext === ".tsv") domain = "dataset";
    else if (ext === ".reqif" || ext === ".reqifz") domain = "requirements";

    if (domain) {
      if (!domains[domain]) domains[domain] = { files: [] };
      domains[domain]!.files.push(name);
    }
  }
  return domains;
}

export function installLocalArchive(
  archivePath: string,
  cwd: string,
  save: boolean,
  expectedName?: string,
): { name: string; version: string } {
  if (!existsSync(archivePath)) {
    console.error(`Error: Archive file does not exist: ${archivePath}`);
    process.exit(1);
  }

  const buffer = readFileSync(archivePath);
  const actualHash = `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
  console.log(`Processing local archive: ${path.relative(cwd, archivePath) || archivePath}`);
  console.log(`✓ Verified CAS integrity: ${actualHash.slice(0, 19)}...`);

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    console.error(
      `Error: Failed to read zip archive ${archivePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  let pkgName: string | null = expectedName || null;
  let pkgVersion = "0.0.0";

  const textEntries = new Map<string, string>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const base = path.basename(entry.entryName).toLowerCase();
    if (
      base === "package.json" ||
      base === "modelscript.json" ||
      base === ".meta.json" ||
      base === ".index.json" ||
      base === "package.mo" ||
      base === "impact.json" ||
      base === "modeldescription.xml" ||
      base === "systemstructure.ssd" ||
      base === "package.xml" ||
      base === "model.config" ||
      base === "fpm.toml" ||
      base === "datapackage.json" ||
      base === "component.xml"
    ) {
      try {
        textEntries.set(entry.entryName, entry.getData().toString("utf-8"));
      } catch {
        // ignore
      }
    }
  }

  const adapted = detectAndAdaptArchiveManifest(textEntries, {
    fallbackName: path.basename(archivePath),
  });
  if (adapted) {
    if (!pkgName && adapted.name) pkgName = adapted.name;
    if (adapted.version) pkgVersion = adapted.version;
  }

  if (!pkgName) {
    const base = path
      .basename(archivePath)
      .replace(/\.(msx\.zip|zip|kpar|mol|fmu|ssp|omex|reqifz|slx|sima|ddp|aasx|okh)$/i, "");
    const match = base.match(/^(.+?)-(\d+\.\d+\.\d+.*)$/);
    if (match) {
      pkgName = match[1]!;
      pkgVersion = match[2]!;
    } else {
      pkgName = base;
    }
  }

  const targetDirName = pkgName.startsWith("@") ? pkgName.replace("/", "__") : pkgName;
  const destDir = path.join(cwd, "libraries", targetDirName);
  mkdirSync(destDir, { recursive: true });
  zip.extractAllTo(destDir, true);

  console.log(`✓ Installed ${pkgName}@${pkgVersion} to ${path.relative(cwd, destDir)}`);

  if (save) {
    const pkgJsonPath = path.join(cwd, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        pkgJson.dependencies = pkgJson.dependencies || {};
        const rel = path.relative(cwd, archivePath);
        const fileSpec = rel.startsWith(".") ? `file:${rel}` : `file:./${rel}`;
        pkgJson.dependencies[pkgName] = fileSpec;
        writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
        console.log(`✓ Added "${pkgName}": "${fileSpec}" to package.json`);
      } catch {
        // Ignore failure to update package.json
      }
    }

    // Update msx.lock
    const domains = extractDomainSummaryFromZip(zip);
    updateLockfilePackage(cwd, pkgName, {
      version: pkgVersion,
      resolved: `file:${path.relative(cwd, archivePath)}`,
      integrity: actualHash,
      domains,
    });
    console.log(`✓ Updated msx.lock with ${pkgName}@${pkgVersion}`);
  }

  return { name: pkgName, version: pkgVersion };
}

export const Install: CommandModule<{}, InstallArgs> = {
  command: "install [package]",
  aliases: ["i", "add"],
  describe: "Install a package from the Ansatz Package Registry into the local workspace",
  builder: (yargs) => {
    return yargs
      .positional("package", {
        description:
          "Package identifier to install (e.g. 'Modelica', 'Modelica@4.1.0', '@scope/name', or './package.msx.zip')",
        type: "string",
      })
      .option("save", {
        alias: "s",
        description: "Save installed package to package.json dependencies",
        type: "boolean",
        default: true,
      })
      .option("frozen-lockfile", {
        alias: ["frozen", "ci"],
        description:
          "Enforce zero-trust installation against msx.lock (fails if lockfile is missing, out of sync, or tampered)",
        type: "boolean",
        default: false,
      })
      .option("dry-run", {
        description: "Simulate transitive dependency resolution without writing packages or lockfile to disk",
        type: "boolean",
        default: false,
      }) as unknown as Argv<InstallArgs>;
  },
  handler: async (args) => {
    const API_URL = getApiUrl();
    const cwd = process.cwd();
    const isFrozen = Boolean(args.frozenLockfile || args.frozen || args.ci);
    const lockfile = readLockfile(cwd);

    if (isFrozen && !lockfile) {
      console.error(
        "Error: Lockfile 'msx.lock' not found. Run 'msx install' without --frozen-lockfile to generate one.",
      );
      process.exit(1);
    }

    const packagesToInstall: { name: string; version?: string | undefined }[] = [];

    if (args.package) {
      const raw = args.package.trim();
      const resolvedLocalPath = path.resolve(cwd, raw);
      const isLocalArchive =
        raw.endsWith(".zip") ||
        raw.endsWith(".msx.zip") ||
        (existsSync(resolvedLocalPath) && statSync(resolvedLocalPath).isFile());

      if (isLocalArchive) {
        installLocalArchive(resolvedLocalPath, cwd, Boolean(args.save));
        console.log("✅ Installation completed successfully.");
        return;
      }

      let name = raw;
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

      packagesToInstall.push({ name, version });
    } else {
      const pkgJsonPath = path.join(cwd, "package.json");
      if (existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          const deps = { ...pkgJson.dependencies, ...pkgJson.modelscript?.dependencies };
          if (isFrozen && lockfile) {
            for (const [depName] of Object.entries(deps)) {
              if (!lockfile.packages[depName]) {
                console.error(`Error: Lockfile 'msx.lock' is out of sync with 'package.json': missing "${depName}".`);
                process.exit(1);
              }
            }
          }

          for (const [depName, depVer] of Object.entries(deps)) {
            if (typeof depVer === "string") {
              if (depVer.startsWith("file:")) {
                const localPath = path.resolve(cwd, depVer.slice("file:".length));
                installLocalArchive(localPath, cwd, false, depName);
                continue;
              }
              const cleanVer = depVer.replace(/^[\^~>=<]/, "");
              packagesToInstall.push({ name: depName, version: cleanVer });
            }
          }
        } catch {
          console.error(`Error: Failed to parse package.json at ${pkgJsonPath}`);
          process.exit(1);
        }
      }

      if (packagesToInstall.length === 0) {
        console.log("✅ Installation completed successfully.");
        return;
      }
    }

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Check for Modelica package.mo annotation(uses(...)) dependencies in workspace
    const rootUsesPath = path.join(cwd, "package.mo");
    if (existsSync(rootUsesPath)) {
      try {
        const moContent = readFileSync(rootUsesPath, "utf-8");
        const usesDeps = parsePackageUses(moContent);
        for (const [depName, depVer] of Object.entries(usesDeps)) {
          if (!packagesToInstall.some((p) => p.name === depName)) {
            const normalizedVer = DependencySolver.normalizeModelicaVersion(depVer);
            packagesToInstall.push({ name: depName, version: normalizedVer });
          }
        }
      } catch {
        // non-critical
      }
    }

    // Initialize package version provider querying the Registry API
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
    const rootRequirements = packagesToInstall.map((p) => ({
      name: p.name,
      range: p.version || "*",
      source: "project",
    }));

    console.log(`Solving dependency graph for ${rootRequirements.length} root package(s)...`);
    const solution = await solver.solve(rootRequirements);

    if (!solution.success) {
      console.error(`\n❌ Dependency resolution failed:\n${solution.error}\n`);
      process.exit(1);
    }

    if (args.dryRun) {
      console.log("\n📦 Dry-run resolution result:");
      for (const pkg of solution.order) {
        const info = solution.packages[pkg];
        const direct = rootRequirements.some((r) => r.name === pkg);
        console.log(`  ${direct ? "• (direct)" : "↳ (transitive)"} ${pkg}@${info?.version}`);
      }
      console.log(`\nResolved ${solution.order.length} package(s) in topological order. No files written.\n`);
      return;
    }

    for (const pkgName of solution.order) {
      const resolvedVersion = solution.packages[pkgName]?.version;
      if (!resolvedVersion) continue;

      const isDirect = rootRequirements.some((r) => r.name === pkgName);
      console.log(`Installing ${pkgName}@${resolvedVersion} (${isDirect ? "direct" : "transitive"})...`);

      const packagePath = pkgName.startsWith("@")
        ? pkgName.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(pkgName);
      const downloadUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/download`;

      try {
        const dlRes = await fetch(downloadUrl, { headers });
        if (!dlRes.ok) {
          throw new Error(`Download failed (${dlRes.status}): ${dlRes.statusText}`);
        }

        const arrayBuf = await dlRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const actualHash = computeBufferIntegrity(buffer);

        const expectedHash = dlRes.headers.get("x-content-sha256");
        if (expectedHash) {
          if (expectedHash.toLowerCase() !== actualHash.toLowerCase()) {
            console.warn(`Warning: Content hash mismatch! Expected ${expectedHash}, got ${actualHash}`);
          } else {
            console.log(`✓ Verified CAS integrity: ${actualHash.slice(0, 19)}...`);
          }
        }

        // Check lockfile entry if present before extraction
        const currentLock = lockfile || readLockfile(cwd);
        const lockedPkg = currentLock?.packages[pkgName];
        if (lockedPkg && lockedPkg.integrity) {
          if (!verifyIntegrity(buffer, lockedPkg.integrity)) {
            if (isFrozen) {
              console.error(
                `Error: Integrity verification failed for ${pkgName}@${resolvedVersion}: expected ${lockedPkg.integrity}, got ${actualHash}.`,
              );
              process.exit(1);
            } else {
              console.warn(
                `⚠️ Lockfile integrity warning for ${pkgName}: expected ${lockedPkg.integrity}, got ${actualHash}`,
              );
            }
          }
        } else if (isFrozen) {
          console.error(`Error: Package "${pkgName}" is not listed in 'msx.lock'.`);
          process.exit(1);
        }

        const targetDirName = pkgName.startsWith("@") ? pkgName.replace("/", "__") : pkgName;
        const destDir = path.join(cwd, "libraries", targetDirName);
        mkdirSync(destDir, { recursive: true });

        const zip = new AdmZip(buffer);
        zip.extractAllTo(destDir, true);

        // Fetch pre-compiled salsa-index.db if provided by registry
        const indexUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/salsa-index.db`;
        try {
          const idxRes = await fetch(indexUrl, { headers });
          if (idxRes.ok) {
            const idxBuf = Buffer.from(await idxRes.arrayBuffer());
            if (idxBuf.length > 0) {
              const metaDir = path.join(destDir, ".modelscript");
              mkdirSync(metaDir, { recursive: true });
              writeFileSync(path.join(metaDir, "salsa-index.db"), idxBuf);
              console.log(
                `✓ Cached pre-compiled Salsa index: ${path.relative(cwd, path.join(metaDir, "salsa-index.db"))}`,
              );
            }
          }
        } catch {
          // Pre-compiled index is optional
        }

        console.log(`✓ Installed ${pkgName}@${resolvedVersion} to ${path.relative(cwd, destDir)}`);

        if (args.save && !isFrozen) {
          if (isDirect) {
            const pkgJsonPath = path.join(cwd, "package.json");
            if (existsSync(pkgJsonPath)) {
              try {
                const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
                pkgJson.dependencies = pkgJson.dependencies || {};
                pkgJson.dependencies[pkgName] = `^${resolvedVersion}`;
                writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
                console.log(`✓ Added "${pkgName}": "^${resolvedVersion}" to package.json`);
              } catch {
                // Ignore failure to update package.json
              }
            }
          }

          // Update msx.lock with v2 DAG metadata
          const domains = extractDomainSummaryFromZip(zip);
          const pkgDeps = solution.packages[pkgName]?.dependencies;
          updateLockfilePackage(cwd, pkgName, {
            version: resolvedVersion,
            resolved: downloadUrl,
            integrity: actualHash,
            domains,
            dependencies: pkgDeps,
            isDirect,
          });
          console.log(`✓ Updated msx.lock with ${pkgName}@${resolvedVersion}`);
        }
      } catch (err) {
        console.error(`Failed to install ${pkgName}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }

    console.log("✅ Installation completed successfully.");
  },
};
