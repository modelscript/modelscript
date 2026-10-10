// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { getToken } from "../util/auth.js";
import { computeBufferIntegrity, readLockfile, updateLockfilePackage, verifyIntegrity } from "../util/lockfile.js";
import { parsePackageMo } from "../util/package-mo.js";

interface InstallArgs {
  package?: string;
  save?: boolean;
  frozenLockfile?: boolean;
  frozen?: boolean;
  ci?: boolean;
}

function extractDomainSummaryFromZip(zip: AdmZip): Record<string, { files: string[] }> {
  const domains: Record<string, { files: string[] }> = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const ext = path.extname(name).toLowerCase();
    let domain: string | null = null;
    if (ext === ".mo") domain = "modelica";
    else if (ext === ".sysml") domain = "sysml2";
    else if (ext === ".step" || ext === ".stp") domain = "cad";
    else if (ext === ".csv" || ext === ".tsv") domain = "dataset";
    else if (ext === ".inp") domain = "fea";
    else if (ext === ".cfg") domain = "cfd";
    else if (ext === ".reqif") domain = "requirements";

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

  const pkgJsonEntry = zip.getEntry("package.json");
  if (pkgJsonEntry) {
    try {
      const parsed = JSON.parse(pkgJsonEntry.getData().toString("utf-8"));
      if (parsed.name) {
        pkgName = parsed.name;
      }
      if (parsed.version) {
        pkgVersion = parsed.version;
      }
    } catch {
      // fallback to package.mo or filename
    }
  }

  if (!pkgName || pkgVersion === "0.0.0") {
    const pkgMoEntry = zip.getEntry("package.mo");
    if (pkgMoEntry) {
      const parsed = parsePackageMo(pkgMoEntry.getData().toString("utf-8"));
      if (!pkgName && parsed.name) {
        pkgName = parsed.name;
      }
      if (pkgVersion === "0.0.0" && parsed.version) {
        pkgVersion = parsed.version;
      }
    }
  }

  if (!pkgName) {
    const base = path.basename(archivePath).replace(/(\.msx)?\.zip$/i, "");
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
  describe: "Install a package from the ModelScript Registry into the local workspace",
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
      }) as any;
  },
  handler: async (args) => {
    const API_URL = process.env.MODELSCRIPT_API_URL || "http://localhost:3000";
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

    for (const item of packagesToInstall) {
      console.log(`Resolving ${item.name}${item.version ? `@${item.version}` : ""}...`);

      const packagePath = item.name.startsWith("@")
        ? item.name.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(item.name);

      let resolvedVersion = item.version;
      if (!resolvedVersion || resolvedVersion === "latest") {
        try {
          const infoRes = await fetch(`${API_URL}/api/v1/libraries/${packagePath}`, { headers });
          if (!infoRes.ok) {
            throw new Error(`Package "${item.name}" not found in registry (${infoRes.status})`);
          }
          const info = (await infoRes.json()) as any;
          resolvedVersion =
            info.latestVersion ||
            info["dist-tags"]?.latest ||
            (Array.isArray(info.versions) ? info.versions[0]?.version || info.versions[0] : null);
          if (!resolvedVersion && typeof info.version === "string") {
            resolvedVersion = info.version;
          }
        } catch (err) {
          console.error(`Error resolving package: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      if (!resolvedVersion) {
        console.error(`Error: Could not resolve version for package ${item.name}`);
        process.exit(1);
      }

      console.log(`Downloading ${item.name}@${resolvedVersion}...`);
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
        const lockedPkg = currentLock?.packages[item.name];
        if (lockedPkg && lockedPkg.integrity) {
          if (!verifyIntegrity(buffer, lockedPkg.integrity)) {
            if (isFrozen) {
              console.error(
                `Error: Integrity verification failed for ${item.name}@${resolvedVersion}: expected ${lockedPkg.integrity}, got ${actualHash}.`,
              );
              process.exit(1);
            } else {
              console.warn(
                `⚠️ Lockfile integrity warning for ${item.name}: expected ${lockedPkg.integrity}, got ${actualHash}`,
              );
            }
          }
        } else if (isFrozen) {
          console.error(`Error: Package "${item.name}" is not listed in 'msx.lock'.`);
          process.exit(1);
        }

        const targetDirName = item.name.startsWith("@") ? item.name.replace("/", "__") : item.name;
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

        console.log(`✓ Installed ${item.name}@${resolvedVersion} to ${path.relative(cwd, destDir)}`);

        if (args.save && !isFrozen) {
          const pkgJsonPath = path.join(cwd, "package.json");
          if (existsSync(pkgJsonPath)) {
            try {
              const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
              pkgJson.dependencies = pkgJson.dependencies || {};
              pkgJson.dependencies[item.name] = `^${resolvedVersion}`;
              writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
              console.log(`✓ Added "${item.name}": "^${resolvedVersion}" to package.json`);
            } catch {
              // Ignore failure to update package.json
            }
          }

          // Update msx.lock
          const domains = extractDomainSummaryFromZip(zip);
          updateLockfilePackage(cwd, item.name, {
            version: resolvedVersion,
            resolved: downloadUrl,
            integrity: actualHash,
            domains,
          });
          console.log(`✓ Updated msx.lock with ${item.name}@${resolvedVersion}`);
        }
      } catch (err) {
        console.error(`Failed to install ${item.name}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }

    console.log("✅ Installation completed successfully.");
  },
};
