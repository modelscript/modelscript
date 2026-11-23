// SPDX-License-Identifier: AGPL-3.0-or-later

import { StlErrorCode } from "../errors.js";
import { analyzeStlTopology, computeStlMassProperties } from "../solver/index.js";
import type { StlDiagnostic, StlMeshDocument, Vec3 } from "../types.js";

export { StlErrorCode };

export interface StlLintOptions {
  /** Minimum triangle area threshold below which a facet is flagged degenerate (default: 1e-12). */
  areaEpsilon?: number | undefined;
  /** Minimum dot product between declared normal and right-hand-rule geometric normal (default: 0.99). */
  normalDotThreshold?: number | undefined;
  /** Vertex welding epsilon for manifold/watertight edge analysis (default: 1e-6). */
  weldEpsilon?: number | undefined;
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * Runs syntax, geometric, normal-consistency, manifold, and watertightness diagnostics on an STL mesh.
 */
export function lintStl(doc: StlMeshDocument, options?: StlLintOptions): StlDiagnostic[] {
  const areaEps = options?.areaEpsilon ?? 1e-12;
  const normalThreshold = options?.normalDotThreshold ?? 0.99;
  const weldEps = options?.weldEpsilon ?? 1e-6;

  const diagnostics: StlDiagnostic[] = [];

  // 1. Parser / binary truncation errors (STL1001, STL5003, STL5004)
  for (const err of doc.errors) {
    const isCountMismatch = err.code === StlErrorCode.BINARY_COUNT_MISMATCH.code;
    const isUnclosed = err.code === StlErrorCode.UNCLOSED_SOLID.code;
    const def = isCountMismatch
      ? StlErrorCode.BINARY_COUNT_MISMATCH
      : isUnclosed
        ? StlErrorCode.UNCLOSED_SOLID
        : StlErrorCode.SYNTAX_ERROR;
    diagnostics.push({
      code: def.code,
      rule: def.rule,
      severity: def.severity,
      message: err.message,
      line: err.line || 1,
      column: err.column || 1,
    });
  }

  // 2. Solid header / footer consistency (STL1002, STL5003)
  for (const solid of doc.solids) {
    if (doc.format === "ascii" && !solid.closed) {
      diagnostics.push({
        code: StlErrorCode.UNCLOSED_SOLID.code,
        rule: StlErrorCode.UNCLOSED_SOLID.rule,
        severity: StlErrorCode.UNCLOSED_SOLID.severity,
        message: StlErrorCode.UNCLOSED_SOLID.message(solid.name || "(unnamed)"),
        line: solid.line ?? 1,
        column: 1,
        solidName: solid.name,
      });
    }
    if (doc.format === "ascii" && solid.closed && solid.name && solid.endName && solid.name !== solid.endName) {
      diagnostics.push({
        code: StlErrorCode.MISMATCHED_ENDSOLID.code,
        rule: StlErrorCode.MISMATCHED_ENDSOLID.rule,
        severity: StlErrorCode.MISMATCHED_ENDSOLID.severity,
        message: StlErrorCode.MISMATCHED_ENDSOLID.message(solid.name, solid.endName),
        line: solid.endLine ?? solid.line ?? 1,
        column: 1,
        solidName: solid.name,
      });
    }
  }

  // 3. Empty mesh (STL5002)
  if (doc.facets.length === 0) {
    diagnostics.push({
      code: StlErrorCode.EMPTY_MESH.code,
      rule: StlErrorCode.EMPTY_MESH.rule,
      severity: StlErrorCode.EMPTY_MESH.severity,
      message: StlErrorCode.EMPTY_MESH.message(),
      line: 1,
      column: 1,
    });
    return diagnostics;
  }

  // 4. Per-facet geometric checks (STL2001, STL3001, STL3002, STL5005)
  for (let i = 0; i < doc.facets.length; i++) {
    const f = doc.facets[i]!;
    const line = f.line ?? 1;
    const [v0, v1, v2] = f.vertices;
    const n = f.normal;

    if (!isFiniteVec3(n) || !isFiniteVec3(v0) || !isFiniteVec3(v1) || !isFiniteVec3(v2)) {
      diagnostics.push({
        code: StlErrorCode.NAN_OR_INF_COORDINATE.code,
        rule: StlErrorCode.NAN_OR_INF_COORDINATE.rule,
        severity: StlErrorCode.NAN_OR_INF_COORDINATE.severity,
        message: StlErrorCode.NAN_OR_INF_COORDINATE.message(String(i)),
        line,
        column: 1,
        facetIndex: i,
      });
      continue;
    }

    const e1x = v1[0] - v0[0];
    const e1y = v1[1] - v0[1];
    const e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0];
    const e2y = v2[1] - v0[1];
    const e2z = v2[2] - v0[2];

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const crossLen = Math.hypot(cx, cy, cz);
    const area = 0.5 * crossLen;

    if (area <= areaEps) {
      diagnostics.push({
        code: StlErrorCode.DEGENERATE_TRIANGLE.code,
        rule: StlErrorCode.DEGENERATE_TRIANGLE.rule,
        severity: StlErrorCode.DEGENERATE_TRIANGLE.severity,
        message: StlErrorCode.DEGENERATE_TRIANGLE.message(String(i), area.toExponential(2)),
        line,
        column: 1,
        facetIndex: i,
      });
      continue;
    }

    const nLen = Math.hypot(n[0], n[1], n[2]);
    if (nLen <= 1e-12) {
      diagnostics.push({
        code: StlErrorCode.ZERO_NORMAL_VECTOR.code,
        rule: StlErrorCode.ZERO_NORMAL_VECTOR.rule,
        severity: StlErrorCode.ZERO_NORMAL_VECTOR.severity,
        message: StlErrorCode.ZERO_NORMAL_VECTOR.message(String(i)),
        line,
        column: 1,
        facetIndex: i,
      });
    } else {
      const gx = cx / crossLen;
      const gy = cy / crossLen;
      const gz = cz / crossLen;
      const dotVal = (n[0] * gx + n[1] * gy + n[2] * gz) / nLen;
      if (dotVal < normalThreshold) {
        diagnostics.push({
          code: StlErrorCode.INCONSISTENT_NORMAL.code,
          rule: StlErrorCode.INCONSISTENT_NORMAL.rule,
          severity: StlErrorCode.INCONSISTENT_NORMAL.severity,
          message: StlErrorCode.INCONSISTENT_NORMAL.message(String(i), dotVal.toFixed(4)),
          line,
          column: 1,
          facetIndex: i,
        });
      }
    }
  }

  // 5. Topology checks: non-manifold edges (STL4001), open boundary edges (STL4002), Euler (STL5006)
  const topo = analyzeStlTopology(doc, weldEps);
  if (topo.nonManifoldEdges > 0) {
    diagnostics.push({
      code: StlErrorCode.NON_MANIFOLD_EDGE.code,
      rule: StlErrorCode.NON_MANIFOLD_EDGE.rule,
      severity: StlErrorCode.NON_MANIFOLD_EDGE.severity,
      message: StlErrorCode.NON_MANIFOLD_EDGE.message(String(topo.nonManifoldEdges)),
      line: 1,
      column: 1,
    });
  }
  if (topo.openBoundaryEdges > 0) {
    diagnostics.push({
      code: StlErrorCode.OPEN_BOUNDARY_EDGE.code,
      rule: StlErrorCode.OPEN_BOUNDARY_EDGE.rule,
      severity: StlErrorCode.OPEN_BOUNDARY_EDGE.severity,
      message: StlErrorCode.OPEN_BOUNDARY_EDGE.message(String(topo.openBoundaryEdges)),
      line: 1,
      column: 1,
    });
  } else if (topo.isWatertight && topo.eulerCharacteristic !== 2) {
    diagnostics.push({
      code: StlErrorCode.EULER_NON_SPHERICAL.code,
      rule: StlErrorCode.EULER_NON_SPHERICAL.rule,
      severity: StlErrorCode.EULER_NON_SPHERICAL.severity,
      message: StlErrorCode.EULER_NON_SPHERICAL.message(String(topo.eulerCharacteristic)),
      line: 1,
      column: 1,
    });
  }

  // 6. Negative signed volume check (STL5001)
  const props = computeStlMassProperties(doc);
  if (props.signedVolume < -1e-12) {
    diagnostics.push({
      code: StlErrorCode.NEGATIVE_SIGNED_VOLUME.code,
      rule: StlErrorCode.NEGATIVE_SIGNED_VOLUME.rule,
      severity: StlErrorCode.NEGATIVE_SIGNED_VOLUME.severity,
      message: StlErrorCode.NEGATIVE_SIGNED_VOLUME.message(props.signedVolume.toExponential(4)),
      line: 1,
      column: 1,
    });
  }

  return diagnostics;
}
