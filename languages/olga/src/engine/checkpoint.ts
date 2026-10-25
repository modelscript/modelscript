// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Portable State Checkpointing & Warm Restart Engine (.rst).
 *
 * Serializes and restores full transient DAE state vectors:
 * - Spatial grid cell profiles (P, T, H_L, H_G, v_L, v_G, droplet fraction)
 * - Dynamic scraper pigging coordinates, velocities, and swept volumes
 * - Active hydrodynamic slug tracking fronts, tails, and lengths
 * - PID controller integrator memories
 * - Machinery states (pump/compressor operating speeds & power)
 */

import fs from "node:fs";
import path from "node:path";
import type { OlgaCellState, OlgaCheckpointState } from "../types.js";

/**
 * Serializes an OlgaCheckpointState to an formatted JSON string.
 */
export function serializeCheckpoint(state: OlgaCheckpointState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Deserializes an OlgaCheckpointState from a JSON string or Uint8Array.
 */
export function deserializeCheckpoint(raw: string | Uint8Array): OlgaCheckpointState {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const parsed = JSON.parse(text);

  if (!parsed || parsed.version !== "1.0" || !Array.isArray(parsed.gridCells)) {
    throw new Error("Invalid OLGA checkpoint state: missing version '1.0' or gridCells array.");
  }

  return parsed as OlgaCheckpointState;
}

/**
 * Saves an OlgaCheckpointState to disk (.rst file).
 */
export function saveCheckpoint(state: OlgaCheckpointState, filePath: string): void {
  const resolved = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const serialized = serializeCheckpoint(state);
  fs.writeFileSync(resolved, serialized, "utf-8");
}

/**
 * Loads an OlgaCheckpointState from disk (.rst file).
 */
export function loadCheckpoint(filePath: string): OlgaCheckpointState {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`OLGA checkpoint file not found: '${resolved}'`);
  }
  const content = fs.readFileSync(resolved, "utf-8");
  return deserializeCheckpoint(content);
}

/**
 * Helper to construct an OlgaCheckpointState from current simulation arrays.
 */
export function captureSimulationCheckpoint(params: {
  modelTitle: string;
  simulatedTime: number;
  cells: { x: number }[];
  P: ArrayLike<number>;
  T: ArrayLike<number>;
  alphaG: ArrayLike<number>;
  jFace: ArrayLike<number>;
  dropletFraction?: ArrayLike<number> | undefined;
  pigs?: { name: string; position: number; velocity: number; sweptVolume: number; isStuck: boolean }[] | undefined;
  slugs?: { id: number; tailX: number; frontX: number; length: number; velocity: number }[] | undefined;
  controllers?: { name: string; integralState: number; lastOutput: number }[] | undefined;
  machinery?: { name: string; speedRpm: number; powerKw: number }[] | undefined;
  boundaryConditions?: Record<string, number> | undefined;
}): OlgaCheckpointState {
  const N = params.cells.length;
  const gridCells: OlgaCellState[] = [];

  for (let i = 0; i < N; i++) {
    const pVal = params.P[i]!;
    const tVal = params.T[i]!;
    const aG = params.alphaG[i]!;
    const hL = 1.0 - aG;
    const jAvg = 0.5 * (params.jFace[i]! + params.jFace[i + 1]!);
    const vG = aG > 1e-4 ? jAvg * 1.2 : 0.0;
    const vL = hL > 1e-4 ? jAvg * 0.8 : 0.0;

    gridCells.push({
      x: params.cells[i]!.x,
      pressurePa: pVal,
      temperatureK: tVal,
      liquidHoldup: Math.max(0.0, Math.min(1.0, hL)),
      gasHoldup: Math.max(0.0, Math.min(1.0, aG)),
      liquidVelocityMps: vL,
      gasVelocityMps: vG,
      dropletFraction: params.dropletFraction ? params.dropletFraction[i] : undefined,
    });
  }

  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    simulatedTime: params.simulatedTime,
    modelTitle: params.modelTitle,
    gridCells,
    pigStates: params.pigs ? [...params.pigs] : undefined,
    slugStates: params.slugs ? [...params.slugs] : undefined,
    controllers: params.controllers ? [...params.controllers] : undefined,
    machinery: params.machinery ? [...params.machinery] : undefined,
    boundaryConditions: params.boundaryConditions ? { ...params.boundaryConditions } : undefined,
  };
}
