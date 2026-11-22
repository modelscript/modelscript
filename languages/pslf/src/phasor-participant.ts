// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pslf — Polyglot `PhasorNetworkParticipant` Implementation (`PslfPhasorParticipant`)
 *
 * Bridges GE PSLF `.epc` / `.dyd` power-flow and dynamic models into ModelScript's
 * generic Phasor <-> EMT hybrid co-simulation engine (`runHybridPhasorEmtCoSimulation`)
 * with dynamic multi-port Y_eq, multi-frequency FDNE scanning, 3-sequence coupling,
 * and Picard state rollback.
 */

import type {
  ComplexPhasor,
  MultiPortBoundaryEquivalent,
  PhasorBoundaryInjection,
  PhasorInitResult,
  PhasorMacroStepResult,
  PhasorNetworkParticipant,
  PhasorTrajectoryResult,
} from "@modelscript/exchange";
import { PssePhasorParticipant } from "@modelscript/psse";
import { ensureBuiltInPslfLibraryRegistered } from "./catalog/library-package-adapter.js";
import { instantiatePslfWasmModel, type PslfLinkedDynamicInstance } from "./catalog/wasm-dyd-loader.js";
import { pslfDydToPsseDyr, pslfEpcToPsseRaw } from "./projections/pslf-to-psse.js";
import type { PslfDydCase, PslfDynamicModel, PslfEpcCase } from "./types.js";

export interface PslfWasmDynamicBindingResult {
  resolved: PslfLinkedDynamicInstance[];
  unmodeled: PslfDynamicModel[];
}

/**
 * Automatically ensures `@modelscript/pslf-std-lib` is registered and instantiates
 * cleanroom WASM dynamic model slots for every supported `.dyd` record, reporting
 * resolved instances alongside any unmodeled custom types.
 */
export function bindPslfDynamicModelsToWasm(
  models: PslfDynamicModel[],
  wasmBytes?: Uint8Array,
): PslfWasmDynamicBindingResult {
  ensureBuiltInPslfLibraryRegistered();
  const resolved: PslfLinkedDynamicInstance[] = [];
  const unmodeled: PslfDynamicModel[] = [];

  for (const model of models) {
    const inst = instantiatePslfWasmModel(model, wasmBytes);
    if (inst) {
      resolved.push(inst);
    } else {
      unmodeled.push(model);
    }
  }

  return { resolved, unmodeled };
}

export class PslfPhasorParticipant implements PhasorNetworkParticipant {
  public readonly id: string;
  public readonly language = "pslf";
  public readonly boundDynamicModels: PslfWasmDynamicBindingResult;

  private readonly inner: PssePhasorParticipant;

  constructor(epcCase: PslfEpcCase, options?: { id?: string; dydCase?: PslfDydCase | undefined }) {
    ensureBuiltInPslfLibraryRegistered();
    this.id = options?.id ?? "PSLF_BulkGrid";
    const psseCase = pslfEpcToPsseRaw(epcCase);
    const dyrCase = options?.dydCase ? pslfDydToPsseDyr(options.dydCase) : undefined;
    this.boundDynamicModels = options?.dydCase
      ? bindPslfDynamicModelsToWasm(options.dydCase.models)
      : { resolved: [], unmodeled: [] };
    this.inner = new PssePhasorParticipant(psseCase, { id: this.id, dyrCase });
  }

  public initialize(options: Parameters<PhasorNetworkParticipant["initialize"]>[0]): PhasorInitResult {
    return this.inner.initialize(options);
  }

  public stepMacro(tSec: number, dtSec: number, injections: PhasorBoundaryInjection[]): PhasorMacroStepResult {
    return this.inner.stepMacro(tSec, dtSec, injections);
  }

  public computeBoundaryEquivalent(boundaryBusIds: string[]): MultiPortBoundaryEquivalent {
    return this.inner.computeBoundaryEquivalent(boundaryBusIds);
  }

  public scanBoundaryAdmittance(
    busId: string,
    freqGridHz: number[],
  ): Array<{ freqHz: number; ySiemens: ComplexPhasor }> {
    return this.inner.scanBoundaryAdmittance(busId, freqGridHz);
  }

  public getState(): unknown {
    return this.inner.getState();
  }

  public setState(snapshot: unknown): void {
    this.inner.setState(snapshot);
  }

  public finalize(): PhasorTrajectoryResult {
    return this.inner.finalize();
  }
}
