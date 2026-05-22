// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Neural-network backed FMU subsystem.
 *
 * Implements the {@link FmuSubsystem} interface using a trained
 * {@link TrainedROM} for fast surrogate evaluation. Plugs directly
 * into {@link FmuSubsystemRegistry} so the simulator can delegate
 * variable evaluation to the ROM instead of a full FMU.
 */

import { evaluateROM, type TrainedROM } from "../surrogates/rom-trainer.js";
import type { FmuSubsystem } from "./fmu-subsystem.js";

/**
 * An FmuSubsystem backed by a trained ROM (MLP, RBF, or polynomial).
 *
 * On each `doStep()`, evaluates the ROM's forward pass with current
 * input values and populates outputs. This is orders of magnitude
 * faster than a full FMU simulation.
 */
export class NeuralNetFmuSubsystem implements FmuSubsystem {
  readonly modelName: string;
  readonly inputNames: string[];
  readonly outputNames: string[];
  readonly parameterNames: string[] = [];

  private rom: TrainedROM;
  private currentInputs = new Map<string, number>();
  private currentOutputs = new Map<string, number>();

  constructor(modelName: string, rom: TrainedROM) {
    this.modelName = modelName;
    this.rom = rom;
    this.inputNames = rom.inputNames;
    this.outputNames = rom.outputNames;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initialize(_startTime: number, _stopTime: number, _stepSize: number): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
    for (const name of this.inputNames) this.currentInputs.set(name, 0);
    for (const name of this.outputNames) this.currentOutputs.set(name, 0);
  }

  setInputs(inputs: Map<string, number>): void {
    for (const [name, value] of inputs) {
      if (this.currentInputs.has(name)) {
        this.currentInputs.set(name, value);
      }
    }
    // Evaluate ROM immediately on input change
    this.evaluate();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  doStep(_currentTime: number, _stepSize: number): void {
    // For a steady-state ROM, evaluation already happened in setInputs.
    // Re-evaluate for safety (no-op if inputs unchanged).
    this.evaluate();
  }

  getOutputs(): Map<string, number> {
    return new Map(this.currentOutputs);
  }

  terminate(): void {
    this.currentInputs.clear();
    this.currentOutputs.clear();
  }

  /** Replace the underlying ROM (e.g., after retraining). */
  updateROM(rom: TrainedROM): void {
    this.rom = rom;
  }

  /** Get the underlying trained ROM for serialization/export. */
  getTrainedROM(): TrainedROM {
    return this.rom;
  }

  private evaluate(): void {
    const inputVec = this.inputNames.map((name) => this.currentInputs.get(name) ?? 0);
    const outputVec = evaluateROM(this.rom, inputVec);
    for (let i = 0; i < this.outputNames.length; i++) {
      this.currentOutputs.set(this.outputNames[i] as string, outputVec[i] ?? 0);
    }
  }
}
