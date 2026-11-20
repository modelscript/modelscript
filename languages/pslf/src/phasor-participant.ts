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
import { pslfDydToPsseDyr, pslfEpcToPsseRaw } from "./projections/pslf-to-psse.js";
import type { PslfDydCase, PslfEpcCase } from "./types.js";

export class PslfPhasorParticipant implements PhasorNetworkParticipant {
  public readonly id: string;
  public readonly language = "pslf";

  private readonly inner: PssePhasorParticipant;

  constructor(epcCase: PslfEpcCase, options?: { id?: string; dydCase?: PslfDydCase | undefined }) {
    this.id = options?.id ?? "PSLF_BulkGrid";
    const psseCase = pslfEpcToPsseRaw(epcCase);
    const dyrCase = options?.dydCase ? pslfDydToPsseDyr(options.dydCase) : undefined;
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
