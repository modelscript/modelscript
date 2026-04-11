// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMU archive builder — packages all FMU artifacts into a ZIP file.
 *
 * Uses pako for deflation (already a dependency of @modelscript/core).
 * Works in both browser and Node.js environments.
 *
 * FMU structure:
 *   modelDescription.xml
 *   sources/
 *     <id>_model.h
 *     <id>_model.c
 *     fmi2Functions.c
 *   resources/
 *     model.json          (serialized DAE for JS-based runtime)
 */

import type { ModelicaDAE } from "@modelscript/symbolics";
import { deflateRaw } from "pako";
import type { FmuOptions, FmuResult } from "./fmi.js";
import { generateFmu } from "./fmi.js";
import { generateFmi3 } from "./fmi3.js";
import { generateFmuCSources } from "./fmu-codegen.js";
import type { ModelicaSimulator } from "./simulator.js";

/** Options for FMU archive generation. */
export interface FmuArchiveOptions extends FmuOptions {
  /** Include C source files in the archive (default: true). */
  includeSources?: boolean;
  /** Include serialized model.json (default: true). */
  includeModelJson?: boolean;
  /** Additional resource files to bundle in `resources/` (filename → contents). */
  resourceFiles?: Map<string, Uint8Array>;
}

/** Result of FMU archive generation. */
export interface FmuArchiveResult {
  /** The FMU archive as a Uint8Array (ZIP format). */
  archive: Uint8Array;
  /** The FMU metadata result. */
  fmuResult: FmuResult;
  /** File listing inside the archive. */
  files: string[];
}

/**
 * Build a complete FMU 2.0 archive (.fmu ZIP file).
 *
 * @param dae       The flattened DAE
 * @param options   FMU archive options
 * @param simulator Optional simulator instance (for state variable detection)
 * @returns FMU archive result with the ZIP bytes
 */
export function buildFmuArchive(
  dae: ModelicaDAE,
  options: FmuArchiveOptions,
  simulator?: ModelicaSimulator,
): FmuArchiveResult {
  const stateVars = simulator?.stateVars ?? new Set<string>();
  const fmuResult = generateFmu(dae, options, stateVars);
  const fmi3Result = generateFmi3(dae, options, stateVars);
  const id = options.modelIdentifier;

  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  // ── modelDescription.xml ──
  files.set("modelDescription.xml", encoder.encode(fmuResult.modelDescriptionXml));

  // ── terminalsAndIcons.xml (FMI 3.0) ──
  if (fmi3Result.terminalsAndIconsXml) {
    files.set("terminalsAndIcons/terminalsAndIcons.xml", encoder.encode(fmi3Result.terminalsAndIconsXml));
  }

  // ── C source files ──
  if (options.includeSources !== false) {
    const sources = generateFmuCSources(dae, fmuResult, options);
    files.set(`sources/${id}_model.h`, encoder.encode(sources.modelH));
    files.set(`sources/${id}_model.c`, encoder.encode(sources.modelC));
    files.set("sources/fmi2Functions.c", encoder.encode(sources.fmi2FunctionsC));
    files.set("sources/fmi3Functions.c", encoder.encode(sources.fmi3FunctionsC));

    // Include FMI 2.0 headers (minimal subset for compilation)
    files.set("sources/fmi2Functions.h", encoder.encode(FMI2_FUNCTIONS_H));
    files.set("sources/fmi2TypesPlatform.h", encoder.encode(FMI2_TYPES_PLATFORM_H));
    files.set("sources/fmi2FunctionTypes.h", encoder.encode(FMI2_FUNCTION_TYPES_H));

    // CMake build system
    files.set("sources/CMakeLists.txt", encoder.encode(sources.cmakeLists));
  }

  // ── model.json (serialized DAE for JS runtime) ──
  if (options.includeModelJson !== false) {
    const modelJson = JSON.stringify(dae.toJSON, null, 2);
    files.set("resources/model.json", encoder.encode(modelJson));
  }

  // ── Additional resource files ──
  if (options.resourceFiles) {
    for (const [name, data] of options.resourceFiles) {
      files.set(`resources/${name}`, data);
    }
  }

  // ── Inject JS/TS Dependencies ──
  const crawledJsPaths = new Set<string>();
  const crawlDaeForJs = (d: ModelicaDAE) => {
    if (d.jsSource && d.jsPath && !crawledJsPaths.has(d.jsPath)) {
      crawledJsPaths.add(d.jsPath);
      const basename = d.jsPath.split(/[/\\]/).pop() ?? "dependency.js";
      files.set(`resources/${basename}`, encoder.encode(d.jsSource));
    }
    for (const fn of d.functions) crawlDaeForJs(fn);
  };
  crawlDaeForJs(dae);

  // ── buildDescription.xml (FMI 3.0 §2.5) ──
  const buildDescLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<fmiBuildDescription fmiVersion="3.0">',
    `  <BuildConfiguration modelIdentifier="${id}">`,
    '    <SourceFileSet language="C">',
    `      <SourceFile name="${id}_model.c" />`,
    `      <SourceFile name="fmi2Functions.c" />`,
    `      <SourceFile name="fmi3Functions.c" />`,
    "    </SourceFileSet>",
    "  </BuildConfiguration>",
    "</fmiBuildDescription>",
  ];
  files.set("extra/buildDescription.xml", encoder.encode(buildDescLines.join("\n")));

  // ── Build ZIP archive ──
  const archive = createZip(files);

  return {
    archive,
    fmuResult,
    files: Array.from(files.keys()),
  };
}

// ── ZIP file builder (pure TypeScript, no external deps beyond pako) ──

export function createZip(files: Map<string, Uint8Array>): Uint8Array {
  const centralDirectory: Uint8Array[] = [];
  const localFiles: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of files) {
    const nameBytes = new TextEncoder().encode(name);
    const compressed = deflateRaw(data, { level: 6 });
    const crc = crc32(data);

    // ── Local file header ──
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lView = new DataView(localHeader.buffer);
    lView.setUint32(0, 0x04034b50, true); // Local file header signature
    lView.setUint16(4, 20, true); // Version needed to extract
    lView.setUint16(6, 0, true); // General purpose bit flag
    lView.setUint16(8, 8, true); // Compression method (deflate)
    lView.setUint16(10, 0, true); // Last mod file time
    lView.setUint16(12, 0, true); // Last mod file date
    lView.setUint32(14, crc, true); // CRC-32
    lView.setUint32(18, compressed.length, true); // Compressed size
    lView.setUint32(22, data.length, true); // Uncompressed size
    lView.setUint16(26, nameBytes.length, true); // File name length
    lView.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localFiles.push(localHeader);
    localFiles.push(compressed);

    // ── Central directory entry ──
    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdEntry.buffer);
    cdView.setUint32(0, 0x02014b50, true); // Central directory signature
    cdView.setUint16(4, 20, true); // Version made by
    cdView.setUint16(6, 20, true); // Version needed
    cdView.setUint16(8, 0, true); // Flags
    cdView.setUint16(10, 8, true); // Compression
    cdView.setUint16(12, 0, true); // Time
    cdView.setUint16(14, 0, true); // Date
    cdView.setUint32(16, crc, true); // CRC-32
    cdView.setUint32(20, compressed.length, true); // Compressed size
    cdView.setUint32(24, data.length, true); // Uncompressed size
    cdView.setUint16(28, nameBytes.length, true); // File name length
    cdView.setUint16(30, 0, true); // Extra field length
    cdView.setUint16(32, 0, true); // File comment length
    cdView.setUint16(34, 0, true); // Disk number start
    cdView.setUint16(36, 0, true); // Internal file attributes
    cdView.setUint32(38, 0, true); // External file attributes
    cdView.setUint32(42, offset, true); // Relative offset of local header
    cdEntry.set(nameBytes, 46);

    centralDirectory.push(cdEntry);
    offset += localHeader.length + compressed.length;
  }

  // ── End of central directory record ──
  const cdSize = centralDirectory.reduce((sum, e) => sum + e.length, 0);
  const eocdr = new Uint8Array(22);
  const eView = new DataView(eocdr.buffer);
  eView.setUint32(0, 0x06054b50, true); // EOCD signature
  eView.setUint16(4, 0, true); // Disk number
  eView.setUint16(6, 0, true); // CD start disk
  eView.setUint16(8, files.size, true); // Entries on this disk
  eView.setUint16(10, files.size, true); // Total entries
  eView.setUint32(12, cdSize, true); // Size of central directory
  eView.setUint32(16, offset, true); // Offset of CD
  eView.setUint16(20, 0, true); // Comment length

  // Concatenate all parts
  const totalSize = offset + cdSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of localFiles) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralDirectory) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  result.set(eocdr, pos);

  return result;
}

// ── CRC-32 ──

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── FMI 2.0 standard header files (minimal, self-contained) ──

export const FMI2_TYPES_PLATFORM_H = `/* FMI 2.0 Type Platform — auto-included by ModelScript */
#ifndef fmi2TypesPlatform_h
#define fmi2TypesPlatform_h

#define fmi2TypesPlatform "default"

typedef void*        fmi2Component;
typedef void*        fmi2ComponentEnvironment;
typedef void*        fmi2FMUstate;
typedef unsigned int fmi2ValueReference;
typedef double       fmi2Real;
typedef int          fmi2Integer;
typedef int          fmi2Boolean;
typedef const char*  fmi2String;
typedef char         fmi2Byte;

#define fmi2True  1
#define fmi2False 0

typedef enum {
  fmi2OK,
  fmi2Warning,
  fmi2Discard,
  fmi2Error,
  fmi2Fatal,
  fmi2Pending
} fmi2Status;

typedef enum {
  fmi2ModelExchange,
  fmi2CoSimulation
} fmi2Type;

typedef enum {
  fmi2DoStepStatus,
  fmi2PendingStatus,
  fmi2LastSuccessfulTime,
  fmi2Terminated
} fmi2StatusKind;

typedef struct {
  fmi2Boolean newDiscreteStatesNeeded;
  fmi2Boolean terminateSimulation;
  fmi2Boolean nominalsOfContinuousStatesChanged;
  fmi2Boolean valuesOfContinuousStatesChanged;
  fmi2Boolean nextEventTimeDefined;
  fmi2Real    nextEventTime;
} fmi2EventInfo;

#endif
`;

export const FMI2_FUNCTION_TYPES_H = `/* FMI 2.0 Function Types — auto-included by ModelScript */
#ifndef fmi2FunctionTypes_h
#define fmi2FunctionTypes_h

#include "fmi2TypesPlatform.h"
#include <stddef.h>

typedef void (*fmi2CallbackLogger)(fmi2ComponentEnvironment, fmi2String, fmi2Status, fmi2String, fmi2String, ...);
typedef void* (*fmi2CallbackAllocateMemory)(size_t, size_t);
typedef void  (*fmi2CallbackFreeMemory)(void*);
typedef void  (*fmi2StepFinished)(fmi2ComponentEnvironment, fmi2Status);

typedef struct {
  fmi2CallbackLogger         logger;
  fmi2CallbackAllocateMemory allocateMemory;
  fmi2CallbackFreeMemory     freeMemory;
  fmi2StepFinished           stepFinished;
  fmi2ComponentEnvironment   componentEnvironment;
} fmi2CallbackFunctions;

#endif
`;

export const FMI2_FUNCTIONS_H = `/* FMI 2.0 Functions — auto-included by ModelScript */
#ifndef fmi2Functions_h
#define fmi2Functions_h

#include "fmi2TypesPlatform.h"
#include "fmi2FunctionTypes.h"
#include <stddef.h>

/* Common */
const char* fmi2GetTypesPlatform(void);
const char* fmi2GetVersion(void);
fmi2Status fmi2SetDebugLogging(fmi2Component, fmi2Boolean, size_t, const fmi2String[]);
fmi2Component fmi2Instantiate(fmi2String, fmi2Type, fmi2String, fmi2String, const fmi2CallbackFunctions*, fmi2Boolean, fmi2Boolean);
void fmi2FreeInstance(fmi2Component);
fmi2Status fmi2SetupExperiment(fmi2Component, fmi2Boolean, fmi2Real, fmi2Real, fmi2Boolean, fmi2Real);
fmi2Status fmi2EnterInitializationMode(fmi2Component);
fmi2Status fmi2ExitInitializationMode(fmi2Component);
fmi2Status fmi2Terminate(fmi2Component);
fmi2Status fmi2Reset(fmi2Component);
fmi2Status fmi2GetReal(fmi2Component, const fmi2ValueReference[], size_t, fmi2Real[]);
fmi2Status fmi2GetInteger(fmi2Component, const fmi2ValueReference[], size_t, fmi2Integer[]);
fmi2Status fmi2GetBoolean(fmi2Component, const fmi2ValueReference[], size_t, fmi2Boolean[]);
fmi2Status fmi2GetString(fmi2Component, const fmi2ValueReference[], size_t, fmi2String[]);
fmi2Status fmi2SetReal(fmi2Component, const fmi2ValueReference[], size_t, const fmi2Real[]);
fmi2Status fmi2SetInteger(fmi2Component, const fmi2ValueReference[], size_t, const fmi2Integer[]);
fmi2Status fmi2SetBoolean(fmi2Component, const fmi2ValueReference[], size_t, const fmi2Boolean[]);
fmi2Status fmi2SetString(fmi2Component, const fmi2ValueReference[], size_t, const fmi2String[]);
fmi2Status fmi2GetFMUstate(fmi2Component, fmi2FMUstate*);
fmi2Status fmi2SetFMUstate(fmi2Component, fmi2FMUstate);
fmi2Status fmi2FreeFMUstate(fmi2Component, fmi2FMUstate*);
fmi2Status fmi2SerializedFMUstateSize(fmi2Component, fmi2FMUstate, size_t*);
fmi2Status fmi2SerializeFMUstate(fmi2Component, fmi2FMUstate, fmi2Byte[], size_t);
fmi2Status fmi2DeSerializeFMUstate(fmi2Component, const fmi2Byte[], size_t, fmi2FMUstate*);
fmi2Status fmi2GetDirectionalDerivative(fmi2Component, const fmi2ValueReference[], size_t, const fmi2ValueReference[], size_t, const fmi2Real[], fmi2Real[]);

/* Model Exchange */
fmi2Status fmi2EnterEventMode(fmi2Component);
fmi2Status fmi2NewDiscreteStates(fmi2Component, fmi2EventInfo*);
fmi2Status fmi2EnterContinuousTimeMode(fmi2Component);
fmi2Status fmi2CompletedIntegratorStep(fmi2Component, fmi2Boolean, fmi2Boolean*, fmi2Boolean*);
fmi2Status fmi2SetTime(fmi2Component, fmi2Real);
fmi2Status fmi2SetContinuousStates(fmi2Component, const fmi2Real[], size_t);
fmi2Status fmi2GetDerivatives(fmi2Component, fmi2Real[], size_t);
fmi2Status fmi2GetEventIndicators(fmi2Component, fmi2Real[], size_t);
fmi2Status fmi2GetContinuousStates(fmi2Component, fmi2Real[], size_t);
fmi2Status fmi2GetNominalsOfContinuousStates(fmi2Component, fmi2Real[], size_t);

/* Co-Simulation */
fmi2Status fmi2DoStep(fmi2Component, fmi2Real, fmi2Real, fmi2Boolean);
fmi2Status fmi2CancelStep(fmi2Component);
fmi2Status fmi2GetStatus(fmi2Component, const fmi2StatusKind, fmi2Status*);
fmi2Status fmi2GetRealStatus(fmi2Component, const fmi2StatusKind, fmi2Real*);
fmi2Status fmi2GetIntegerStatus(fmi2Component, const fmi2StatusKind, fmi2Integer*);
fmi2Status fmi2GetBooleanStatus(fmi2Component, const fmi2StatusKind, fmi2Boolean*);
fmi2Status fmi2GetStringStatus(fmi2Component, const fmi2StatusKind, fmi2String*);
fmi2Status fmi2SetRealInputDerivatives(fmi2Component, const fmi2ValueReference[], size_t, const fmi2Integer[], const fmi2Real[]);
fmi2Status fmi2GetRealOutputDerivatives(fmi2Component, const fmi2ValueReference[], size_t, const fmi2Integer[], fmi2Real[]);

#endif
`;

/**
 * Compiles the generated C sources into a shared library (.dll, .so, .dylib) via CMake.
 * NOTE: This requires Node.js (fs, path, os, child_process), CMake, and a C compiler available on the system.
 */
export async function compileFmuBinary(
  id: string,
  sources: { modelC: string; modelH: string; fmi2FunctionsC: string; fmi3FunctionsC: string; cmakeLists: string },
): Promise<Uint8Array> {
  const [fs, path, os, { execSync }] = await Promise.all([
    import("fs"),
    import("path"),
    import("os"),
    import("child_process"),
  ]);

  const tmpPrefix = path.join(os.tmpdir(), `modelscript-fmu-${id}-`);
  const tmpDir = fs.mkdtempSync(tmpPrefix);

  try {
    fs.writeFileSync(path.join(tmpDir, `${id}_model.c`), sources.modelC);
    fs.writeFileSync(path.join(tmpDir, `${id}_model.h`), sources.modelH);
    fs.writeFileSync(path.join(tmpDir, "fmi2Functions.c"), sources.fmi2FunctionsC);
    fs.writeFileSync(path.join(tmpDir, "fmi3Functions.c"), sources.fmi3FunctionsC);
    fs.writeFileSync(path.join(tmpDir, "fmi2Functions.h"), FMI2_FUNCTIONS_H);
    fs.writeFileSync(path.join(tmpDir, "fmi2TypesPlatform.h"), FMI2_TYPES_PLATFORM_H);
    fs.writeFileSync(path.join(tmpDir, "fmi2FunctionTypes.h"), FMI2_FUNCTION_TYPES_H);
    fs.writeFileSync(path.join(tmpDir, "CMakeLists.txt"), sources.cmakeLists);

    execSync(`cmake -B build -S . -DCMAKE_BUILD_TYPE=Release`, { cwd: tmpDir, stdio: "pipe" });
    execSync(`cmake --build build --config Release`, { cwd: tmpDir, stdio: "pipe" });

    const buildDir = path.join(tmpDir, "build");
    const files = fs.readdirSync(buildDir);
    const libFile = files.find(
      (f) => f.startsWith(id) && (f.endsWith(".dll") || f.endsWith(".so") || f.endsWith(".dylib")),
    );
    if (!libFile) throw new Error("Shared library not found after CMake compilation.");

    return new Uint8Array(fs.readFileSync(path.join(buildDir, libFile)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
