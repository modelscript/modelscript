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
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  wasmParserInitialized = true;
}

export interface NativeSimSpec {
  modelName: string;
  sourceFiles: string[];
  libraryPaths?: string[] | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  stepSize?: number | undefined;
  numberOfIntervals?: number | undefined;
  solver?: "rk4" | "cvode" | undefined;
  tolerance?: number | undefined;
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

    const fileNamePrefix = spec.modelName.replace(/[^a-zA-Z0-9_]/g, "_") || "model";
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

    const resolvedWorkDir = path.resolve(workingDir);
    const cFile = path.resolve(resolvedWorkDir, `${fileNamePrefix}_sim.c`);
    const binFile = path.resolve(resolvedWorkDir, `${fileNamePrefix}_sim`);
    const csvFile = path.resolve(resolvedWorkDir, `${fileNamePrefix}_res.csv`);
    const runScript = path.resolve(resolvedWorkDir, `run_${fileNamePrefix}.sh`);
    if (
      !cFile.startsWith(resolvedWorkDir + path.sep) ||
      !binFile.startsWith(resolvedWorkDir + path.sep) ||
      !csvFile.startsWith(resolvedWorkDir + path.sep) ||
      !runScript.startsWith(resolvedWorkDir + path.sep)
    ) {
      throw new Error("Invalid simulation output path outside working directory");
    }

    fs.writeFileSync(cFile, cSource, "utf8");

    const rawCc = process.env["CC"] ?? "gcc";
    const cc = /^[a-zA-Z0-9_./+-]+$/.test(rawCc) ? rawCc : "gcc";
    const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
    const scriptContent = `#!/bin/bash
set -e
${shellQuote(cc)} -O3 -fno-math-errno -w ${shellQuote(cFile)} -o ${shellQuote(binFile)} -lm
${shellQuote(binFile)} > ${shellQuote(csvFile)}
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
