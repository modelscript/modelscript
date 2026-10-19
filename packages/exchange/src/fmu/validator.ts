// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU Archive Validation, Inspection, Source Compilation, and Direct Simulation.
 *
 * Provides `fmusim`-equivalent capabilities for FMI 2.0 and FMI 3.0 `.fmu` archives:
 * - `validateFmuArchive`: Schema & structural checks on `modelDescription.xml`, `binaries/`, and `sources/buildDescription.xml`
 * - `inspectFmuArchive`: Metadata, interface, platform, and variable summary for `msx fmu info` / `msx fmu list`
 * - `buildSourceFmuArchive`: Compiles C source FMUs into shared libraries for the host platform and repacks the `.fmu`
 * - `simulateFmuArchive`: Runs Co-Simulation (`cs`) or Model Exchange (`me`) directly on any `.fmu` archive
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { inflateRawSync } from "node:zlib";
import { createZip, FMI2_FUNCTION_TYPES_H, FMI2_FUNCTIONS_H, FMI2_TYPES_PLATFORM_H } from "./archive.js";
import { generateFmuHarnessC } from "./harness-codegen.js";
import { generateFmi3HarnessC } from "./harness3-codegen.js";
import { parseModelDescription, type FmiModelDescription, type FmiScalarVariable } from "./model-description.js";

/** Validation issue reported by `validateFmuArchive`. */
export interface FmuValidationIssue {
  /** Machine-readable rule code (e.g. "FMU_001"). */
  code: string;
  /** Severity level. */
  severity: "error" | "warning";
  /** Human-readable diagnostic message. */
  message: string;
}

/** Result of `validateFmuArchive`. */
export interface FmuValidationResult {
  /** True if zero errors were found. */
  valid: boolean;
  /** Validation errors. */
  errors: FmuValidationIssue[];
  /** Validation warnings. */
  warnings: FmuValidationIssue[];
  /** Parsed `modelDescription.xml` if present. */
  modelDescription?: FmiModelDescription | undefined;
  /** All file paths inside the `.fmu` ZIP archive. */
  files: string[];
}

/** Result of `inspectFmuArchive`. */
export interface FmuInspectionResult {
  /** FMI version string ("2.0", "3.0", etc.). */
  fmiVersion: string;
  /** Model name. */
  modelName: string;
  /** GUID or instantiationToken. */
  guid: string;
  /** Optional description. */
  description?: string | undefined;
  /** Optional author. */
  author?: string | undefined;
  /** Generation tool name. */
  generationTool?: string | undefined;
  /** Supported FMI interfaces ("CoSimulation", "ModelExchange", "ScheduledExecution"). */
  interfaces: {
    type: "CoSimulation" | "ModelExchange" | "ScheduledExecution";
    modelIdentifier: string;
  }[];
  /** Default experiment metadata. */
  defaultExperiment?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        stepSize?: number | undefined;
        tolerance?: number | undefined;
      }
    | undefined;
  /** Native binary platform identifiers present in `binaries/`. */
  platforms: string[];
  /** Whether C source files are bundled under `sources/`. */
  hasSources: boolean;
  /** Whether `sources/buildDescription.xml` or `extra/buildDescription.xml` is present. */
  hasBuildDescription: boolean;
  /** Whether a WebAssembly binary is bundled. */
  hasWasm: boolean;
  /** Whether `resources/model.js` or `resources/model.json` is bundled. */
  hasJs: boolean;
  /** Summary counts of variables and states. */
  counts: {
    total: number;
    inputs: number;
    outputs: number;
    parameters: number;
    states: number;
    eventIndicators: number;
  };
  /** All parsed variables. */
  variables: FmiScalarVariable[];
  /** All files in the archive. */
  files: string[];
}

/** Options for `buildSourceFmuArchive`. */
export interface FmuBuildOptions {
  /** C compiler command (default: `process.env.CC ?? "gcc"`). */
  compiler?: string | undefined;
  /** Target platform override (default: host platform). */
  platform?: string | undefined;
}

/** Result of `buildSourceFmuArchive`. */
export interface FmuBuildResult {
  /** Repacked `.fmu` archive containing the compiled shared library. */
  archive: Uint8Array;
  /** Relative path of the added binary inside the archive (e.g. `binaries/x86_64-linux/Model.so`). */
  binaryPath: string;
  /** Target platform identifier. */
  platform: string;
  /** Model identifier compiled. */
  modelIdentifier: string;
}

/** Options for `simulateFmuArchive`. */
export interface FmuSimulateOptions {
  /** FMI interface type: 'cs' (Co-Simulation), 'me' (Model Exchange), or 'auto' (default: 'auto'). */
  interfaceType?: "cs" | "me" | "auto" | undefined;
  /** ODE solver for Model Exchange ('euler' | 'rk4' | 'cvode', default: 'rk4'). */
  solver?: "euler" | "rk4" | "cvode" | string | undefined;
  /** Experiment start time override. */
  startTime?: number | undefined;
  /** Experiment stop time override. */
  stopTime?: number | undefined;
  /** Communication step size / output interval override. */
  stepSize?: number | undefined;
  /** Relative tolerance override. */
  tolerance?: number | undefined;
  /** Start value overrides (`name -> value`). */
  startValues?: Record<string, number | string | boolean> | undefined;
  /** Path to CSV input trajectory file (`time,u1,u2,...`). */
  inputFile?: string | undefined;
  /** Subset of variable names to include in output. */
  outputVariables?: string[] | undefined;
  /** Path to binary FMU state file to restore prior to stepping. */
  initialStateFile?: string | undefined;
  /** Path to binary FMU state file to save after simulation completes. */
  finalStateFile?: string | undefined;
  /** Log all FMI calls to stderr. */
  logFmiCalls?: boolean | undefined;
}

/** Result of `simulateFmuArchive`. */
export interface FmuSimulateResult {
  /** Time grid points. */
  t: number[];
  /** Output variable names in column order. */
  varNames: string[];
  /** Row-major trajectory values (`values[stepIdx][varIdx]`). */
  values: (number | string | boolean)[][];
  /** Parsed `modelDescription.xml`. */
  modelDescription: FmiModelDescription;
  /** Interface type actually executed ("cs" | "me"). */
  interfaceUsed: "cs" | "me";
}

// ── ZIP Extraction Utilities ──────────────────────────────────────────

/**
 * Extracts all files from a ZIP archive buffer into an in-memory map.
 */
export function extractAllFilesFromZip(zipData: Uint8Array | Buffer): Map<string, Uint8Array> {
  const buf = Buffer.isBuffer(zipData) ? zipData : Buffer.from(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const files = new Map<string, Uint8Array>();

  if (buf.length < 22) return files;

  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return files;

  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEnd = Math.min(buf.length, cdOffset + cdSize);

  let pos = cdOffset;
  while (pos + 46 <= cdEnd) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const fileNameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const fileName = buf
      .subarray(pos + 46, pos + 46 + fileNameLength)
      .toString("utf-8")
      .replace(/\\/g, "/");

    pos += 46 + fileNameLength + extraLength + commentLength;

    if (fileName.endsWith("/")) continue;
    if (localHeaderOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localFileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
    if (dataStart + compressedSize > buf.length) continue;

    const rawSlice = buf.subarray(dataStart, dataStart + compressedSize);
    if (compressionMethod === 0) {
      files.set(fileName, new Uint8Array(rawSlice));
    } else if (compressionMethod === 8) {
      try {
        const inflated = inflateRawSync(rawSlice);
        files.set(fileName, new Uint8Array(inflated));
      } catch {
        // Skip corrupted entry
      }
    }
  }

  return files;
}

/**
 * Lists all file paths inside a ZIP archive buffer.
 */
export function listZipFiles(zipData: Uint8Array | Buffer): string[] {
  return Array.from(extractAllFilesFromZip(zipData).keys());
}

// ── FMU Validation ──────────────────────────────────────────────────

/**
 * Validates an `.fmu` archive against FMI 2.0 / 3.0 structural and schema rules.
 */
export function validateFmuArchive(fmuBytes: Uint8Array | Buffer): FmuValidationResult {
  const errors: FmuValidationIssue[] = [];
  const warnings: FmuValidationIssue[] = [];

  const fileMap = extractAllFilesFromZip(fmuBytes);
  const files = Array.from(fileMap.keys());

  if (files.length === 0) {
    errors.push({
      code: "FMU_001",
      severity: "error",
      message: "Archive is empty or not a valid ZIP file.",
    });
    return { valid: false, errors, warnings, files };
  }

  const xmlBytes = fileMap.get("modelDescription.xml");
  if (!xmlBytes) {
    errors.push({
      code: "FMU_001",
      severity: "error",
      message: "Missing required 'modelDescription.xml' at the root of the FMU archive.",
    });
    return { valid: false, errors, warnings, files };
  }

  const xml = new TextDecoder().decode(xmlBytes);
  const desc = parseModelDescription(xml);

  // Check fmiVersion
  if (
    !desc.fmiVersion ||
    (!desc.fmiVersion.startsWith("2.") && !desc.fmiVersion.startsWith("3.") && !desc.fmiVersion.startsWith("1."))
  ) {
    errors.push({
      code: "FMU_002",
      severity: "error",
      message: `Unsupported or missing fmiVersion '${desc.fmiVersion}'. Expected '2.0' or '3.0'.`,
    });
  }

  // Check modelName
  if (!desc.modelName || desc.modelName === "Unknown") {
    errors.push({
      code: "FMU_003",
      severity: "error",
      message: "Missing 'modelName' attribute on <fmiModelDescription>.",
    });
  }

  // Check guid / instantiationToken
  if (!desc.guid || desc.guid.trim() === "") {
    const attrName = desc.fmiVersion.startsWith("3.") ? "instantiationToken" : "guid";
    errors.push({
      code: "FMU_004",
      severity: "error",
      message: `Missing required '${attrName}' attribute on <fmiModelDescription>.`,
    });
  }

  // Check interface types and modelIdentifier
  const hasCS = desc.supportsCoSimulation;
  const hasME = desc.supportsModelExchange;
  const hasSE = Boolean(desc.supportsScheduledExecution);
  if (!hasCS && !hasME && !hasSE) {
    errors.push({
      code: "FMU_005",
      severity: "error",
      message:
        "FMU must declare at least one interface element (<CoSimulation>, <ModelExchange>, or <ScheduledExecution>).",
    });
  }

  const cIdentRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (hasCS && (!desc.coSimulationModelIdentifier || !cIdentRegex.test(desc.coSimulationModelIdentifier))) {
    errors.push({
      code: "FMU_005",
      severity: "error",
      message: `<CoSimulation> has missing or invalid C modelIdentifier '${desc.coSimulationModelIdentifier ?? ""}'.`,
    });
  }
  if (hasME && (!desc.modelExchangeModelIdentifier || !cIdentRegex.test(desc.modelExchangeModelIdentifier))) {
    errors.push({
      code: "FMU_005",
      severity: "error",
      message: `<ModelExchange> has missing or invalid C modelIdentifier '${desc.modelExchangeModelIdentifier ?? ""}'.`,
    });
  }

  // Check variables
  const seenNames = new Set<string>();
  const validVrs = new Set<number>();
  for (const v of desc.variables) {
    if (!v.name) {
      errors.push({
        code: "FMU_006",
        severity: "error",
        message: `Variable with valueReference ${v.valueReference} has an empty name.`,
      });
    } else if (seenNames.has(v.name)) {
      errors.push({
        code: "FMU_006",
        severity: "error",
        message: `Duplicate variable name '${v.name}' in <ModelVariables>.`,
      });
    } else {
      seenNames.add(v.name);
    }

    if (Number.isNaN(v.valueReference) || v.valueReference < 0) {
      errors.push({
        code: "FMU_006",
        severity: "error",
        message: `Variable '${v.name}' has invalid valueReference '${v.valueReference}'.`,
      });
    } else {
      validVrs.add(v.valueReference);
    }

    // FMI causality/variability rules
    if (v.causality === "input" && v.start === undefined && v.type !== "Clock") {
      errors.push({
        code: "FMU_007",
        severity: "error",
        message: `Input variable '${v.name}' (vr=${v.valueReference}) must specify a 'start' value.`,
      });
    }
    if (v.causality === "parameter" && v.variability !== "fixed" && v.variability !== "tunable") {
      errors.push({
        code: "FMU_007",
        severity: "error",
        message: `Parameter '${v.name}' must have variability 'fixed' or 'tunable', found '${v.variability}'.`,
      });
    }
    if (v.initial === "exact" && v.start === undefined && v.type !== "Clock") {
      errors.push({
        code: "FMU_007",
        severity: "error",
        message: `Variable '${v.name}' with initial='exact' must specify a 'start' value.`,
      });
    }
  }

  // Check ModelStructure references
  if (desc.modelStructure) {
    const isFmi3 = desc.fmiVersion.startsWith("3.");
    for (const ref of desc.modelStructure.outputs) {
      if (isFmi3 ? !validVrs.has(ref) : ref < 1 || ref > desc.variables.length) {
        errors.push({
          code: "FMU_008",
          severity: "error",
          message: `<ModelStructure> Output reference '${ref}' does not match any declared variable.`,
        });
      }
    }
    for (const ref of desc.modelStructure.derivatives) {
      if (isFmi3 ? !validVrs.has(ref) : ref < 1 || ref > desc.variables.length) {
        errors.push({
          code: "FMU_008",
          severity: "error",
          message: `<ModelStructure> Derivative reference '${ref}' does not match any declared variable.`,
        });
      }
    }
  }

  // Check binaries / sources presence
  const hasBinaries = files.some(
    (f) =>
      f.startsWith("binaries/") &&
      (f.endsWith(".so") || f.endsWith(".dll") || f.endsWith(".dylib") || f.endsWith(".wasm")),
  );
  const hasSources = files.some((f) => f.startsWith("sources/") && f.endsWith(".c"));
  const hasJs = files.includes("resources/model.js") || files.includes("resources/model.json");
  const hasBuildDesc = files.includes("sources/buildDescription.xml") || files.includes("extra/buildDescription.xml");

  if (!hasBinaries && !hasSources && !hasJs) {
    warnings.push({
      code: "FMU_009",
      severity: "warning",
      message:
        "Archive contains no pre-compiled binaries under 'binaries/', no C sources under 'sources/', and no JS runtime under 'resources/'.",
    });
  }

  if (desc.fmiVersion.startsWith("3.") && hasSources && !hasBuildDesc) {
    warnings.push({
      code: "FMU_010",
      severity: "warning",
      message: "FMI 3.0 source FMU does not contain 'sources/buildDescription.xml'.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    modelDescription: desc,
    files,
  };
}

// ── FMU Inspection ──────────────────────────────────────────────────

/**
 * Inspects an `.fmu` archive and returns structured metadata for `msx fmu info` and `msx fmu list`.
 */
export function inspectFmuArchive(fmuBytes: Uint8Array | Buffer): FmuInspectionResult {
  const fileMap = extractAllFilesFromZip(fmuBytes);
  const files = Array.from(fileMap.keys());
  const xmlBytes = fileMap.get("modelDescription.xml");
  if (!xmlBytes) {
    throw new Error("Invalid FMU archive: modelDescription.xml not found");
  }
  const xml = new TextDecoder().decode(xmlBytes);
  const desc = parseModelDescription(xml);

  const interfaces: FmuInspectionResult["interfaces"] = [];
  if (desc.supportsCoSimulation && desc.coSimulationModelIdentifier) {
    interfaces.push({ type: "CoSimulation", modelIdentifier: desc.coSimulationModelIdentifier });
  }
  if (desc.supportsModelExchange && desc.modelExchangeModelIdentifier) {
    interfaces.push({ type: "ModelExchange", modelIdentifier: desc.modelExchangeModelIdentifier });
  }
  if (desc.supportsScheduledExecution && desc.scheduledExecutionModelIdentifier) {
    interfaces.push({ type: "ScheduledExecution", modelIdentifier: desc.scheduledExecutionModelIdentifier });
  }

  const platformSet = new Set<string>();
  for (const f of files) {
    if (f.startsWith("binaries/")) {
      const parts = f.split("/");
      if (parts.length >= 3 && parts[1]) {
        platformSet.add(parts[1]);
      }
    }
  }

  const inputs = desc.variables.filter((v) => v.causality === "input").length;
  const outputs = desc.variables.filter((v) => v.causality === "output").length;
  const parameters = desc.variables.filter(
    (v) => v.causality === "parameter" || v.causality === "calculatedParameter",
  ).length;
  const states = desc.modelStructure?.derivatives.length ?? 0;

  return {
    fmiVersion: desc.fmiVersion,
    modelName: desc.modelName,
    guid: desc.guid,
    description: desc.description,
    author: desc.author,
    generationTool: desc.generationTool,
    interfaces,
    defaultExperiment: desc.defaultExperiment,
    platforms: Array.from(platformSet),
    hasSources: files.some((f) => f.startsWith("sources/") && f.endsWith(".c")),
    hasBuildDescription: files.includes("sources/buildDescription.xml") || files.includes("extra/buildDescription.xml"),
    hasWasm: files.some((f) => f.endsWith(".wasm")),
    hasJs: files.includes("resources/model.js") || files.includes("resources/model.json"),
    counts: {
      total: desc.variables.length,
      inputs,
      outputs,
      parameters,
      states,
      eventIndicators: desc.numberOfEventIndicators ?? 0,
    },
    variables: desc.variables,
    files,
  };
}

// ── Source FMU Builder (`msx fmu build`) ────────────────────────────

/**
 * Determines the standard FMI 2.0 or FMI 3.0 platform folder name and shared library extension for the host OS/CPU.
 */
export function getHostFmiPlatform(fmiVersion: string): { platform: string; ext: string } {
  const isFmi3 = fmiVersion.startsWith("3.");
  const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
  if (isFmi3) {
    const arch = os.arch() === "arm64" ? "aarch64" : os.arch() === "x64" ? "x86_64" : "x86";
    const sys = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
    return { platform: `${arch}-${sys}`, ext };
  } else {
    const bits = os.arch() === "x64" || os.arch() === "arm64" ? "64" : "32";
    const sys = process.platform === "win32" ? "win" : process.platform === "darwin" ? "darwin" : "linux";
    return { platform: `${sys}${bits}`, ext };
  }
}

/**
 * Compiles a source-code `.fmu` archive (`sources/*.c` or `sources/buildDescription.xml`) into a host shared library
 * and returns a repacked `.fmu` archive containing `binaries/<platform>/<modelIdentifier>.<ext>`.
 */
export function buildSourceFmuArchive(fmuBytes: Uint8Array | Buffer, options?: FmuBuildOptions): FmuBuildResult {
  const fileMap = extractAllFilesFromZip(fmuBytes);
  const xmlBytes = fileMap.get("modelDescription.xml");
  if (!xmlBytes) {
    throw new Error("Invalid FMU archive: modelDescription.xml not found");
  }
  const desc = parseModelDescription(new TextDecoder().decode(xmlBytes));
  const modelIdentifier =
    desc.coSimulationModelIdentifier ??
    desc.modelExchangeModelIdentifier ??
    desc.scheduledExecutionModelIdentifier ??
    desc.modelName.replace(/[^A-Za-z0-9_]/g, "_");

  const isFmi3 = desc.fmiVersion.startsWith("3.");
  const hostPlat = getHostFmiPlatform(desc.fmiVersion);
  const platform = options?.platform ?? hostPlat.platform;
  const ext = hostPlat.ext;

  // Gather source files from buildDescription.xml or sources/ directory
  const buildDescBytes = fileMap.get("sources/buildDescription.xml") ?? fileMap.get("extra/buildDescription.xml");
  const cFiles: string[] = [];

  if (buildDescBytes) {
    const buildDescXml = new TextDecoder().decode(buildDescBytes);
    const matches = buildDescXml.matchAll(/<SourceFile\b([^>]*)>/g);
    for (const m of matches) {
      const nameMatch = m[1]?.match(/\bname\s*=\s*"([^"]+)"/);
      if (nameMatch?.[1]) {
        const candidate = nameMatch[1].startsWith("sources/") ? nameMatch[1] : `sources/${nameMatch[1]}`;
        if (fileMap.has(candidate)) {
          cFiles.push(candidate);
        }
      }
    }
  }

  if (cFiles.length === 0) {
    for (const key of fileMap.keys()) {
      if (key.startsWith("sources/") && key.endsWith(".c")) {
        // Avoid compiling both fmi2Functions.c and fmi3Functions.c simultaneously if both exist
        if (isFmi3 && key === "sources/fmi2Functions.c" && fileMap.has("sources/fmi3Functions.c")) continue;
        if (!isFmi3 && key === "sources/fmi3Functions.c" && fileMap.has("sources/fmi2Functions.c")) continue;
        cFiles.push(key);
      }
    }
  }

  if (cFiles.length === 0) {
    throw new Error(`No C source files found under 'sources/' in FMU '${desc.modelName}'.`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `msx-fmu-build-${modelIdentifier}-`));
  try {
    // Write all extracted files to tmpDir
    for (const [relPath, content] of fileMap.entries()) {
      const targetPath = path.join(tmpDir, relPath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content);
    }

    const srcDir = path.join(tmpDir, "sources");
    fs.mkdirSync(srcDir, { recursive: true });

    // Ensure standard FMI 2.0 headers exist if compiling FMI 2.0 sources
    if (!isFmi3) {
      if (!fs.existsSync(path.join(srcDir, "fmi2Functions.h"))) {
        fs.writeFileSync(path.join(srcDir, "fmi2Functions.h"), FMI2_FUNCTIONS_H);
      }
      if (!fs.existsSync(path.join(srcDir, "fmi2TypesPlatform.h"))) {
        fs.writeFileSync(path.join(srcDir, "fmi2TypesPlatform.h"), FMI2_TYPES_PLATFORM_H);
      }
      if (!fs.existsSync(path.join(srcDir, "fmi2FunctionTypes.h"))) {
        fs.writeFileSync(path.join(srcDir, "fmi2FunctionTypes.h"), FMI2_FUNCTION_TYPES_H);
      }
    }

    const outBinPath = path.join(tmpDir, `${modelIdentifier}${ext}`);
    const cc = options?.compiler ?? process.env["CC"] ?? "gcc";
    const ccArgs = [
      "-shared",
      "-fPIC",
      "-O2",
      `-I${srcDir}`,
      `-I${tmpDir}`,
      ...cFiles.map((f) => path.join(tmpDir, f)),
      "-o",
      outBinPath,
      "-lm",
      "-pthread",
    ];

    execFileSync(cc, ccArgs, { stdio: "pipe", timeout: 60000 });

    const binaryBytes = new Uint8Array(fs.readFileSync(outBinPath));
    const binaryPath = `binaries/${platform}/${modelIdentifier}${ext}`;
    fileMap.set(binaryPath, binaryBytes);

    // Also add for alternate interface identifier if different
    if (desc.modelExchangeModelIdentifier && desc.modelExchangeModelIdentifier !== modelIdentifier) {
      fileMap.set(`binaries/${platform}/${desc.modelExchangeModelIdentifier}${ext}`, binaryBytes);
    }

    const archive = createZip(fileMap);
    return {
      archive,
      binaryPath,
      platform,
      modelIdentifier,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Direct FMU Simulation (`msx simulate <file.fmu>` / `msx fmu simulate`) ──

/**
 * Compiles and caches the C harness binary for FMI 2.0 or FMI 3.0.
 */
function ensureHarnessBinary(isFmi3: boolean): string {
  const cacheDir = path.join(os.tmpdir(), "msx-fmu-harness-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const cSource = isFmi3 ? generateFmi3HarnessC() : generateFmuHarnessC();
  const hash = createHash("sha256").update(cSource).digest("hex").slice(0, 12);
  const binName = isFmi3 ? `fmu3-harness-${hash}` : `fmu2-harness-${hash}`;
  const binPath = path.join(cacheDir, process.platform === "win32" ? `${binName}.exe` : binName);

  if (fs.existsSync(binPath)) {
    return binPath;
  }

  const cPath = path.join(cacheDir, `${binName}.c`);
  fs.writeFileSync(cPath, cSource, "utf-8");
  const cc = process.env["CC"] ?? "gcc";
  const dlFlag = process.platform === "win32" ? "" : "-ldl -lm";
  execSync(`${cc} -O2 "${cPath}" -o "${binPath}" ${dlFlag}`, { stdio: "pipe", timeout: 60000 });
  return binPath;
}

/**
 * Parses an input CSV file (`time,var1,var2,...`) into a time-sorted table.
 */
function parseInputCsvFile(csvPath: string): { times: number[]; columns: Map<string, number[]> } {
  const text = fs.readFileSync(csvPath, "utf-8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) {
    return { times: [], columns: new Map() };
  }
  const headers = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const times: number[] = [];
  const columns = new Map<string, number[]>();
  for (let c = 1; c < headers.length; c++) {
    const colName = headers[c];
    if (colName) columns.set(colName, []);
  }

  for (let r = 1; r < lines.length; r++) {
    const cells = (lines[r] ?? "").split(",").map((s) => s.trim());
    const tVal = parseFloat(cells[0] ?? "0");
    if (Number.isNaN(tVal)) continue;
    times.push(tVal);
    for (let c = 1; c < headers.length; c++) {
      const colName = headers[c];
      if (!colName) continue;
      const v = parseFloat(cells[c] ?? "0");
      columns.get(colName)?.push(Number.isNaN(v) ? 0 : v);
    }
  }
  return { times, columns };
}

/**
 * Interpolates input values from a parsed CSV input table at time `t`.
 */
function sampleInputCsvAtTime(
  table: { times: number[]; columns: Map<string, number[]> },
  t: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const { times, columns } = table;
  if (times.length === 0) return out;

  if (t <= (times[0] ?? 0) || times.length === 1) {
    for (const [name, vals] of columns) {
      out[name] = vals[0] ?? 0;
    }
    return out;
  }
  const lastIdx = times.length - 1;
  if (t >= (times[lastIdx] ?? 0)) {
    for (const [name, vals] of columns) {
      out[name] = vals[lastIdx] ?? 0;
    }
    return out;
  }

  let idx = 0;
  while (idx < lastIdx && (times[idx + 1] ?? 0) < t) {
    idx++;
  }
  const t0 = times[idx] ?? 0;
  const t1 = times[idx + 1] ?? t0;
  const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  for (const [name, vals] of columns) {
    const v0 = vals[idx] ?? 0;
    const v1 = vals[idx + 1] ?? v0;
    out[name] = v0 + alpha * (v1 - v0);
  }
  return out;
}

/**
 * Simulates an `.fmu` archive directly using the native FMI 2.0 or FMI 3.0 harness
 * (auto-compiling source FMUs if needed).
 */
export async function simulateFmuArchive(fmuPath: string, options?: FmuSimulateOptions): Promise<FmuSimulateResult> {
  const absFmuPath = path.resolve(fmuPath);
  if (!fs.existsSync(absFmuPath)) {
    throw new Error(`FMU archive not found: ${absFmuPath}`);
  }

  const rawBytes = fs.readFileSync(absFmuPath);
  const inspection = inspectFmuArchive(rawBytes);
  const fileMap = extractAllFilesFromZip(rawBytes);
  const xml = new TextDecoder().decode(fileMap.get("modelDescription.xml")!);
  const desc = parseModelDescription(xml);

  const isFmi3 = desc.fmiVersion.startsWith("3.");
  const hostPlat = getHostFmiPlatform(desc.fmiVersion);

  // Determine interface mode ('cs' or 'me')
  let interfaceUsed: "cs" | "me" = "cs";
  if (options?.interfaceType === "me") {
    if (!desc.supportsModelExchange) {
      throw new Error(`FMU '${desc.modelName}' does not support Model Exchange.`);
    }
    interfaceUsed = "me";
  } else if (options?.interfaceType === "cs") {
    if (!desc.supportsCoSimulation) {
      throw new Error(`FMU '${desc.modelName}' does not support Co-Simulation.`);
    }
    interfaceUsed = "cs";
  } else {
    interfaceUsed = desc.supportsCoSimulation ? "cs" : desc.supportsModelExchange ? "me" : "cs";
  }

  // Check if host binary exists in the archive; if not and sources exist, build on the fly
  let effectiveFmuPath = absFmuPath;
  let tempBuiltFmuPath: string | null = null;
  const hasHostBinary = inspection.platforms.includes(hostPlat.platform);
  if (!hasHostBinary && inspection.hasSources) {
    const built = buildSourceFmuArchive(rawBytes);
    tempBuiltFmuPath = path.join(os.tmpdir(), `msx-autobuild-${Date.now()}-${path.basename(absFmuPath)}`);
    fs.writeFileSync(tempBuiltFmuPath, built.archive);
    effectiveFmuPath = tempBuiltFmuPath;
  }

  const harnessBin = ensureHarnessBinary(isFmi3);

  const startTime = options?.startTime ?? desc.defaultExperiment?.startTime ?? 0;
  const stopTime = options?.stopTime ?? desc.defaultExperiment?.stopTime ?? 1;
  const stepSize =
    options?.stepSize ??
    desc.defaultExperiment?.stepSize ??
    (stopTime > startTime ? (stopTime - startTime) / 500 : 0.002);
  const solver = options?.solver ?? "rk4";

  // Map variables by name and VR
  const varByName = new Map<string, FmiScalarVariable>();
  const varsByVr = new Map<number, FmiScalarVariable[]>();
  for (const v of desc.variables) {
    varByName.set(v.name, v);
    const list = varsByVr.get(v.valueReference) ?? [];
    list.push(v);
    varsByVr.set(v.valueReference, list);
  }

  // Determine output variable list
  let outputVars: FmiScalarVariable[];
  if (options?.outputVariables && options.outputVariables.length > 0) {
    outputVars = [];
    for (const name of options.outputVariables) {
      const sv = varByName.get(name);
      if (sv) outputVars.push(sv);
    }
  } else {
    // Include non-clock, non-independent variables (time is already column 0)
    outputVars = desc.variables.filter((v) => v.type !== "Clock" && v.causality !== "independent");
  }
  const varNames = outputVars.map((v) => v.name);

  const realVars = outputVars.filter((v) => v.type === "Real");
  const realRefs = realVars.map((v) => v.valueReference);
  const realCounts = realVars.map((v) =>
    v.dimensions && v.dimensions.length > 0 ? v.dimensions.reduce((a, b) => a * b, 1) : 1,
  );
  const intRefs = outputVars
    .filter((v) => v.type === "Integer" || v.type === "Enumeration")
    .map((v) => v.valueReference);
  const boolRefs = outputVars.filter((v) => v.type === "Boolean").map((v) => v.valueReference);
  const stringRefs = outputVars.filter((v) => v.type === "String").map((v) => v.valueReference);

  // Parse optional CSV input trajectory
  const inputCsv = options?.inputFile ? parseInputCsvFile(path.resolve(options.inputFile)) : null;

  // Spawn harness process
  const child = spawn(harnessBin, [effectiveFmuPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrLog = "";
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrLog += text;
    if (options?.logFmiCalls) {
      process.stderr.write(text);
    }
  });

  let reqId = 0;
  const pending = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line: string) => {
    try {
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message));
          } else {
            p.resolve(msg.result);
          }
        }
      }
    } catch {
      // Ignore non-JSON stdout lines
    }
  });

  child.on("exit", (code) => {
    for (const [, p] of pending) {
      p.reject(new Error(`FMU harness exited unexpectedly (code ${code}): ${stderrLog}`));
    }
    pending.clear();
  });

  const rpc = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const id = ++reqId;
    const payload = JSON.stringify({ method, params, id }) + "\n";
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(payload);
    });
  };

  const applyNamedValues = async (namedValues: Record<string, number | string | boolean>) => {
    const realOrOther: Record<string, number | string | boolean> = {};
    const intValues: Record<string, number> = {};
    let count = 0;
    for (const [name, val] of Object.entries(namedValues)) {
      const sv = varByName.get(name);
      if (!sv) continue;
      count++;
      if ((sv.type === "Integer" || sv.type === "Enumeration") && typeof val === "number") {
        intValues[String(sv.valueReference)] = Math.trunc(val);
      } else {
        realOrOther[String(sv.valueReference)] = val;
      }
    }
    if (count > 0) {
      await rpc("setInputs", { values: realOrOther, intValues });
    }
  };

  try {
    await rpc("initialize", {
      startTime,
      stopTime,
      stepSize,
      fmuType: interfaceUsed,
      nx: desc.modelStructure?.derivatives.length ?? 0,
      nz: desc.numberOfEventIndicators ?? 0,
      logFmiCalls: options?.logFmiCalls ? 1 : 0,
    });

    if (options?.initialStateFile) {
      await rpc("loadStateFromFile", { filePath: path.resolve(options.initialStateFile) });
    }

    if (options?.startValues && Object.keys(options.startValues).length > 0) {
      await applyNamedValues(options.startValues);
    }

    if (inputCsv) {
      const initInputs = sampleInputCsvAtTime(inputCsv, startTime);
      await applyNamedValues(initInputs);
    }

    const tGrid: number[] = [];
    const valuesGrid: (number | string | boolean)[][] = [];

    const recordStep = async (currentTime: number) => {
      const rawOut = (await rpc("getOutputs", {
        valueReferences: realRefs,
        realCounts,
        intRefs,
        boolRefs,
        stringRefs,
      })) as Record<string, number | string | boolean>;
      const row: (number | string | boolean)[] = [];
      for (const sv of outputVars) {
        const key =
          sv.type === "Integer" || sv.type === "Enumeration"
            ? `int:${sv.valueReference}`
            : sv.type === "Boolean"
              ? `bool:${sv.valueReference}`
              : sv.type === "String"
                ? `str:${sv.valueReference}`
                : String(sv.valueReference);
        const val = rawOut[key] ?? rawOut[String(sv.valueReference)] ?? sv.start ?? 0;
        row.push(val);
      }
      tGrid.push(Number(currentTime.toFixed(12)));
      valuesGrid.push(row);
    };

    await recordStep(startTime);

    let currentTime = startTime;
    const eps = stepSize * 1e-9;
    while (currentTime + eps < stopTime) {
      const dt = Math.min(stepSize, stopTime - currentTime);
      if (inputCsv) {
        const stepInputs = sampleInputCsvAtTime(inputCsv, currentTime);
        await applyNamedValues(stepInputs);
      }
      await rpc("doStep", { currentTime, stepSize: dt, solver });
      currentTime += dt;
      await recordStep(currentTime);
    }

    if (options?.finalStateFile) {
      await rpc("saveStateToFile", { filePath: path.resolve(options.finalStateFile) });
    }

    await rpc("terminate");

    return {
      t: tGrid,
      varNames,
      values: valuesGrid,
      modelDescription: desc,
      interfaceUsed,
    };
  } finally {
    rl.close();
    child.kill("SIGTERM");
    if (tempBuiltFmuPath && fs.existsSync(tempBuiltFmuPath)) {
      try {
        fs.unlinkSync(tempBuiltFmuPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Formats an `FmuSimulateResult` as CSV or JSON.
 */
export function formatFmuSimulateResult(result: FmuSimulateResult, format: "csv" | "json" | "none" = "csv"): string {
  if (format === "none") return "";
  if (format === "json") {
    const rows = result.t.map((time, i) => {
      const row: Record<string, number | string | boolean> = { time };
      result.varNames.forEach((name, vIdx) => {
        row[name] = result.values[i]?.[vIdx] ?? 0;
      });
      return row;
    });
    return JSON.stringify(rows, null, 2) + "\n";
  }

  const stringVarNames = new Set(
    (result.modelDescription?.variables ?? []).filter((v) => v.type === "String").map((v) => v.name),
  );
  const lines: string[] = [];
  lines.push(["time", ...result.varNames].join(","));
  for (let i = 0; i < result.t.length; i++) {
    const rowVals = result.values[i] ?? [];
    const formatted = [
      String(result.t[i]),
      ...result.varNames.map((name, vIdx) => {
        const v = rowVals[vIdx] ?? 0;
        if (typeof v === "string") {
          return stringVarNames.has(name) || v.includes(",") ? `"${v.replace(/"/g, '""')}"` : v;
        }
        return String(v);
      }),
    ];
    lines.push(formatted.join(","));
  }
  return lines.join("\n") + "\n";
}
