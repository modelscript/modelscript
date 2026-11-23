// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ApdlElement,
  ApdlElementResult,
  ApdlModalSolution,
  ApdlModel,
  ApdlModeResult,
  ApdlNodalDisplacement,
  ApdlNodalReaction,
  ApdlStaticSolution,
} from "../types.js";
import { expandApdlMacros } from "./macro-expander.js";

const DOF_NAMES = ["UX", "UY", "UZ", "ROTX", "ROTY", "ROTZ"] as const;
const FORCE_TO_DOF: Record<string, number> = {
  FX: 0,
  FY: 1,
  FZ: 2,
  MX: 3,
  MY: 4,
  MZ: 5,
};
const DOF_INDEX: Record<string, number> = {
  UX: 0,
  UY: 1,
  UZ: 2,
  ROTX: 3,
  ROTY: 4,
  ROTZ: 5,
};

interface ElementMaterialProps {
  E: number;
  nu: number;
  G: number;
  rho: number;
  A: number;
  Izz: number;
  Iyy: number;
  J: number;
  height: number;
  springK: number;
  pointMass: number;
}

function getElementProps(model: ApdlModel, elem: ApdlElement, etName: string): ElementMaterialProps {
  const mat = model.materials.get(elem.matId);
  const sec = model.sections.get(elem.secId);
  const real = model.realConstants.get(elem.realId);

  const E = mat?.EX ?? 2.1e11;
  const nu = mat?.PRXY ?? 0.3;
  const G = mat?.GXY ?? E / (2 * (1 + nu));
  const rho = mat?.DENS ?? 7850.0;

  let A = sec?.area ?? 1e-3;
  let Izz = sec?.Izz ?? 8.3333333333e-8;
  let Iyy = sec?.Iyy ?? Izz;
  let J = sec?.J ?? Izz + Iyy;
  let height = sec?.data[1] ?? sec?.data[0] ?? Math.sqrt(A);

  // Real constants override if no section is defined for this element
  if (!sec && real && real.values.length > 0) {
    if (etName.startsWith("LINK") || etName === "TRUSS" || etName === "SPAR") {
      A = real.values[0] ?? A;
    } else if (etName.startsWith("BEAM")) {
      A = real.values[0] ?? A;
      Izz = real.values[1] ?? Izz;
      Iyy = real.values[2] ?? Izz;
      height = real.values[2] ?? Math.sqrt(A);
      J = Izz + Iyy;
    }
  }

  const springK = real?.values[0] ?? 1e5;
  const pointMass = real?.values[0] ?? 1.0;

  return { E, nu, G, rho, A, Izz, Iyy, J, height, springK, pointMass };
}

/**
 * Builds the 3x3 direction-cosine rotation matrix `R` from global to local beam coordinates,
 * where local x is along the element axis `(p2 - p1)/L`.
 */
function buildBeamRotation3x3(dx: number, dy: number, dz: number, L: number): number[][] {
  const cx = dx / L;
  const cy = dy / L;
  const cz = dz / L;

  // Choose reference vector not parallel to local x
  let refX = 0;
  let refY = 0;
  let refZ = 1;
  if (Math.abs(cz) > 0.999) {
    refX = 0;
    refY = 1;
    refZ = 0;
  }

  // local y = ref x local_x (so for an X-axis beam in X-Y plane with ref=(0,0,1): y = (0,0,1)x(1,0,0) = (0,1,0)!)
  let yx = refY * cz - refZ * cy;
  let yy = refZ * cx - refX * cz;
  let yz = refX * cy - refY * cx;
  const yLen = Math.hypot(yx, yy, yz);
  yx /= yLen;
  yy /= yLen;
  yz /= yLen;

  // local z = local_x x local_y
  const zx = cy * yz - cz * yy;
  const zy = cz * yx - cx * yz;
  const zz = cx * yy - cy * yx;

  return [
    [cx, cy, cz],
    [yx, yy, yz],
    [zx, zy, zz],
  ];
}

/**
 * Builds the 12x12 local Euler-Bernoulli stiffness matrix for a 3D `BEAM188` element.
 */
function beam188LocalStiffness(L: number, props: ElementMaterialProps): number[][] {
  const K = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const { E, G, A, Izz, Iyy, J } = props;
  const L2 = L * L;
  const L3 = L2 * L;

  // Axial (0, 6)
  const ka = (E * A) / L;
  K[0]![0] = ka;
  K[0]![6] = -ka;
  K[6]![0] = -ka;
  K[6]![6] = ka;

  // Torsion (3, 9)
  const kt = (G * J) / L;
  K[3]![3] = kt;
  K[3]![9] = -kt;
  K[9]![3] = -kt;
  K[9]![9] = kt;

  // Bending in local x-y plane (about z): DOFs [1, 5, 7, 11] = [uy1, rz1, uy2, rz2]
  const cz = (E * Izz) / L3;
  const xyIdx = [1, 5, 7, 11] as const;
  const xyMat = [
    [12 * cz, 6 * L * cz, -12 * cz, 6 * L * cz],
    [6 * L * cz, 4 * L2 * cz, -6 * L * cz, 2 * L2 * cz],
    [-12 * cz, -6 * L * cz, 12 * cz, -6 * L * cz],
    [6 * L * cz, 2 * L2 * cz, -6 * L * cz, 4 * L2 * cz],
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      K[xyIdx[i]!]![xyIdx[j]!] = xyMat[i]![j]!;
    }
  }

  // Bending in local x-z plane (about y): DOFs [2, 4, 8, 10] = [uz1, ry1, uz2, ry2]
  const cy = (E * Iyy) / L3;
  const xzIdx = [2, 4, 8, 10] as const;
  const xzMat = [
    [12 * cy, -6 * L * cy, -12 * cy, -6 * L * cy],
    [-6 * L * cy, 4 * L2 * cy, 6 * L * cy, 2 * L2 * cy],
    [-12 * cy, 6 * L * cy, 12 * cy, 6 * L * cy],
    [-6 * L * cy, 2 * L2 * cy, 6 * L * cy, 4 * L2 * cy],
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      K[xzIdx[i]!]![xzIdx[j]!] = xzMat[i]![j]!;
    }
  }

  return K;
}

/**
 * Builds the 12x12 local consistent mass matrix for a 3D `BEAM188` element.
 */
function beam188LocalMass(L: number, props: ElementMaterialProps): number[][] {
  const M = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const { rho, A, J } = props;
  const m = rho * A * L;
  const L2 = L * L;

  // Axial (0, 6)
  M[0]![0] = m / 3;
  M[0]![6] = m / 6;
  M[6]![0] = m / 6;
  M[6]![6] = m / 3;

  // Torsion (3, 9)
  const ip = Math.max(J, A * L2 * 1e-4);
  const mt = (rho * ip * L) / 6;
  M[3]![3] = 2 * mt;
  M[3]![9] = mt;
  M[9]![3] = mt;
  M[9]![9] = 2 * mt;

  // Bending x-y: [1, 5, 7, 11]
  const c = m / 420;
  const xyIdx = [1, 5, 7, 11] as const;
  const xyMat = [
    [156 * c, 22 * L * c, 54 * c, -13 * L * c],
    [22 * L * c, 4 * L2 * c, 13 * L * c, -3 * L2 * c],
    [54 * c, 13 * L * c, 156 * c, -22 * L * c],
    [-13 * L * c, -3 * L2 * c, -22 * L * c, 4 * L2 * c],
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      M[xyIdx[i]!]![xyIdx[j]!] = xyMat[i]![j]!;
    }
  }

  // Bending x-z: [2, 4, 8, 10]
  const xzIdx = [2, 4, 8, 10] as const;
  const xzMat = [
    [156 * c, -22 * L * c, 54 * c, 13 * L * c],
    [-22 * L * c, 4 * L2 * c, -13 * L * c, -3 * L2 * c],
    [54 * c, -13 * L * c, 156 * c, 22 * L * c],
    [13 * L * c, -3 * L2 * c, 22 * L * c, 4 * L2 * c],
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      M[xzIdx[i]!]![xzIdx[j]!] = xzMat[i]![j]!;
    }
  }

  return M;
}

function transform12x12(Mlocal: number[][], R: number[][]): number[][] {
  // T is block-diagonal with four 3x3 blocks of R
  const T = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let b = 0; b < 4; b++) {
    const off = b * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        T[off + i]![off + j] = R[i]![j]!;
      }
    }
  }
  // tmp = Mlocal * T
  const tmp = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 12; k++) {
      const v = Mlocal[i]![k]!;
      if (v === 0) continue;
      for (let j = 0; j < 12; j++) {
        tmp[i]![j]! += v * T[k]![j]!;
      }
    }
  }
  // out = T^T * tmp
  const out = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 12; k++) {
      const v = T[k]![i]!;
      if (v === 0) continue;
      for (let j = 0; j < 12; j++) {
        out[i]![j]! += v * tmp[k]![j]!;
      }
    }
  }
  return out;
}

interface AssembledSystem {
  nodeIds: number[];
  nodeIndex: Map<number, number>;
  nDof: number;
  K: number[][];
  M: number[][];
  F: number[];
  prescribed: Map<number, number>;
  freeDofs: number[];
}

function assembleSystem(model: ApdlModel): AssembledSystem {
  const nodeIds = Array.from(model.nodes.keys()).sort((a, b) => a - b);
  const nodeIndex = new Map<number, number>();
  nodeIds.forEach((id, idx) => nodeIndex.set(id, idx));

  const nDof = nodeIds.length * 6;
  const K = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const M = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const F = new Array<number>(nDof).fill(0);

  for (const elem of model.elements.values()) {
    const et = model.elementTypes.get(elem.typeId);
    const etName = (et?.name ?? "BEAM188").toUpperCase();
    const props = getElementProps(model, elem, etName);

    if (etName === "MASS21" && elem.nodes.length >= 1) {
      const ni = nodeIndex.get(elem.nodes[0]!);
      if (ni === undefined) continue;
      for (let d = 0; d < 3; d++) {
        M[ni * 6 + d]![ni * 6 + d]! += props.pointMass;
      }
      continue;
    }

    if (elem.nodes.length < 2) continue;
    const n1 = model.nodes.get(elem.nodes[0]!);
    const n2 = model.nodes.get(elem.nodes[1]!);
    if (!n1 || !n2) continue;
    const i1 = nodeIndex.get(n1.id)!;
    const i2 = nodeIndex.get(n2.id)!;

    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const dz = n2.z - n1.z;
    const L = Math.hypot(dx, dy, dz);
    if (L <= 1e-12) continue;

    if (etName.startsWith("LINK") || etName === "TRUSS" || etName === "SPAR" || etName === "COMBIN14") {
      const k = etName === "COMBIN14" ? props.springK : (props.E * props.A) / L;
      const c = [dx / L, dy / L, dz / L];
      const dofMap = [i1 * 6, i1 * 6 + 1, i1 * 6 + 2, i2 * 6, i2 * 6 + 1, i2 * 6 + 2];

      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const kab = k * c[a]! * c[b]!;
          K[dofMap[a]!]![dofMap[b]!]! += kab;
          K[dofMap[a]!]![dofMap[3 + b]!]! -= kab;
          K[dofMap[3 + a]!]![dofMap[b]!]! -= kab;
          K[dofMap[3 + a]!]![dofMap[3 + b]!]! += kab;
        }
      }

      if (etName !== "COMBIN14") {
        const m = props.rho * props.A * L;
        for (let a = 0; a < 3; a++) {
          M[dofMap[a]!]![dofMap[a]!]! += m / 3;
          M[dofMap[a]!]![dofMap[3 + a]!]! += m / 6;
          M[dofMap[3 + a]!]![dofMap[a]!]! += m / 6;
          M[dofMap[3 + a]!]![dofMap[3 + a]!]! += m / 3;
        }
      }
    } else {
      // BEAM188 / BEAM3 / BEAM4 / default 3D Euler-Bernoulli beam
      const R = buildBeamRotation3x3(dx, dy, dz, L);
      const Ke = transform12x12(beam188LocalStiffness(L, props), R);
      const Me = transform12x12(beam188LocalMass(L, props), R);
      const dofMap = [
        i1 * 6,
        i1 * 6 + 1,
        i1 * 6 + 2,
        i1 * 6 + 3,
        i1 * 6 + 4,
        i1 * 6 + 5,
        i2 * 6,
        i2 * 6 + 1,
        i2 * 6 + 2,
        i2 * 6 + 3,
        i2 * 6 + 4,
        i2 * 6 + 5,
      ];
      for (let a = 0; a < 12; a++) {
        for (let b = 0; b < 12; b++) {
          K[dofMap[a]!]![dofMap[b]!]! += Ke[a]![b]!;
          M[dofMap[a]!]![dofMap[b]!]! += Me[a]![b]!;
        }
      }
    }
  }

  // Apply nodal forces
  for (const force of model.forces) {
    const ni = nodeIndex.get(force.node);
    const dIdx = FORCE_TO_DOF[force.dof.toUpperCase()];
    if (ni !== undefined && dIdx !== undefined) {
      F[ni * 6 + dIdx]! += force.value;
    }
  }

  // Collect prescribed DOFs
  const prescribed = new Map<number, number>();
  for (const bc of model.constraints) {
    const ni = nodeIndex.get(bc.node);
    if (ni === undefined) continue;
    const lab = bc.dof.toUpperCase();
    if (lab === "ALL") {
      for (let d = 0; d < 6; d++) {
        prescribed.set(ni * 6 + d, bc.value);
      }
    } else {
      const dIdx = DOF_INDEX[lab];
      if (dIdx !== undefined) {
        prescribed.set(ni * 6 + dIdx, bc.value);
      }
    }
  }

  // Active free DOFs: not prescribed and have non-zero diagonal stiffness (automatically eliminates unused 3D DOFs in 2D problems)
  const freeDofs: number[] = [];
  for (let d = 0; d < nDof; d++) {
    if (!prescribed.has(d) && Math.abs(K[d]![d]!) > 1e-18) {
      freeDofs.push(d);
    }
  }

  return { nodeIds, nodeIndex, nDof, K, M, F, prescribed, freeDofs };
}

/**
 * Solves `A * x = b` via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-24) {
      throw new Error(`Singular stiffness matrix at free DOF ${col} (check boundary constraints)`);
    }
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }

    const pivot = M[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = M[r]![col]! / pivot;
      if (factor === 0) continue;
      M[r]![col] = 0;
      for (let c = col + 1; c <= n; c++) {
        M[r]![c]! -= factor * M[col]![c]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) {
      sum -= M[r]![c]! * x[c]!;
    }
    x[r] = sum / M[r]![r]!;
  }
  return x;
}

/**
 * Solves the direct-stiffness static equilibrium problem `K * u = F` for an APDL model.
 */
export function solveApdlStatic(sourceOrModel: string | ApdlModel): ApdlStaticSolution {
  const model = typeof sourceOrModel === "string" ? expandApdlMacros(sourceOrModel) : sourceOrModel;
  const sys = assembleSystem(model);
  const { nodeIds, nodeIndex, nDof, K, F, prescribed, freeDofs } = sys;

  const nf = freeDofs.length;
  const Kff = Array.from({ length: nf }, () => new Array<number>(nf).fill(0));
  const Ff = new Array<number>(nf).fill(0);

  for (let i = 0; i < nf; i++) {
    const di = freeDofs[i]!;
    let rhs = F[di]!;
    for (const [dp, up] of prescribed.entries()) {
      if (up !== 0) rhs -= K[di]![dp]! * up;
    }
    Ff[i] = rhs;
    for (let j = 0; j < nf; j++) {
      Kff[i]![j] = K[di]![freeDofs[j]!]!;
    }
  }

  const uf = solveLinearSystem(Kff, Ff);
  const u = new Array<number>(nDof).fill(0);
  for (const [dp, up] of prescribed.entries()) u[dp] = up;
  for (let i = 0; i < nf; i++) u[freeDofs[i]!] = uf[i]!;

  // Compute nodal reactions R = K*u - F
  const R = new Array<number>(nDof).fill(0);
  for (let i = 0; i < nDof; i++) {
    let ku = 0;
    for (let j = 0; j < nDof; j++) {
      ku += K[i]![j]! * u[j]!;
    }
    R[i] = ku - F[i]!;
  }

  const displacements = new Map<number, ApdlNodalDisplacement>();
  const reactions = new Map<number, ApdlNodalReaction>();
  let maxDisplacement = 0;

  for (const id of nodeIds) {
    const base = nodeIndex.get(id)! * 6;
    const ux = u[base]!;
    const uy = u[base + 1]!;
    const uz = u[base + 2]!;
    const rotx = u[base + 3]!;
    const roty = u[base + 4]!;
    const rotz = u[base + 5]!;
    const usum = Math.hypot(ux, uy, uz);
    if (usum > maxDisplacement) maxDisplacement = usum;

    displacements.set(id, { nodeId: id, ux, uy, uz, rotx, roty, rotz, usum });
    reactions.set(id, {
      nodeId: id,
      fx: R[base]!,
      fy: R[base + 1]!,
      fz: R[base + 2]!,
      mx: R[base + 3]!,
      my: R[base + 4]!,
      mz: R[base + 5]!,
    });
  }

  // Element internal forces, stresses, and strain energy
  const elementResults = new Map<number, ApdlElementResult>();
  let totalStrainEnergy = 0;

  for (const elem of model.elements.values()) {
    const etName = (model.elementTypes.get(elem.typeId)?.name ?? "BEAM188").toUpperCase();
    if (elem.nodes.length < 2) continue;
    const n1 = model.nodes.get(elem.nodes[0]!);
    const n2 = model.nodes.get(elem.nodes[1]!);
    if (!n1 || !n2) continue;
    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const dz = n2.z - n1.z;
    const L = Math.hypot(dx, dy, dz);
    if (L <= 1e-12) continue;

    const props = getElementProps(model, elem, etName);
    const i1 = nodeIndex.get(n1.id)! * 6;
    const i2 = nodeIndex.get(n2.id)! * 6;

    if (etName.startsWith("LINK") || etName === "TRUSS" || etName === "SPAR" || etName === "COMBIN14") {
      const cx = dx / L;
      const cy = dy / L;
      const cz = dz / L;
      const du = (u[i2]! - u[i1]!) * cx + (u[i2 + 1]! - u[i1 + 1]!) * cy + (u[i2 + 2]! - u[i1 + 2]!) * cz;
      const k = etName === "COMBIN14" ? props.springK : (props.E * props.A) / L;
      const axialForce = k * du;
      const axialStress = props.A > 0 ? axialForce / props.A : 0;
      const strainEnergy = 0.5 * k * du * du;
      totalStrainEnergy += strainEnergy;
      elementResults.set(elem.id, {
        elementId: elem.id,
        elementType: etName,
        length: L,
        axialForce,
        axialStress,
        maxShearY: 0,
        maxMomentZ: 0,
        maxBendingStress: Math.abs(axialStress),
        strainEnergy,
      });
    } else {
      const Rot = buildBeamRotation3x3(dx, dy, dz, L);
      const uGlobal = [
        u[i1]!,
        u[i1 + 1]!,
        u[i1 + 2]!,
        u[i1 + 3]!,
        u[i1 + 4]!,
        u[i1 + 5]!,
        u[i2]!,
        u[i2 + 1]!,
        u[i2 + 2]!,
        u[i2 + 3]!,
        u[i2 + 4]!,
        u[i2 + 5]!,
      ];
      const uLocal = new Array<number>(12).fill(0);
      for (let b = 0; b < 4; b++) {
        const off = b * 3;
        for (let r = 0; r < 3; r++) {
          uLocal[off + r] =
            Rot[r]![0]! * uGlobal[off]! + Rot[r]![1]! * uGlobal[off + 1]! + Rot[r]![2]! * uGlobal[off + 2]!;
        }
      }
      const Kloc = beam188LocalStiffness(L, props);
      const fLocal = new Array<number>(12).fill(0);
      let energy = 0;
      for (let r = 0; r < 12; r++) {
        let sum = 0;
        for (let c = 0; c < 12; c++) sum += Kloc[r]![c]! * uLocal[c]!;
        fLocal[r] = sum;
        energy += 0.5 * uLocal[r]! * sum;
      }
      totalStrainEnergy += energy;
      const axialForce = fLocal[6]!;
      const axialStress = props.A > 0 ? axialForce / props.A : 0;
      const maxShearY = Math.max(Math.abs(fLocal[1]!), Math.abs(fLocal[7]!));
      const maxMomentZ = Math.max(Math.abs(fLocal[5]!), Math.abs(fLocal[11]!));
      const maxBendingStress = props.Izz > 0 ? (maxMomentZ * (props.height / 2)) / props.Izz : 0;

      elementResults.set(elem.id, {
        elementId: elem.id,
        elementType: etName,
        length: L,
        axialForce,
        axialStress,
        maxShearY,
        maxMomentZ,
        maxBendingStress,
        strainEnergy: energy,
      });
    }
  }

  return {
    analysisType: "STATIC",
    converged: true,
    dofCount: nDof,
    freeDofCount: nf,
    displacements,
    reactions,
    elementResults,
    maxDisplacement,
    totalStrainEnergy,
  };
}

/**
 * Cholesky decomposition `A = L * L^T` for symmetric positive-definite matrix `A`.
 */
function choleskyDecompose(A: number[][]): number[][] {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i]![j]!;
      for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        L[i]![j] = Math.sqrt(Math.max(sum, 1e-24));
      } else {
        L[i]![j] = sum / L[j]![j]!;
      }
    }
  }
  return L;
}

function invertLowerTriangular(L: number[][]): number[][] {
  const n = L.length;
  const inv = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    inv[i]![i] = 1 / L[i]![i]!;
    for (let j = 0; j < i; j++) {
      let sum = 0;
      for (let k = j; k < i; k++) sum += L[i]![k]! * inv[k]![j]!;
      inv[i]![j] = -sum / L[i]![i]!;
    }
  }
  return inv;
}

/**
 * Symmetric Jacobi eigensolver: computes all eigenvalues and eigenvectors of symmetric matrix `A`.
 */
function jacobiEigenSymmetric(AInput: number[][]): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = AInput.length;
  const A = AInput.map((row) => [...row]);
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1.0 : 0.0)),
  );

  const maxSweeps = 100 * n * n;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let p = 0;
    let q = 1;
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(A[i]![j]!);
        if (v > maxOff) {
          maxOff = v;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < 1e-12) break;

    const app = A[p]![p]!;
    const aqq = A[q]![q]!;
    const apq = A[p]![q]!;
    const tau = (aqq - app) / (2 * apq);
    const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    A[p]![p] = app - t * apq;
    A[q]![q] = aqq + t * apq;
    A[p]![q] = 0;
    A[q]![p] = 0;

    for (let r = 0; r < n; r++) {
      if (r !== p && r !== q) {
        const arp = A[r]![p]!;
        const arq = A[r]![q]!;
        A[r]![p] = c * arp - s * arq;
        A[p]![r] = A[r]![p]!;
        A[r]![q] = s * arp + c * arq;
        A[q]![r] = A[r]![q]!;
      }
    }

    for (let r = 0; r < n; r++) {
      const vrp = V[r]![p]!;
      const vrq = V[r]![q]!;
      V[r]![p] = c * vrp - s * vrq;
      V[r]![q] = s * vrp + c * vrq;
    }
  }

  const eigenvalues = Array.from({ length: n }, (_, i) => A[i]![i]!);
  return { eigenvalues, eigenvectors: V };
}

/**
 * Solves the generalized structural modal eigenvalue problem `det(K - omega^2 * M) = 0`.
 */
export function solveApdlModal(sourceOrModel: string | ApdlModel, requestedModes?: number): ApdlModalSolution {
  const model = typeof sourceOrModel === "string" ? expandApdlMacros(sourceOrModel) : sourceOrModel;
  const sys = assembleSystem(model);
  const { nodeIds, nodeIndex, nDof, K, M, freeDofs } = sys;

  // Keep only free DOFs that also have positive mass diagonal
  const modalDofs = freeDofs.filter((d) => M[d]![d]! > 1e-24);
  const nf = modalDofs.length;
  if (nf === 0) {
    return { analysisType: "MODAL", converged: true, dofCount: nDof, freeDofCount: 0, modes: [] };
  }

  const Kff = Array.from({ length: nf }, (_, i) =>
    Array.from({ length: nf }, (__, j) => K[modalDofs[i]!]![modalDofs[j]!]!),
  );
  const Mff = Array.from({ length: nf }, (_, i) =>
    Array.from({ length: nf }, (__, j) => M[modalDofs[i]!]![modalDofs[j]!]!),
  );

  // Transform K*phi = lam*M*phi -> (L^-1 K L^-T) psi = lam psi where M = L L^T
  const L = choleskyDecompose(Mff);
  const Linv = invertLowerTriangular(L);

  const tmp = Array.from({ length: nf }, () => new Array<number>(nf).fill(0));
  for (let i = 0; i < nf; i++) {
    for (let k = 0; k < nf; k++) {
      const v = Linv[i]![k]!;
      if (v === 0) continue;
      for (let j = 0; j < nf; j++) tmp[i]![j]! += v * Kff[k]![j]!;
    }
  }
  const A = Array.from({ length: nf }, () => new Array<number>(nf).fill(0));
  for (let i = 0; i < nf; i++) {
    for (let j = 0; j < nf; j++) {
      let sum = 0;
      for (let k = 0; k < nf; k++) sum += tmp[i]![k]! * Linv[j]![k]!;
      A[i]![j] = sum;
    }
  }
  // Enforce exact symmetry
  for (let i = 0; i < nf; i++) {
    for (let j = i + 1; j < nf; j++) {
      const avg = 0.5 * (A[i]![j]! + A[j]![i]!);
      A[i]![j] = avg;
      A[j]![i] = avg;
    }
  }

  const { eigenvalues, eigenvectors } = jacobiEigenSymmetric(A);
  const order = eigenvalues
    .map((lam, idx) => ({ lam, idx }))
    .filter((e) => e.lam > 1e-12)
    .sort((a, b) => a.lam - b.lam);

  const count = Math.min(requestedModes ?? model.numModes, order.length);
  const modes: ApdlModeResult[] = [];

  for (let m = 0; m < count; m++) {
    const entry = order[m]!;
    const omega = Math.sqrt(entry.lam);
    const frequencyHz = omega / (2 * Math.PI);

    // Back-transform phi = L^-T * psi
    const phiFree = new Array<number>(nf).fill(0);
    let maxAbs = 0;
    for (let i = 0; i < nf; i++) {
      let sum = 0;
      for (let k = i; k < nf; k++) sum += Linv[k]![i]! * eigenvectors[k]![entry.idx]!;
      phiFree[i] = sum;
      if (Math.abs(sum) > maxAbs) maxAbs = Math.abs(sum);
    }
    if (maxAbs > 0) {
      for (let i = 0; i < nf; i++) phiFree[i]! /= maxAbs;
    }

    const fullPhi = new Array<number>(nDof).fill(0);
    for (let i = 0; i < nf; i++) fullPhi[modalDofs[i]!] = phiFree[i]!;

    const modeShape = new Map<number, ApdlNodalDisplacement>();
    for (const id of nodeIds) {
      const base = nodeIndex.get(id)! * 6;
      const ux = fullPhi[base]!;
      const uy = fullPhi[base + 1]!;
      const uz = fullPhi[base + 2]!;
      modeShape.set(id, {
        nodeId: id,
        ux,
        uy,
        uz,
        rotx: fullPhi[base + 3]!,
        roty: fullPhi[base + 4]!,
        rotz: fullPhi[base + 5]!,
        usum: Math.hypot(ux, uy, uz),
      });
    }

    modes.push({ mode: m + 1, omega, frequencyHz, modeShape });
  }

  return {
    analysisType: "MODAL",
    converged: true,
    dofCount: nDof,
    freeDofCount: nf,
    modes,
  };
}

/**
 * Solves an APDL model according to its `ANTYPE` (`STATIC` or `MODAL`).
 */
export function solveApdl(sourceOrModel: string | ApdlModel): ApdlStaticSolution | ApdlModalSolution {
  const model = typeof sourceOrModel === "string" ? expandApdlMacros(sourceOrModel) : sourceOrModel;
  if (model.analysisType === "MODAL") {
    return solveApdlModal(model);
  }
  return solveApdlStatic(model);
}

export { DOF_NAMES };
