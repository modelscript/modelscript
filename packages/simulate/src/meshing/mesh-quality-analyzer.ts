// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MeshQualityMetrics, Tet4Mesh } from "../fea/tet4-types.js";

/**
 * High-performance Finite Element & CFD Mesh Quality Analyzer.
 * Computes scaled Jacobian determinants, aspect ratios, and flags inverted or degenerate cells.
 */
export class MeshQualityAnalyzer {
  /**
   * Computes comprehensive mesh quality metrics for a Tet4 or Tet10 mesh.
   */
  public static analyze(mesh: Tet4Mesh): MeshQualityMetrics {
    const { nodeCoords, elements, numElements, nodesPerElement = 4 } = mesh;

    const elementJacobians = new Float32Array(numElements);
    const elementAspectRatios = new Float32Array(numElements);

    let minJ = Infinity;
    let maxJ = -Infinity;
    let sumJ = 0;

    let minAR = Infinity;
    let maxAR = -Infinity;
    let sumAR = 0;

    let numInverted = 0;
    const SQRT2 = Math.SQRT2;

    for (let e = 0; e < numElements; e++) {
      const base = e * nodesPerElement;
      const n0 = elements[base + 0] * 3;
      const n1 = elements[base + 1] * 3;
      const n2 = elements[base + 2] * 3;
      const n3 = elements[base + 3] * 3;

      const x0 = nodeCoords[n0 + 0],
        y0 = nodeCoords[n0 + 1],
        z0 = nodeCoords[n0 + 2];
      const x1 = nodeCoords[n1 + 0],
        y1 = nodeCoords[n1 + 1],
        z1 = nodeCoords[n1 + 2];
      const x2 = nodeCoords[n2 + 0],
        y2 = nodeCoords[n2 + 1],
        z2 = nodeCoords[n2 + 2];
      const x3 = nodeCoords[n3 + 0],
        y3 = nodeCoords[n3 + 1],
        z3 = nodeCoords[n3 + 2];

      // Edge vectors from n0
      const e1x = x1 - x0,
        e1y = y1 - y0,
        e1z = z1 - z0;
      const e2x = x2 - x0,
        e2y = y2 - y0,
        e2z = z2 - z0;
      const e3x = x3 - x0,
        e3y = y3 - y0,
        e3z = z3 - z0;

      // Cross product e1 x e2
      const cx = e1y * e2z - e1z * e2y;
      const cy = e1z * e2x - e1x * e2z;
      const cz = e1x * e2y - e1y * e2x;

      // Determinant (e1 x e2) . e3
      const detJ = cx * e3x + cy * e3y + cz * e3z;

      const len1 = Math.hypot(e1x, e1y, e1z);
      const len2 = Math.hypot(e2x, e2y, e2z);
      const len3 = Math.hypot(e3x, e3y, e3z);

      const denom = len1 * len2 * len3;
      let scaledJ = 0;
      if (denom > 1e-15) {
        scaledJ = (SQRT2 * detJ) / denom;
      }

      if (scaledJ <= 0) {
        numInverted++;
      }

      elementJacobians[e] = scaledJ;
      minJ = Math.min(minJ, scaledJ);
      maxJ = Math.max(maxJ, scaledJ);
      sumJ += scaledJ;

      // 6 edge lengths for aspect ratio
      const e4x = x2 - x1,
        e4y = y2 - y1,
        e4z = z2 - z1;
      const e5x = x3 - x1,
        e5y = y3 - y1,
        e5z = z3 - z1;
      const e6x = x3 - x2,
        e6y = y3 - y2,
        e6z = z3 - z2;

      const len4 = Math.hypot(e4x, e4y, e4z);
      const len5 = Math.hypot(e5x, e5y, e5z);
      const len6 = Math.hypot(e6x, e6y, e6z);

      const maxLen = Math.max(len1, len2, len3, len4, len5, len6);
      const minLen = Math.max(1e-12, Math.min(len1, len2, len3, len4, len5, len6));
      const ar = maxLen / minLen;

      elementAspectRatios[e] = ar;
      minAR = Math.min(minAR, ar);
      maxAR = Math.max(maxAR, ar);
      sumAR += ar;
    }

    return {
      minJacobian: numElements > 0 ? minJ : 0,
      maxJacobian: numElements > 0 ? maxJ : 0,
      avgJacobian: numElements > 0 ? sumJ / numElements : 0,
      minAspectRatio: numElements > 0 ? minAR : 1,
      maxAspectRatio: numElements > 0 ? maxAR : 1,
      avgAspectRatio: numElements > 0 ? sumAR / numElements : 1,
      numInvertedElements: numInverted,
      elementJacobians,
      elementAspectRatios,
    };
  }
}
