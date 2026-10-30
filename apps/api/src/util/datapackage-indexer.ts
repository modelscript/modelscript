// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type DataPackageLockEntry,
  type DataPackageLockJson,
  type DataPackageResourceDescriptor,
  type DataPackageSchemaField,
  parseDataPackageResources,
} from "@modelscript/exchange";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { initializeArtifactSystem } from "../artifacts/index.js";
import { getArtifactRegistry } from "../artifacts/registry.js";
import type { LibraryDatabase } from "../database.js";
import type { LibraryStorage } from "../storage.js";

function sha256Hex(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function inferArtifactTypeFromResource(resPath: string, format?: string, profile?: string): string {
  const lowerPath = resPath.toLowerCase();
  const lowerFmt = (format ?? "").toLowerCase();
  const lowerProf = (profile ?? "").toLowerCase();

  if (
    lowerProf.includes("tabular") ||
    lowerProf.includes("data") ||
    lowerFmt === "csv" ||
    lowerFmt === "tsv" ||
    lowerFmt === "parquet" ||
    lowerFmt === "arrow" ||
    lowerFmt === "hdf5" ||
    lowerFmt === "mat" ||
    lowerPath.endsWith(".csv") ||
    lowerPath.endsWith(".tsv") ||
    lowerPath.endsWith(".parquet") ||
    lowerPath.endsWith(".arrow") ||
    lowerPath.endsWith(".h5") ||
    lowerPath.endsWith(".hdf5") ||
    lowerPath.endsWith(".mat")
  ) {
    return "dataset";
  }
  if (lowerFmt === "fmu" || lowerPath.endsWith(".fmu")) return "fmu";
  if (lowerFmt === "step" || lowerFmt === "stp" || lowerPath.endsWith(".step") || lowerPath.endsWith(".stp")) {
    return "cad";
  }
  if (lowerFmt === "sysml" || lowerFmt === "sysml2" || lowerPath.endsWith(".sysml")) return "sysml";
  return "dataset";
}

/**
 * Synchronously or asynchronously index declared `datapackage.json` / `package.json` `resources[]`
 * (including CAS/S3 external dataset pointers and inline CSV/TSV/Parquet files) into the `artifacts` table.
 */
export async function indexDataPackageResources(
  database: LibraryDatabase,
  versionId: number,
  libraryPath: string,
  manifestStr?: string,
): Promise<DataPackageResourceDescriptor[]> {
  initializeArtifactSystem();
  const registry = getArtifactRegistry();

  const declaredByPath = new Map<string, DataPackageResourceDescriptor>();

  const ingestRawManifest = (rawContent: string) => {
    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      const msx =
        parsed["modelscript"] && typeof parsed["modelscript"] === "object"
          ? (parsed["modelscript"] as Record<string, unknown>)
          : undefined;
      const list = parseDataPackageResources(parsed["resources"] ?? msx?.["resources"]);
      for (const r of list) {
        const cleanPath = r.path.replace(/\\/g, "/").replace(/^\.\//, "");
        declaredByPath.set(cleanPath, { ...r, path: cleanPath });
      }
    } catch {
      // ignore invalid JSON
    }
  };

  if (manifestStr) {
    ingestRawManifest(manifestStr);
  }

  for (const candidate of ["datapackage.json", "package.json", "modelscript.json"]) {
    const p = path.join(libraryPath, candidate);
    if (fs.existsSync(p)) {
      try {
        ingestRawManifest(fs.readFileSync(p, "utf-8"));
      } catch {
        // ignore
      }
    }
  }

  // Also scan extracted directory for dataset files (.csv, .tsv, .parquet, .arrow, .h5, .hdf5)
  const discoveredFiles = new Set<string>();
  const walk = (dir: string, prefix = "") => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".csv", ".tsv", ".parquet", ".arrow", ".h5", ".hdf5", ".mat"].includes(ext)) {
          discoveredFiles.add(rel);
        }
      }
    }
  };
  walk(libraryPath);

  const allResourcePaths = new Set<string>([...declaredByPath.keys(), ...discoveredFiles]);
  const indexedResources: DataPackageResourceDescriptor[] = [];

  for (const relPath of allResourcePaths) {
    const declared = declaredByPath.get(relPath);
    const fullPath = path.resolve(libraryPath, relPath);
    const safeBase = path.resolve(libraryPath);
    const isInsideArchive =
      (fullPath === safeBase || fullPath.startsWith(safeBase + path.sep)) &&
      fs.existsSync(fullPath) &&
      fs.statSync(fullPath).isFile();

    const artifactType = inferArtifactTypeFromResource(relPath, declared?.format, declared?.profile);
    let extractedDetails: Record<string, unknown> = {};

    if (isInsideArchive) {
      try {
        const fileBuf = fs.readFileSync(fullPath);
        const meta = await registry.extractMetadata(artifactType, fileBuf, relPath);
        if (meta?.details) {
          extractedDetails = meta.details;
        } else {
          extractedDetails = {
            bytes: fileBuf.length,
            hash: `sha256:${sha256Hex(fileBuf)}`,
            storage: "inline",
          };
        }
      } catch {
        // ignore extraction failure
      }
    }

    // Merge declared Frictionless schema fields (units, descriptions, constraints) with extracted stats
    const extractedCols = Array.isArray(extractedDetails["columns"])
      ? (extractedDetails["columns"] as Record<string, unknown>[])
      : [];
    const declaredFields = declared?.schema?.fields ?? [];

    const mergedColumns: DataPackageSchemaField[] = [];
    if (extractedCols.length > 0) {
      const declaredMap = new Map(declaredFields.map((f) => [f.name.toLowerCase(), f]));
      for (const col of extractedCols) {
        const colName = String(col["name"] ?? "");
        const decl = declaredMap.get(colName.toLowerCase());
        mergedColumns.push({
          name: decl?.name ?? colName,
          type: (decl?.type ??
            (col["type"] as DataPackageSchemaField["type"]) ??
            "string") as DataPackageSchemaField["type"],
          title: decl?.title,
          description: decl?.description,
          unit: decl?.unit ?? (typeof col["unit"] === "string" ? col["unit"] : undefined),
          min: typeof col["min"] === "number" ? col["min"] : decl?.min,
          max: typeof col["max"] === "number" ? col["max"] : decl?.max,
          mean: typeof col["mean"] === "number" ? col["mean"] : decl?.mean,
          unique: typeof col["unique"] === "number" ? col["unique"] : decl?.unique,
        });
      }
    } else if (declaredFields.length > 0) {
      mergedColumns.push(...declaredFields);
    }

    const fallbackName =
      relPath
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-") || "dataset";

    const resolvedFormat =
      declared?.format ??
      (typeof extractedDetails["format"] === "string"
        ? extractedDetails["format"]
        : path.extname(relPath).replace(/^\./, "").toLowerCase() || "csv");

    const resolvedStorage: "inline" | "cas" | "s3" = declared?.storage ?? (isInsideArchive ? "inline" : "cas");

    const resolvedHash =
      declared?.hash ?? (typeof extractedDetails["hash"] === "string" ? extractedDetails["hash"] : undefined);

    const resolvedBytes =
      declared?.bytes ?? (typeof extractedDetails["bytes"] === "number" ? extractedDetails["bytes"] : undefined);

    const resolvedRowCount =
      declared?.rowCount ??
      (typeof extractedDetails["rowCount"] === "number" ? extractedDetails["rowCount"] : undefined);

    const mergedDetails: Record<string, unknown> = {
      ...extractedDetails,
      name: declared?.name ?? fallbackName,
      title: declared?.title,
      description: declared?.description,
      profile: declared?.profile ?? (artifactType === "dataset" ? "tabular-data-resource" : `${artifactType}-resource`),
      format: resolvedFormat,
      mediatype:
        declared?.mediatype ??
        (typeof extractedDetails["mediatype"] === "string" ? extractedDetails["mediatype"] : undefined),
      bytes: resolvedBytes,
      hash: resolvedHash,
      storage: resolvedStorage,
      rowCount: resolvedRowCount ?? 0,
      columns: mergedColumns,
      schema: mergedColumns.length > 0 ? { fields: mergedColumns } : declared?.schema,
    };

    database.storeArtifact(versionId, artifactType, relPath, JSON.stringify(mergedDetails));

    indexedResources.push({
      name: String(mergedDetails["name"]),
      path: relPath,
      title: declared?.title,
      description: declared?.description,
      profile: String(mergedDetails["profile"]),
      format: resolvedFormat,
      mediatype: typeof mergedDetails["mediatype"] === "string" ? mergedDetails["mediatype"] : undefined,
      bytes: resolvedBytes,
      hash: resolvedHash,
      storage: resolvedStorage,
      rowCount: resolvedRowCount,
      schema: mergedColumns.length > 0 ? { fields: mergedColumns } : declared?.schema,
    });
  }

  return indexedResources;
}

/**
 * Convert stored database artifact rows for a package version into Frictionless DataPackageResourceDescriptors.
 */
export function getPackageVersionResources(
  database: LibraryDatabase,
  packageName: string,
  version: string,
): DataPackageResourceDescriptor[] {
  const pkg = database.getPackage(packageName);
  if (!pkg) return [];
  const verRow = database.getPackageVersion(pkg.id, version);
  if (!verRow) return [];

  const rows = database.getArtifacts(verRow.id);
  const resources: DataPackageResourceDescriptor[] = [];

  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        meta = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }

    const fallbackName =
      row.path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-") || `artifact-${row.id}`;

    const cols = Array.isArray(meta["columns"]) ? (meta["columns"] as DataPackageSchemaField[]) : [];
    const schemaFields =
      meta["schema"] &&
      typeof meta["schema"] === "object" &&
      Array.isArray((meta["schema"] as { fields?: unknown })["fields"])
        ? ((meta["schema"] as { fields: DataPackageSchemaField[] })["fields"] ?? cols)
        : cols;

    resources.push({
      name: typeof meta["name"] === "string" && meta["name"] ? meta["name"] : fallbackName,
      path: row.path,
      title: typeof meta["title"] === "string" ? meta["title"] : undefined,
      description: typeof meta["description"] === "string" ? meta["description"] : undefined,
      profile:
        typeof meta["profile"] === "string"
          ? meta["profile"]
          : row.type === "dataset"
            ? "tabular-data-resource"
            : `${row.type}-resource`,
      format:
        typeof meta["format"] === "string"
          ? meta["format"]
          : path.extname(row.path).replace(/^\./, "").toLowerCase() || row.type,
      mediatype: typeof meta["mediatype"] === "string" ? meta["mediatype"] : undefined,
      bytes: typeof meta["bytes"] === "number" ? meta["bytes"] : undefined,
      hash: typeof meta["hash"] === "string" ? meta["hash"] : undefined,
      storage:
        meta["storage"] === "cas" || meta["storage"] === "s3" || meta["storage"] === "inline"
          ? meta["storage"]
          : "inline",
      rowCount: typeof meta["rowCount"] === "number" ? meta["rowCount"] : undefined,
      schema: schemaFields.length > 0 ? { fields: schemaFields } : undefined,
    });
  }

  return resources;
}

/**
 * Resolve a deterministic, content-addressed `datapackage.lock.json` across the package/dataset dependency graph.
 */
export function resolveDataPackageLockfile(
  storage: LibraryStorage,
  database: LibraryDatabase,
  rootName: string,
  rootVersion: string,
  options?: {
    extraDependencies?: Record<string, string> | undefined;
    sourceContent?: string | undefined;
    engine?: string | undefined;
    experiment?: DataPackageLockJson["experiment"] | undefined;
  },
): DataPackageLockJson {
  const packages: Record<string, DataPackageLockEntry> = {};
  const visited = new Set<string>();

  const resolveMatchingVersion = (depName: string, versionRange: string): string | null => {
    const available = storage.versions(depName);
    if (available.length === 0) {
      const pkg = database.getPackage(depName);
      if (!pkg) return semver.valid(versionRange) ? versionRange : null;
      return semver.valid(versionRange) ? versionRange : "1.0.0";
    }
    if (semver.valid(versionRange) && available.includes(versionRange)) {
      return versionRange;
    }
    const matched = semver.maxSatisfying(available, versionRange === "*" || !versionRange ? "*" : versionRange);
    return matched ?? available[0] ?? null;
  };

  const visitPackage = (pkgName: string, pkgVersion: string, isRoot = false) => {
    const key = `${pkgName}@${pkgVersion}`;
    if (visited.has(key)) return;
    visited.add(key);

    const release = database.getLibraryRelease(pkgName, pkgVersion);
    const contentHash =
      release?.content_hash ||
      storage.getContentHash(pkgName, pkgVersion) ||
      `sha256:${sha256Hex(`${pkgName}@${pkgVersion}`)}`;

    const pkgRecord = database.getPackage(pkgName);
    const verRow = pkgRecord ? database.getPackageVersion(pkgRecord.id, pkgVersion) : undefined;

    let deps: Record<string, string> = {};
    let profile: string | undefined;
    let manifestResources: DataPackageResourceDescriptor[] = [];

    if (verRow?.manifest) {
      try {
        const parsed = JSON.parse(verRow.manifest) as Record<string, unknown>;
        const msx =
          parsed["modelscript"] && typeof parsed["modelscript"] === "object"
            ? (parsed["modelscript"] as Record<string, unknown>)
            : undefined;
        if (parsed["dependencies"] && typeof parsed["dependencies"] === "object") {
          deps = { ...(parsed["dependencies"] as Record<string, string>) };
        }
        profile =
          typeof parsed["profile"] === "string"
            ? parsed["profile"]
            : typeof msx?.["profile"] === "string"
              ? msx["profile"]
              : undefined;
        manifestResources = parseDataPackageResources(parsed["resources"] ?? msx?.["resources"]);
      } catch {
        // ignore
      }
    }

    if (isRoot && options?.extraDependencies) {
      deps = { ...deps, ...options.extraDependencies };
    }

    const dbResources = getPackageVersionResources(database, pkgName, pkgVersion);
    const allResources = [...manifestResources];
    const seenPaths = new Set(allResources.map((r) => r.path));
    for (const r of dbResources) {
      if (!seenPaths.has(r.path)) {
        allResources.push(r);
        seenPaths.add(r.path);
      }
    }

    const lockedResources: NonNullable<DataPackageLockEntry["resources"]> = {};
    for (const r of allResources) {
      lockedResources[r.name] = {
        path: r.path,
        hash: r.hash ?? `sha256:${sha256Hex(`${key}:${r.path}`)}`,
        bytes: r.bytes,
        format: r.format,
        storage: r.storage ?? "inline",
      };
    }

    const encodedName = pkgName.startsWith("@")
      ? pkgName
          .split("/")
          .map((s) => encodeURIComponent(s))
          .join("/")
      : encodeURIComponent(pkgName);

    packages[key] = {
      version: pkgVersion,
      resolved: `/api/v1/libraries/${encodedName}/${encodeURIComponent(pkgVersion)}/download`,
      integrity: contentHash,
      profile:
        profile ?? (Object.keys(lockedResources).length > 0 ? "engineering-data-package" : "engineering-package"),
      dependencies: Object.keys(deps).length > 0 ? deps : undefined,
      resources: Object.keys(lockedResources).length > 0 ? lockedResources : undefined,
    };

    for (const [depName, depRange] of Object.entries(deps)) {
      const resolvedVer = resolveMatchingVersion(depName, depRange);
      if (resolvedVer) {
        visitPackage(depName, resolvedVer, false);
      }
    }
  };

  if (storage.exists(rootName, rootVersion) || database.getPackage(rootName)) {
    visitPackage(rootName, rootVersion, true);
  } else if (options?.extraDependencies) {
    for (const [depName, depRange] of Object.entries(options.extraDependencies)) {
      const resolvedVer = resolveMatchingVersion(depName, depRange);
      if (resolvedVer) {
        visitPackage(depName, resolvedVer, false);
      }
    }
  }

  const rootEntry = packages[`${rootName}@${rootVersion}`];
  const rootIntegrity =
    rootEntry?.integrity ??
    (options?.sourceContent
      ? `sha256:${sha256Hex(options.sourceContent)}`
      : `sha256:${sha256Hex(`${rootName}@${rootVersion}`)}`);

  // Deterministic canonical digest of the entire resolved lockfile state
  const sortedPackageKeys = Object.keys(packages).sort();
  const sortedPackages: Record<string, DataPackageLockEntry> = {};
  for (const k of sortedPackageKeys) {
    sortedPackages[k] = packages[k]!;
  }

  const canonicalPayload = JSON.stringify({
    name: rootName,
    version: rootVersion,
    rootIntegrity,
    compiler: {
      engine: options?.engine ?? "modelscript-wasm",
      version: "1.0.0",
    },
    experiment: options?.experiment ?? undefined,
    packages: sortedPackages,
  });
  const lockfileIntegrity = `sha256:${sha256Hex(canonicalPayload)}`;

  return {
    $schema: "https://modelscript.org/schemas/datapackage-lock-v1.json",
    lockfileVersion: 1,
    name: rootName,
    version: rootVersion,
    generatedAt: new Date().toISOString(),
    rootIntegrity,
    lockfileIntegrity,
    compiler: {
      engine: options?.engine ?? "modelscript-wasm",
      version: "1.0.0",
    },
    experiment: options?.experiment,
    packages: sortedPackages,
  };
}
