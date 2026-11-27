// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure TypeScript 3D CAD & Robotics WAM Zonotope geometry builders.
 *
 * Computes dual translucent tolerance ghost shells (ξ = -1 inner / ξ = +1 outer / active ξ_k probe),
 * symmetry coupling override pairs with optional clearance caliper linear constraints, and smooth
 * parallel-transport Frenet-frame 3D WAM reachability tubes.
 *
 * Intentionally free of React, DOM, Three.js, and `@modelscript/runtime` imports so it can execute
 * cleanly in both browser bundles and Node unit tests.
 */

import type {
  LinearConstraintSpec,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "./zonotope-workbench-state.js";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface CadGhostShellSpec {
  componentName: string;
  groupId: number;
  position: [number, number, number];
  rotation: [number, number, number];
  baseScale: [number, number, number];
  dimensions: [number, number, number];
  shapeKind: "box" | "cylinder" | "sphere";
  /** ξ = -1 inner bound: 1 - ε_3d * stressScale (clamped >= 0.1) */
  innerScale: [number, number, number];
  /** ξ = +1 outer bound: 1 + ε_3d * stressScale */
  outerScale: [number, number, number];
  /** Interpolated scale for active ξ_k ∈ [-1, +1] */
  probeScale: [number, number, number];
  xiValue: number;
  epsilon3d: number;
  isViolating: boolean;
  violationReason?: string | undefined;
}

export interface WamTrajectoryWaypoint {
  position: [number, number, number];
  radius: number;
  groupId: number;
}

export interface CadGhostShellComponentInput {
  name: string;
  cad?:
    | {
        position?: [number, number, number] | undefined;
        rotation?: [number, number, number] | undefined;
        scale?: [number, number, number] | undefined;
      }
    | undefined;
  sourceMetadata?:
    | {
        dimensions?: [number, number, number] | undefined;
        position?: [number, number, number] | undefined;
        translation?: [number, number, number] | undefined;
        rotation?: [number, number, number] | undefined;
        scale?: [number, number, number] | undefined;
        primitiveType?: string | undefined;
        parameterName?: string | undefined;
      }
    | undefined;
  shapeType?: string | undefined;
}

export interface CadGhostShellHypergraphSpan {
  groupId: number;
  relTypeId: number;
  relSign: number;
  symbolName?: string | undefined;
  text: string;
}

export interface CadGhostShellHypergraphInput {
  spans: CadGhostShellHypergraphSpan[];
}

export interface SymmetryCouplingPairResult {
  overrides: ZonotopePendingOverride[];
  clearanceConstraint?: LinearConstraintSpec | undefined;
}

export interface WamReachabilityTubeMeshData {
  centers: [number, number, number][];
  radii: number[];
  vertices: number[];
  indices: number[];
}

// ---------------------------------------------------------------------------
// Internal Math Helpers
// ---------------------------------------------------------------------------

const REL_TYPE_GDT_TOLERANCE_CONE = 6;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function cloneVec3(
  v: [number, number, number] | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  if (!v) return [fallback[0], fallback[1], fallback[2]];
  return [
    Number.isFinite(v[0]) ? v[0] : fallback[0],
    Number.isFinite(v[1]) ? v[1] : fallback[1],
    Number.isFinite(v[2]) ? v[2] : fallback[2],
  ];
}

function sanitizeDimensions(v: [number, number, number] | undefined): [number, number, number] {
  if (!v) return [1, 1, 1];
  return [
    Number.isFinite(v[0]) && Math.abs(v[0]) > 1e-6 ? Math.abs(v[0]) : 1,
    Number.isFinite(v[1]) && Math.abs(v[1]) > 1e-6 ? Math.abs(v[1]) : 1,
    Number.isFinite(v[2]) && Math.abs(v[2]) > 1e-6 ? Math.abs(v[2]) : 1,
  ];
}

function resolveShapeKind(
  shapeType?: string | undefined,
  primitiveType?: string | undefined,
): "box" | "cylinder" | "sphere" {
  const hint = `${shapeType ?? ""} ${primitiveType ?? ""}`.toLowerCase();
  if (
    hint.includes("cyl") ||
    hint.includes("pipe") ||
    hint.includes("tube") ||
    hint.includes("cone") ||
    hint.includes("shaft") ||
    hint.includes("rod") ||
    hint.includes("wheel")
  ) {
    return "cylinder";
  }
  if (hint.includes("sph") || hint.includes("ball") || hint.includes("ellipsoid") || hint.includes("orb")) {
    return "sphere";
  }
  return "box";
}

function normalizeIdentifier(name: string): string {
  return name.trim().toLowerCase();
}

function leafIdentifier(name: string): string {
  const trimmed = name.trim();
  const dotIdx = trimmed.lastIndexOf(".");
  return dotIdx >= 0 ? trimmed.slice(dotIdx + 1).toLowerCase() : trimmed.toLowerCase();
}

function spanMatchesName(span: CadGhostShellHypergraphSpan, candidates: string[]): boolean {
  const sym = span.symbolName ? normalizeIdentifier(span.symbolName) : "";
  const symLeaf = span.symbolName ? leafIdentifier(span.symbolName) : "";
  const txt = normalizeIdentifier(span.text);
  const txtLeaf = leafIdentifier(span.text);

  for (const cand of candidates) {
    if (!cand) continue;
    const norm = normalizeIdentifier(cand);
    const leaf = leafIdentifier(cand);
    if (sym && (sym === norm || symLeaf === leaf)) return true;
    if (txt && (txt === norm || txtLeaf === leaf)) return true;
  }
  return false;
}

interface ResolvedGroupBinding {
  groupId: number;
  relSign: number;
}

function resolveComponentGroupBinding(
  comp: CadGhostShellComponentInput,
  fallbackGroupId: number,
  hypergraphRecord: CadGhostShellHypergraphInput | null,
  pendingOverrides: readonly ZonotopePendingOverride[],
): ResolvedGroupBinding {
  const candidates: string[] = [comp.name];
  if (comp.sourceMetadata?.parameterName) {
    candidates.push(comp.sourceMetadata.parameterName);
  }

  // 1. User pending overrides (most recent matching override takes precedence)
  for (let i = pendingOverrides.length - 1; i >= 0; i--) {
    const ov = pendingOverrides[i]!;
    const ovSym = ov.symbolName ? normalizeIdentifier(ov.symbolName) : "";
    const ovSnippet = ov.textSnippet ? normalizeIdentifier(ov.textSnippet) : "";
    for (const cand of candidates) {
      const norm = normalizeIdentifier(cand);
      if ((ovSym && ovSym === norm) || (ovSnippet && ovSnippet === norm)) {
        return {
          groupId: Math.max(0, Math.trunc(ov.groupId)),
          relSign: ov.relSign < 0 ? -1 : 1,
        };
      }
    }
  }

  // 2. Compiled hypergraph record spans (prioritize GDT_TOLERANCE_CONE relTypeId === 6)
  if (hypergraphRecord && hypergraphRecord.spans.length > 0) {
    let bestAny: CadGhostShellHypergraphSpan | null = null;
    for (const span of hypergraphRecord.spans) {
      if (span.groupId <= 0) continue;
      if (!spanMatchesName(span, candidates)) continue;
      if (span.relTypeId === REL_TYPE_GDT_TOLERANCE_CONE) {
        return {
          groupId: Math.trunc(span.groupId),
          relSign: span.relSign < 0 ? -1 : 1,
        };
      }
      if (!bestAny) {
        bestAny = span;
      }
    }
    if (bestAny) {
      return {
        groupId: Math.trunc(bestAny.groupId),
        relSign: bestAny.relSign < 0 ? -1 : 1,
      };
    }
  }

  // 3. Deterministic 1-based group index fallback
  return {
    groupId: fallbackGroupId,
    relSign: 1,
  };
}

function checkConstraintViolationForComponent(
  compName: string,
  paramName: string | undefined,
  constraints: readonly LinearConstraintSpec[],
  specByKey: ReadonlyMap<string, { nominal: number; innerFactor: number; outerFactor: number; probeFactor: number }>,
): string | undefined {
  const keysToMatch = new Set<string>([compName]);
  if (paramName) keysToMatch.add(paramName);

  for (const constraint of constraints) {
    const coeffEntries = Object.entries(constraint.coeffs);
    if (coeffEntries.length === 0) continue;

    let involvesComponent = false;
    for (const [varName] of coeffEntries) {
      if (keysToMatch.has(varName)) {
        involvesComponent = true;
        break;
      }
    }
    if (!involvesComponent) continue;

    // Require all variables referenced by this constraint to be known 3D components/parameters
    let allResolved = true;
    let probeSum = 0;
    let minSum = 0;
    let maxSum = 0;

    for (const [varName, coeff] of coeffEntries) {
      const entry = specByKey.get(varName);
      if (!entry) {
        allResolved = false;
        break;
      }
      const probeVal = entry.nominal * entry.probeFactor;
      const loVal = entry.nominal * entry.innerFactor;
      const hiVal = entry.nominal * entry.outerFactor;

      probeSum += coeff * probeVal;
      if (coeff >= 0) {
        minSum += coeff * loVal;
        maxSum += coeff * hiVal;
      } else {
        minSum += coeff * hiVal;
        maxSum += coeff * loVal;
      }
    }

    if (!allResolved) continue;

    const tol = 1e-6;
    let violated = false;
    if (constraint.sense === "<=") {
      violated = probeSum > constraint.rhs + tol || maxSum > constraint.rhs + tol;
    } else if (constraint.sense === ">=") {
      violated = probeSum < constraint.rhs - tol || minSum < constraint.rhs - tol;
    } else {
      violated =
        Math.abs(probeSum - constraint.rhs) > tol || minSum > constraint.rhs + tol || maxSum < constraint.rhs - tol;
    }

    if (violated) {
      return `Constraint breached: ${constraint.expression}`;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// 1. Dual Ghost Tolerance Shells Builder
// ---------------------------------------------------------------------------

/**
 * Builds dual translucent ghost tolerance shell specifications for each 3D CAD component.
 *
 * - `innerScale` represents ξ = -1: `1 - ε_3d * stressScale` (clamped `>= 0.1`)
 * - `outerScale` represents ξ = +1: `1 + ε_3d * stressScale`
 * - `probeScale` represents the interpolated geometry at active `ξ_k ∈ [-1, +1]`
 */
export function buildCadGhostShellSpecs(
  components: Array<CadGhostShellComponentInput>,
  hypergraphRecord: CadGhostShellHypergraphInput | null,
  state: ZonotopeWorkbenchState,
  violatingComponentNames?: ReadonlySet<string> | ReadonlyArray<string>,
): CadGhostShellSpec[] {
  const effectiveEps = clamp(state.budgets.cadToleranceFraction * state.stressScale, 0, 0.85);

  const violatingSet = new Set<string>();
  if (violatingComponentNames) {
    for (const name of violatingComponentNames) {
      violatingSet.add(name);
    }
  }

  interface PendingSpec {
    spec: CadGhostShellSpec;
    paramName?: string | undefined;
    nominal: number;
    innerFactor: number;
    outerFactor: number;
    probeFactor: number;
  }

  const pending: PendingSpec[] = [];
  const specByKey = new Map<
    string,
    { nominal: number; innerFactor: number; outerFactor: number; probeFactor: number }
  >();

  for (let i = 0; i < components.length; i++) {
    const comp = components[i]!;
    const binding = resolveComponentGroupBinding(comp, i + 1, hypergraphRecord, state.pendingOverrides);

    const position = cloneVec3(
      comp.cad?.position ?? comp.sourceMetadata?.position ?? comp.sourceMetadata?.translation,
      [0, 0, 0],
    );
    const rotation = cloneVec3(comp.cad?.rotation ?? comp.sourceMetadata?.rotation, [0, 0, 0]);
    const baseScale = cloneVec3(comp.cad?.scale ?? comp.sourceMetadata?.scale, [1, 1, 1]);
    const dimensions = sanitizeDimensions(comp.sourceMetadata?.dimensions);
    const shapeKind = resolveShapeKind(comp.shapeType, comp.sourceMetadata?.primitiveType);

    const isLocked = binding.groupId <= 0;
    const compEps = isLocked ? 0 : effectiveEps;
    const rawXi = isLocked ? 0 : (state.xiByGroupId[binding.groupId] ?? 0);
    const xiValue = isLocked ? 0 : clamp(rawXi, -1, 1) * (binding.relSign < 0 ? -1 : 1);

    const innerFactor = Math.max(0.1, 1 - compEps);
    const outerFactor = 1 + compEps;
    const probeFactor = Math.max(0.1, 1 + compEps * xiValue);

    const paramName = comp.sourceMetadata?.parameterName;
    const explicitViolation = violatingSet.has(comp.name) || (paramName !== undefined && violatingSet.has(paramName));

    const spec: CadGhostShellSpec = {
      componentName: comp.name,
      groupId: binding.groupId,
      position,
      rotation,
      baseScale,
      dimensions,
      shapeKind,
      innerScale: [innerFactor, innerFactor, innerFactor],
      outerScale: [outerFactor, outerFactor, outerFactor],
      probeScale: [probeFactor, probeFactor, probeFactor],
      xiValue,
      epsilon3d: compEps,
      isViolating: explicitViolation,
      ...(explicitViolation ? { violationReason: "Worst-case ξ* tolerance breach" } : {}),
    };

    const nominal = comp.sourceMetadata?.dimensions?.[0] ?? baseScale[0] ?? 1;
    const metric = { nominal, innerFactor, outerFactor, probeFactor };
    specByKey.set(comp.name, metric);
    if (paramName) {
      specByKey.set(paramName, metric);
    }

    pending.push({
      spec,
      paramName,
      nominal,
      innerFactor,
      outerFactor,
      probeFactor,
    });
  }

  if (state.constraints.length > 0) {
    for (const item of pending) {
      if (item.spec.isViolating) continue;
      const reason = checkConstraintViolationForComponent(
        item.spec.componentName,
        item.paramName,
        state.constraints,
        specByKey,
      );
      if (reason) {
        item.spec.isViolating = true;
        item.spec.violationReason = reason;
      }
    }
  }

  return pending.map((p) => p.spec);
}

// ---------------------------------------------------------------------------
// 2. Symmetry Coupling & Clearance Caliper Builder
// ---------------------------------------------------------------------------

/**
 * Produces two `ZonotopePendingOverride` records binding `partA` (`+1`) and `partB` (`sign`)
 * under `groupId` (`modality: "3d"`), plus an optional clearance caliper `LinearConstraintSpec`.
 */
export function buildSymmetryCouplingPair(
  partA: string,
  partB: string,
  sign: 1 | -1,
  groupId: number,
  includeClearanceCaliper?: { minGap: number },
): SymmetryCouplingPairResult {
  const safeGroupId = Math.max(1, Math.trunc(groupId));
  const relTypeB = sign > 0 ? 1 : 2;
  const modeLabel = sign > 0 ? "SYMMETRY +1" : "MIRROR -1";

  const overrides: ZonotopePendingOverride[] = [
    {
      id: `cad-sym-${safeGroupId}-${partA}-anchor`,
      symbolName: partA,
      textSnippet: partA,
      groupId: safeGroupId,
      relTypeId: 1,
      relSign: 1,
      modality: "3d",
      note: `${modeLabel} anchor paired with ${partB}`,
    },
    {
      id: `cad-sym-${safeGroupId}-${partB}-${sign > 0 ? "pos" : "neg"}`,
      symbolName: partB,
      textSnippet: partB,
      groupId: safeGroupId,
      relTypeId: relTypeB,
      relSign: sign,
      modality: "3d",
      note: `${modeLabel} coupled to ${partA}`,
    },
  ];

  if (includeClearanceCaliper === undefined) {
    return { overrides };
  }

  const minGap = Number.isFinite(includeClearanceCaliper.minGap) ? includeClearanceCaliper.minGap : 0;
  const samePart = partA.trim() === partB.trim();
  const clearanceConstraint: LinearConstraintSpec = samePart
    ? {
        id: `cad-clearance-${safeGroupId}-${partA}`,
        expression: `clearance >= ${minGap}`,
        coeffs: { clearance: 1 },
        sense: ">=",
        rhs: minGap,
        modality: "3d",
      }
    : {
        id: `cad-clearance-${safeGroupId}-${partA}-${partB}`,
        expression: `${partA} - ${partB} >= ${minGap}`,
        coeffs: { [partA]: 1, [partB]: -1 },
        sense: ">=",
        rhs: minGap,
        modality: "3d",
      };

  return {
    overrides,
    clearanceConstraint,
  };
}

// ---------------------------------------------------------------------------
// 3. 3D WAM Reachability Tube Builder (Parallel-Transport Frenet Frames)
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];

function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vecLen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function vecNormalize(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const len = vecLen(a);
  if (!Number.isFinite(len) || len < 1e-9) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  return [a[0] / len, a[1] / len, a[2] / len];
}

function rotateAroundAxis(v: Vec3, axisUnit: Vec3, angleRad: number): Vec3 {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const uxv = vecCross(axisUnit, v);
  const udotv = vecDot(axisUnit, v);
  return [
    v[0] * cosA + uxv[0] * sinA + axisUnit[0] * udotv * (1 - cosA),
    v[1] * cosA + uxv[1] * sinA + axisUnit[1] * udotv * (1 - cosA),
    v[2] * cosA + uxv[2] * sinA + axisUnit[2] * udotv * (1 - cosA),
  ];
}

/**
 * Builds a smooth triangulated 3D reachability tube mesh around WAM trajectory waypoints
 * using parallel-transport (Bishop) frames, scaled by `Math.max(0.15, stressScale)`.
 */
export function buildWamReachabilityTubeRings(
  waypoints: WamTrajectoryWaypoint[],
  stressScale: number,
  radialSegments = 16,
): WamReachabilityTubeMeshData {
  const scaleFactor = Math.max(0.15, Number.isFinite(stressScale) ? stressScale : 1.0);
  const centers: [number, number, number][] = waypoints.map((wp) => cloneVec3(wp.position, [0, 0, 0]));
  const radii: number[] = waypoints.map((wp) => {
    const baseR = Number.isFinite(wp.radius) ? Math.abs(wp.radius) : 0.1;
    return Math.max(1e-4, baseR * scaleFactor);
  });

  if (waypoints.length < 2) {
    return { centers, radii, vertices: [], indices: [] };
  }

  const segs = Math.max(3, Math.trunc(radialSegments));
  const n = centers.length;

  // 1. Compute unit tangents along the polyline
  const tangents: Vec3[] = new Array<Vec3>(n);
  for (let i = 0; i < n; i++) {
    let raw: Vec3;
    if (i === 0) {
      raw = vecSub(centers[1]!, centers[0]!);
    } else if (i === n - 1) {
      raw = vecSub(centers[n - 1]!, centers[n - 2]!);
    } else {
      raw = vecSub(centers[i + 1]!, centers[i - 1]!);
      if (vecLen(raw) < 1e-9) {
        raw = vecSub(centers[i + 1]!, centers[i]!);
      }
    }
    const fallback: Vec3 = i > 0 ? tangents[i - 1]! : [0, 1, 0];
    tangents[i] = vecNormalize(raw, fallback);
  }

  // 2. Parallel-transport normal & binormal frames to prevent twist singularities
  const normals: Vec3[] = new Array<Vec3>(n);
  const binormals: Vec3[] = new Array<Vec3>(n);

  const t0 = tangents[0]!;
  const refAxis: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  normals[0] = vecNormalize(vecCross(t0, refAxis), [1, 0, 0]);
  binormals[0] = vecNormalize(vecCross(t0, normals[0]!), [0, 0, 1]);

  for (let i = 1; i < n; i++) {
    const prevT = tangents[i - 1]!;
    const currT = tangents[i]!;
    const prevN = normals[i - 1]!;

    const rotAxis = vecCross(prevT, currT);
    const rotAxisLen = vecLen(rotAxis);
    let nextN: Vec3;

    if (rotAxisLen > 1e-7) {
      const unitAxis: Vec3 = [rotAxis[0] / rotAxisLen, rotAxis[1] / rotAxisLen, rotAxis[2] / rotAxisLen];
      const cosTheta = clamp(vecDot(prevT, currT), -1, 1);
      const theta = Math.acos(cosTheta);
      nextN = rotateAroundAxis(prevN, unitAxis, theta);
    } else if (vecDot(prevT, currT) < -0.9999) {
      nextN = [-prevN[0], -prevN[1], -prevN[2]];
    } else {
      nextN = [prevN[0], prevN[1], prevN[2]];
    }

    // Gram-Schmidt re-orthogonalization against currT
    const proj = vecDot(nextN, currT);
    const ortho: Vec3 = [nextN[0] - currT[0] * proj, nextN[1] - currT[1] * proj, nextN[2] - currT[2] * proj];
    normals[i] = vecNormalize(ortho, prevN);
    binormals[i] = vecNormalize(vecCross(currT, normals[i]!), binormals[i - 1]!);
  }

  // 3. Emit ring vertices
  const vertices: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i]!;
    const r = radii[i]!;
    const norm = normals[i]!;
    const binorm = binormals[i]!;

    for (let j = 0; j < segs; j++) {
      const angle = (j / segs) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const vx = c[0] + r * (cosA * norm[0] + sinA * binorm[0]);
      const vy = c[1] + r * (cosA * norm[1] + sinA * binorm[1]);
      const vz = c[2] + r * (cosA * norm[2] + sinA * binorm[2]);
      vertices.push(vx, vy, vz);
    }
  }

  // 4. Emit triangle strip indices connecting consecutive rings
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const ringA = i * segs;
    const ringB = (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const jNext = (j + 1) % segs;
      const a = ringA + j;
      const b = ringA + jNext;
      const c = ringB + j;
      const d = ringB + jNext;
      indices.push(a, c, b, b, c, d);
    }
  }

  return { centers, radii, vertices, indices };
}

// ---------------------------------------------------------------------------
// 4. Heuristic WAM Waypoint Extractor for URDF / Robotics Assemblies
// ---------------------------------------------------------------------------

const ROBOTICS_PART_PATTERN =
  /(link|joint|arm|wrist|elbow|shoulder|effector|gripper|base_link|robot|wam|manipulator|urdf|actuator|flange)/i;

/**
 * Derives default WAM reachability tube waypoints when viewing a URDF / robotics kinematic chain
 * and no explicit `wamWaypoints` were supplied by the host.
 */
export function inferWamWaypointsFromSpecs(specs: readonly CadGhostShellSpec[]): WamTrajectoryWaypoint[] {
  if (specs.length < 2) return [];
  const roboticsSpecs = specs.filter((s) => ROBOTICS_PART_PATTERN.test(s.componentName));
  if (roboticsSpecs.length < 2) return [];

  return roboticsSpecs.map((s) => {
    const maxDim = Math.max(
      s.dimensions[0] * Math.abs(s.baseScale[0]),
      s.dimensions[1] * Math.abs(s.baseScale[1]),
      s.dimensions[2] * Math.abs(s.baseScale[2]),
    );
    return {
      position: [s.position[0], s.position[1], s.position[2]],
      radius: Math.max(0.08, maxDim * 0.22),
      groupId: Math.max(1, s.groupId),
    };
  });
}
