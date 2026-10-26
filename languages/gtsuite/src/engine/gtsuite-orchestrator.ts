// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simulateGtSuiteTransient } from "../dae/cylinder-dae.js";
import { parseGdxTrajectory } from "../parser/gdx-reader.js";
import type { GtModel, GtSimulationResult } from "../types.js";

export interface GtSuiteEngineOptions {
  executablePath?: string | undefined;
  workingDir?: string | undefined;
  timeoutMs?: number | undefined;
  forceWasmFallback?: boolean | undefined;
  durationSeconds?: number | undefined;
}

/**
 * Checks whether the native Gamma Technologies GT-SUITE executable (gtise / gtise.exe) is reachable.
 */
export async function isGtSuiteEngineAvailable(executablePath?: string): Promise<boolean> {
  const binary = executablePath ?? process.env["GTSUITE_BIN"] ?? (process.platform === "win32" ? "gtise.exe" : "gtise");
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(binary, ["-version"], {
        shell: false,
        stdio: "ignore",
      });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Executes a GT-SUITE engine simulation. Spawns native gtise if available,
 * otherwise falls back automatically to ModelScript's zero-install in-WASM DAE simulator.
 */
export async function runGtSuiteSimulation(
  model: GtModel,
  modelSourceText: string,
  options: GtSuiteEngineOptions = {},
): Promise<GtSimulationResult> {
  const forceWasm = options.forceWasmFallback ?? false;
  const isAvailable = !forceWasm && (await isGtSuiteEngineAvailable(options.executablePath));

  if (!isAvailable) {
    // In-WASM DAE Engine Fallback
    return simulateGtSuiteTransient(model, {
      durationSeconds: options.durationSeconds ?? model.simulationSettings.durationSeconds,
      engineSpeedRpm: model.simulationSettings.engineSpeedRpm,
    });
  }

  // Native GT-SUITE execution
  const tempDir = options.workingDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "gtsuite-run-")));
  const safeModelName = path.basename(model.name).replace(/[^a-zA-Z0-9_-]/g, "_") || "model";
  const modelPath = path.join(tempDir, `${safeModelName}.gtm`);
  await fs.writeFile(modelPath, modelSourceText, "utf-8");

  const binary =
    options.executablePath ?? process.env["GTSUITE_BIN"] ?? (process.platform === "win32" ? "gtise.exe" : "gtise");

  return new Promise<GtSimulationResult>((resolve, reject) => {
    const child = spawn(binary, ["-run", modelPath], {
      cwd: tempDir,
      shell: false,
      stdio: "pipe",
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`GT-SUITE execution timed out after ${options.timeoutMs ?? 60000} ms.`));
    }, options.timeoutMs ?? 60000);

    child.on("close", async (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Fall back to WASM if native execution fails
        const wasmRes = simulateGtSuiteTransient(model, {
          durationSeconds: options.durationSeconds ?? model.simulationSettings.durationSeconds,
          engineSpeedRpm: model.simulationSettings.engineSpeedRpm,
        });
        resolve(wasmRes);
        return;
      }

      // Check for results .gdx or .csv
      try {
        const resultCsv = path.join(tempDir, `${safeModelName}.csv`);
        const content = await fs.readFile(resultCsv, "utf-8");
        const parsed = parseGdxTrajectory(content, safeModelName);
        resolve(parsed);
      } catch {
        resolve(
          simulateGtSuiteTransient(model, {
            durationSeconds: options.durationSeconds ?? model.simulationSettings.durationSeconds,
            engineSpeedRpm: model.simulationSettings.engineSpeedRpm,
          }),
        );
      }
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve(
        simulateGtSuiteTransient(model, {
          durationSeconds: options.durationSeconds ?? model.simulationSettings.durationSeconds,
          engineSpeedRpm: model.simulationSettings.engineSpeedRpm,
        }),
      );
    });
  });
}
