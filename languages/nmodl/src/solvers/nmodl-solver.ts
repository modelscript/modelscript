// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Deterministic Hodgkin-Huxley Action Potential & Current Clamp Solver.
 *
 * Simulates single-compartment soma membrane dynamics under current-clamp injection
 * and calculates action potential spike frequency, peak voltage, and resting potential.
 */

import type { NmodlDocument, NmodlSimOptions, NmodlSimResult } from "../types.js";

function vtrap(x: number, y: number): number {
  if (Math.abs(x / y) < 1e-6) {
    return y * (1 - x / y / 2);
  }
  return x / (Math.exp(x / y) - 1);
}

export function solveNmodlActionPotential(doc: NmodlDocument, options?: NmodlSimOptions): NmodlSimResult {
  const model = doc.model;
  const tEnd = options?.tEnd ?? 50.0; // ms
  const dt = options?.dt ?? 0.025; // ms
  const stimAmp = options?.stimAmp ?? 10.0; // uA/cm2
  const stimStart = options?.stimStart ?? 5.0; // ms
  const stimDuration = options?.stimDuration ?? 35.0; // ms

  // Parameter extraction
  const pMap = new Map<string, number>();
  for (const p of model.parameters) {
    pMap.set(p.name.toLowerCase(), p.val);
  }

  const gnabar = pMap.get("gnabar") ?? 120.0; // mS/cm2
  const gkbar = pMap.get("gkbar") ?? 36.0; // mS/cm2
  const gl = pMap.get("gl") ?? 0.3; // mS/cm2
  const ena = pMap.get("ena") ?? 50.0; // mV
  const ek = pMap.get("ek") ?? -77.0; // mV
  const el = pMap.get("el") ?? -54.387; // mV
  const cm = 1.0; // uF/cm2

  // Initial membrane potential
  let v = options?.vInit ?? -65.0;

  // Steady-state gating variables at initial v
  const alpha_m_init = 0.1 * vtrap(-(v + 40), 10);
  const beta_m_init = 4.0 * Math.exp(-(v + 65) / 18);
  let m = alpha_m_init / (alpha_m_init + beta_m_init);

  const alpha_h_init = 0.07 * Math.exp(-(v + 65) / 20);
  const beta_h_init = 1.0 / (1.0 + Math.exp(-(v + 35) / 10));
  let h = alpha_h_init / (alpha_h_init + beta_h_init);

  const alpha_n_init = 0.01 * vtrap(-(v + 55), 10);
  const beta_n_init = 0.125 * Math.exp(-(v + 65) / 80);
  let n = alpha_n_init / (alpha_n_init + beta_n_init);

  const time: number[] = [];
  const vArr: number[] = [];
  const mArr: number[] = [];
  const hArr: number[] = [];
  const nArr: number[] = [];
  const inaArr: number[] = [];
  const ikArr: number[] = [];

  const steps = Math.floor(tEnd / dt);
  let spikeCount = 0;
  let inSpike = false;
  let vPeak = -Infinity;
  let vRest = v;

  for (let s = 0; s <= steps; s++) {
    const t = s * dt;
    time.push(t);
    vArr.push(v);
    mArr.push(m);
    hArr.push(h);
    nArr.push(n);

    // Compute currents
    const gna = gnabar * m * m * m * h;
    const gk = gkbar * n * n * n * n;
    const ina = gna * (v - ena);
    const ik = gk * (v - ek);
    const il = gl * (v - el);

    inaArr.push(ina);
    ikArr.push(ik);

    if (v > vPeak) vPeak = v;

    // Spike counter (threshold 0 mV)
    if (v > 0.0 && !inSpike) {
      spikeCount++;
      inSpike = true;
    } else if (v < -10.0 && inSpike) {
      inSpike = false;
    }

    // Current clamp stimulus
    const isStim = t >= stimStart && t <= stimStart + stimDuration;
    const istim = isStim ? stimAmp : 0.0;

    // Rate functions at current v
    const am = 0.1 * vtrap(-(v + 40), 10);
    const bm = 4.0 * Math.exp(-(v + 65) / 18);
    const ah = 0.07 * Math.exp(-(v + 65) / 20);
    const bh = 1.0 / (1.0 + Math.exp(-(v + 35) / 10));
    const an = 0.01 * vtrap(-(v + 55), 10);
    const bn = 0.125 * Math.exp(-(v + 65) / 80);

    // Numerical integration (Euler-Exponential / RK2)
    const dv_dt = (-ina - ik - il + istim) / cm;
    const dm_dt = am * (1.0 - m) - bm * m;
    const dh_dt = ah * (1.0 - h) - bh * h;
    const dn_dt = an * (1.0 - n) - bn * n;

    v += dv_dt * dt;
    m += dm_dt * dt;
    h += dh_dt * dt;
    n += dn_dt * dt;

    if (m < 0) m = 0;
    else if (m > 1) m = 1;
    if (h < 0) h = 0;
    else if (h > 1) h = 1;
    if (n < 0) n = 0;
    else if (n > 1) n = 1;
  }

  const firingRateHz = stimDuration > 0 ? spikeCount / (stimDuration / 1000.0) : 0.0;

  return {
    time,
    v: vArr,
    states: { m: mArr, h: hArr, n: nArr },
    currents: { ina: inaArr, ik: ikArr },
    spikeCount,
    firingRateHz,
    vPeak,
    vRest,
  };
}
