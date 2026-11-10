// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Verification 3D Visual Protocol & Data Schema.
 *
 * Defines the unified data contracts for projecting formal verification results
 * (continuous reachability flowpipes, dynamic clearance vectors, barrier certificates,
 * and counterexample assemblies) into 3D viewports across Morsel, VS Code, and Artifact Viewers.
 */

import type { DynamicClearanceReport } from "./dynamic-clearance.js";

export interface ReachabilityTubeSegment {
  time: number;
  center: [number, number, number];
  /** Bounding box or ellipsoid radii [rx, ry, rz] in 3D workspace */
  radii: [number, number, number];
  /** Discrete zonotope generators projected to 3D: [g_x, g_y, g_z][] */
  generators?: [number, number, number][] | undefined;
  /** Quantitative robustness score rho(t): >0 safe, =0 boundary, <0 violated */
  robustness?: number | undefined;
}

export interface DynamicClearanceVectorEntry {
  id: string;
  time: number;
  partA: string;
  partB: string;
  pointA: [number, number, number];
  pointB: [number, number, number];
  distance: number;
  requiredClearance: number;
  isViolation: boolean;
}

export interface BarrierCertificateShellSpec {
  id: string;
  label: string;
  /** Triangulated boundary mesh for zero-level set B(x) = 0 */
  vertices: number[];
  indices: number[];
  normals?: number[] | undefined;
  color?: string | undefined;
  opacity?: number | undefined;
}

export interface CounterexampleWitnessState {
  time: number;
  contractId: string;
  metricName: string;
  threshold: number;
  actualValue: number;
  operator: string;
  witnessVector?: [number, number, number] | undefined;
  /** Assembly snapshot frozen at violation time */
  counterexampleAssembly?: unknown | undefined;
  /** Primary focus point for 3D camera centering */
  focusPoint: [number, number, number];
}

export interface SpatialPinDiagnostic {
  id: string;
  position: [number, number, number];
  label: string;
  severity: "error" | "warning" | "info";
  contractId?: string | undefined;
  hypergraphThreadId?: number | undefined;
  clauseSummary?: string | undefined;
}

export interface Verification3DOverlayPayload {
  version: 1;
  isCertifiedSafe: boolean;
  verdict: "passed" | "violated" | "unknown";
  summary: string;
  worstMargin?: number | undefined;
  worstCaseTime?: number | undefined;
  /** Reachability flowpipes per moving component */
  flowpipes?: Record<string, ReachabilityTubeSegment[]> | undefined;
  /** Dynamic clearance vectors over time */
  clearanceHistory?: DynamicClearanceVectorEntry[] | undefined;
  /** Barrier certificate safety shells */
  barrierShells?: BarrierCertificateShellSpec[] | undefined;
  /** Counterexample witness states */
  counterexamples?: CounterexampleWitnessState[] | undefined;
  /** 3D spatial pins mapped to proof tree nodes and digital thread */
  spatialPins?: SpatialPinDiagnostic[] | undefined;
}

/**
 * Adapter converting a DynamicClearanceReport into a Verification3DOverlayPayload.
 */
export function toVerification3DOverlay(report: DynamicClearanceReport): Verification3DOverlayPayload {
  const clearanceHistory: DynamicClearanceVectorEntry[] = [];
  const counterexamples: CounterexampleWitnessState[] = [];
  const spatialPins: SpatialPinDiagnostic[] = [];

  // 1. Process time history into 3D dynamic clearance vector entries
  for (let i = 0; i < report.timeHistory.length; i++) {
    const entry = report.timeHistory[i]!;
    if (entry.closestPoints) {
      const [ptA, ptB] = entry.closestPoints;
      const isViolated = report.violations.some((v) => Math.abs(v.time - entry.time) < 1e-4);
      clearanceHistory.push({
        id: `clearance_${i}_${entry.time.toFixed(3)}`,
        time: entry.time,
        partA: entry.closestPair[0],
        partB: entry.closestPair[1],
        pointA: ptA,
        pointB: ptB,
        distance: entry.minDistance,
        requiredClearance: entry.minDistance - (report.worstMargin < 0 ? report.worstMargin : 0),
        isViolation: isViolated,
      });
    }
  }

  // 2. Process violations into counterexample witness states and spatial pins
  for (let i = 0; i < report.violations.length; i++) {
    const viol = report.violations[i]!;
    // Find closestPoints around violation time
    const matchingHistory = report.timeHistory.find((th) => Math.abs(th.time - viol.time) < 1e-4);
    const focusPoint: [number, number, number] = matchingHistory?.closestPoints
      ? [
          (matchingHistory.closestPoints[0][0] + matchingHistory.closestPoints[1][0]) * 0.5,
          (matchingHistory.closestPoints[0][1] + matchingHistory.closestPoints[1][1]) * 0.5,
          (matchingHistory.closestPoints[0][2] + matchingHistory.closestPoints[1][2]) * 0.5,
        ]
      : [0, 0, 0];

    counterexamples.push({
      time: viol.time,
      contractId: `clearance_${viol.partA}_${viol.partB}`,
      metricName: `Spatial Clearance (${viol.partA} - ${viol.partB})`,
      threshold: viol.requiredClearance,
      actualValue: viol.actualDistance,
      operator: ">=",
      witnessVector: matchingHistory?.closestPoints
        ? [
            matchingHistory.closestPoints[1][0] - matchingHistory.closestPoints[0][0],
            matchingHistory.closestPoints[1][1] - matchingHistory.closestPoints[0][1],
            matchingHistory.closestPoints[1][2] - matchingHistory.closestPoints[0][2],
          ]
        : undefined,
      counterexampleAssembly: report.counterexampleAssembly,
      focusPoint,
    });

    spatialPins.push({
      id: `pin_viol_${i}`,
      position: focusPoint,
      label: `${viol.status === "collision" ? "Collision" : "Clearance Breach"}: ${viol.actualDistance.toFixed(2)}mm < ${viol.requiredClearance.toFixed(2)}mm`,
      severity: "error",
      contractId: `clearance_${viol.partA}_${viol.partB}`,
      clauseSummary: viol.description,
    });
  }

  return {
    version: 1,
    isCertifiedSafe: report.isCertifiedSafe,
    verdict: report.isCertifiedSafe ? "passed" : "violated",
    summary: report.summary,
    worstMargin: report.worstMargin,
    worstCaseTime: report.worstCaseTime,
    clearanceHistory,
    counterexamples,
    spatialPins,
  };
}

export interface SpatialOracleIntegrityReport {
  stresses?: Record<
    string,
    {
      maxVonMisesPa: number;
      allowableYieldStressPa: number;
      marginOfSafety: number;
      status: "SAT" | "UNSAT";
    }
  > | undefined;
  deflections?: Record<
    string,
    {
      maxDisplacementMeters: number;
      allowableDisplacementMeters: number;
      status: "SAT" | "UNSAT";
    }
  > | undefined;
  solids?: Record<
    string,
    {
      isWatertight: boolean;
      volumeM3: number;
      status: "SAT" | "UNSAT";
    }
  > | undefined;
}

/**
 * Adapter converting SpatialPhysicsOracle status reports into 3D pins and counterexamples.
 */
export function spatialOracleToVerification3DOverlay(
  status: SpatialOracleIntegrityReport,
  componentPositions?: Record<string, [number, number, number]> | undefined,
): Verification3DOverlayPayload {
  const counterexamples: CounterexampleWitnessState[] = [];
  const spatialPins: SpatialPinDiagnostic[] = [];
  let isAllSafe = true;
  let worstMargin = Infinity;

  // 1. Process FEA yield stress integrity
  if (status.stresses) {
    for (const [partName, spec] of Object.entries(status.stresses)) {
      const isSat = spec.status === "SAT";
      if (!isSat) isAllSafe = false;
      if (spec.marginOfSafety < worstMargin) worstMargin = spec.marginOfSafety;

      const pos: [number, number, number] = componentPositions?.[partName] ?? [0, 0, 0];

      if (!isSat) {
        counterexamples.push({
          time: 0,
          contractId: `yield_stress_${partName}`,
          metricName: `von Mises Stress (${partName})`,
          threshold: spec.allowableYieldStressPa / 1e6,
          actualValue: spec.maxVonMisesPa / 1e6,
          operator: "<=",
          focusPoint: pos,
        });

        spatialPins.push({
          id: `pin_stress_${partName}`,
          position: pos,
          label: `Yield Exceeded: ${(spec.maxVonMisesPa / 1e6).toFixed(1)} MPa > ${(spec.allowableYieldStressPa / 1e6).toFixed(1)} MPa`,
          severity: "error",
          contractId: `yield_stress_${partName}`,
          clauseSummary: `Material yield exceeded on ${partName} by ${Math.abs(spec.marginOfSafety * 100).toFixed(1)}%`,
        });
      }
    }
  }

  // 2. Process structural deflection limits
  if (status.deflections) {
    for (const [partName, spec] of Object.entries(status.deflections)) {
      const isSat = spec.status === "SAT";
      if (!isSat) isAllSafe = false;
      const margin = spec.allowableDisplacementMeters - spec.maxDisplacementMeters;
      if (margin < worstMargin) worstMargin = margin;

      const pos: [number, number, number] = componentPositions?.[partName] ?? [0, 0, 0];

      if (!isSat) {
        counterexamples.push({
          time: 0,
          contractId: `deflection_${partName}`,
          metricName: `Max Deflection (${partName})`,
          threshold: spec.allowableDisplacementMeters * 1000,
          actualValue: spec.maxDisplacementMeters * 1000,
          operator: "<=",
          focusPoint: pos,
        });

        spatialPins.push({
          id: `pin_defl_${partName}`,
          position: pos,
          label: `Deflection Limit Exceeded: ${(spec.maxDisplacementMeters * 1000).toFixed(2)}mm > ${(spec.allowableDisplacementMeters * 1000).toFixed(2)}mm`,
          severity: "error",
          contractId: `deflection_${partName}`,
          clauseSummary: `Deflection limit violated on ${partName}`,
        });
      }
    }
  }

  // 3. Process CAD solid watertightness and manifold geometry
  if (status.solids) {
    for (const [solidName, spec] of Object.entries(status.solids)) {
      const isSat = spec.status === "SAT";
      if (!isSat) isAllSafe = false;
      const pos: [number, number, number] = componentPositions?.[solidName] ?? [0, 0, 0];

      if (!isSat) {
        spatialPins.push({
          id: `pin_solid_${solidName}`,
          position: pos,
          label: `Non-watertight CAD Topology: ${solidName}`,
          severity: "warning",
          contractId: `watertight_${solidName}`,
          clauseSummary: `Solid geometry ${solidName} is non-manifold or contains open boundary loops`,
        });
      }
    }
  }

  return {
    version: 1,
    isCertifiedSafe: isAllSafe,
    verdict: isAllSafe ? "passed" : "violated",
    summary: isAllSafe
      ? "All spatial continuum physics contracts satisfied"
      : `Spatial physics contract violations detected (${counterexamples.length} failure witnesses)`,
    worstMargin: Number.isFinite(worstMargin) ? worstMargin : 0,
    counterexamples,
    spatialPins,
  };
}
