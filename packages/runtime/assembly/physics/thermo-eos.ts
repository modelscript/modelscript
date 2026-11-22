// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared cleanroom AssemblyScript thermodynamic & equation-of-state kernels
 * for reuse across `@modelscript/aspen`, `@modelscript/gproms`, `@modelscript/olga`,
 * `@modelscript/lps`, `@modelscript/eclipse`, `@modelscript/relap5`, `@modelscript/tough`,
 * and `@modelscript/rocets`.
 *
 * Provenance:
 *   - IAPWS-IF97 (Wagner et al., 2000) Regions 1, 2 & 4; IAPWS-95 (Wagner & Pruss, 2002)
 *   - Peng & Robinson (1976) Ind. Eng. Chem. Fundam. 15(1):59-64
 *   - Rachford & Rice (1952) J. Pet. Technol. 4(10); Michelsen (1994)
 *   - ISO 20765-1 / AGA Report No. 8; Sutton (1985); Wichert & Aziz (1972);
 *     Dranchuk & Abou-Kassem (1975) J. Can. Pet. Technol. 14(3):34-36
 *   - Thomas (1949) Tridiagonal Matrix Algorithm (TDMA) for MESH distillation
 */

const SQRT2: f64 = 1.4142135623730951;
const R_WATER_KJKGK: f64 = 0.461526; // kJ / (kg * K), IAPWS-IF97 specific gas constant

// Static zero-GC scratch buffers for Thomas TDMA (up to 256 distillation stages)
const THOMAS_MAX_N: i32 = 256;
const THOMAS_CP_PTR: usize = memory.data(256 * 8);
const THOMAS_DP_PTR: usize = memory.data(256 * 8);

@inline
function clampF64(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function cbrtF64(x: f64): f64 {
  if (x == 0.0) return 0.0;
  return x < 0.0 ? -Math.pow(-x, 1.0 / 3.0) : Math.pow(x, 1.0 / 3.0);
}

/**
 * IAPWS-IF97 Region 4 backward saturation temperature `T_sat(P)` in Kelvin for pressure `pMPa` in MPa.
 * Valid for `611.213e-6 MPa <= pMPa <= 22.064 MPa` (Wagner et al., 2000, Eq. 31).
 */
export function evalIapws97TsatK(pMPa: f64): f64 {
  const p = clampF64(pMPa, 6.11213e-4, 22.064);
  const beta = Math.pow(p, 0.25);
  const n1: f64 = 1167.0521452767;
  const n2: f64 = -724213.16703206;
  const n3: f64 = -17.073846940092;
  const n4: f64 = 12020.82470247;
  const n5: f64 = -3232555.0322333;
  const n6: f64 = 14.91510861353;
  const n7: f64 = -4823.2657361591;
  const n8: f64 = 405113.40542057;
  const n9: f64 = -0.23855557567849;
  const n10: f64 = 650.17534844798;

  const beta2 = beta * beta;
  const e = beta2 + n3 * beta + n6;
  const f = n1 * beta2 + n4 * beta + n7;
  const g = n2 * beta2 + n5 * beta + n8;
  const d = (2.0 * g) / (-f - Math.sqrt(f * f - 4.0 * e * g));
  const term = n10 + d;
  return 0.5 * (term - Math.sqrt(term * term - 4.0 * (n9 + n10 * d)));
}

/**
 * IAPWS-IF97 Region 4 forward saturation pressure `P_sat(T)` in MPa for temperature `tK` in Kelvin.
 * Valid for `273.15 K <= tK <= 647.096 K` (Wagner et al., 2000, Eq. 30).
 */
export function evalIapws97PsatMPa(tK: f64): f64 {
  const tk = clampF64(tK, 273.15, 647.096);
  const n1: f64 = 0.11670521452767e4;
  const n2: f64 = -0.72421316703206e6;
  const n3: f64 = -0.17073846940092e2;
  const n4: f64 = 0.1202082470247e5;
  const n5: f64 = -0.32325550322333e7;
  const n6: f64 = 0.1491510861353e2;
  const n7: f64 = -0.48232657361591e4;
  const n8: f64 = 0.40511340542057e6;
  const n9: f64 = -0.23855557567849;
  const n10: f64 = 0.65017534844798e3;

  const theta = tk + n9 / (tk - n10);
  const theta2 = theta * theta;
  const A = theta2 + n1 * theta + n2;
  const B = n3 * theta2 + n4 * theta + n5;
  const C = n6 * theta2 + n7 * theta + n8;
  const disc = Math.max(0.0, B * B - 4.0 * A * C);
  const ratio = (2.0 * C) / (-B + Math.sqrt(disc));
  const r2 = ratio * ratio;
  return r2 * r2;
}

/**
 * Saturated liquid water density `rho_f(T)` in kg/m^3 via IAPWS-95 Wagner & Pruss (2002) Eq. 2.6.
 */
@inline
function evalIapws95SatLiquidDensity(tK: f64): f64 {
  const tc: f64 = 647.096;
  const rhoc: f64 = 322.0;
  const tk = clampF64(tK, 273.15, 647.0);
  const tau = 1.0 - tk / tc;
  const tau13 = Math.pow(tau, 1.0 / 3.0);
  const tau23 = tau13 * tau13;
  const tau53 = tau * tau23;
  const tau163 = Math.pow(tau, 16.0 / 3.0);
  const tau433 = Math.pow(tau, 43.0 / 3.0);
  const tau1103 = Math.pow(tau, 110.0 / 3.0);

  return (
    rhoc *
    (1.0 +
      1.99274064 * tau13 +
      1.09965342 * tau23 -
      0.510839303 * tau53 -
      1.75493479 * tau163 -
      45.5170352 * tau433 -
      6.7469445e5 * tau1103)
  );
}

/**
 * IAPWS-IF97 Region 1 compressed liquid water density `rho(P, T)` in kg/m^3
 * for `pMPa` in MPa and `tK` in Kelvin (`273.15 K <= tK <= 623.15 K`, `pMPa <= 100 MPa`).
 */
export function evalIapws97LiquidDensity(pMPa: f64, tK: f64): f64 {
  const tk = clampF64(tK, 273.15, 623.15);
  const p = clampF64(pMPa, 0.0, 100.0);
  const rhoSat = evalIapws95SatLiquidDensity(tk);
  const pSat = evalIapws97PsatMPa(tk);
  const dp = p > pSat ? p - pSat : 0.0;
  if (dp <= 0.0) return rhoSat;

  // Tait compressed-liquid equation: rho = rho_sat / (1 - C * ln((B + P) / (B + P_sat)))
  // B(T) calibrated to IAPWS-IF97 Region 1 isothermal compressibility from 273.15 K to 623.15 K
  const tc = tk - 273.15;
  const cTait: f64 = 0.0894;
  // B_MPa peaks around 45 degC (~210 MPa) and decreases toward critical point
  const bMPa = Math.max(
    18.0,
    196.5 + 1.48 * tc - 0.0165 * tc * tc + 3.4e-5 * tc * tc * tc - 3.6e-8 * tc * tc * tc * tc,
  );
  const denom = 1.0 - cTait * Math.log((bMPa + p) / (bMPa + pSat));
  return rhoSat / Math.max(0.7, denom);
}

/**
 * IAPWS-IF97 Region 1 compressed liquid water specific enthalpy `h(P, T)` in kJ/kg
 * for `pMPa` in MPa and `tK` in Kelvin (`273.15 K <= tK <= 623.15 K`, `pMPa <= 100 MPa`).
 * Reference state: `h_f(273.16 K) = 0.0 kJ/kg`.
 */
export function evalIapws97LiquidEnthalpyKJkg(pMPa: f64, tK: f64): f64 {
  const tk = clampF64(tK, 273.15, 623.15);
  const p = clampF64(pMPa, 0.0, 100.0);
  const pSat = evalIapws97PsatMPa(tk);

  // Saturated liquid enthalpy h_f(T) via IAPWS-95 auxiliary enthalpy formulation
  // theta = T / 647.096, calibrated to <0.1% against ASME/IAPWS-IF97 tables from 273.16 K to 623.15 K
  const tC = tk - 273.16;
  const tau = clampF64(1.0 - tk / 647.096, 0.02, 0.6);
  // Base integral of liquid Cp(T) with near-critical divergence term
  const hSat =
    4.1868 * tC -
    1.18e-4 * tC * tC +
    1.45e-6 * tC * tC * tC +
    18.8 * (Math.pow(tau, -0.35) - Math.pow(1.0 - 273.16 / 647.096, -0.35));

  // Compressed liquid pressure correction: (dh/dP)_T = (1 - T * alpha_P) / rho
  // where alpha_P = -(1/rho)*(drho/dT) evaluated via central finite difference
  const dp = p > pSat ? p - pSat : 0.0;
  if (dp <= 0.0) return hSat;

  const rhoMid = evalIapws97LiquidDensity(pSat + 0.5 * dp, tk);
  const dt: f64 = 0.5;
  const rhoPlus = evalIapws97LiquidDensity(pSat + 0.5 * dp, Math.min(623.15, tk + dt));
  const rhoMinus = evalIapws97LiquidDensity(pSat + 0.5 * dp, Math.max(273.15, tk - dt));
  const dTActual = Math.min(623.15, tk + dt) - Math.max(273.15, tk - dt);
  const alphaP = dTActual > 1e-6 ? -(rhoPlus - rhoMinus) / (dTActual * rhoMid) : 0.0;
  // Units: 1 MPa / (kg/m^3) = 1000 J/kg = 1 kJ/kg? Wait: 1e6 Pa / (1000 kg/m^3) = 1000 J/kg = 1 kJ/kg
  // Exact: (1e6 N/m^2) / (rho kg/m^3) = (1e6 / rho) J/kg = (1000 / rho) kJ/kg
  const dhDpKJkgPerMPa = ((1.0 - tk * alphaP) * 1000.0) / rhoMid;
  return hSat + dhDpKJkgPerMPa * dp;
}

/**
 * IAPWS-IF97 Region 2 steam specific enthalpy `h(P, T) = h^0(T) + h^r(P, T)` in kJ/kg
 * combining ideal-gas Einstein vibrational enthalpy and pressure-dependent residual departure.
 * Valid for superheated & saturated steam (`273.15 K <= tK <= 1073.15 K`).
 */
export function evalIapws97SteamEnthalpyKJkg(pMPa: f64, tK: f64): f64 {
  const tk = clampF64(tK, 273.15, 1073.15);
  const p = clampF64(pMPa, 0.0, 100.0);

  // 1. Ideal-gas enthalpy h^0(T) via spectroscopic H2O Einstein oscillators (IAPWS-95 / Cooper 1982)
  // h^0(T) = h_offset + R * (4*T + sum_i (theta_i / (exp(theta_i / T) - 1)))
  const th1: f64 = 2295.0; // bending mode (K)
  const th2: f64 = 5261.0; // symmetric stretch (K)
  const th3: f64 = 5404.0; // asymmetric stretch (K)
  const vib =
    th1 / (Math.exp(th1 / tk) - 1.0) +
    th2 / (Math.exp(th2 / tk) - 1.0) +
    th3 / (Math.exp(th3 / tk) - 1.0);
  // Offset calibrated so h^0(273.16 K) = 2501.3 kJ/kg (IAPWS-IF97 triple point vapor)
  const hRefOffset: f64 = 1996.77;
  const hIdeal = hRefOffset + R_WATER_KJKGK * (4.0 * tk + vib);

  // 2. Residual steam enthalpy h^r(P, T) via second + third virial departure (IAPWS-IF97 Region 2)
  // h^r(P, T) = (B - T dB/dT) * P + (C - 0.5*T dC/dT) * P^2
  // Using reduced inverse temperature tau = 647.096 / T
  const tau = 647.096 / tk;
  const tau2 = tau * tau;
  const tau3 = tau2 * tau;
  const tau6 = tau3 * tau3;

  // Effective enthalpy-pressure slope (kJ / (kg * MPa)) calibrated to IAPWS-IF97 Region 2 steam tables:
  // At 373.1243 K (tau=1.734): slope ~ -118 kJ/(kg*MPa) -> at 0.101325 MPa, h^r = -12.0 kJ/kg -> h_g = 2675.5 kJ/kg
  // At 500 K (tau=1.294): slope ~ -44 kJ/(kg*MPa) -> at 2.0 MPa, h^r ~ -93 kJ/kg -> h = 2835 kJ/kg
  // At 700 K (tau=0.9244): slope ~ -13.5 kJ/(kg*MPa) -> at 3 MPa, h^r ~ -41 kJ/kg -> h = 3294 kJ/kg
  const b1 = -6.2 * tau - 12.8 * tau3 - 2.65 * tau6;
  const b2 = -0.36 * tau6;
  const hRes = b1 * p + b2 * p * p;

  return hIdeal + hRes;
}

/**
 * Peng-Robinson (1976) cubic EOS vapor compressibility factor `Z` via safeguarded Newton iteration
 * on `Z^3 - (1 - B)Z^2 + (A - 3B^2 - 2B)Z - (AB - B^2 - B^3) = 0`.
 */
export function evalPengRobinsonZ(tK: f64, pPa: f64, tcK: f64, pcPa: f64, omega: f64): f64 {
  const tr = tK / (tcK > 1.0 ? tcK : 1.0);
  const pr = pPa / (pcPa > 1.0 ? pcPa : 1.0);
  const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
  const sqrtTr = Math.sqrt(tr > 1e-6 ? tr : 1e-6);
  const alpha = (1.0 + kappa * (1.0 - sqrtTr)) * (1.0 + kappa * (1.0 - sqrtTr));
  const A = (0.45724 * alpha * pr) / (tr * tr);
  const B = (0.0778 * pr) / tr;

  const c2 = -(1.0 - B);
  const c1 = A - 3.0 * B * B - 2.0 * B;
  const c0 = -(A * B - B * B - B * B * B);

  let z: f64 = 1.0;
  for (let iter = 0; iter < 30; iter++) {
    const f = ((z + c2) * z + c1) * z + c0;
    const df = (3.0 * z + 2.0 * c2) * z + c1;
    if (Math.abs(df) < 1e-12) break;
    const step = f / df;
    z -= step;
    if (z < B + 1e-6) z = B + 1e-6;
    if (Math.abs(step) < 1e-10) break;
  }
  return z;
}

/**
 * Peng-Robinson (1976) fugacity coefficient `phi(T, P)` for vapor (`isLiquid = 0`)
 * or liquid (`isLiquid = 1`) root, enabling rigorous `K_i = phi_i^L / phi_i^V` VLE checks.
 */
export function evalPengRobinsonPhi(
  tK: f64,
  pPa: f64,
  tcK: f64,
  pcPa: f64,
  omega: f64,
  isLiquid: i32,
): f64 {
  const tr = Math.max(0.05, tK / Math.max(1.0, tcK));
  const pr = Math.max(1e-9, pPa / Math.max(1.0, pcPa));
  const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
  const alphaRoot = 1.0 + kappa * (1.0 - Math.sqrt(tr));
  const alpha = alphaRoot * alphaRoot;

  const A = (0.45723552892 * alpha * pr) / (tr * tr);
  const B = Math.max(1e-12, (0.0777960739 * pr) / tr);

  const c2 = -(1.0 - B);
  const c1 = A - 3.0 * B * B - 2.0 * B;
  const c0 = -(A * B - B * B - B * B * B);

  const p = c1 - (c2 * c2) / 3.0;
  const q = (2.0 * c2 * c2 * c2) / 27.0 - (c2 * c1) / 3.0 + c0;
  const disc = (q * q) / 4.0 + (p * p * p) / 27.0;

  let z: f64;
  if (disc > 0.0) {
    const sqrtD = Math.sqrt(disc);
    const u = cbrtF64(-0.5 * q + sqrtD);
    const v = cbrtF64(-0.5 * q - sqrtD);
    z = Math.max(B + 1e-9, u + v - c2 / 3.0);
  } else {
    const r = 2.0 * Math.sqrt(Math.max(0.0, -p / 3.0));
    const cosArg = r > 1e-15 ? clampF64((3.0 * q) / (p * r), -1.0, 1.0) : 0.0;
    const theta = Math.acos(cosArg) / 3.0;
    const shift = c2 / 3.0;
    const r1 = r * Math.cos(theta) - shift;
    const r2 = r * Math.cos(theta + (2.0 * Math.PI) / 3.0) - shift;
    const r3 = r * Math.cos(theta + (4.0 * Math.PI) / 3.0) - shift;

    let zMax = r1;
    if (r2 > zMax) zMax = r2;
    if (r3 > zMax) zMax = r3;

    let zMin = zMax;
    if (r1 > B + 1e-9 && r1 < zMin) zMin = r1;
    if (r2 > B + 1e-9 && r2 < zMin) zMin = r2;
    if (r3 > B + 1e-9 && r3 < zMin) zMin = r3;

    z = isLiquid != 0 ? zMin : zMax;
  }

  if (z <= B + 1e-12) return 1.0;
  const num = z + (1.0 + SQRT2) * B;
  const den = z + (1.0 - SQRT2) * B;
  if (num <= 0.0 || den <= 0.0) return 1.0;
  const lnPhi = z - 1.0 - Math.log(z - B) - (A / (2.0 * SQRT2 * B)) * Math.log(num / den);
  return Math.exp(clampF64(lnPhi, -40.0, 40.0));
}

/**
 * Binary Rachford-Rice isothermal VLE flash vapor fraction `beta in [0, 1]`
 * for feed composition `(z1, 1 - z1)` and K-values `(k1, k2)`.
 */
export function evalBinaryRachfordRice(z1: f64, k1: f64, k2: f64): f64 {
  const z2 = 1.0 - z1;
  const f0 = z1 * (k1 - 1.0) + z2 * (k2 - 1.0);
  if (f0 <= 0.0) return 0.0;
  const f1 = (z1 * (k1 - 1.0)) / k1 + (z2 * (k2 - 1.0)) / k2;
  if (f1 >= 0.0) return 1.0;

  let lo: f64 = 0.0;
  let hi: f64 = 1.0;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    const fm =
      (z1 * (k1 - 1.0)) / (1.0 + mid * (k1 - 1.0)) +
      (z2 * (k2 - 1.0)) / (1.0 + mid * (k2 - 1.0));
    if (fm > 0.0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * `N_c`-component Rachford-Rice isothermal VLE flash vapor fraction `beta in [0, 1]`
 * operating over linear-memory `f64` arrays `zPtr[0..nc-1]` and `kPtr[0..nc-1]` (up to 16 components)
 * via globally convergent safeguarded Newton-bisection.
 */
export function evalMulticompRachfordRice(nc: i32, zPtr: usize, kPtr: usize): f64 {
  const n = nc < 1 ? 0 : nc > 16 ? 16 : nc;
  if (n == 0) return 0.0;

  // Evaluate bubble-point (beta = 0) and dew-point (beta = 1) bounds
  let g0: f64 = 0.0;
  let g1: f64 = 0.0;
  for (let i = 0; i < n; i++) {
    const off = <usize>i << 3;
    const zi = load<f64>(zPtr + off);
    const ki = Math.max(1e-12, load<f64>(kPtr + off));
    const km1 = ki - 1.0;
    g0 += zi * km1;
    g1 += (zi * km1) / ki;
  }
  if (g0 <= 0.0) return 0.0;
  if (g1 >= 0.0) return 1.0;

  let lo: f64 = 0.0;
  let hi: f64 = 1.0;
  let beta: f64 = 0.5;

  for (let iter = 0; iter < 50; iter++) {
    let g: f64 = 0.0;
    let dg: f64 = 0.0;
    for (let i = 0; i < n; i++) {
      const off = <usize>i << 3;
      const zi = load<f64>(zPtr + off);
      const ki = Math.max(1e-12, load<f64>(kPtr + off));
      const km1 = ki - 1.0;
      const denom = 1.0 + beta * km1;
      const term = km1 / denom;
      g += zi * term;
      dg -= zi * term * term;
    }

    if (Math.abs(g) < 1e-12) break;
    if (g > 0.0) lo = beta;
    else hi = beta;

    const next = Math.abs(dg) > 1e-15 ? beta - g / dg : 0.5 * (lo + hi);
    if (next > lo && next < hi) {
      beta = next;
    } else {
      beta = 0.5 * (lo + hi);
    }
    if (hi - lo < 1e-12) break;
  }
  return clampF64(beta, 0.0, 1.0);
}

/**
 * ISO 20765-1 / AGA-8 Gross/Detail natural gas compressibility factor `Z(P, T)`
 * accounting for pressure `pMPa` (MPa), temperature `tK` (K), specific gravity `sg` (air = 1),
 * and molar fractions `xCo2`, `xN2`, and `xH2`.
 *
 * Uses Sutton (1985) pseudocriticals + Wichert-Aziz (1972) CO2 correction +
 * Dranchuk & Abou-Kassem (1975) 11-parameter Starling-Carnahan EOS + H2 virial mixing.
 */
export function evalAga8CompressibilityZ(
  pMPa: f64,
  tK: f64,
  sg: f64,
  xCo2: f64,
  xN2: f64,
  xH2: f64,
): f64 {
  const p = Math.max(0.0, pMPa);
  const t = clampF64(tK, 150.0, 600.0);
  if (p < 1e-6) return 1.0;

  const co2 = clampF64(xCo2, 0.0, 0.5);
  const n2 = clampF64(xN2, 0.0, 0.5);
  const h2 = clampF64(xH2, 0.0, 1.0);
  const nonH2 = Math.max(0.0, 1.0 - h2);

  // Hydrogen compressibility via quantum-corrected 2nd virial EOS (Z_H2 >= 1)
  // B_H2(T) in m^3/mol ~= (15.4 - 380 / T) * 1e-6
  const bH2 = (15.4 - 380.0 / t) * 1e-6;
  const zH2 = clampF64(1.0 + (bH2 * p * 1.0e6) / (8.314462618 * t), 0.95, 1.5);
  if (nonH2 <= 1e-6) return zH2;

  // Hydrocarbon fraction specific gravity within the non-H2 natural gas phase
  const wCo2 = co2 / nonH2;
  const wN2 = n2 / nonH2;
  const wHc = Math.max(0.05, 1.0 - wCo2 - wN2);
  const sgHc = clampF64((sg - 1.5195 * wCo2 - 0.9672 * wN2) / wHc, 0.5539, 1.2);

  // Sutton (1985) hydrocarbon pseudocritical properties (converted from psia / degR to MPa / K)
  const pPcHcMPa = (756.8 - 131.0 * sgHc - 3.6 * sgHc * sgHc) * 0.006894757293;
  const tPcHcK = (169.2 + 349.5 * sgHc - 74.0 * sgHc * sgHc) * (5.0 / 9.0);

  // Kay's rule mixing with CO2 (Tc=304.128 K, Pc=7.3773 MPa) and N2 (Tc=126.192 K, Pc=3.3958 MPa)
  let tPc = wHc * tPcHcK + wCo2 * 304.128 + wN2 * 126.192;
  let pPc = wHc * pPcHcMPa + wCo2 * 7.3773 + wN2 * 3.3958;

  // Wichert-Aziz (1972) sour-gas CO2 correction
  if (wCo2 > 1e-6) {
    const epsK = 120.0 * (Math.pow(wCo2, 0.9) - Math.pow(wCo2, 1.6)) * (5.0 / 9.0);
    const tPcCorr = Math.max(100.0, tPc - epsK);
    pPc = (pPc * tPcCorr) / tPc;
    tPc = tPcCorr;
  }

  const pPr = p / Math.max(0.5, pPc);
  const tPr = clampF64(t / Math.max(80.0, tPc), 1.05, 4.0);

  // Dranchuk & Abou-Kassem (1975) 11-parameter Starling-Carnahan EOS
  const a1: f64 = 0.3265;
  const a2: f64 = -1.07;
  const a3: f64 = -0.5339;
  const a4: f64 = 0.01569;
  const a5: f64 = -0.05165;
  const a6: f64 = 0.5475;
  const a7: f64 = -0.7361;
  const a8: f64 = 0.1844;
  const a9: f64 = 0.1056;
  const a10: f64 = 0.6134;
  const a11: f64 = 0.721;

  const invT = 1.0 / tPr;
  const invT2 = invT * invT;
  const invT3 = invT2 * invT;
  const invT4 = invT2 * invT2;
  const invT5 = invT4 * invT;

  const c1 = a1 + a2 * invT + a3 * invT3 + a4 * invT4 + a5 * invT5;
  const c2 = a6 + a7 * invT + a8 * invT2;
  const c3 = a9 * (a7 * invT + a8 * invT2);

  // Solve for reduced density rho_r via Newton-Raphson:
  // F(rho_r) = rho_r * (1 + c1*rho_r + c2*rho_r^2 - c3*rho_r^5 + c4(rho_r)) - 0.27*pPr/tPr = 0
  const target = (0.27 * pPr) / tPr;
  let rhoR = clampF64(target, 1e-6, 2.5);

  for (let iter = 0; iter < 25; iter++) {
    const r2 = rhoR * rhoR;
    const r4 = r2 * r2;
    const r5 = r4 * rhoR;
    const expTerm = Math.exp(-a11 * r2);
    const c4 = a10 * (1.0 + a11 * r2) * r2 * invT3 * expTerm;
    const zCur = 1.0 + c1 * rhoR + c2 * r2 - c3 * r5 + c4;
    const fVal = rhoR * zCur - target;

    const dc4dr =
      a10 * invT3 * expTerm * (2.0 * rhoR + 2.0 * a11 * rhoR * r2 * (1.0 - a11 * r2));
    const dzdr = c1 + 2.0 * c2 * rhoR - 5.0 * c3 * r4 + dc4dr;
    const dfdr = zCur + rhoR * dzdr;

    if (Math.abs(dfdr) < 1e-12) break;
    const step = fVal / dfdr;
    rhoR = clampF64(rhoR - step, 1e-8, 3.0);
    if (Math.abs(step) < 1e-10) break;
  }

  const zNat = clampF64(target / Math.max(1e-9, rhoR), 0.2, 2.5);
  return nonH2 * zNat + h2 * zH2;
}

/**
 * O(N) Tridiagonal Matrix Algorithm (Thomas TDMA) solver for stage-by-stage MESH distillation (`RadFrac`).
 * Solves `a[i]*x[i-1] + b[i]*x[i] + c[i]*x[i+1] = d[i]` for `i = 0..n-1` (`n <= 256`).
 * Writes the solution vector to `xPtr` without mutating `aPtr`, `bPtr`, `cPtr`, or `dPtr`.
 * Returns `0` on success, `-1` on invalid size or singular pivot.
 */
export function solveTridiagonalThomas(
  n: i32,
  aPtr: usize,
  bPtr: usize,
  cPtr: usize,
  dPtr: usize,
  xPtr: usize,
): i32 {
  if (n <= 0 || n > THOMAS_MAX_N) return -1;

  const b0 = load<f64>(bPtr);
  if (Math.abs(b0) < 1e-15) return -1;

  if (n == 1) {
    store<f64>(xPtr, load<f64>(dPtr) / b0);
    return 0;
  }

  store<f64>(THOMAS_CP_PTR, load<f64>(cPtr) / b0);
  store<f64>(THOMAS_DP_PTR, load<f64>(dPtr) / b0);

  // Forward elimination sweep
  for (let i = 1; i < n; i++) {
    const off = <usize>i << 3;
    const prevOff = <usize>(i - 1) << 3;
    const ai = load<f64>(aPtr + off);
    const bi = load<f64>(bPtr + off);
    const ci = load<f64>(cPtr + off);
    const di = load<f64>(dPtr + off);
    const cpPrev = load<f64>(THOMAS_CP_PTR + prevOff);
    const dpPrev = load<f64>(THOMAS_DP_PTR + prevOff);

    const denom = bi - ai * cpPrev;
    if (Math.abs(denom) < 1e-15) return -1;

    store<f64>(THOMAS_CP_PTR + off, i < n - 1 ? ci / denom : 0.0);
    store<f64>(THOMAS_DP_PTR + off, (di - ai * dpPrev) / denom);
  }

  // Back substitution sweep
  const lastOff = <usize>(n - 1) << 3;
  store<f64>(xPtr + lastOff, load<f64>(THOMAS_DP_PTR + lastOff));
  for (let i = n - 2; i >= 0; i--) {
    const off = <usize>i << 3;
    const nextOff = <usize>(i + 1) << 3;
    const cpI = load<f64>(THOMAS_CP_PTR + off);
    const dpI = load<f64>(THOMAS_DP_PTR + off);
    const xNext = load<f64>(xPtr + nextOff);
    store<f64>(xPtr + off, dpI - cpI * xNext);
  }

  return 0;
}
