// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Clocked Zero-Order Hold & Delayed ONNX RL Policy Block.
 *
 * Bridges trained RL policies (`TrainedROM` / `ArenaNeuralBlock` from `onnx-importer.ts`)
 * into closed-loop plant simulation with:
 *   1. Periodic discrete sampling (`samplePeriod`, e.g. 0.02 s for 50 Hz).
 *   2. Exact actuation/communication latency (`commandDelay`, e.g. 0.0225 s) via a
 *      time-stamped ring buffer.
 *   3. Action scaling and home-pose offset (`q_target = q_home + scale * action`).
 *   4. Direct `DAEBuilder` lowering for continuous/hybrid co-simulation and FMU export.
 */

import {
  type ArenaNeuralBlock,
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { evaluateROM, type TrainedROM } from "./rom-trainer.js";

export interface SampledPolicyOptions {
  /** Block instance name (e.g. "WalkingPolicy"). */
  name: string;
  /** Policy execution period [s]. Default: 0.02 (50 Hz). */
  samplePeriod?: number | undefined;
  /** Command transport delay [s]. Default: 0.0 (e.g. 0.0225 s). */
  commandDelay?: number | undefined;
  /** Ordered observation variable names in DAEBuilder. */
  inputVarNames: string[];
  /** Ordered target variable names in DAEBuilder. */
  outputVarNames: string[];
  /** Action scale factor (scalar or per-channel). Default: 1.0. */
  actionScale?: number | number[] | undefined;
  /** Action offset / home pose (scalar or per-channel). Default: 0.0. */
  actionOffset?: number | number[] | undefined;
}

/**
 * Stateful 50 Hz Zero-Order Hold + Ring-Buffer Command Delay controller
 * for closed-loop RL policy co-simulation.
 */
export class SampledPolicyController {
  public readonly name: string;
  public readonly samplePeriod: number;
  public readonly commandDelay: number;
  private readonly actionDim: number;
  private readonly actionScale: number[];
  private readonly actionOffset: number[];
  private readonly rom: TrainedROM;
  private readonly history: { time: number; command: number[] }[] = [];
  private nextSampleTime = 0.0;
  private lastRawAction: number[];

  constructor(
    rom: TrainedROM,
    options: Omit<SampledPolicyOptions, "inputVarNames" | "outputVarNames"> & { actionDim?: number },
  ) {
    this.name = options.name;
    this.samplePeriod = Math.max(1e-6, options.samplePeriod ?? 0.02);
    this.commandDelay = Math.max(0.0, options.commandDelay ?? 0.0);
    this.rom = rom;
    this.actionDim = options.actionDim ?? rom.outputNames.length;
    this.actionScale = Array.from({ length: this.actionDim }, (_, i) =>
      Array.isArray(options.actionScale) ? (options.actionScale[i] ?? 1.0) : (options.actionScale ?? 1.0),
    );
    this.actionOffset = Array.from({ length: this.actionDim }, (_, i) =>
      Array.isArray(options.actionOffset) ? (options.actionOffset[i] ?? 0.0) : (options.actionOffset ?? 0.0),
    );
    this.lastRawAction = new Array<number>(this.actionDim).fill(0.0);
    this.history.push({ time: -1e9, command: [...this.actionOffset] });
  }

  public reset(): void {
    this.nextSampleTime = 0.0;
    this.lastRawAction.fill(0.0);
    this.history.length = 0;
    this.history.push({ time: -1e9, command: [...this.actionOffset] });
  }

  /**
   * Advances the sampled policy to time `t` given current observation `obs`,
   * returning the delayed actuator target vector active at `t`.
   */
  public step(t: number, obs: number[]): number[] {
    if (t + 1e-12 >= this.nextSampleTime) {
      const raw = evaluateROM(this.rom, obs);
      this.lastRawAction = raw;
      const scaled = new Array<number>(this.actionDim);
      for (let i = 0; i < this.actionDim; i++) {
        scaled[i] = this.actionOffset[i]! + this.actionScale[i]! * (raw[i] ?? 0.0);
      }
      this.history.push({ time: t, command: scaled });
      while (t >= this.nextSampleTime - 1e-12) {
        this.nextSampleTime += this.samplePeriod;
      }
      // Trim history entries older than commandDelay + 2 * samplePeriod
      const cutoff = t - this.commandDelay - 2 * this.samplePeriod;
      while (this.history.length > 2 && this.history[1]!.time < cutoff) {
        this.history.shift();
      }
    }

    const queryTime = t - this.commandDelay;
    let active = this.history[0]!.command;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.time <= queryTime + 1e-12) {
        active = this.history[i]!.command;
        break;
      }
    }
    return active;
  }

  public getLastRawAction(): readonly number[] {
    return this.lastRawAction;
  }
}

/**
 * Lowers an `ArenaNeuralBlock` into `DAEBuilder` with sampling/delay metadata
 * and scaled/offset actuator target equations.
 */
export function lowerSampledPolicyToDae(
  dae: DAEBuilder,
  block: ArenaNeuralBlock,
  options: SampledPolicyOptions,
): { rawOutputNames: string[] } {
  const samplePeriod = Math.max(1e-6, options.samplePeriod ?? 0.02);
  const commandDelay = Math.max(0.0, options.commandDelay ?? 0.0);

  dae.addVariable(`${options.name}.samplePeriod`, VarType.Real, Variability.Parameter, Causality.Local, samplePeriod);
  dae.addVariable(`${options.name}.commandDelay`, VarType.Real, Variability.Parameter, Causality.Local, commandDelay);

  const rawOutputNames = options.outputVarNames.map((_, i) => `${options.name}.raw_action_${i}`);
  for (const rawName of rawOutputNames) {
    if (dae.getVarIdxByName(rawName) === -1) {
      dae.addVariable(rawName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    }
  }

  block.build(dae, options.inputVarNames, rawOutputNames);

  for (let i = 0; i < options.outputVarNames.length; i++) {
    const outName = options.outputVarNames[i]!;
    const rawName = rawOutputNames[i]!;
    const scale = Array.isArray(options.actionScale) ? (options.actionScale[i] ?? 1.0) : (options.actionScale ?? 1.0);
    const offset = Array.isArray(options.actionOffset)
      ? (options.actionOffset[i] ?? 0.0)
      : (options.actionOffset ?? 0.0);

    if (dae.getVarIdxByName(outName) === -1) {
      dae.addVariable(outName, VarType.Real, Variability.Continuous, Causality.Local, offset);
    }
    const scaledExpr = dae.addBinaryExpr(
      BinOp.Add,
      dae.addRealLiteral(offset),
      dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(scale), dae.addNameExpr(rawName)),
    );
    dae.addEquation(EqKind.Simple, dae.addNameExpr(outName), scaledExpr);
  }

  return { rawOutputNames };
}
