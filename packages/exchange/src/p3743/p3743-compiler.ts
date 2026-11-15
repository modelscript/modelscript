// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileWidebandCorridor,
  type CompiledWidebandCorridor,
  type CorridorBoundaryEquivalent,
  type OverheadConductorSpec,
  type WidebandCorridorInput,
} from "@modelscript/simulate/solvers";
import { validateP3743Package } from "./p3743-reader.js";
import type { P3743BoundaryEquivalent, P3743Package, P3743VendorModelEncapsulation } from "./types.js";

export interface P3743EmtCompilationResult {
  caseId: string;
  corridors: CompiledWidebandCorridor[];
  verifiedVendorModels: Array<{
    id: string;
    busId: string;
    payloadKind: P3743VendorModelEncapsulation["payloadKind"];
    sha256: string;
  }>;
  warnings: string[];
}

function defaultThreePhaseConductors(baseKvLL: number): OverheadConductorSpec[] {
  const spacingM = baseKvLL >= 345 ? 8.0 : baseKvLL >= 230 ? 6.0 : 4.0;
  const heightM = baseKvLL >= 345 ? 24.0 : baseKvLL >= 230 ? 18.0 : 14.0;
  return [
    { id: "PH_A", phase: 1, xM: -spacingM, yTowerM: heightM, radiusM: 0.015, dcResistanceOhmPerKm: 0.05 },
    { id: "PH_B", phase: 2, xM: 0, yTowerM: heightM, radiusM: 0.015, dcResistanceOhmPerKm: 0.05 },
    { id: "PH_C", phase: 3, xM: spacingM, yTowerM: heightM, radiusM: 0.015, dcResistanceOhmPerKm: 0.05 },
  ];
}

function toCorridorBoundary(eq: P3743BoundaryEquivalent | undefined): CorridorBoundaryEquivalent | undefined {
  if (!eq) return undefined;
  return {
    busId: eq.busId,
    shortCircuitMva: eq.shortCircuitMva,
    xOverRRatio: eq.xOverRRatio,
    z1Ohm: eq.z1Ohm,
    z0Ohm: eq.z0Ohm,
  };
}

/**
 * Validates and compiles an IEEE P3743 package into wideband EMT corridor models
 * and verified black-box vendor model bindings.
 */
export function compileP3743ToEmtCorridors(
  pkg: P3743Package,
  options: { conductorsByCorridor?: Record<string, OverheadConductorSpec[]> } = {},
): P3743EmtCompilationResult {
  const validation = validateP3743Package(pkg);
  if (!validation.valid) {
    throw new Error(`Invalid IEEE P3743 package: ${validation.errors.join("; ")}`);
  }

  const busIndexMap = new Map<string, number>();
  const busKvMap = new Map<string, number>();
  pkg.buses.forEach((b, idx) => {
    busIndexMap.set(b.id, idx + 1);
    busKvMap.set(b.id, b.baseKvLL);
  });

  const boundaryByBus = new Map<string, P3743BoundaryEquivalent>();
  for (const eq of pkg.boundaryEquivalents) {
    boundaryByBus.set(eq.busId, eq);
  }

  const corridors: CompiledWidebandCorridor[] = pkg.corridors.map((corridor) => {
    const baseKv = busKvMap.get(corridor.fromBusId) ?? 345;
    const conductors = options.conductorsByCorridor?.[corridor.id] ?? defaultThreePhaseConductors(baseKv);

    const input: WidebandCorridorInput = {
      corridorId: corridor.id,
      fromNode: busIndexMap.get(corridor.fromBusId) ?? 1,
      toNode: busIndexMap.get(corridor.toBusId) ?? 2,
      lengthKm: corridor.lengthKm,
      conductors,
      homogeneousSoilOhmM: corridor.soilModel.kind === "homogeneous" ? corridor.soilModel.rhoOhmM : undefined,
      twoLayerSoil:
        corridor.soilModel.kind === "two-layer"
          ? {
              upperResistivityOhmM: corridor.soilModel.upperRhoOhmM,
              lowerResistivityOhmM: corridor.soilModel.lowerRhoOhmM,
              upperLayerDepthM: corridor.soilModel.upperDepthM,
            }
          : undefined,
      fromBoundary: toCorridorBoundary(boundaryByBus.get(corridor.fromBusId)),
      toBoundary: toCorridorBoundary(boundaryByBus.get(corridor.toBusId)),
    };

    const compiled = compileWidebandCorridor(input);
    if (corridor.mutualCouplings && corridor.mutualCouplings.length > 0) {
      for (const mc of corridor.mutualCouplings) {
        const idx60 = mc.frequenciesHz.findIndex((f) => Math.abs(f - 60) < 1e-3);
        const pickIdx = idx60 >= 0 ? idx60 : 0;
        if (mc.frequenciesHz[pickIdx] !== undefined) {
          compiled.mutualCouplings.push({
            coupledCorridorId: mc.corridorB,
            freqHz: mc.frequenciesHz[pickIdx]!,
            rMutualOhmPerKm: mc.rMutualOhmPerKm[pickIdx] ?? 0,
            lMutualHPerKm: mc.lMutualHPerKm[pickIdx] ?? 0,
          });
        }
      }
    }
    return compiled;
  });

  const verifiedVendorModels = pkg.vendorModels.map((vm) => ({
    id: vm.id,
    busId: vm.busId,
    payloadKind: vm.payloadKind,
    sha256: vm.sha256.toLowerCase(),
  }));

  return {
    caseId: pkg.metadata.caseId,
    corridors,
    verifiedVendorModels,
    warnings: validation.warnings,
  };
}
