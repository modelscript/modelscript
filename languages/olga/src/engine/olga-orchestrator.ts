// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Tier 3: Native Schlumberger OLGA Engine Batch Orchestrator.
 *
 * Spawns the native OLGA executable (olga.exe / olga batch runner),
 * serializes .genkey decks, executes batch multiphase solves, parses .tpl trend
 * files, and provides seamless zero-install fallback to in-WASM 1D drift-flux.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { serializeKeyDeck } from "../parser/key-parser.js";
import { simulateDriftFlux } from "../solver/drift-flux-dae.js";
import type { OlgaModel, OlgaSimulationResult } from "../types.js";

/** Configuration options for executing the Schlumberger OLGA engine. */
export interface OlgaEngineOptions {
  /** Path to the OLGA executable (e.g. 'C:\\Program Files\\Schlumberger\\OLGA\\olga.exe' or 'olga'). */
  executablePath?: string | undefined;
  /** Custom working directory for the simulation run. */
  workingDir?: string | undefined;
  /** Simulation timeout in milliseconds (default: 60000 ms). */
  timeoutMs?: number | undefined;
  /** Force the use of ModelScript's in-WASM 1D drift-flux solver. */
  forceWasmFallback?: boolean | undefined;
  /** Raw PVT table content (.tab) to write alongside the .genkey case. */
  pvtTableContent?: string | undefined;
  /** Total simulation duration in seconds (overrides model.endTime if set). */
  durationSeconds?: number | undefined;
}

import { decodeOlgaFlowRegime, parseOlgaPpl, parseOlgaPplSnapshots, profileDatasetToSnapshots } from "./ppl-parser.js";
import { parseOlgaTpl, parseOlgaTplDataset, parseTrendVariableHeader } from "./tpl-parser.js";

export {
  decodeOlgaFlowRegime,
  parseOlgaPpl,
  parseOlgaPplSnapshots,
  parseOlgaTpl,
  parseOlgaTplDataset,
  parseTrendVariableHeader,
  profileDatasetToSnapshots,
};

/**
 * Checks whether the Schlumberger OLGA native executable is installed and reachable.
 */
export async function isOlgaEngineAvailable(executablePath?: string): Promise<boolean> {
  const binary = executablePath ?? process.env["OLGA_BIN"] ?? (process.platform === "win32" ? "olga.exe" : "olga");
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(binary, ["--version"], {
        shell: true,
        stdio: "ignore",
      });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0 || code === 1));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Orchestrates an OLGA simulation run.
 *
 * If native OLGA is installed, serializes the case to .genkey, launches the engine,
 * and parses the output trends. Otherwise, seamlessly falls back to ModelScript's
 * zero-GC in-WASM 1D drift-flux multiphase solver.
 */
export async function runOlgaEngine(model: OlgaModel, options: OlgaEngineOptions = {}): Promise<OlgaSimulationResult> {
  const isAvailable = !options.forceWasmFallback && (await isOlgaEngineAvailable(options.executablePath));

  if (!isAvailable) {
    // Seamless Tier 1 in-WASM drift-flux solver fallback
    return simulateDriftFlux(model, { durationSeconds: options.durationSeconds });
  }

  const binary =
    options.executablePath ?? process.env["OLGA_BIN"] ?? (process.platform === "win32" ? "olga.exe" : "olga");
  const caseDir = options.workingDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "modelscript-olga-")));
  const caseBaseName = "run_case";
  const keyDeckPath = path.join(caseDir, `${caseBaseName}.genkey`);
  const tplPath = path.join(caseDir, `${caseBaseName}.tpl`);

  try {
    // 1. Serialize case to .genkey
    const keyDeckContent = serializeKeyDeck(model);
    await fs.writeFile(keyDeckPath, keyDeckContent, "utf-8");

    // 2. Write PVT table if provided
    if (options.pvtTableContent && model.tableFile) {
      await fs.writeFile(path.join(caseDir, model.tableFile), options.pvtTableContent, "utf-8");
    }

    // 3. Spawn OLGA batch execution
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`OLGA engine timed out after ${options.timeoutMs ?? 60000} ms.`));
      }, options.timeoutMs ?? 60000);

      const child = spawn(binary, ["-b", `${caseBaseName}.genkey`], {
        cwd: caseDir,
        shell: true,
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`OLGA batch run failed with exit code ${code}`));
        } else {
          resolve();
        }
      });
    });

    // 4. Read and parse the resulting .tpl trend file
    let simResult: OlgaSimulationResult;
    try {
      const tplRaw = await fs.readFile(tplPath, "utf-8");
      simResult = parseOlgaTpl(tplRaw);
    } catch {
      simResult = simulateDriftFlux(model, { durationSeconds: options.durationSeconds });
    }

    // 5. Ingest .ppl spatial profile file if generated by engine
    const pplPath = path.join(caseDir, `${caseBaseName}.ppl`);
    try {
      const pplRaw = await fs.readFile(pplPath, "utf-8");
      const pplDataset = parseOlgaPpl(pplRaw);
      simResult.profileDataset = pplDataset;
      const snapshots = profileDatasetToSnapshots(pplDataset);
      if (snapshots.length > 0) {
        simResult.profiles = snapshots;
      }
    } catch {
      // .ppl is optional or case had no profile output
    }

    return simResult;
  } catch (_err) {
    // Gracefully fallback to in-WASM drift-flux if external engine failed
    return simulateDriftFlux(model, { durationSeconds: options.durationSeconds });
  } finally {
    if (!options.workingDir) {
      await fs.rm(caseDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
