// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — AssemblyScript WebAssembly Kernel for Point Reactor Kinetics (PRKE).
 *
 * Implements 6-group delayed neutron precursor kinetics coupled with Doppler fuel
 * feedback and moderator thermal-hydraulic temperature feedback directly in linear memory.
 */

const SCRATCH_BASE: usize = 1024;
const STATE_BASE: usize = SCRATCH_BASE; // 9 f64s (72 bytes)
const PARAMS_BASE: usize = STATE_BASE + 72; // 10 f64s (80 bytes)
const DECAY_BASE: usize = PARAMS_BASE + 80; // 6 f64s (48 bytes)
const FRACTION_BASE: usize = DECAY_BASE + 48; // 6 f64s (48 bytes)
const K1_BASE: usize = FRACTION_BASE + 48; // 9 f64s (72 bytes)
const K2_BASE: usize = K1_BASE + 72; // 9 f64s (72 bytes)
const K3_BASE: usize = K2_BASE + 72; // 9 f64s (72 bytes)
const K4_BASE: usize = K3_BASE + 72; // 9 f64s (72 bytes)
const Y_TEMP_BASE: usize = K4_BASE + 72; // 9 f64s (72 bytes)
const METRICS_BASE: usize = Y_TEMP_BASE + 72; // 4 f64s (32 bytes)
const TRAJECTORY_BASE: usize = 2048; // Output trajectory buffer

export function point_kinetics_get_scratch_base(): usize {
  return SCRATCH_BASE;
}

export function point_kinetics_get_trajectory_base(): usize {
  return TRAJECTORY_BASE;
}

export function point_kinetics_init(
  lambda: f64,
  beta: f64,
  p0: f64,
  tfuel0: f64,
  tmod0: f64,
  cfuel: f64,
  cmod: f64,
  ua: f64,
  alphaF: f64,
  alphaM: f64,
): void {
  store<f64>(PARAMS_BASE + 0 * 8, lambda);
  store<f64>(PARAMS_BASE + 1 * 8, beta);
  store<f64>(PARAMS_BASE + 2 * 8, p0);
  store<f64>(PARAMS_BASE + 3 * 8, tfuel0);
  store<f64>(PARAMS_BASE + 4 * 8, tmod0);
  store<f64>(PARAMS_BASE + 5 * 8, cfuel);
  store<f64>(PARAMS_BASE + 6 * 8, cmod);
  store<f64>(PARAMS_BASE + 7 * 8, ua);
  store<f64>(PARAMS_BASE + 8 * 8, alphaF);
  store<f64>(PARAMS_BASE + 9 * 8, alphaM);

  // Initial states: n = 1.0, Tf = tfuel0, Tm = tmod0
  store<f64>(STATE_BASE + 0 * 8, 1.0);
  store<f64>(STATE_BASE + 7 * 8, tfuel0);
  store<f64>(STATE_BASE + 8 * 8, tmod0);

  // Equilibrium precursors: C_i = fraction_i / (lambda * decay_i)
  for (let i: usize = 0; i < 6; i++) {
    const dec = load<f64>(DECAY_BASE + i * 8);
    const frac = load<f64>(FRACTION_BASE + i * 8);
    const cEq = dec > 0.0 ? frac / (lambda * dec) : 0.0;
    store<f64>(STATE_BASE + (1 + i) * 8, cEq);
  }

  // Init metrics
  store<f64>(METRICS_BASE + 0 * 8, p0 / 1e6); // peakPowerMW
  store<f64>(METRICS_BASE + 1 * 8, tfuel0); // peakFuelTempK
  store<f64>(METRICS_BASE + 2 * 8, p0 / 1e6); // finalPowerMW
}

export function point_kinetics_set_delayed_group(groupIndex: i32, decay: f64, fraction: f64): void {
  if (groupIndex >= 0 && groupIndex < 6) {
    store<f64>(DECAY_BASE + (<usize>groupIndex) * 8, decay);
    store<f64>(FRACTION_BASE + (<usize>groupIndex) * 8, fraction);
  }
}

function compute_derivatives(yBase: usize, outBase: usize, curRho: f64): void {
  const lambda = load<f64>(PARAMS_BASE + 0 * 8);
  const beta = load<f64>(PARAMS_BASE + 1 * 8);
  const p0 = load<f64>(PARAMS_BASE + 2 * 8);
  const cfuel = load<f64>(PARAMS_BASE + 5 * 8);
  const cmod = load<f64>(PARAMS_BASE + 6 * 8);
  const ua = load<f64>(PARAMS_BASE + 7 * 8);

  const curN = load<f64>(yBase + 0 * 8);
  const curTf = load<f64>(yBase + 7 * 8);
  const curTm = load<f64>(yBase + 8 * 8);

  let sumDecay: f64 = 0.0;
  for (let i: usize = 0; i < 6; i++) {
    const decay = load<f64>(DECAY_BASE + i * 8);
    const cVal = load<f64>(yBase + (1 + i) * 8);
    sumDecay += decay * cVal;

    const frac = load<f64>(FRACTION_BASE + i * 8);
    const dCi = (frac / lambda) * curN - decay * cVal;
    store<f64>(outBase + (1 + i) * 8, dCi);
  }

  const dn = ((curRho - beta) / lambda) * curN + sumDecay;
  store<f64>(outBase + 0 * 8, dn);

  const qTrans = ua * (curTf - curTm);
  const dTf = (p0 * curN - qTrans) / cfuel;
  const dTm = (qTrans - p0 * curN * 0.95) / cmod;

  store<f64>(outBase + 7 * 8, dTf);
  store<f64>(outBase + 8 * 8, dTm);
}

export function point_kinetics_rk4_step(dt: f64, rho: f64): void {
  // 1. k1 = deriv(state, rho)
  compute_derivatives(STATE_BASE, K1_BASE, rho);

  // 2. y_temp = state + 0.5 * dt * k1
  const halfDt: f64 = 0.5 * dt;
  const n_half1: f64 = load<f64>(STATE_BASE + 0 * 8) + halfDt * load<f64>(K1_BASE + 0 * 8);
  store<f64>(Y_TEMP_BASE + 0 * 8, n_half1 > 0.0 ? n_half1 : 0.0);

  for (let i: usize = 0; i < 6; i++) {
    const cVal = load<f64>(STATE_BASE + (1 + i) * 8) + halfDt * load<f64>(K1_BASE + (1 + i) * 8);
    store<f64>(Y_TEMP_BASE + (1 + i) * 8, cVal > 0.0 ? cVal : 0.0);
  }
  store<f64>(Y_TEMP_BASE + 7 * 8, load<f64>(STATE_BASE + 7 * 8) + halfDt * load<f64>(K1_BASE + 7 * 8));
  store<f64>(Y_TEMP_BASE + 8 * 8, load<f64>(STATE_BASE + 8 * 8) + halfDt * load<f64>(K1_BASE + 8 * 8));

  // 3. k2 = deriv(y_temp, rho)
  compute_derivatives(Y_TEMP_BASE, K2_BASE, rho);

  // 4. y_temp = state + 0.5 * dt * k2
  const n_half2: f64 = load<f64>(STATE_BASE + 0 * 8) + halfDt * load<f64>(K2_BASE + 0 * 8);
  store<f64>(Y_TEMP_BASE + 0 * 8, n_half2 > 0.0 ? n_half2 : 0.0);

  for (let i: usize = 0; i < 6; i++) {
    const cVal = load<f64>(STATE_BASE + (1 + i) * 8) + halfDt * load<f64>(K2_BASE + (1 + i) * 8);
    store<f64>(Y_TEMP_BASE + (1 + i) * 8, cVal > 0.0 ? cVal : 0.0);
  }
  store<f64>(Y_TEMP_BASE + 7 * 8, load<f64>(STATE_BASE + 7 * 8) + halfDt * load<f64>(K2_BASE + 7 * 8));
  store<f64>(Y_TEMP_BASE + 8 * 8, load<f64>(STATE_BASE + 8 * 8) + halfDt * load<f64>(K2_BASE + 8 * 8));

  // 5. k3 = deriv(y_temp, rho)
  compute_derivatives(Y_TEMP_BASE, K3_BASE, rho);

  // 6. y_temp = state + dt * k3
  const n_full: f64 = load<f64>(STATE_BASE + 0 * 8) + dt * load<f64>(K3_BASE + 0 * 8);
  store<f64>(Y_TEMP_BASE + 0 * 8, n_full > 0.0 ? n_full : 0.0);

  for (let i: usize = 0; i < 6; i++) {
    const cVal = load<f64>(STATE_BASE + (1 + i) * 8) + dt * load<f64>(K3_BASE + (1 + i) * 8);
    store<f64>(Y_TEMP_BASE + (1 + i) * 8, cVal > 0.0 ? cVal : 0.0);
  }
  store<f64>(Y_TEMP_BASE + 7 * 8, load<f64>(STATE_BASE + 7 * 8) + dt * load<f64>(K3_BASE + 7 * 8));
  store<f64>(Y_TEMP_BASE + 8 * 8, load<f64>(STATE_BASE + 8 * 8) + dt * load<f64>(K3_BASE + 8 * 8));

  // 7. k4 = deriv(y_temp, rho)
  compute_derivatives(Y_TEMP_BASE, K4_BASE, rho);

  // 8. Update state = state + (dt / 6) * (k1 + 2*k2 + 2*k3 + k4)
  const dt6: f64 = dt / 6.0;
  const n_new: f64 =
    load<f64>(STATE_BASE + 0 * 8) +
    dt6 *
      (load<f64>(K1_BASE + 0 * 8) +
        2.0 * load<f64>(K2_BASE + 0 * 8) +
        2.0 * load<f64>(K3_BASE + 0 * 8) +
        load<f64>(K4_BASE + 0 * 8));
  store<f64>(STATE_BASE + 0 * 8, n_new > 0.0 ? n_new : 0.0);

  for (let i: usize = 0; i < 6; i++) {
    const c_new: f64 =
      load<f64>(STATE_BASE + (1 + i) * 8) +
      dt6 *
        (load<f64>(K1_BASE + (1 + i) * 8) +
          2.0 * load<f64>(K2_BASE + (1 + i) * 8) +
          2.0 * load<f64>(K3_BASE + (1 + i) * 8) +
          load<f64>(K4_BASE + (1 + i) * 8));
    store<f64>(STATE_BASE + (1 + i) * 8, c_new > 0.0 ? c_new : 0.0);
  }

  const tf_new: f64 =
    load<f64>(STATE_BASE + 7 * 8) +
    dt6 *
      (load<f64>(K1_BASE + 7 * 8) +
        2.0 * load<f64>(K2_BASE + 7 * 8) +
        2.0 * load<f64>(K3_BASE + 7 * 8) +
        load<f64>(K4_BASE + 7 * 8));
  store<f64>(STATE_BASE + 7 * 8, tf_new);

  const tm_new: f64 =
    load<f64>(STATE_BASE + 8 * 8) +
    dt6 *
      (load<f64>(K1_BASE + 8 * 8) +
        2.0 * load<f64>(K2_BASE + 8 * 8) +
        2.0 * load<f64>(K3_BASE + 8 * 8) +
        load<f64>(K4_BASE + 8 * 8));
  store<f64>(STATE_BASE + 8 * 8, tm_new);
}

export function point_kinetics_simulate(
  duration: f64,
  dt: f64,
  extRho0: f64,
  scramTime: f64,
  sampleInterval: f64,
): i32 {
  const p0 = load<f64>(PARAMS_BASE + 2 * 8);
  const tfuel0 = load<f64>(PARAMS_BASE + 3 * 8);
  const tmod0 = load<f64>(PARAMS_BASE + 4 * 8);
  const alphaF = load<f64>(PARAMS_BASE + 8 * 8);
  const alphaM = load<f64>(PARAMS_BASE + 9 * 8);
  const p0_MW = p0 / 1e6;

  let peakPowerMW: f64 = p0_MW;
  let peakFuelTempK: f64 = tfuel0;

  const totalSteps: i32 = <i32>Math.ceil(duration / dt);
  const sampleSteps: i32 = <i32>Math.max(1.0, Math.floor(sampleInterval / dt));

  let sampleCount: i32 = 0;
  const RECORD_SIZE: usize = 12 * 8; // 96 bytes

  for (let step: i32 = 0; step <= totalSteps; step++) {
    const t: f64 = (<f64>step) * dt;

    const n = load<f64>(STATE_BASE + 0 * 8);
    const tfuel = load<f64>(STATE_BASE + 7 * 8);
    const tmod = load<f64>(STATE_BASE + 8 * 8);

    // Reactivity calculation: rho = ext + scram + Doppler + MTC
    let rho: f64 = extRho0;
    if (t >= scramTime) {
      rho -= 0.05; // -5000 pcm negative SCRAM insertion
    }
    const deltaTfuel = tfuel - tfuel0;
    const deltaTmod = tmod - tmod0;
    rho += alphaF * deltaTfuel;
    rho += alphaM * deltaTmod;

    const currentPowerMW = n * p0_MW;
    if (currentPowerMW > peakPowerMW) peakPowerMW = currentPowerMW;
    if (tfuel > peakFuelTempK) peakFuelTempK = tfuel;

    // Sample recording
    if (step % sampleSteps == 0 || step == totalSteps) {
      const recPtr = TRAJECTORY_BASE + (<usize>sampleCount) * RECORD_SIZE;
      store<f64>(recPtr + 0 * 8, t);
      store<f64>(recPtr + 1 * 8, n);
      store<f64>(recPtr + 2 * 8, currentPowerMW);
      store<f64>(recPtr + 3 * 8, rho * 1e5); // reactivityPcm
      store<f64>(recPtr + 4 * 8, tfuel);
      store<f64>(recPtr + 5 * 8, tmod);
      for (let i: usize = 0; i < 6; i++) {
        store<f64>(recPtr + (6 + i) * 8, load<f64>(STATE_BASE + (1 + i) * 8));
      }
      sampleCount++;
    }

    if (step < totalSteps) {
      point_kinetics_rk4_step(dt, rho);
    }
  }

  const finalN = load<f64>(STATE_BASE + 0 * 8);
  store<f64>(METRICS_BASE + 0 * 8, peakPowerMW);
  store<f64>(METRICS_BASE + 1 * 8, peakFuelTempK);
  store<f64>(METRICS_BASE + 2 * 8, finalN * p0_MW);

  return sampleCount;
}

export function point_kinetics_get_peak_power_mw(): f64 {
  return load<f64>(METRICS_BASE + 0 * 8);
}

export function point_kinetics_get_peak_fuel_temp_k(): f64 {
  return load<f64>(METRICS_BASE + 1 * 8);
}

export function point_kinetics_get_final_power_mw(): f64 {
  return load<f64>(METRICS_BASE + 2 * 8);
}
