// SPDX-License-Identifier: AGPL-3.0-or-later

import { plot3dIndex, type Plot3dGridBlock, type Plot3dSolutionBlock } from "../types.js";
import { computeQuadFaceAreaVector, type Vec3 } from "./metrics.js";

export interface Plot3dGasProperties {
  /** Ratio of specific heats (default: 1.4 for air). */
  gamma?: number | undefined;
  /** Specific gas constant R in J/(kg·K) (default: 287.058). */
  gasConstantR?: number | undefined;
  /** Reference static pressure for Cp and entropy (default: 101325 Pa). */
  pRef?: number | undefined;
  /** Reference density for Cp and entropy (default: 1.225 kg/m^3). */
  rhoRef?: number | undefined;
  /** Reference freestream speed for Cp (default: computed from FSMACH & a_ref). */
  vRef?: number | undefined;
}

export interface PrimitiveFlowState {
  rho: number;
  u: number;
  v: number;
  w: number;
  speed: number;
  pressure: number;
  temperature: number;
  soundSpeed: number;
  mach: number;
  totalPressure: number;
  totalTemperature: number;
  cp: number;
  entropy: number;
}

export interface ConservativeFlowState {
  rho: number;
  rhou: number;
  rhov: number;
  rhow: number;
  energy: number;
}

export interface Plot3dBlockFlowField {
  blockIndex: number;
  ni: number;
  nj: number;
  nk: number;
  u: Float64Array;
  v: Float64Array;
  w: Float64Array;
  pressure: Float64Array;
  temperature: Float64Array;
  soundSpeed: Float64Array;
  mach: Float64Array;
  totalPressure: Float64Array;
  totalTemperature: Float64Array;
  cp: Float64Array;
  entropy: Float64Array;
}

export type BlockFaceBoundary = "imin" | "imax" | "jmin" | "jmax" | "kmin" | "kmax";

/**
 * Converts a single PLOT3D conservative state vector Q = (rho, rhou, rhov, rhow, e)
 * to primitive & derived thermodynamic flow quantities.
 */
export function conservativeToPrimitive(q: ConservativeFlowState, props?: Plot3dGasProperties): PrimitiveFlowState {
  const gamma = props?.gamma ?? 1.4;
  const R = props?.gasConstantR ?? 287.058;
  const pRef = props?.pRef ?? 101325.0;
  const rhoRef = props?.rhoRef ?? 1.225;

  const rho = q.rho;
  const invRho = rho > 0 ? 1.0 / rho : 0.0;
  const u = q.rhou * invRho;
  const v = q.rhov * invRho;
  const w = q.rhow * invRho;
  const vSq = u * u + v * v + w * w;
  const speed = Math.sqrt(vSq);

  const pressure = (gamma - 1.0) * (q.energy - 0.5 * rho * vSq);
  const temperature = rho > 0 ? pressure / (rho * R) : 0.0;
  const soundSpeed = rho > 0 && pressure > 0 ? Math.sqrt((gamma * pressure) / rho) : 0.0;
  const mach = soundSpeed > 0 ? speed / soundSpeed : 0.0;

  const isenFactor = 1.0 + 0.5 * (gamma - 1.0) * mach * mach;
  const totalPressure = pressure > 0 ? pressure * Math.pow(isenFactor, gamma / (gamma - 1.0)) : 0.0;
  const totalTemperature = temperature * isenFactor;

  const aRef = Math.sqrt((gamma * pRef) / rhoRef);
  const vRef = props?.vRef ?? aRef;
  const qDynRef = 0.5 * rhoRef * vRef * vRef;
  const cp = qDynRef > 1e-12 ? (pressure - pRef) / qDynRef : 0.0;

  const cv = R / (gamma - 1.0);
  const cpGas = gamma * cv;
  const entropy =
    pressure > 0 && rho > 0 ? cv * Math.log(pressure / pRef) - cpGas * Math.log(rho / rhoRef) : Number.NaN;

  return {
    rho,
    u,
    v,
    w,
    speed,
    pressure,
    temperature,
    soundSpeed,
    mach,
    totalPressure,
    totalTemperature,
    cp,
    entropy,
  };
}

/**
 * Converts primitive variables (rho, u, v, w, p) to PLOT3D conservative state Q.
 */
export function primitiveToConservative(
  rho: number,
  u: number,
  v: number,
  w: number,
  pressure: number,
  gamma: number = 1.4,
): ConservativeFlowState {
  const kinetic = 0.5 * rho * (u * u + v * v + w * w);
  const energy = pressure / (gamma - 1.0) + kinetic;
  return {
    rho,
    rhou: rho * u,
    rhov: rho * v,
    rhow: rho * w,
    energy,
  };
}

/**
 * Evaluates primitive & thermodynamic flow fields across all nodes of a PLOT3D solution block.
 */
export function computeBlockFlowField(
  solBlock: Plot3dSolutionBlock,
  props?: Plot3dGasProperties,
): Plot3dBlockFlowField {
  const n = solBlock.rho.length;
  const gamma = props?.gamma ?? 1.4;
  const R = props?.gasConstantR ?? 287.058;
  const pRef = props?.pRef ?? 101325.0;
  const rhoRef = props?.rhoRef ?? 1.225;
  const aRef = Math.sqrt((gamma * pRef) / rhoRef);
  const vRef = props?.vRef ?? (solBlock.conditions.fsmach > 0 ? solBlock.conditions.fsmach * aRef : aRef);

  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const w = new Float64Array(n);
  const pressure = new Float64Array(n);
  const temperature = new Float64Array(n);
  const soundSpeed = new Float64Array(n);
  const mach = new Float64Array(n);
  const totalPressure = new Float64Array(n);
  const totalTemperature = new Float64Array(n);
  const cp = new Float64Array(n);
  const entropy = new Float64Array(n);

  const gasProps: Plot3dGasProperties = { gamma, gasConstantR: R, pRef, rhoRef, vRef };
  for (let idx = 0; idx < n; idx++) {
    const st = conservativeToPrimitive(
      {
        rho: solBlock.rho[idx]!,
        rhou: solBlock.rhou[idx]!,
        rhov: solBlock.rhov[idx]!,
        rhow: solBlock.rhow[idx]!,
        energy: solBlock.energy[idx]!,
      },
      gasProps,
    );
    u[idx] = st.u;
    v[idx] = st.v;
    w[idx] = st.w;
    pressure[idx] = st.pressure;
    temperature[idx] = st.temperature;
    soundSpeed[idx] = st.soundSpeed;
    mach[idx] = st.mach;
    totalPressure[idx] = st.totalPressure;
    totalTemperature[idx] = st.totalTemperature;
    cp[idx] = st.cp;
    entropy[idx] = st.entropy;
  }

  return {
    blockIndex: solBlock.index,
    ni: solBlock.ni,
    nj: solBlock.nj,
    nk: solBlock.nk,
    u,
    v,
    w,
    pressure,
    temperature,
    soundSpeed,
    mach,
    totalPressure,
    totalTemperature,
    cp,
    entropy,
  };
}

function gridNode(b: Plot3dGridBlock, i: number, j: number, k: number): Vec3 {
  const idx = plot3dIndex(i, j, k, b.ni, b.nj);
  return { x: b.x[idx]!, y: b.y[idx]!, z: b.z[idx]! };
}

function momentumNode(s: Plot3dSolutionBlock, i: number, j: number, k: number): Vec3 {
  const idx = plot3dIndex(i, j, k, s.ni, s.nj);
  return { x: s.rhou[idx]!, y: s.rhov[idx]!, z: s.rhow[idx]! };
}

/**
 * Integrates mass flux $\dot{m} = \iint \rho \vec{u} \cdot d\vec{A}$ over a constant-index
 * slice or boundary face of a 3D structured PLOT3D block.
 *
 * Sign convention: normal points in the positive coordinate direction (+i, +j, or +k).
 */
export function computeSurfaceMassFlux(
  gridBlock: Plot3dGridBlock,
  solBlock: Plot3dSolutionBlock,
  face: BlockFaceBoundary,
  sliceIndex?: number,
): { massFlux: number; area: number } {
  const { ni, nj, nk } = gridBlock;
  let massFlux = 0;
  let area = 0;

  const avgMom = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 => ({
    x: 0.25 * (a.x + b.x + c.x + d.x),
    y: 0.25 * (a.y + b.y + c.y + d.y),
    z: 0.25 * (a.z + b.z + c.z + d.z),
  });

  if (face === "imin" || face === "imax") {
    const i = sliceIndex ?? (face === "imin" ? 0 : ni - 1);
    for (let k = 0; k < nk - 1; k++) {
      for (let j = 0; j < nj - 1; j++) {
        // Right-handed +i normal: (p(j,k), p(j+1,k), p(j+1,k+1), p(j,k+1))
        const aVec = computeQuadFaceAreaVector(
          gridNode(gridBlock, i, j, k),
          gridNode(gridBlock, i, j + 1, k),
          gridNode(gridBlock, i, j + 1, k + 1),
          gridNode(gridBlock, i, j, k + 1),
        );
        const mom = avgMom(
          momentumNode(solBlock, i, j, k),
          momentumNode(solBlock, i, j + 1, k),
          momentumNode(solBlock, i, j + 1, k + 1),
          momentumNode(solBlock, i, j, k + 1),
        );
        massFlux += mom.x * aVec.x + mom.y * aVec.y + mom.z * aVec.z;
        area += Math.sqrt(aVec.x * aVec.x + aVec.y * aVec.y + aVec.z * aVec.z);
      }
    }
  } else if (face === "jmin" || face === "jmax") {
    const j = sliceIndex ?? (face === "jmin" ? 0 : nj - 1);
    for (let k = 0; k < nk - 1; k++) {
      for (let i = 0; i < ni - 1; i++) {
        // Right-handed +j normal: (p(i,k), p(i,k+1), p(i+1,k+1), p(i+1,k))
        const aVec = computeQuadFaceAreaVector(
          gridNode(gridBlock, i, j, k),
          gridNode(gridBlock, i, j, k + 1),
          gridNode(gridBlock, i + 1, j, k + 1),
          gridNode(gridBlock, i + 1, j, k),
        );
        const mom = avgMom(
          momentumNode(solBlock, i, j, k),
          momentumNode(solBlock, i, j, k + 1),
          momentumNode(solBlock, i + 1, j, k + 1),
          momentumNode(solBlock, i + 1, j, k),
        );
        massFlux += mom.x * aVec.x + mom.y * aVec.y + mom.z * aVec.z;
        area += Math.sqrt(aVec.x * aVec.x + aVec.y * aVec.y + aVec.z * aVec.z);
      }
    }
  } else {
    const k = sliceIndex ?? (face === "kmin" ? 0 : nk - 1);
    for (let j = 0; j < nj - 1; j++) {
      for (let i = 0; i < ni - 1; i++) {
        // Right-handed +k normal: (p(i,j), p(i+1,j), p(i+1,j+1), p(i,j+1))
        const aVec = computeQuadFaceAreaVector(
          gridNode(gridBlock, i, j, k),
          gridNode(gridBlock, i + 1, j, k),
          gridNode(gridBlock, i + 1, j + 1, k),
          gridNode(gridBlock, i, j + 1, k),
        );
        const mom = avgMom(
          momentumNode(solBlock, i, j, k),
          momentumNode(solBlock, i + 1, j, k),
          momentumNode(solBlock, i + 1, j + 1, k),
          momentumNode(solBlock, i, j + 1, k),
        );
        massFlux += mom.x * aVec.x + mom.y * aVec.y + mom.z * aVec.z;
        area += Math.sqrt(aVec.x * aVec.x + aVec.y * aVec.y + aVec.z * aVec.z);
      }
    }
  }

  return { massFlux, area };
}
