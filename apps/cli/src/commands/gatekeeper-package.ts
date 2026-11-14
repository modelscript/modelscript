// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintPsse, parseRaw } from "@modelscript/psse";
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";

export interface GatekeeperInputDefaults {
  gridInterconnection?: string;
  ratedMva?: number;
  poiKv?: number;
}

interface RawManifestFields {
  submissionId?: string;
  developerOrganization?: string;
  plantName?: string;
  gridInterconnection?: string;
  ratedMva?: number;
  poiKv?: number;
  hasRawPowerFlow?: boolean;
  hasDyrDynamics?: boolean;
  hasPscadModel?: boolean;
  hasWasmFirmware?: boolean;
  rawPath?: string;
  dyrPath?: string;
  pscadPath?: string;
  wasmPath?: string;
  staticDiagnosticCount?: { errors: number; warnings: number };
  flatStartMaxDriftPercent?: number;
  lowestStableScr?: number;
  lvrtPass?: boolean;
  hvrtPass?: boolean;
  emtRmsNrmse?: number;
}

function collectDirectoryFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function analyzeRawContent(rawText: string): {
  staticDiagnosticCount: { errors: number; warnings: number };
  inferredSbase?: number | undefined;
  inferredBaseKv?: number | undefined;
} {
  try {
    const parsed = parseRaw(rawText);
    const diags = lintPsse(parsed);
    const errors = diags.filter((d) => d.severity === "error").length;
    const warnings = diags.filter((d) => d.severity === "warning").length;
    let maxBusKv: number | undefined;
    for (const bus of parsed.buses.values()) {
      const bkv = (bus as { basekv?: number }).basekv;
      if (typeof bkv === "number" && Number.isFinite(bkv) && bkv > 0) {
        maxBusKv = maxBusKv === undefined ? bkv : Math.max(maxBusKv, bkv);
      }
    }
    return {
      staticDiagnosticCount: { errors, warnings },
      inferredSbase: parsed.header.sbase > 0 ? parsed.header.sbase : undefined,
      inferredBaseKv: maxBusKv,
    };
  } catch {
    return {
      staticDiagnosticCount: { errors: 1, warnings: 0 },
    };
  }
}

function asFiniteNumber(val: unknown): number | undefined {
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

/**
 * Inspects a Gatekeeper submission input (.zip archive, directory, .json manifest, or model file)
 * and builds an honest `GatekeeperSubmissionPackage` payload without fabricating missing artifacts or metrics.
 */
export function buildGatekeeperPackageFromInput(
  inputPath: string,
  defaults: GatekeeperInputDefaults = {},
): Record<string, unknown> {
  const absPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Submission file or directory not found: ${absPath}`);
  }

  const stat = fs.statSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const baseDir = stat.isDirectory() ? absPath : path.dirname(absPath);

  let manifest: RawManifestFields = {};
  let hasRawPowerFlow = false;
  let hasDyrDynamics = false;
  let hasPscadModel = false;
  let hasWasmFirmware = false;
  let rawText: string | undefined;

  if (stat.isDirectory()) {
    const files = collectDirectoryFiles(absPath);
    const manifestCandidate = files.find((f) => {
      const base = path.basename(f).toLowerCase();
      return base === "manifest.json" || base === "submission.json";
    });
    if (manifestCandidate) {
      manifest = JSON.parse(fs.readFileSync(manifestCandidate, "utf-8")) as RawManifestFields;
    }
    const rawFile = files.find((f) => f.toLowerCase().endsWith(".raw"));
    hasRawPowerFlow = Boolean(rawFile);
    hasDyrDynamics = files.some((f) => f.toLowerCase().endsWith(".dyr"));
    hasPscadModel = files.some((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith(".pscx") || lower.endsWith(".pslx");
    });
    hasWasmFirmware = files.some((f) => f.toLowerCase().endsWith(".wasm"));
    if (rawFile) {
      rawText = fs.readFileSync(rawFile, "utf-8");
    }
  } else if (ext === ".zip") {
    const zip = new AdmZip(absPath);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const manifestEntry = entries.find((e) => {
      const base = path.posix.basename(e.entryName.replace(/\\/g, "/")).toLowerCase();
      return base === "manifest.json" || base === "submission.json";
    });
    if (manifestEntry) {
      manifest = JSON.parse(manifestEntry.getData().toString("utf-8")) as RawManifestFields;
    }
    const rawEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".raw"));
    hasRawPowerFlow = Boolean(rawEntry);
    hasDyrDynamics = entries.some((e) => e.entryName.toLowerCase().endsWith(".dyr"));
    hasPscadModel = entries.some((e) => {
      const lower = e.entryName.toLowerCase();
      return lower.endsWith(".pscx") || lower.endsWith(".pslx");
    });
    hasWasmFirmware = entries.some((e) => e.entryName.toLowerCase().endsWith(".wasm"));
    if (rawEntry) {
      rawText = rawEntry.getData().toString("utf-8");
    }
  } else if (ext === ".json") {
    manifest = JSON.parse(fs.readFileSync(absPath, "utf-8")) as RawManifestFields;
    const rawTarget = manifest.rawPath ? path.resolve(baseDir, manifest.rawPath) : undefined;
    const dyrTarget = manifest.dyrPath ? path.resolve(baseDir, manifest.dyrPath) : undefined;
    const pscadTarget = manifest.pscadPath ? path.resolve(baseDir, manifest.pscadPath) : undefined;
    const wasmTarget = manifest.wasmPath ? path.resolve(baseDir, manifest.wasmPath) : undefined;

    hasRawPowerFlow = Boolean(manifest.hasRawPowerFlow ?? (rawTarget && fs.existsSync(rawTarget)));
    hasDyrDynamics = Boolean(manifest.hasDyrDynamics ?? (dyrTarget && fs.existsSync(dyrTarget)));
    hasPscadModel = Boolean(manifest.hasPscadModel ?? (pscadTarget && fs.existsSync(pscadTarget)));
    hasWasmFirmware = Boolean(manifest.hasWasmFirmware ?? (wasmTarget && fs.existsSync(wasmTarget)));

    if (rawTarget && fs.existsSync(rawTarget)) {
      rawText = fs.readFileSync(rawTarget, "utf-8");
    }
  } else {
    hasRawPowerFlow = ext === ".raw";
    hasDyrDynamics = ext === ".dyr";
    hasPscadModel = ext === ".pscx" || ext === ".pslx";
    hasWasmFirmware = ext === ".wasm";
    if (hasRawPowerFlow) {
      rawText = fs.readFileSync(absPath, "utf-8");
    }
  }

  const rawAnalysis = rawText !== undefined ? analyzeRawContent(rawText) : undefined;
  const ratedMva =
    asFiniteNumber(manifest.ratedMva) ?? asFiniteNumber(defaults.ratedMva) ?? rawAnalysis?.inferredSbase ?? 100.0;
  const poiKv =
    asFiniteNumber(manifest.poiKv) ?? asFiniteNumber(defaults.poiKv) ?? rawAnalysis?.inferredBaseKv ?? 230.0;

  return {
    submissionId: manifest.submissionId || path.basename(absPath),
    developerOrganization: manifest.developerOrganization || "Interconnection Customer",
    plantName: manifest.plantName || path.basename(absPath, path.extname(absPath)),
    gridInterconnection: manifest.gridInterconnection || defaults.gridInterconnection || "Western",
    ratedMva,
    poiKv,
    hasRawPowerFlow,
    hasDyrDynamics,
    hasPscadModel,
    hasWasmFirmware,
    staticDiagnosticCount: manifest.staticDiagnosticCount ?? rawAnalysis?.staticDiagnosticCount,
    flatStartMaxDriftPercent: asFiniteNumber(manifest.flatStartMaxDriftPercent),
    lowestStableScr: asFiniteNumber(manifest.lowestStableScr),
    lvrtPass: typeof manifest.lvrtPass === "boolean" ? manifest.lvrtPass : undefined,
    hvrtPass: typeof manifest.hvrtPass === "boolean" ? manifest.hvrtPass : undefined,
    emtRmsNrmse: asFiniteNumber(manifest.emtRmsNrmse),
  };
}
