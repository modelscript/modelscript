// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FastsimContactInput, FastsimContactOutput } from "../types.js";
import { getWasmContactBridge } from "./wasm-bridge.js";

/**
 * Pure TypeScript reference implementation of Kalker's FASTSIM algorithm.
 */
export function pureTsSolveFastsim(input: FastsimContactInput, strips: number = 20): FastsimContactOutput {
  const {
    normalForce,
    longitudinalCreep,
    lateralCreep,
    spin,
    ellipseSemiMajor: a,
    ellipseSemiMinor: b,
    shearModulus: G,
    poissonRatio: nu,
    frictionCoeff: mu,
  } = input;

  if (normalForce <= 0 || a <= 0 || b <= 0) {
    return { fx: 0, fy: 0, mz: 0, adhesionRatio: 0 };
  }

  const L = (3 * Math.PI * G) / (8 * (1 - nu) * a);

  let totalFx = 0;
  let totalFy = 0;
  let totalMz = 0;

  const dy = (2 * b) / strips;

  for (let i = 0; i < strips; i++) {
    const y = -b + (i + 0.5) * dy;
    const yRel = y / b;
    if (Math.abs(yRel) >= 1) continue;

    const xLeading = a * Math.sqrt(Math.max(0, 1 - yRel * yRel));
    const stripLength = 2 * xLeading;
    if (stripLength <= 0) continue;

    const dx = stripLength / strips;
    let px = 0;
    let py = 0;

    for (let j = 0; j < strips; j++) {
      const x = xLeading - (j + 0.5) * dx;

      // Local relative slip increment
      const sx = longitudinalCreep - spin * y;
      const sy = lateralCreep + spin * x;

      // Elastic traction prediction
      const dpx = sx * L * dx;
      const dpy = sy * L * dx;

      px += dpx;
      py += dpy;

      // Coulomb traction limit p_lim = mu * p_z(x, y)
      const r2 = (x * x) / (a * a) + (y * y) / (b * b);
      const pz = r2 < 1 ? ((3 * normalForce) / (2 * Math.PI * a * b)) * Math.sqrt(1 - r2) : 0;
      const pLim = mu * pz;

      const pMag = Math.sqrt(px * px + py * py);
      if (pMag > pLim && pMag > 0) {
        px = (px / pMag) * pLim;
        py = (py / pMag) * pLim;
      }

      const dA = dx * dy;
      totalFx += px * dA;
      totalFy += py * dA;
      totalMz += (x * py - y * px) * dA;
    }
  }

  const resultantTangent = Math.sqrt(totalFx * totalFx + totalFy * totalFy);
  const maxAdhesion = Math.max(1e-9, mu * normalForce);
  const adhesionRatio = Math.min(1.0, resultantTangent / maxAdhesion);

  return {
    fx: totalFx,
    fy: totalFy,
    mz: totalMz,
    adhesionRatio,
  };
}

/**
 * Kalker's FASTSIM algorithm for rolling contact with tangential creepage.
 * Discretizes the Hertzian contact ellipse into strips and integrates elastic/slip zones.
 *
 * Accelerated via WebAssembly linear memory kernel with transparent TypeScript fallback.
 */
export function solveFastsim(input: FastsimContactInput, strips: number = 20): FastsimContactOutput {
  try {
    return getWasmContactBridge().solveFastsim(input, strips);
  } catch {
    return pureTsSolveFastsim(input, strips);
  }
}
