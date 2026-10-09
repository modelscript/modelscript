// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateFmu, generateSimulationC } from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica";
import { createWasmParser } from "@modelscript/modelica/parser";
import { foldArenaConstants, scalarizeArena, type DAEBuilder } from "@modelscript/runtime";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { NodeFileSystem } from "../../util/filesystem.js";

let wasmParserInitialized = false;

export async function ensureModelicaParser(): Promise<void> {
  if (wasmParserInitialized) return;
  const require = createRequire(import.meta.url);
  const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
  const { parser } = await createWasmParser(modelicaWasmPath);
  Context.registerParser(".mo", parser as any);
  wasmParserInitialized = true;
}

export interface NativeSimSpec {
  modelName: string;
  sourceFiles: string[];
  libraryPaths?: string[];
  startTime?: number;
  stopTime?: number;
  stepSize?: number;
  numberOfIntervals?: number;
  solver?: "rk4" | "cvode";
  tolerance?: number;
}

export interface NativeSimPrepResult {
  cFile: string;
  runScript: string;
  fileNamePrefix: string;
  csvFile: string;
  arena: DAEBuilder;
}

/**
 * Prepares native C simulation files (standalone chunked C source and runner script)
 * inside the given working directory.
 */
export async function prepareNativeSimulation(
  workingDir: string,
  spec: NativeSimSpec,
): Promise<NativeSimPrepResult | null> {
  try {
    await ensureModelicaParser();

    const context = Context.createBatch(new NodeFileSystem());

    // Add library paths
    if (spec.libraryPaths) {
      for (const libPath of spec.libraryPaths) {
        if (fs.existsSync(libPath)) {
          await context.addLibrary(libPath);
        }
      }
    }

    // Add source files
    for (const src of spec.sourceFiles) {
      if (fs.existsSync(src)) {
        await context.addLibrary(src);
      }
    }

    // Flatten model
    let arena = context.flattenArena(spec.modelName);
    if (!arena) return null;

    // Scalarize arrays if needed
    let hasArrays = false;
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.getVarShape(i).length > 0) {
        hasArrays = true;
        break;
      }
    }
    if (hasArrays) {
      arena = scalarizeArena(arena);
      foldArenaConstants(arena);
    }

    const fileNamePrefix = spec.modelName.replace(/\./g, "_");
    const fmuResult = generateFmu(arena, {
      modelIdentifier: fileNamePrefix,
      generationTool: "ModelScript Cloud HPC",
    });

    const startTime = spec.startTime ?? 0.0;
    const stopTime = spec.stopTime ?? 1.0;
    const stepSize =
      spec.stepSize ?? (spec.numberOfIntervals ? (stopTime - startTime) / spec.numberOfIntervals : 0.002);

    const cSource = generateSimulationC(arena, fmuResult, {
      modelIdentifier: fileNamePrefix,
      startTime,
      stopTime,
      stepSize,
      quiet: false,
      solver: spec.solver ?? "rk4",
      tolerance: spec.tolerance ?? 1e-6,
    });

    const cFile = path.join(workingDir, `${fileNamePrefix}_sim.c`);
    const binFile = path.join(workingDir, `${fileNamePrefix}_sim`);
    const csvFile = path.join(workingDir, `${fileNamePrefix}_res.csv`);
    const runScript = path.join(workingDir, `run_${fileNamePrefix}.sh`);

    fs.writeFileSync(cFile, cSource, "utf8");

    const cc = process.env.CC ?? "gcc";
    const scriptContent = `#!/bin/bash
set -e
${cc} -O3 -fno-math-errno -w "${cFile}" -o "${binFile}" -lm
"${binFile}" > "${csvFile}"
`;
    fs.writeFileSync(runScript, scriptContent, { mode: 0o755, encoding: "utf8" });

    return {
      cFile,
      runScript,
      fileNamePrefix,
      csvFile,
      arena,
    };
  } catch (err) {
    console.error("Native ModelScript simulation prep failed, falling back:", err);
    return null;
  }
}
