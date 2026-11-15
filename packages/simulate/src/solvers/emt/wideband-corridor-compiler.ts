// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Field-to-RTO Wideband Transmission Line Corridor Compiler.
 *
 * Implements Step 4 of the ORNL / City Utilities EMT Data-Sources pipeline:
 * 1. Spatial Geometry (OpenDSS tower coordinates, phase spacing, conductor sag)
 * 2. Earth-Return Path (2-Layer Soil from geological borings)
 * 3. Mutual Coupling (IEEE P3743 parallel-corridor electromagnetic coupling)
 * 4. Boundary Equipments (ASPEN OneLiner validated short-circuit fault equivalents)
 * -> Compiles all layers into a unified `FrequencyDependentLineConfig` + RTO deliverable.
 */

import type { FrequencyDependentLineConfig } from "./elements/frequency-dependent-line.js";
import {
  computeMulticonductorLineConstants,
  synthesizeFdLineFromMulticonductorTower,
  type OverheadConductorSpec,
  type OverheadLineConstantsResult,
  type TwoLayerSoilSpec,
} from "./line-constants.js";

export interface CorridorBoundaryEquivalent {
  busId: string;
  shortCircuitMva: number;
  xOverRRatio: number;
  z1Ohm: { r: number; x: number };
  z0Ohm: { r: number; x: number };
}

export interface ParallelCorridorCoupling {
  coupledCorridorId: string;
  centerToCenterSeparationM: number;
  parallelLengthKm: number;
}

export interface WidebandCorridorInput {
  corridorId: string;
  fromNode: number;
  toNode: number;
  lengthKm: number;
  conductors: OverheadConductorSpec[];
  twoLayerSoil?: TwoLayerSoilSpec | undefined;
  homogeneousSoilOhmM?: number | undefined;
  transposed?: boolean | undefined;
  parallelCouplings?: ParallelCorridorCoupling[] | undefined;
  fromBoundary?: CorridorBoundaryEquivalent | undefined;
  toBoundary?: CorridorBoundaryEquivalent | undefined;
  numPoles?: number | undefined;
}

export interface MutualCouplingMatrixSummary {
  coupledCorridorId: string;
  freqHz: number;
  rMutualOhmPerKm: number;
  lMutualHPerKm: number;
}

export interface CompiledWidebandCorridor {
  corridorId: string;
  fdLine: FrequencyDependentLineConfig;
  constants60Hz: OverheadLineConstantsResult;
  constants100kHz: OverheadLineConstantsResult;
  mutualCouplings: MutualCouplingMatrixSummary[];
  fromBoundary?: CorridorBoundaryEquivalent | undefined;
  toBoundary?: CorridorBoundaryEquivalent | undefined;
}

/**
 * Compiles OpenDSS tower geometry, 2-layer soil borings, parallel-corridor mutual coupling,
 * and ASPEN boundary short-circuit equivalents into a unified Wideband Line Model.
 */
export function compileWidebandCorridor(input: WidebandCorridorInput): CompiledWidebandCorridor {
  const geom = {
    lengthKm: input.lengthKm,
    conductors: input.conductors,
    soilResistivityOhmM: input.homogeneousSoilOhmM,
    twoLayerSoil: input.twoLayerSoil,
    transposed: input.transposed,
  };

  const constants60Hz = computeMulticonductorLineConstants(geom, 60.0);
  const constants100kHz = computeMulticonductorLineConstants(geom, 100e3);
  const fdLine = synthesizeFdLineFromMulticonductorTower(
    input.corridorId,
    input.fromNode,
    input.toNode,
    geom,
    input.numPoles ?? 6,
  );

  // Compute approximate zero-sequence mutual coupling between parallel corridors
  // using Carson-Deri complex ground return separation D_e / D_ab.
  const mutualCouplings: MutualCouplingMatrixSummary[] = [];
  if (input.parallelCouplings && input.parallelCouplings.length > 0) {
    const mu0 = 4 * Math.PI * 1e-7;
    const rho = input.twoLayerSoil?.lowerResistivityOhmM ?? input.homogeneousSoilOhmM ?? 100.0;
    const de = 658.5 * Math.sqrt(rho / 60.0);
    for (const pc of input.parallelCouplings) {
      const dSep = Math.max(1.0, pc.centerToCenterSeparationM);
      const rMutualOhmPerKm = 0.0592 * 3.0; // 3 * R_earth at 60 Hz (Ohm/km)
      const lMutualHPerKm = ((3.0 * mu0 * 1000.0) / (2.0 * Math.PI)) * Math.log(Math.max(1.05, de / dSep));
      mutualCouplings.push({
        coupledCorridorId: pc.coupledCorridorId,
        freqHz: 60.0,
        rMutualOhmPerKm,
        lMutualHPerKm,
      });
    }
  }

  return {
    corridorId: input.corridorId,
    fdLine,
    constants60Hz,
    constants100kHz,
    mutualCouplings,
    fromBoundary: input.fromBoundary,
    toBoundary: input.toBoundary,
  };
}
