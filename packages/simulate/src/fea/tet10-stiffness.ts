// SPDX-License-Identifier: AGPL-3.0-or-later

const ALPHA = (5.0 + 3.0 * Math.sqrt(5.0)) / 20.0;
const BETA = (5.0 - Math.sqrt(5.0)) / 20.0;
const GAUSS_WEIGHT = 1.0 / 24.0;

// 4-point Gauss quadrature in barycentric coordinates [L0, L1, L2, L3]
const GAUSS_POINTS: [number, number, number, number][] = [
  [ALPHA, BETA, BETA, BETA],
  [BETA, ALPHA, BETA, BETA],
  [BETA, BETA, ALPHA, BETA],
  [BETA, BETA, BETA, ALPHA],
];

/**
 * High-Order Quadratic 10-Node Tetrahedral (Tet10) Formulation.
 * Eliminates artificial shear-locking under bending.
 */
export class Tet10Element {
  /**
   * Evaluates the 10 shape function derivatives with respect to natural coordinates (r, s, t).
   * r = L1, s = L2, t = L3, L0 = 1 - r - s - t.
   */
  public static computeNaturalDerivatives(
    L0: number,
    L1: number,
    L2: number,
    L3: number,
  ): { dNdr: Float64Array; dNds: Float64Array; dNdt: Float64Array } {
    const dNdr = new Float64Array(10);
    const dNds = new Float64Array(10);
    const dNdt = new Float64Array(10);

    // Corner node 0
    dNdr[0] = 1.0 - 4.0 * L0;
    dNds[0] = 1.0 - 4.0 * L0;
    dNdt[0] = 1.0 - 4.0 * L0;

    // Corner node 1
    dNdr[1] = 4.0 * L1 - 1.0;
    dNds[1] = 0.0;
    dNdt[1] = 0.0;

    // Corner node 2
    dNdr[2] = 0.0;
    dNds[2] = 4.0 * L2 - 1.0;
    dNdt[2] = 0.0;

    // Corner node 3
    dNdr[3] = 0.0;
    dNds[3] = 0.0;
    dNdt[3] = 4.0 * L3 - 1.0;

    // Mid-edge node 4 (0-1)
    dNdr[4] = 4.0 * (L0 - L1);
    dNds[4] = -4.0 * L1;
    dNdt[4] = -4.0 * L1;

    // Mid-edge node 5 (1-2)
    dNdr[5] = 4.0 * L2;
    dNds[5] = 4.0 * L1;
    dNdt[5] = 0.0;

    // Mid-edge node 6 (2-0)
    dNdr[6] = -4.0 * L2;
    dNds[6] = 4.0 * (L0 - L2);
    dNdt[6] = -4.0 * L2;

    // Mid-edge node 7 (0-3)
    dNdr[7] = -4.0 * L3;
    dNds[7] = -4.0 * L3;
    dNdt[7] = 4.0 * (L0 - L3);

    // Mid-edge node 8 (1-3)
    dNdr[8] = 4.0 * L3;
    dNds[8] = 0.0;
    dNdt[8] = 4.0 * L1;

    // Mid-edge node 9 (2-3)
    dNdr[9] = 0.0;
    dNds[9] = 4.0 * L3;
    dNdt[9] = 4.0 * L2;

    return { dNdr, dNds, dNdt };
  }

  /**
   * Computes the 30x30 stiffness matrix Ke and Gauss-point strain matrices for a Tet10 element.
   *
   * @param nodes 10 node coordinates [x, y, z]
   * @param D 6x6 isotropic elasticity matrix
   */
  public static computeElementStiffness(
    nodes: [number, number, number][],
    D: Float64Array,
  ): { Ke: Float64Array; B_gauss: Float64Array[]; volume: number } {
    if (nodes.length !== 10) {
      throw new Error(`Tet10Element requires exactly 10 nodes, got ${nodes.length}`);
    }

    const Ke = new Float64Array(900); // 30 x 30
    const B_gauss: Float64Array[] = [];
    let totalVolume = 0.0;

    // Loop over 4 Gauss integration points
    for (let g = 0; g < 4; g++) {
      const [L0, L1, L2, L3] = GAUSS_POINTS[g];
      const { dNdr, dNds, dNdt } = this.computeNaturalDerivatives(L0, L1, L2, L3);

      // Compute Jacobian J (3x3)
      let J11 = 0,
        J12 = 0,
        J13 = 0;
      let J21 = 0,
        J22 = 0,
        J23 = 0;
      let J31 = 0,
        J32 = 0,
        J33 = 0;

      for (let i = 0; i < 10; i++) {
        const [x, y, z] = nodes[i];
        J11 += dNdr[i] * x;
        J12 += dNdr[i] * y;
        J13 += dNdr[i] * z;
        J21 += dNds[i] * x;
        J22 += dNds[i] * y;
        J23 += dNds[i] * z;
        J31 += dNdt[i] * x;
        J32 += dNdt[i] * y;
        J33 += dNdt[i] * z;
      }

      // det(J)
      const detJ = J11 * (J22 * J33 - J23 * J32) - J12 * (J21 * J33 - J23 * J31) + J13 * (J21 * J32 - J22 * J31);

      const absDetJ = Math.abs(detJ);
      totalVolume += absDetJ * GAUSS_WEIGHT;

      const invDetJ = 1.0 / detJ;
      // Inverse Jacobian J^-1
      const invJ11 = (J22 * J33 - J23 * J32) * invDetJ;
      const invJ12 = (J13 * J32 - J12 * J33) * invDetJ;
      const invJ13 = (J12 * J23 - J13 * J22) * invDetJ;

      const invJ21 = (J23 * J31 - J21 * J33) * invDetJ;
      const invJ22 = (J11 * J33 - J13 * J31) * invDetJ;
      const invJ23 = (J13 * J21 - J11 * J23) * invDetJ;

      const invJ31 = (J21 * J32 - J22 * J31) * invDetJ;
      const invJ32 = (J12 * J31 - J11 * J32) * invDetJ;
      const invJ33 = (J11 * J22 - J12 * J21) * invDetJ;

      // Spatial gradients: [dN/dx, dN/dy, dN/dz] = J^-1 * [dN/dr, dN/ds, dN/dt]
      const dNdx = new Float64Array(10);
      const dNdy = new Float64Array(10);
      const dNdz = new Float64Array(10);

      for (let i = 0; i < 10; i++) {
        const dr = dNdr[i],
          ds = dNds[i],
          dt = dNdt[i];
        dNdx[i] = invJ11 * dr + invJ12 * ds + invJ13 * dt;
        dNdy[i] = invJ21 * dr + invJ22 * ds + invJ23 * dt;
        dNdz[i] = invJ31 * dr + invJ32 * ds + invJ33 * dt;
      }

      // Assemble 6x30 strain-displacement matrix B
      const B = new Float64Array(180); // 6 rows, 30 cols
      for (let i = 0; i < 10; i++) {
        const col = i * 3;
        const b = dNdx[i],
          c = dNdy[i],
          d = dNdz[i];

        B[0 * 30 + col + 0] = b;
        B[1 * 30 + col + 1] = c;
        B[2 * 30 + col + 2] = d;

        B[3 * 30 + col + 0] = c;
        B[3 * 30 + col + 1] = b;

        B[4 * 30 + col + 1] = d;
        B[4 * 30 + col + 2] = c;

        B[5 * 30 + col + 0] = d;
        B[5 * 30 + col + 2] = b;
      }

      B_gauss.push(B);

      // Compute DB = D (6x6) * B (6x30) -> 6x30
      const DB = new Float64Array(180);
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 30; c++) {
          let sum = 0.0;
          for (let k = 0; k < 6; k++) {
            sum += D[r * 6 + k] * B[k * 30 + c];
          }
          DB[r * 30 + c] = sum;
        }
      }

      // Integrate Ke += w_g * detJ * B^T (30x6) * DB (6x30)
      const dV = GAUSS_WEIGHT * absDetJ;
      for (let r = 0; r < 30; r++) {
        for (let c = 0; c < 30; c++) {
          let sum = 0.0;
          for (let k = 0; k < 6; k++) {
            sum += B[k * 30 + r] * DB[k * 30 + c];
          }
          Ke[r * 30 + c] += dV * sum;
        }
      }
    }

    return { Ke, B_gauss, volume: totalVolume };
  }

  /**
   * Computes element von Mises stress averaged across the 4 Gauss points from element displacement ue (30x1).
   */
  public static computeElementStress(
    B_gauss: Float64Array[],
    D: Float64Array,
    ue: Float64Array,
  ): { stress: Float64Array; vonMises: number } {
    const avgStress = new Float64Array(6);

    for (let g = 0; g < B_gauss.length; g++) {
      const B = B_gauss[g];
      // eps = B * ue (6x1)
      const eps = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        let sum = 0.0;
        for (let c = 0; c < 30; c++) {
          sum += B[r * 30 + c] * ue[c];
        }
        eps[r] = sum;
      }

      // sigma = D * eps
      for (let r = 0; r < 6; r++) {
        let sum = 0.0;
        for (let c = 0; c < 6; c++) {
          sum += D[r * 6 + c] * eps[c];
        }
        avgStress[r] += sum / B_gauss.length;
      }
    }

    const sxx = avgStress[0],
      syy = avgStress[1],
      szz = avgStress[2];
    const sxy = avgStress[3],
      syz = avgStress[4],
      szx = avgStress[5];

    const d1 = sxx - syy,
      d2 = syy - szz,
      d3 = szz - sxx;
    const vonMises = Math.sqrt(0.5 * (d1 * d1 + d2 * d2 + d3 * d3) + 3.0 * (sxy * sxy + syz * syz + szx * szx));

    return { stress: avgStress, vonMises };
  }

  /**
   * Evaluates the 10 shape functions at barycentric coordinates [L0, L1, L2, L3].
   */
  public static computeShapeFunctions(L0: number, L1: number, L2: number, L3: number): Float64Array {
    const N = new Float64Array(10);
    N[0] = L0 * (2.0 * L0 - 1.0);
    N[1] = L1 * (2.0 * L1 - 1.0);
    N[2] = L2 * (2.0 * L2 - 1.0);
    N[3] = L3 * (2.0 * L3 - 1.0);
    N[4] = 4.0 * L0 * L1;
    N[5] = 4.0 * L1 * L2;
    N[6] = 4.0 * L2 * L0;
    N[7] = 4.0 * L0 * L3;
    N[8] = 4.0 * L1 * L3;
    N[9] = 4.0 * L2 * L3;
    return N;
  }

  /**
   * Computes the 30x30 consistent mass matrix Me for a quadratic 10-node tetrahedron (Tet10).
   * Me = integral_Ve rho * N^T * N dV evaluated with 4-point Gauss quadrature.
   */
  public static computeElementMass(
    nodes: [number, number, number][],
    rho: number,
  ): { Me: Float64Array; volume: number } {
    if (nodes.length !== 10) {
      throw new Error(`Tet10Element requires exactly 10 nodes, got ${nodes.length}`);
    }

    const Me = new Float64Array(900); // 30 x 30
    let totalVolume = 0.0;

    for (let g = 0; g < 4; g++) {
      const [L0, L1, L2, L3] = GAUSS_POINTS[g];
      const { dNdr, dNds, dNdt } = this.computeNaturalDerivatives(L0, L1, L2, L3);
      const N = this.computeShapeFunctions(L0, L1, L2, L3);

      let J11 = 0,
        J12 = 0,
        J13 = 0;
      let J21 = 0,
        J22 = 0,
        J23 = 0;
      let J31 = 0,
        J32 = 0,
        J33 = 0;

      for (let i = 0; i < 10; i++) {
        const x = nodes[i][0],
          y = nodes[i][1],
          z = nodes[i][2];
        J11 += dNdr[i] * x;
        J12 += dNdr[i] * y;
        J13 += dNdr[i] * z;
        J21 += dNds[i] * x;
        J22 += dNds[i] * y;
        J23 += dNds[i] * z;
        J31 += dNdt[i] * x;
        J32 += dNdt[i] * y;
        J33 += dNdt[i] * z;
      }

      const detJ = J11 * (J22 * J33 - J23 * J32) - J12 * (J21 * J33 - J23 * J31) + J13 * (J21 * J32 - J22 * J31);
      const absDetJ = Math.abs(detJ);
      const dV = GAUSS_WEIGHT * absDetJ;
      totalVolume += dV;

      // Me += rho * dV * (N^T * N) tensor I_3
      const factor = rho * dV;
      for (let i = 0; i < 10; i++) {
        const Ni = N[i];
        for (let j = 0; j < 10; j++) {
          const val = factor * Ni * N[j];
          for (let d = 0; d < 3; d++) {
            Me[(i * 3 + d) * 30 + (j * 3 + d)] += val;
          }
        }
      }
    }

    return { Me, volume: totalVolume };
  }
}
