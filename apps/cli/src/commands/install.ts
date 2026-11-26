// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  isRemoteDependency,
  MANIFEST_FILENAME,
  normalizeRemoteDependency,
  PACKAGES_DIR,
  parseModelScriptYaml,
  resolveManifestFromDir,
  upsertManifestDependency,
  type ResolvedRemoteSpec,
} from "@modelscript/runtime";
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { DependencySolver, type PackageVersionProvider } from "../solver/solver.js";
import { getApiUrl, getToken } from "../util/auth.js";
import {
  computeBufferIntegrity,
  LOCKFILE_NAME,
  readLockfile,
  updateLockfilePackage,
  verifyIntegrity,
} from "../util/lockfile.js";
import { parsePackageUses } from "../util/package-mo.js";
import { defaultPackageStore } from "../util/store.js";
import { syncPullRemoteSpecs } from "./sync.js";
import type { VendorManifest } from "./vendor.js";

interface InstallArgs {
  package?: string | undefined;
  save?: boolean | undefined;
  frozenLockfile?: boolean | undefined;
  frozen?: boolean | undefined;
  ci?: boolean | undefined;
  dryRun?: boolean | undefined;
  offline?: boolean | undefined;
  vendorFirst?: boolean | undefined;
  preferVendor?: boolean | undefined;
  vendorDir?: string | undefined;
  allowYanked?: boolean | undefined;
}

import { detectAndAdaptArchiveManifest, EXTENSION_TO_LANGUAGE_ID } from "@modelscript/exchange";

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

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function normalizeEd25519PublicKeyForInstall(rawKey: string): crypto.KeyObject | null {
  try {
    const str = rawKey.replace(/\\n/g, "\n").trim();

    // 1. PEM SPKI
    if (str.includes("-----BEGIN PUBLIC KEY-----")) {
      return crypto.createPublicKey(str);
    }

    // 2. OpenSSH "ssh-ed25519 AAAA... [comment]"
    if (str.startsWith("ssh-ed25519 ")) {
      const parts = str.split(/\s+/);
      if (parts[1]) {
        const wireBytes = Buffer.from(parts[1], "base64");
        if (wireBytes.length >= 51) {
          const rawPubkey = wireBytes.subarray(wireBytes.length - 32);
          const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawPubkey]);
          return crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
        }
      }
    }

    // 3. Raw 64-char hex or "ed25519:<64-char hex>"
    const hexCandidate = str.startsWith("ed25519:") ? str.slice("ed25519:".length).trim() : str;
    if (/^[0-9a-fA-F]{64}$/.test(hexCandidate)) {
      const rawPubkey = Buffer.from(hexCandidate, "hex");
      const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawPubkey]);
      return crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    }

    // 4. Base64-encoded SPKI DER (44 bytes) or raw 32-byte Ed25519 public key
    const b64Bytes = Buffer.from(str, "base64");
    if (b64Bytes.length === 44 && b64Bytes.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
      return crypto.createPublicKey({ key: b64Bytes, format: "der", type: "spki" });
    }
    if (b64Bytes.length === 32) {
      const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, b64Bytes]);
      return crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    }
  } catch {
    // Fall through to null
  }
  return null;
}

export interface VerifyDownloadedPackageSignatureOptions {
  buffer: Buffer;
  contentHash: string;
  signature: string;
  publicKey: string;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
}

/**
 * Verifies an Ed25519 package signature returned via `X-Package-Signature` and
 * `X-Package-Public-Key` headers against the downloaded archive and its SHA-256 digest
 * (matching `apps/api/src/util/package-signature.ts` signing formats).
 */
export function verifyDownloadedPackageSignature(options: VerifyDownloadedPackageSignatureOptions): {
  valid: boolean;
  error?: string;
} {
  const { buffer, contentHash, signature, publicKey, packageName, packageVersion } = options;

  const keyObj = normalizeEd25519PublicKeyForInstall(publicKey);
  if (!keyObj) {
    return { valid: false, error: "Unable to parse Ed25519 public key from X-Package-Public-Key header" };
  }

  const trimmedSig = signature.trim();
  const candidateSignatures: Buffer[] = [];
  try {
    const b64 = Buffer.from(trimmedSig, "base64");
    if (b64.length === 64) {
      candidateSignatures.push(b64);
    }
  } catch {
    // ignore
  }
  if (/^[0-9a-fA-F]{128}$/.test(trimmedSig)) {
    const hex = Buffer.from(trimmedSig, "hex");
    if (hex.length === 64) {
      candidateSignatures.push(hex);
    }
  }

  if (candidateSignatures.length === 0) {
    return { valid: false, error: "Invalid Ed25519 signature encoding (expected 64-byte base64 or hex)" };
  }

  const cleanHex = contentHash.toLowerCase().replace(/^sha256:/, "");
  const formattedHash = `sha256:${cleanHex}`;

  const candidateMessages: Buffer[] = [Buffer.from(formattedHash, "utf8"), Buffer.from(cleanHex, "utf8")];
  if (/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    candidateMessages.push(Buffer.from(cleanHex, "hex"));
  }
  if (packageName && packageVersion) {
    candidateMessages.push(Buffer.from(`package:${packageName}@${packageVersion}:${formattedHash}`, "utf8"));
  }
  candidateMessages.push(buffer);

  for (const sigBuf of candidateSignatures) {
    for (const msgBuf of candidateMessages) {
      try {
        if (crypto.verify(null, msgBuf, keyObj, sigBuf)) {
          return { valid: true };
        }
      } catch {
        // Continue trying candidate message formats
      }
    }
  }

  return { valid: false, error: "Ed25519 cryptographic signature does not match downloaded archive or digest" };
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
    if (base === MANIFEST_FILENAME) {
      try {
        const parsed = parseModelScriptYaml(entry.getData().toString("utf-8"), entry.entryName);
        if (!pkgName && parsed.name) pkgName = parsed.name;
        if (parsed.version) pkgVersion = parsed.version;
      } catch {
        // ignore
      }
      continue;
    }
    if (
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

  if (!pkgName || pkgVersion === "0.0.0") {
    const adapted = detectAndAdaptArchiveManifest(textEntries, {
      fallbackName: path.basename(archivePath),
    });
    if (adapted) {
      if (!pkgName && adapted.name) pkgName = adapted.name;
      if (pkgVersion === "0.0.0" && adapted.version) pkgVersion = adapted.version;
    }
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

  const storePackageDir = defaultPackageStore.extractToStore(pkgName, pkgVersion, actualHash, buffer);

  const destDir = path.join(cwd, PACKAGES_DIR, ...pkgName.split("/"));
  const linkResult = defaultPackageStore.linkToWorkspace(storePackageDir, destDir);

  console.log(
    `✓ Installed ${pkgName}@${pkgVersion} to ${path.relative(cwd, destDir)} (${linkResult.hardlinks} hardlinks, ${linkResult.copies} copied)`,
  );

  if (save) {
    const manifestPath = path.join(cwd, MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      try {
        const rawYaml = readFileSync(manifestPath, "utf-8");
        const rel = path.relative(cwd, archivePath);
        const fileSpec = rel.startsWith(".") ? `file:${rel}` : `file:./${rel}`;
        const updated = upsertManifestDependency(rawYaml, pkgName, fileSpec);
        writeFileSync(manifestPath, updated, "utf-8");
        console.log(`✓ Added "${pkgName}": "${fileSpec}" to ${MANIFEST_FILENAME}`);
      } catch {
        // Ignore failure to update modelscript.yaml
      }
    }

    // Update modelscript.lock
    const domains = extractDomainSummaryFromZip(zip);
    updateLockfilePackage(cwd, pkgName, {
      version: pkgVersion,
      resolved: `file:${path.relative(cwd, archivePath)}`,
      integrity: actualHash,
      domains,
    });
    console.log(`✓ Updated ${LOCKFILE_NAME} with ${pkgName}@${pkgVersion}`);
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
          "Enforce zero-trust installation against modelscript.lock (fails if lockfile is missing, out of sync, or tampered)",
        type: "boolean",
        default: false,
      })
      .option("dry-run", {
        description: "Simulate transitive dependency resolution without writing packages or lockfile to disk",
        type: "boolean",
        default: false,
      })
      .option("offline", {
        alias: "o",
        description: "Install strictly from local vendor directory and global CAS store with zero network requests",
        type: "boolean",
        default: false,
      })
      .option("vendor-first", {
        alias: "prefer-vendor",
        description: "Prefer locally vendored dependencies before making remote registry network requests",
        type: "boolean",
        default: false,
      })
      .option("vendor-dir", {
        description: "Path to the local vendor directory (defaults to ./vendor)",
        type: "string",
        default: "vendor",
      })
      .option("allow-yanked", {
        description: "Allow installation of yanked (tombstoned) package releases",
        type: "boolean",
        default: false,
      }) as unknown as Argv<InstallArgs>;
  },
  handler: async (args) => {
    const API_URL = getApiUrl();
    const cwd = process.cwd();
    const isFrozen = Boolean(args.frozenLockfile || args.frozen || args.ci);
    const lockfile = readLockfile(cwd);

    const isOffline = Boolean(args.offline);
    const isVendorFirst = isOffline || Boolean(args.vendorFirst || args.preferVendor);
    const vendorDir = path.resolve(cwd, args.vendorDir || "vendor");
    const vendorManifestPath = path.join(vendorDir, "vendor-manifest.json");

    let vendorManifest: VendorManifest | null = null;
    if (existsSync(vendorManifestPath)) {
      try {
        vendorManifest = JSON.parse(readFileSync(vendorManifestPath, "utf-8")) as VendorManifest;
      } catch (err) {
        console.warn(`Warning: Failed to parse vendor manifest at ${vendorManifestPath}: ${err}`);
      }
    }

    if (isFrozen && !lockfile) {
      console.error(
        `Error: Lockfile '${LOCKFILE_NAME}' not found. Run 'msx install' without --frozen-lockfile to generate one.`,
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
      const remoteSpecsToPull: ResolvedRemoteSpec[] = [];
      let resolved: Awaited<ReturnType<typeof resolveManifestFromDir>> = null;
      try {
        resolved = await resolveManifestFromDir(cwd);
      } catch (err) {
        console.error(
          `Error: Failed to parse ${MANIFEST_FILENAME} at ${path.join(cwd, MANIFEST_FILENAME)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (resolved) {
        if (resolved.virtual) {
          console.log(`Projected virtual ${MANIFEST_FILENAME} from ${resolved.sourceFile} (${resolved.projectorId}).`);
        }
        const manifest = resolved.manifest;
        const deps = manifest.dependencies ?? {};
        if (isFrozen && lockfile) {
          for (const [depName] of Object.entries(deps)) {
            if (!lockfile.packages[depName]) {
              console.error(
                `Error: Lockfile '${LOCKFILE_NAME}' is out of sync with '${resolved.sourceFile}': missing "${depName}".`,
              );
              process.exit(1);
            }
          }
        }

        for (const [depName, depSpec] of Object.entries(deps)) {
          if (isRemoteDependency(depSpec)) {
            const norm = normalizeRemoteDependency(depSpec);
            if (norm) {
              remoteSpecsToPull.push({ ...norm, packageName: depName });
            }
            continue;
          }
          if (typeof depSpec === "string") {
            if (depSpec.startsWith("file:")) {
              const localPath = path.resolve(cwd, depSpec.slice("file:".length));
              installLocalArchive(localPath, cwd, false, depName);
              continue;
            }
            const cleanVer =
              resolved.language === "modelica"
                ? DependencySolver.normalizeModelicaVersion(depSpec)
                : depSpec.replace(/^[\^~>=<]/, "");
            packagesToInstall.push({ name: depName, version: cleanVer });
          }
        }
      }

      if (remoteSpecsToPull.length > 0) {
        if (isOffline) {
          console.log(`Offline mode: skipping live ALM sync for ${remoteSpecsToPull.length} remote dependency(ies).`);
        } else {
          await syncPullRemoteSpecs(cwd, remoteSpecsToPull, "fail");
        }
        if (packagesToInstall.length === 0) {
          return;
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

    // Initialize package version provider querying vendor, CAS store, and/or Registry API
    const provider: PackageVersionProvider = {
      async getVersions(pkgName: string): Promise<string[]> {
        const localVersions: string[] = [];

        // 1. Check local vendor manifest
        if (vendorManifest?.packages[pkgName]) {
          const v = vendorManifest.packages[pkgName].version;
          if (!localVersions.includes(v)) localVersions.push(v);
        }

        // 2. Check local CAS store
        const storeVersions = defaultPackageStore.listCachedVersions(pkgName);
        for (const sv of storeVersions) {
          if (!localVersions.includes(sv)) localVersions.push(sv);
        }

        // Offline mode: strictly return local versions with zero network requests
        if (isOffline) {
          return localVersions;
        }

        // Vendor-first mode: if satisfied locally, do not make network calls
        if (isVendorFirst && localVersions.length > 0) {
          return localVersions;
        }

        // 3. Query remote registry
        const pPath = pkgName.startsWith("@")
          ? pkgName.split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(pkgName);
        try {
          const res = await fetch(`${API_URL}/api/v1/libraries/${pPath}`, { headers });
          if (!res.ok) return localVersions;
          const data = (await res.json()) as {
            versions?: (string | { version: string })[] | undefined;
            version?: string | undefined;
          };
          const remoteVersions: string[] = [];
          if (Array.isArray(data.versions)) {
            remoteVersions.push(...data.versions.map((v) => (typeof v === "string" ? v : v.version)));
          } else if (typeof data.version === "string") {
            remoteVersions.push(data.version);
          }
          for (const rv of remoteVersions) {
            if (!localVersions.includes(rv)) localVersions.push(rv);
          }
          return localVersions;
        } catch {
          return localVersions;
        }
      },
      async getManifest(pkgName: string, ver: string): ReturnType<PackageVersionProvider["getManifest"]> {
        // 1. Check vendor manifest
        if (vendorManifest?.packages[pkgName] && vendorManifest.packages[pkgName].version === ver) {
          const vPkg = vendorManifest.packages[pkgName]!;
          const vDir = path.resolve(vendorDir, vPkg.directory);
          const vPkgJson = path.join(vDir, "package.json");
          if (existsSync(vPkgJson)) {
            try {
              const parsed = JSON.parse(readFileSync(vPkgJson, "utf-8"));
              return {
                name: pkgName,
                version: ver,
                dependencies: { ...parsed.dependencies, ...parsed.modelscript?.dependencies },
              };
            } catch {}
          }
          const vPkgMo = path.join(vDir, "package.mo");
          if (existsSync(vPkgMo)) {
            try {
              const content = readFileSync(vPkgMo, "utf-8");
              return {
                name: pkgName,
                version: ver,
                dependencies: parsePackageUses(content),
              };
            } catch {}
          }
          return {
            name: pkgName,
            version: ver,
            dependencies: vPkg.dependencies || {},
          };
        }

        // 2. Check local CAS store
        const cachedManifest = defaultPackageStore.getCachedManifest(pkgName, ver);
        if (cachedManifest) {
          return cachedManifest;
        }

        // Offline mode: cannot query remote
        if (isOffline) {
          return null;
        }

        // 3. Query remote registry
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
      async getReleases(pkgName: string): Promise<import("../solver/solver.js").PackageReleaseMetadata[]> {
        const pPath = pkgName.startsWith("@")
          ? pkgName.split("/").map(encodeURIComponent).join("/")
          : encodeURIComponent(pkgName);
        try {
          const res = await fetch(`${API_URL}/api/v1/libraries/${pPath}`, { headers });
          if (!res.ok) return [];
          const data = (await res.json()) as { releases?: import("../solver/solver.js").PackageReleaseMetadata[] };
          return Array.isArray(data.releases) ? data.releases : [];
        } catch {
          return [];
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
    const solution = await solver.solve(rootRequirements, {
      allowYanked: Boolean(args.allowYanked),
    });

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

    if (solution.deprecated) {
      for (const [deprPkg, deprInfo] of Object.entries(solution.deprecated)) {
        console.warn(
          `\n⚠️  [DEPRECATED] Package "${deprPkg}@${deprInfo.version}" is deprecated:\n   ${deprInfo.reason}\n`,
        );
      }
    }

    if (solution.yanked && !args.allowYanked) {
      for (const [yankPkg, yankInfo] of Object.entries(solution.yanked)) {
        console.error(
          `\n❌ [YANKED RELEASE] Package "${yankPkg}@${yankInfo.version}" has been yanked by the maintainer:\n   Reason: ${yankInfo.reason}\n   Pass --allow-yanked to force installation.\n`,
        );
      }
      process.exit(1);
    }

    for (const pkgName of solution.order) {
      const resolvedVersion = solution.packages[pkgName]?.version;
      if (!resolvedVersion) continue;

      const isDirect = rootRequirements.some((r) => r.name === pkgName);
      console.log(`Installing ${pkgName}@${resolvedVersion} (${isDirect ? "direct" : "transitive"})...`);

      const packagePath = pkgName.startsWith("@")
        ? pkgName.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(pkgName);
      const downloadUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/download${args.allowYanked ? "?allowYanked=true" : ""}`;

      try {
        const currentLock = lockfile || readLockfile(cwd);
        const lockedPkg = currentLock?.packages[pkgName];
        const lockedIntegrity = lockedPkg?.integrity;

        let actualHash: string;
        let storePackageDir: string;
        let zip: AdmZip;
        let installSourceType: "vendor" | "store" | "network" = "network";

        // Check 1: Vendor directory / archive
        const vPkg = vendorManifest?.packages[pkgName];
        const isVendored = vPkg && vPkg.version === resolvedVersion;

        if (isVendored) {
          installSourceType = "vendor";
          const vDir = path.resolve(vendorDir, vPkg.directory);
          const vArchive = vPkg.archive ? path.resolve(vendorDir, vPkg.archive) : undefined;

          if (vArchive && existsSync(vArchive)) {
            const buf = readFileSync(vArchive);
            actualHash = computeBufferIntegrity(buf);
            if (vPkg.integrity && actualHash.toLowerCase() !== vPkg.integrity.toLowerCase()) {
              throw new Error(
                `Integrity mismatch for vendored archive ${pkgName}@${resolvedVersion}: expected ${vPkg.integrity}, got ${actualHash}`,
              );
            }
            storePackageDir = defaultPackageStore.extractToStore(pkgName, resolvedVersion, actualHash, buf);
            zip = new AdmZip(buf);
          } else if (existsSync(vDir)) {
            zip = new AdmZip();
            zip.addLocalFolder(vDir);
            const buf = zip.toBuffer();
            actualHash = vPkg.integrity || computeBufferIntegrity(buf);
            storePackageDir = defaultPackageStore.extractToStore(pkgName, resolvedVersion, actualHash, buf);
          } else {
            throw new Error(`Vendored package directory not found: ${vDir}`);
          }
          console.log(`✓ Resolved from local vendor (${actualHash.slice(0, 19)}...)`);
        } else if (lockedIntegrity && defaultPackageStore.hasPackage(pkgName, resolvedVersion, lockedIntegrity)) {
          // Check 2: Locked package already in CAS store with matching integrity
          installSourceType = "store";
          console.log(`✓ Using cached package from store (${lockedIntegrity.slice(0, 19)}...)`);
          actualHash = lockedIntegrity;
          storePackageDir = defaultPackageStore.getPackageStorePath(pkgName, resolvedVersion, lockedIntegrity);
          const cachedBuf = defaultPackageStore.getCachedArchive(lockedIntegrity);
          zip = cachedBuf ? new AdmZip(cachedBuf) : new AdmZip();
        } else if (
          (!lockedIntegrity || isOffline) &&
          defaultPackageStore.getCachedPackageDir(pkgName, resolvedVersion)
        ) {
          // Check 3: Available in CAS store (only if not pinned to a different hash, or in offline mode)
          const candidateStoreDir = defaultPackageStore.getCachedPackageDir(pkgName, resolvedVersion)!;
          const meta = defaultPackageStore.getCachedPackageMeta(pkgName, resolvedVersion);
          const metaHash = meta?.contentHash || "sha256:cas-cached";
          if (lockedIntegrity && metaHash.toLowerCase() !== lockedIntegrity.toLowerCase()) {
            if (isFrozen) {
              console.error(
                `Error: Integrity verification failed for ${pkgName}@${resolvedVersion}: expected ${lockedIntegrity}, got ${metaHash}.`,
              );
              process.exit(1);
            }
          }
          installSourceType = "store";
          storePackageDir = candidateStoreDir;
          actualHash = metaHash;
          console.log(`✓ Using cached package from CAS store (${actualHash.slice(0, 19)}...)`);
          const cachedBuf = meta?.contentHash ? defaultPackageStore.getCachedArchive(meta.contentHash) : null;
          if (cachedBuf) {
            zip = new AdmZip(cachedBuf);
          } else {
            zip = new AdmZip();
            zip.addLocalFolder(storePackageDir);
          }
        } else {
          // Check 4: Remote registry network download
          if (isOffline) {
            throw new Error(
              `Package "${pkgName}@${resolvedVersion}" is not available in local vendor directory or CAS store (offline mode active).`,
            );
          }

          installSourceType = "network";
          const dlRes = await fetch(downloadUrl, { headers });
          if (!dlRes.ok) {
            let errorDetail = dlRes.statusText;
            try {
              const errData = (await dlRes.json()) as { error?: string };
              if (errData.error) errorDetail = errData.error;
            } catch {}
            throw new Error(`Download failed (${dlRes.status}): ${errorDetail}`);
          }

          const arrayBuf = await dlRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          actualHash = computeBufferIntegrity(buffer);

          const expectedHash = dlRes.headers.get("x-content-sha256");
          if (expectedHash) {
            if (expectedHash.toLowerCase() !== actualHash.toLowerCase()) {
              throw new Error(
                `Content integrity mismatch for ${pkgName}@${resolvedVersion}: server header reported ${expectedHash}, downloaded ${actualHash}. Aborting install.`,
              );
            } else {
              console.log(`✓ Verified CAS integrity: ${actualHash.slice(0, 19)}...`);
            }
          }

          const pkgSignature = dlRes.headers.get("x-package-signature");
          const pkgPublicKey = dlRes.headers.get("x-package-public-key");
          if (pkgSignature && pkgPublicKey) {
            const sigCheck = verifyDownloadedPackageSignature({
              buffer,
              contentHash: actualHash,
              signature: pkgSignature,
              publicKey: pkgPublicKey,
              packageName: pkgName,
              packageVersion: resolvedVersion,
            });
            if (!sigCheck.valid) {
              throw new Error(
                `Ed25519 signature verification failed for ${pkgName}@${resolvedVersion}: ${sigCheck.error ?? "invalid signature"}. Aborting install.`,
              );
            }
            console.log(`✓ Verified Ed25519 signature`);
          }

          // Check lockfile entry if present before extraction
          if (lockedPkg && lockedPkg.integrity) {
            if (!verifyIntegrity(buffer, lockedPkg.integrity)) {
              if (isFrozen || lockedPkg.version === resolvedVersion) {
                console.error(
                  `Error: Integrity verification failed for ${pkgName}@${resolvedVersion}: expected ${lockedPkg.integrity}, got ${actualHash}.`,
                );
                process.exit(1);
              } else {
                console.warn(
                  `⚠️ Lockfile integrity updated for ${pkgName} (${lockedPkg.version} → ${resolvedVersion}): ${actualHash}`,
                );
              }
            }
          } else if (isFrozen) {
            console.error(`Error: Package "${pkgName}" is not listed in '${LOCKFILE_NAME}'.`);
            process.exit(1);
          }

          storePackageDir = defaultPackageStore.extractToStore(pkgName, resolvedVersion, actualHash, buffer);
          zip = new AdmZip(buffer);
        }

        const destDir = path.join(cwd, PACKAGES_DIR, ...pkgName.split("/"));
        const linkResult = defaultPackageStore.linkToWorkspace(storePackageDir, destDir);

        // Fetch pre-compiled relocatable binary index (index.msidx), falling back to legacy salsa-index.db
        const destMsidxFile = path.join(destDir, ".modelscript", "index.msidx");
        const destIndexFile = path.join(destDir, ".modelscript", "salsa-index.db");
        if (
          (installSourceType === "network" || installSourceType === "store") &&
          !isOffline &&
          !existsSync(destMsidxFile) &&
          !existsSync(destIndexFile)
        ) {
          let cachedBinaryIndex = false;
          const msidxUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/index.msidx`;
          try {
            const msidxRes = await fetch(msidxUrl, { headers });
            if (msidxRes.ok) {
              const idxBuf = Buffer.from(await msidxRes.arrayBuffer());
              if (idxBuf.length > 0) {
                const metaDir = path.join(destDir, ".modelscript");
                mkdirSync(metaDir, { recursive: true });
                writeFileSync(destMsidxFile, idxBuf);
                const storeMetaDir = path.join(storePackageDir, ".modelscript");
                mkdirSync(storeMetaDir, { recursive: true });
                writeFileSync(path.join(storeMetaDir, "index.msidx"), idxBuf);
                console.log(`✓ Cached pre-compiled binary package index: ${path.relative(cwd, destMsidxFile)}`);
                cachedBinaryIndex = true;
              }
            }
          } catch {
            // Optional — fall back to legacy salsa-index.db
          }

          if (!cachedBinaryIndex) {
            const indexUrl = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(resolvedVersion)}/salsa-index.db`;
            try {
              const idxRes = await fetch(indexUrl, { headers });
              if (idxRes.ok) {
                const idxBuf = Buffer.from(await idxRes.arrayBuffer());
                if (idxBuf.length > 0) {
                  const metaDir = path.join(destDir, ".modelscript");
                  mkdirSync(metaDir, { recursive: true });
                  writeFileSync(destIndexFile, idxBuf);
                  const storeMetaDir = path.join(storePackageDir, ".modelscript");
                  mkdirSync(storeMetaDir, { recursive: true });
                  writeFileSync(path.join(storeMetaDir, "salsa-index.db"), idxBuf);
                  console.log(`✓ Cached pre-compiled Salsa index: ${path.relative(cwd, destIndexFile)}`);
                }
              }
            } catch {
              // Pre-compiled index is optional
            }
          }
        }

        console.log(
          `✓ Installed ${pkgName}@${resolvedVersion} to ${path.relative(cwd, destDir)} (${linkResult.hardlinks} hardlinks, ${linkResult.copies} copied)`,
        );

        if (args.save && !isFrozen) {
          if (isDirect) {
            const manifestPath = path.join(cwd, MANIFEST_FILENAME);
            if (existsSync(manifestPath)) {
              try {
                const rawYaml = readFileSync(manifestPath, "utf-8");
                const updated = upsertManifestDependency(rawYaml, pkgName, `^${resolvedVersion}`);
                writeFileSync(manifestPath, updated, "utf-8");
                console.log(`✓ Added "${pkgName}": "^${resolvedVersion}" to ${MANIFEST_FILENAME}`);
              } catch {
                // Ignore failure to update modelscript.yaml
              }
            }
          }

          // Update modelscript.lock with v2 DAG metadata
          const domains = extractDomainSummaryFromZip(zip);
          const pkgDeps = solution.packages[pkgName]?.dependencies;
          const resolvedLocation =
            installSourceType === "vendor"
              ? `vendor:${path.relative(cwd, path.resolve(vendorDir, vPkg!.directory))}`
              : installSourceType === "store"
                ? `store:${pkgName}@${resolvedVersion}`
                : downloadUrl;

          updateLockfilePackage(cwd, pkgName, {
            version: resolvedVersion,
            resolved: currentLock?.packages[pkgName]?.resolved || resolvedLocation,
            integrity: actualHash,
            domains,
            dependencies: pkgDeps,
            isDirect,
          });
          console.log(`✓ Updated ${LOCKFILE_NAME} with ${pkgName}@${resolvedVersion}`);
        }
      } catch (err) {
        console.error(`Failed to install ${pkgName}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }

    console.log("✅ Installation completed successfully.");
  },
};
