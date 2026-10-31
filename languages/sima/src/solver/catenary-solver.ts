// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance analytical and shooting catenary solver for marine mooring lines.
 * Computes fairlead horizontal tension H, vertical tension V, suspended length,
 * touchdown point (TDP), anchor tension, and catenary geometry profile.
 */

export interface CatenarySolveParams {
  waterDepth: number; // h: vertical elevation from seabed to fairlead (m)
  horizontalSpan: number; // X: distance between anchor and fairlead (m)
  lineLength: number; // L: unstretched length (m)
  submergedWeight: number; // w: submerged weight per unit length (N/m)
  axialStiffnessEA?: number; // EA: axial stiffness (N), optional for elasticity
}

export interface CatenaryResult {
  horizontalTension: number; // H (N)
  fairleadVerticalTension: number; // Vf (N)
  fairleadTotalTension: number; // Tf = sqrt(H^2 + Vf^2) (N)
  anchorVerticalTension: number; // Va (N, 0 if line touches down)
  anchorTotalTension: number; // Ta (N)
  suspendedLength: number; // s (m)
  groundedLength: number; // L - s (m)
  touchdownDistance: number; // horizontal distance from anchor to TDP (m)
  fairleadAngleDeg: number; // angle from horizontal (deg)
  anchorAngleDeg: number; // angle from horizontal at anchor (deg)
  isLiftedOff: boolean; // true if no line is resting on the seabed
  profile: { x: number; z: number }[]; // 2D points along the line
}

import { WasmCatenaryBridge } from "./wasm-bridge.js";

export function solveCatenary(params: CatenarySolveParams): CatenaryResult {
  const { waterDepth: h, horizontalSpan: X, lineLength: L, submergedWeight: w } = params;
  const ea = params.axialStiffnessEA ?? 1e9;

  if (L <= h) {
    throw new Error(`Line length (${L}m) must be greater than water depth (${h}m).`);
  }

  const wasmBridge = WasmCatenaryBridge.getInstance();
  if (wasmBridge) {
    const wasmResult = wasmBridge.solve(params);
    if (wasmResult) {
      return wasmResult;
    }
  }

  // Check straight-line distance
  const diag = Math.sqrt(X * X + h * h);
  if (L < diag) {
    // Taut line with elastic stretch
    const stretch = (diag - L) / L;
    const tension = stretch * ea;
    const angleRad = Math.atan2(h, X);
    const H = tension * Math.cos(angleRad);
    const Vf = tension * Math.sin(angleRad);
    return {
      horizontalTension: H,
      fairleadVerticalTension: Vf,
      fairleadTotalTension: tension,
      anchorVerticalTension: Vf,
      anchorTotalTension: tension,
      suspendedLength: L,
      groundedLength: 0,
      touchdownDistance: 0,
      fairleadAngleDeg: (angleRad * 180) / Math.PI,
      anchorAngleDeg: (angleRad * 180) / Math.PI,
      isLiftedOff: true,
      profile: [
        { x: 0, z: 0 },
        { x: X, z: h },
      ],
    };
  }

  // Bracket for suspended length s: h < s <= L
  // Let f(s) = X_susp(s) + (L - s) - X, including elastic stretch H*s/EA
  const computeSpanError = (s: number): { err: number; H: number } => {
    if (s <= h) return { err: -1e9, H: 0 };
    // H = w * (s^2 - h^2) / (2 * h)
    const H = (w * (s * s - h * h)) / (2 * h);
    if (H <= 0) return { err: -1e9, H: 0 };
    // X_susp = (H / w) * asinh(w * s / H) + (H * s) / EA
    const xSusp = (H / w) * Math.asinh((w * s) / H) + (H * s) / ea;
    const xGrounded = L - s;
    return { err: xSusp + xGrounded - X, H };
  };

  // Check if fully lifted off at s = L
  const atL = computeSpanError(L);
  if (atL.err < 0) {
    // Entire line is suspended; anchor is lifted off (Va > 0)
    // Solve for H in fully suspended catenary
    return solveLiftedOffCatenary(h, X, L, w, ea);
  }

  // Root finding for s in (h, L] using Brent / Bisection
  let sLow = h + 1e-4;
  let sHigh = L;
  let bestH = 1e5;
  let bestS = L;

  for (let iter = 0; iter < 40; iter++) {
    const sMid = 0.5 * (sLow + sHigh);
    const { err, H } = computeSpanError(sMid);
    bestH = H;
    bestS = sMid;

    if (Math.abs(err) < 1e-4) {
      break;
    }
    if (err > 0) {
      sHigh = sMid;
    } else {
      sLow = sMid;
    }
  }

  const Vf = w * bestS;
  const Tf = Math.sqrt(bestH * bestH + Vf * Vf);
  const groundedLen = Math.max(0, L - bestS);
  const fairleadAngleRad = Math.atan2(Vf, bestH);

  // Generate 2D profile points
  const profile: { x: number; z: number }[] = [];
  const numGroundedPts = 10;
  for (let i = 0; i <= numGroundedPts; i++) {
    const frac = i / numGroundedPts;
    profile.push({ x: frac * groundedLen, z: 0 });
  }

  const numSuspPts = 30;
  for (let i = 1; i <= numSuspPts; i++) {
    const sLocal = (i / numSuspPts) * bestS;
    const zLocal = (bestH / w) * (Math.sqrt(1 + Math.pow((w * sLocal) / bestH, 2)) - 1);
    const xLocal = groundedLen + (bestH / w) * Math.asinh((w * sLocal) / bestH) + (bestH * sLocal) / ea;
    profile.push({ x: xLocal, z: zLocal });
  }

  return {
    horizontalTension: bestH,
    fairleadVerticalTension: Vf,
    fairleadTotalTension: Tf,
    anchorVerticalTension: 0,
    anchorTotalTension: bestH,
    suspendedLength: bestS,
    groundedLength: groundedLen,
    touchdownDistance: groundedLen,
    fairleadAngleDeg: (fairleadAngleRad * 180) / Math.PI,
    anchorAngleDeg: 0,
    isLiftedOff: false,
    profile,
  };
}

function solveLiftedOffCatenary(h: number, X: number, L: number, w: number, ea: number): CatenaryResult {
  // Bisection on H for fully suspended catenary with elastic stretch
  let hLow = 1e3;
  let hHigh = 1e8;
  let bestH = hLow;

  for (let i = 0; i < 40; i++) {
    const H = 0.5 * (hLow + hHigh);
    const a = H / w;
    // L_eff^2 - h^2 = 4 * a^2 * sinh^2(X / (2 * a))
    const rhs = 2 * a * Math.sinh(X / (2 * a));
    const stretchedL = L + (H * L) / ea;
    const target = Math.sqrt(Math.max(0, stretchedL * stretchedL - h * h));
    if (rhs < target) {
      hHigh = H;
    } else {
      hLow = H;
    }
    bestH = H;
  }

  const a = bestH / w;
  const u = X / (2 * a);
  const va = (w * (h / Math.tanh(u) - L)) / 2;
  const vf = va + w * L;
  const tf = Math.sqrt(bestH * bestH + vf * vf);
  const ta = Math.sqrt(bestH * bestH + Math.max(0, va) * Math.max(0, va));
  const angleF = (Math.atan2(vf, bestH) * 180) / Math.PI;
  const angleA = (Math.atan2(Math.max(0, va), bestH) * 180) / Math.PI;

  const profile: { x: number; z: number }[] = [];
  const numPts = 40;
  const sinhU = Math.sinh(u);
  const x0 = sinhU !== 0 ? X / 2 - a * Math.asinh(h / (2 * a * sinhU)) : X / 2;
  const coshX0OverA = Math.cosh(x0 / a);

  for (let i = 0; i <= numPts; i++) {
    const xVal = (i / numPts) * X;
    const zVal = i === 0 ? 0 : i === numPts ? h : a * (Math.cosh((xVal - x0) / a) - coshX0OverA);
    profile.push({ x: xVal, z: zVal });
  }

  return {
    horizontalTension: bestH,
    fairleadVerticalTension: vf,
    fairleadTotalTension: tf,
    anchorVerticalTension: Math.max(0, va),
    anchorTotalTension: ta,
    suspendedLength: L,
    groundedLength: 0,
    touchdownDistance: 0,
    fairleadAngleDeg: angleF,
    anchorAngleDeg: angleA,
    isLiftedOff: true,
    profile,
  };
}
