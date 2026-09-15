// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MaterialProperties } from "./tet4-types.js";

/**
 * Closed-form 4-node linear tetrahedral (Tet4) element formulation.
 */
export class Tet4Element {
  /**
   * Builds the 6x6 isotropic elasticity constitutive matrix D.
   *
   * [ sigma_xx ]        [ lambda+2mu   lambda     lambda       0    0    0   ] [ eps_xx ]
   * [ sigma_yy ]        [   lambda   lambda+2mu   lambda       0    0    0   ] [ eps_yy ]
   * [ sigma_zz ]   =    [   lambda     lambda   lambda+2mu     0    0    0   ] [ eps_zz ]
   * [ tau_xy   ]        [     0          0          0         mu    0    0   ] [ gam_xy ]
   * [ tau_yz   ]        [     0          0          0          0   mu    0   ] [ gam_yz ]
   * [ tau_zx   ]        [     0          0          0          0    0   mu   ] [ gam_zx ]
   */
  public static computeConstitutiveMatrix(mat: MaterialProperties): Float64Array {
    const { E, nu } = mat;
    const lambda = (E * nu) / ((1 + nu) * (1 - 2 * nu));
    const mu = E / (2 * (1 + nu));

    const D = new Float64Array(36);
    // Row 0
    D[0] = lambda + 2 * mu;
    D[1] = lambda;
    D[2] = lambda;
    // Row 1
    D[6] = lambda;
    D[7] = lambda + 2 * mu;
    D[8] = lambda;
    // Row 2
    D[12] = lambda;
    D[13] = lambda;
    D[14] = lambda + 2 * mu;
    // Shear diagonal
    D[21] = mu; // (3, 3)
    D[28] = mu; // (4, 4)
    D[35] = mu; // (5, 5)

    return D;
  }

  /**
   * Computes the volume, 6x12 strain-displacement matrix B, and 12x12 stiffness matrix Ke
   * for a linear tetrahedron defined by 4 vertices [x_i, y_i, z_i].
   */
  public static computeElementStiffness(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    D: Float64Array,
  ): { Ke: Float64Array; B: Float64Array; volume: number } {
    // Coordinate differences relative to p0
    const x21 = p1[0] - p0[0],
      y21 = p1[1] - p0[1],
      z21 = p1[2] - p0[2];
    const x31 = p2[0] - p0[0],
      y31 = p2[1] - p0[1],
      z31 = p2[2] - p0[2];
    const x41 = p3[0] - p0[0],
      y41 = p3[1] - p0[1],
      z41 = p3[2] - p0[2];

    // Determinant of Jacobian matrix
    const detJ = x21 * (y31 * z41 - y41 * z31) - y21 * (x31 * z41 - x41 * z31) + z21 * (x31 * y41 - x41 * y31);

    const volume = Math.abs(detJ) / 6.0;
    if (volume <= 1e-18) {
      throw new Error(`Degenerate or zero-volume tetrahedron encountered (volume = ${volume}).`);
    }

    const sign = detJ >= 0 ? 1.0 : -1.0;
    const inv6V = sign / (6.0 * volume);

    // Shape function spatial gradients [dN/dx, dN/dy, dN/dz]
    // Derived from cross-products of edge vectors
    const b = new Float64Array(4); // dN/dx
    const c = new Float64Array(4); // dN/dy
    const d = new Float64Array(4); // dN/dz

    // For node 1 (index 1 in 1-based, p1)
    b[1] = inv6V * (y31 * z41 - y41 * z31);
    c[1] = inv6V * (z31 * x41 - z41 * x31);
    d[1] = inv6V * (x31 * y41 - x41 * y31);

    // For node 2 (p2)
    b[2] = inv6V * (y41 * z21 - y21 * z41);
    c[2] = inv6V * (z41 * x21 - z21 * x41);
    d[2] = inv6V * (x41 * y21 - x21 * y41);

    // For node 3 (p3)
    b[3] = inv6V * (y21 * z31 - y31 * z21);
    c[3] = inv6V * (z21 * x31 - z31 * x21);
    d[3] = inv6V * (x21 * y31 - x31 * y21);

    // For node 0 (p0): sum of gradients must be zero
    b[0] = -(b[1] + b[2] + b[3]);
    c[0] = -(c[1] + c[2] + c[3]);
    d[0] = -(d[1] + d[2] + d[3]);

    // Construct 6x12 strain-displacement matrix B
    // Stored row-major (6 rows, 12 cols)
    const B = new Float64Array(72);
    for (let i = 0; i < 4; i++) {
      const col = i * 3;
      // Row 0: eps_xx = dN_i/dx * u_i
      B[0 * 12 + col + 0] = b[i];
      // Row 1: eps_yy = dN_i/dy * v_i
      B[1 * 12 + col + 1] = c[i];
      // Row 2: eps_zz = dN_i/dz * w_i
      B[2 * 12 + col + 2] = d[i];
      // Row 3: gam_xy = dN_i/dy * u_i + dN_i/dx * v_i
      B[3 * 12 + col + 0] = c[i];
      B[3 * 12 + col + 1] = b[i];
      // Row 4: gam_yz = dN_i/dz * v_i + dN_i/dy * w_i
      B[4 * 12 + col + 1] = d[i];
      B[4 * 12 + col + 2] = c[i];
      // Row 5: gam_zx = dN_i/dz * u_i + dN_i/dx * w_i
      B[5 * 12 + col + 0] = d[i];
      B[5 * 12 + col + 2] = b[i];
    }

    // Compute DB = D (6x6) * B (6x12) -> (6x12)
    const DB = new Float64Array(72);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 12; c++) {
        let sum = 0.0;
        for (let k = 0; k < 6; k++) {
          sum += D[r * 6 + k] * B[k * 12 + c];
        }
        DB[r * 12 + c] = sum;
      }
    }

    // Compute Ke = V * B^T (12x6) * DB (6x12) -> (12x12)
    const Ke = new Float64Array(144);
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 12; c++) {
        let sum = 0.0;
        for (let k = 0; k < 6; k++) {
          // B^T[r, k] = B[k, r]
          sum += B[k * 12 + r] * DB[k * 12 + c];
        }
        Ke[r * 12 + c] = volume * sum;
      }
    }

    return { Ke, B, volume };
  }

  /**
   * Computes element strain, stress, and von Mises scalar from element nodal displacements ue (12x1).
   */
  public static computeElementStress(
    B: Float64Array,
    D: Float64Array,
    ue: Float64Array,
  ): { stress: Float64Array; vonMises: number } {
    // 1. Strain: eps = B * ue (6x1)
    const eps = new Float64Array(6);
    for (let r = 0; r < 6; r++) {
      let sum = 0.0;
      for (let c = 0; c < 12; c++) {
        sum += B[r * 12 + c] * ue[c];
      }
      eps[r] = sum;
    }

    // 2. Stress: sigma = D * eps (6x1)
    const stress = new Float64Array(6);
    for (let r = 0; r < 6; r++) {
      let sum = 0.0;
      for (let c = 0; c < 6; c++) {
        sum += D[r * 6 + c] * eps[c];
      }
      stress[r] = sum;
    }

    // 3. von Mises scalar
    const sxx = stress[0],
      syy = stress[1],
      szz = stress[2];
    const sxy = stress[3],
      syz = stress[4],
      szx = stress[5];

    const diff1 = sxx - syy;
    const diff2 = syy - szz;
    const diff3 = szz - sxx;

    const vonMises = Math.sqrt(
      0.5 * (diff1 * diff1 + diff2 * diff2 + diff3 * diff3) + 3.0 * (sxy * sxy + syz * syz + szx * szx),
    );

    return { stress, vonMises };
  }

  /**
   * Computes the 12x12 consistent mass matrix Me for a linear tetrahedron (Tet4).
   * Me = (rho * V / 20) * [ 2*I  I    I    I   ]
   *                       [ I    2*I  I    I   ]
   *                       [ I    I    2*I  I   ]
   *                       [ I    I    I    2*I ]
   */
  public static computeElementMass(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    rho: number,
  ): { Me: Float64Array; volume: number } {
    const x21 = p1[0] - p0[0],
      y21 = p1[1] - p0[1],
      z21 = p1[2] - p0[2];
    const x31 = p2[0] - p0[0],
      y31 = p2[1] - p0[1],
      z31 = p2[2] - p0[2];
    const x41 = p3[0] - p0[0],
      y41 = p3[1] - p0[1],
      z41 = p3[2] - p0[2];

    const detJ = x21 * (y31 * z41 - y41 * z31) - y21 * (x31 * z41 - x41 * z31) + z21 * (x31 * y41 - x41 * y31);
    const volume = Math.abs(detJ) / 6.0;

    const Me = new Float64Array(144);
    const factor = (rho * volume) / 20.0;
    const diagFactor = 2.0 * factor;
    const offDiagFactor = 1.0 * factor;

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const val = i === j ? diagFactor : offDiagFactor;
        for (let d = 0; d < 3; d++) {
          const row = i * 3 + d;
          const col = j * 3 + d;
          Me[row * 12 + col] = val;
        }
      }
    }

    return { Me, volume };
  }
}
