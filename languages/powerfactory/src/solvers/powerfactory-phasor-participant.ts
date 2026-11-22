// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerfactory — Polyglot `PhasorNetworkParticipant` Implementation (`PowerFactoryPhasorParticipant`)
 *
 * Bridges DIgSILENT PowerFactory models into ModelScript's generic Phasor <-> EMT
 * hybrid co-simulation engine, transparently mapping PowerFactory terminal IDs or
 * bus numbers across the boundary.
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
import { ensureBuiltInPowerFactoryLibraryRegistered } from "../catalog/library-package-adapter.js";
import { powerFactoryToPsse, type PowerFactoryToPsseOptions } from "../projections/powerfactory-to-psse.js";
import type { PowerFactoryModel } from "../types.js";

export class PowerFactoryPhasorParticipant implements PhasorNetworkParticipant {
  public readonly id: string;
  public readonly language = "powerfactory";

  private readonly inner: PssePhasorParticipant;
  private readonly termToBusMap: Map<string, number>;
  private readonly busToTermMap: Map<string, string>;

  constructor(model: PowerFactoryModel, options?: PowerFactoryToPsseOptions & { id?: string }) {
    ensureBuiltInPowerFactoryLibraryRegistered();
    this.id = options?.id ?? "PowerFactory_Grid";
    const { psseCase, termToBusMap } = powerFactoryToPsse(model, options);
    this.termToBusMap = termToBusMap;
    this.busToTermMap = new Map<string, string>();
    for (const [termId, busNum] of termToBusMap) {
      this.busToTermMap.set(String(busNum), termId);
    }
    this.inner = new PssePhasorParticipant(psseCase, { id: this.id });
  }

  private toInternalBusId(busOrTermId: string): string {
    const mapped = this.termToBusMap.get(busOrTermId);
    return mapped !== undefined ? String(mapped) : busOrTermId;
  }

  private remapVoltages(
    raw: Map<string, PhasorBoundaryBusVoltage>,
    requestedIds: string[],
  ): Map<string, PhasorBoundaryBusVoltage> {
    const out = new Map<string, PhasorBoundaryBusVoltage>();
    for (const reqId of requestedIds) {
      const internal = this.toInternalBusId(reqId);
      const bv = raw.get(internal);
      if (bv) out.set(reqId, { ...bv, busId: reqId });
    }
    return out;
  }

  private remapEquiv(eq: MultiPortBoundaryEquivalent, requestedIds: string[]): MultiPortBoundaryEquivalent {
    return {
      ...eq,
      busIds: eq.busIds.map((bId, i) => requestedIds[i] ?? this.busToTermMap.get(bId) ?? bId),
    };
  }

  private requestedBoundaryIds: string[] = [];

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
