// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Polyglot `PhasorNetworkParticipant` Implementation (`CgmesPhasorParticipant`)
 *
 * Bridges IEC 61970 CGMES (CIM XML/RDF) transmission models into ModelScript's
 * generic Phasor <-> EMT hybrid co-simulation engine, transparently mapping
 * CGMES TopologicalNode mRIDs or bus numbers across the boundary.
 */

import type {
  ComplexPhasor,
  MultiPortBoundaryEquivalent,
  PhasorBoundaryBusVoltage,
  PhasorBoundaryInjection,
  PhasorInitResult,
  PhasorMacroStepResult,
  PhasorNetworkParticipant,
  PhasorTrajectoryResult,
} from "@modelscript/exchange";
import { PssePhasorParticipant } from "@modelscript/psse";
import { cgmesToPsse, type CgmesToPsseOptions } from "./projections/cgmes-to-psse.js";
import type { CgmesModel } from "./types.js";

export class CgmesPhasorParticipant implements PhasorNetworkParticipant {
  public readonly id: string;
  public readonly language = "cgmes";

  private readonly inner: PssePhasorParticipant;
  private readonly nodeToBusNum: Map<string, number>;
  private readonly busNumToNode: Map<number, string>;
  private requestedBoundaryIds: string[] = [];

  constructor(model: CgmesModel, options?: CgmesToPsseOptions & { id?: string }) {
    this.id = options?.id ?? "CGMES_Grid";
    const { psseCase, nodeToBusNum, busNumToNode } = cgmesToPsse(model, options);
    this.nodeToBusNum = nodeToBusNum;
    this.busNumToNode = busNumToNode;
    this.inner = new PssePhasorParticipant(psseCase, { id: this.id });
  }

  private toInternalBusId(nodeOrBusId: string): string {
    const mapped = this.nodeToBusNum.get(nodeOrBusId);
    return mapped !== undefined ? String(mapped) : nodeOrBusId;
  }

  private remapVoltages(
    raw: Map<string, PhasorBoundaryBusVoltage>,
    requestedIds: string[],
  ): Map<string, PhasorBoundaryBusVoltage> {
    const out = new Map<string, PhasorBoundaryBusVoltage>();
    for (const reqId of requestedIds) {
      const bv = raw.get(this.toInternalBusId(reqId));
      if (bv) out.set(reqId, { ...bv, busId: reqId });
    }
    return out;
  }

  private remapEquiv(eq: MultiPortBoundaryEquivalent, requestedIds: string[]): MultiPortBoundaryEquivalent {
    return {
      ...eq,
      busIds: eq.busIds.map((bId, i) => requestedIds[i] ?? this.busNumToNode.get(Number(bId)) ?? bId),
    };
  }

  public initialize(options: Parameters<PhasorNetworkParticipant["initialize"]>[0]): PhasorInitResult {
    this.requestedBoundaryIds = options.boundaryBusIds.slice();
    const internalIds = options.boundaryBusIds.map((id) => this.toInternalBusId(id));
    const res = this.inner.initialize({
      ...options,
      boundaryBusIds: internalIds,
      fault: options.fault ? { ...options.fault, busId: this.toInternalBusId(options.fault.busId) } : undefined,
    });
    return {
      ...res,
      boundaryVoltages: this.remapVoltages(res.boundaryVoltages, this.requestedBoundaryIds),
      boundaryEquivalent: this.remapEquiv(res.boundaryEquivalent, this.requestedBoundaryIds),
    };
  }

  public stepMacro(tSec: number, dtSec: number, injections: PhasorBoundaryInjection[]): PhasorMacroStepResult {
    const mappedInj = injections.map((inj) => ({
      ...inj,
      busId: this.toInternalBusId(inj.busId),
    }));
    const res = this.inner.stepMacro(tSec, dtSec, mappedInj);
    return {
      ...res,
      boundaryVoltages: this.remapVoltages(res.boundaryVoltages, this.requestedBoundaryIds),
      boundaryEquivalent: res.boundaryEquivalent
        ? this.remapEquiv(res.boundaryEquivalent, this.requestedBoundaryIds)
        : undefined,
    };
  }

  public computeBoundaryEquivalent(boundaryBusIds: string[]): MultiPortBoundaryEquivalent {
    const internalIds = boundaryBusIds.map((id) => this.toInternalBusId(id));
    return this.remapEquiv(this.inner.computeBoundaryEquivalent(internalIds), boundaryBusIds);
  }

  public scanBoundaryAdmittance(
    busId: string,
    freqGridHz: number[],
  ): Array<{ freqHz: number; ySiemens: ComplexPhasor }> {
    return this.inner.scanBoundaryAdmittance(this.toInternalBusId(busId), freqGridHz);
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
