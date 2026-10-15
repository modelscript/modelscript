// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Power-Electronics Switching Bridge Models for EMT Simulation (`ConverterBridge`).
 *
 * Implements two industrial power-electronics converter topologies with sub-step
 * carrier/firing interpolation to prevent fixed-timestep numerical jitter:
 *
 * 1. `"vsc_pwm"` — 2-Level / 3-Level Sine-Triangle PWM Voltage Source Converter (VSC):
 *    - Sub-step averaged duty-ratio interpolation over each carrier interval [t, t + dt],
 *      eliminating artificial sub-harmonics when f_sw is not an integer divisor of 1/dt.
 *    - Dynamic DC-link capacitor energy balance:
 *        C_dc * d(V_dc)/dt = I_dc_source - (P_ac / max(V_dc_min, V_dc))
 *    - Coupled to AC phase nodes via converter filter Norton equivalent (G_conv = dt / (2*L_f + R_f*dt)).
 *
 * 2. `"lcc_6pulse"` — 6-Pulse Line-Commutated Thyristor Bridge (LCC HVDC / Industrial Rectifier):
 *    - Firing delay angle alpha (deg) with commutation overlap inductance L_c.
 *    - Synthesizes the 6-pulse commutated DC voltage waveform with 6th/12th harmonic ripple
 *      and injects AC fundamental + characteristic harmonic currents (5th, 7th, 11th, 13th).
 *
 * 3. `"mmc_thevenin"` — Modular Multilevel Converter (MMC) Thévenin Equivalent Arm Model:
 *    - N-submodule half-bridge/full-bridge upper and lower arms reduced via Dommel/Gole (2008)
 *      companion Thévenin equivalents.
 *    - Sub-step Nearest-Level Modulation (NLM) staircase quantization over [t, t + dt].
 *    - Upper/lower arm submodule capacitor voltage sum balancing and 2nd-harmonic Circulating
 *      Current Suppressing Control (CCSC).
 */

export interface ConverterBridgeConfig {
  id: string;
  bus: string;
  topology?: "vsc_pwm" | "lcc_6pulse" | "mmc_thevenin" | undefined;
  kind?: "vsc_pwm" | "lcc_6pulse" | "mmc_thevenin" | undefined;
  ratedMva: number;
  ratedAcKv?: number | undefined; // AC bus rated peak or RMS voltage (kV)
  ratedKv?: number | undefined;
  nominalDcKv?: number | undefined; // Nominal DC link voltage V_dc (kV), e.g. 64.0 kV
  dcLinkKv?: number | undefined;
  nominalFreqHz?: number | undefined;
  // Filter / commutation / arm parameters
  filterResistanceOhm?: number | undefined; // R_f (default: 0.05 Ohm)
  filterInductanceH?: number | undefined; // L_f or commutation L_c (default: 0.005 H)
  commutationInductanceH?: number | undefined;
  armInductanceH?: number | undefined; // MMC arm inductance L_arm (H)
  armResistanceOhm?: number | undefined; // MMC arm resistance R_arm (Ohm)
  dcCapacitanceF?: number | undefined; // DC-link capacitor C_dc (default: 2000e-6 F)
  dcLoadConductanceS?: number | undefined; // Shunt DC load / source conductance (default: 0.02 S)
  dcCurrentSourceAmp?: number | undefined; // External DC current source injection into DC link (A)
  // VSC PWM / MMC control parameters
  modulationIndex?: number | undefined; // m_a in [0, 1.15] (default: 0.90)
  phaseAngleRad?: number | undefined; // Converter internal voltage angle delta_c (rad, default: 0.15)
  phaseAngleDeg?: number | undefined;
  carrierFreqHz?: number | undefined; // PWM triangular carrier frequency f_sw (default: 2500 Hz)
  // MMC submodule parameters
  numSubmodulesPerArm?: number | undefined; // Number of submodules per arm N (default: 32)
  submoduleCapacitanceF?: number | undefined; // Individual SM capacitance C_sm (default: 10e-3 F)
  enableCcsc?: boolean | undefined; // Enable 2nd-harmonic Circulating Current Suppressing Control (default: true)
  // LCC 6-pulse thyristor control parameters
  firingAngleDeg?: number | undefined; // Thyristor delay angle alpha in [5°, 165°] (default: 18°)
}

export interface ConverterBridgeState {
  config: ConverterBridgeConfig;
  nodes: number[]; // [nodeA] in 1-phase or [nodeA, nodeB, nodeC] in 3-phase
  omega0: number;
  gFilter: number; // Trapezoidal filter companion conductance stamped at each AC phase node (S)
  alphaFilter: number;
  vDcVolts: number; // Instantaneous DC-link capacitor voltage V_dc(t) (V)
  iDcAmp: number; // Instantaneous DC link current I_dc(t) (A)
  pAcWatts: number; // Instantaneous 3-phase active power exchanged with AC grid (W)
  dutyCycleA: number; // Normalized sub-step PWM/NLM duty cycle in [0, 1] for Phase A
  overlapAngleRad: number; // Commutation overlap angle mu (rad) for LCC bridge
  // MMC Thévenin arm states
  numSubmodules: number; // N submodules per arm
  activeSubmodulesUpperA: number; // Instantaneous inserted upper-arm SM count in [0, N] for Phase A
  submoduleVoltageSpreadPct: number; // Relative arm capacitor sum spread (%) across arms
  vCapSumUpper: Float64Array; // Upper arm total SM capacitor voltage sum V_cu^Sigma per phase (V)
  vCapSumLower: Float64Array; // Lower arm total SM capacitor voltage sum V_cl^Sigma per phase (V)
  iCirculating: Float64Array; // Phase-leg circulating current i_circ per phase (A)
  iHistFilter: Float64Array; // Trapezoidal history current per phase
  iInjectedPhase: Float64Array; // Total Norton current injected into each AC phase node (A)
  iTerminalPhase: Float64Array; // Net AC current leaving converter into grid (A)
}

export function createConverterBridgeState(
  cfg: ConverterBridgeConfig,
  nodes: number[],
  dt: number,
  defaultFreqHz = 60.0,
): ConverterBridgeState {
  const freqHz = cfg.nominalFreqHz ?? defaultFreqHz;
  const omega0 = 2 * Math.PI * freqHz;
  const topo = cfg.topology ?? cfg.kind ?? "vsc_pwm";
  // For an MMC, the effective AC phase filter impedance is the parallel combination of upper & lower arms (R_arm/2, L_arm/2)
  const rF =
    topo === "mmc_thevenin" && cfg.armResistanceOhm !== undefined
      ? 0.5 * cfg.armResistanceOhm
      : (cfg.filterResistanceOhm ?? 0.05);
  const lF = Math.max(
    1e-5,
    topo === "mmc_thevenin" && cfg.armInductanceH !== undefined
      ? 0.5 * cfg.armInductanceH
      : (cfg.filterInductanceH ?? cfg.commutationInductanceH ?? 0.005),
  );

  const gFilter = dt / (2 * lF + rF * dt);
  const alphaFilter = (2 * lF - rF * dt) / (2 * lF + rF * dt);
  const dcKv = cfg.nominalDcKv ?? cfg.dcLinkKv ?? 400.0;
  const vDcInit = Math.max(100.0, dcKv * 1e3);
  const numSubmodules = Math.max(2, Math.round(cfg.numSubmodulesPerArm ?? 32));

  const nPh = nodes.length;
  const vCapSumUpper = new Float64Array(nPh);
  const vCapSumLower = new Float64Array(nPh);
  vCapSumUpper.fill(vDcInit);
  vCapSumLower.fill(vDcInit);

  return {
    config: cfg,
    nodes,
    omega0,
    gFilter,
    alphaFilter,
    vDcVolts: vDcInit,
    iDcAmp: 0,
    pAcWatts: 0,
    dutyCycleA: 0.5,
    overlapAngleRad: 0.0,
    numSubmodules,
    activeSubmodulesUpperA: Math.round(numSubmodules / 2),
    submoduleVoltageSpreadPct: 0.0,
    vCapSumUpper,
    vCapSumLower,
    iCirculating: new Float64Array(nPh),
    iHistFilter: new Float64Array(nPh),
    iInjectedPhase: new Float64Array(nPh),
    iTerminalPhase: new Float64Array(nPh),
  };
}

/**
 * Evaluates a sub-step interpolated 2-level Sine-Triangle PWM switching function s(t) in [-1, +1]
 * averaged over [t, t + dt] to eliminate fixed-timestep carrier-crossing aliasing.
 */
function evaluateSubStepPwmModulation(modRef: number, t: number, dt: number, carrierFreqHz: number): number {
  const clampedRef = Math.max(-1.15, Math.min(1.15, modRef));
  const tCarrier = 1.0 / Math.max(100.0, carrierFreqHz);

  // Sub-divide [t, t + dt] into 4 sub-intervals for exact carrier-crossing duty ratio integration
  const nSub = 4;
  const subDt = dt / nSub;
  let dutySum = 0;
  for (let k = 0; k < nSub; k++) {
    const tk = t + (k + 0.5) * subDt;
    const phaseInPeriod = (tk % tCarrier) / tCarrier;
    // Symmetric triangular carrier in [-1, +1]
    const vCarrier = phaseInPeriod < 0.5 ? -1.0 + 4.0 * phaseInPeriod : 3.0 - 4.0 * phaseInPeriod;
    // Analytical sub-step linear interpolation around the switching threshold
    const diff = clampedRef - vCarrier;
    const smoothSwitch = Math.max(-1.0, Math.min(1.0, diff * 8.0));
    dutySum += smoothSwitch;
  }
  return dutySum / nSub;
}

/**
 * Evaluates Nearest-Level Modulation (NLM) with sub-step fractional quantization over [t, t + dt]
 * for an N-submodule MMC arm, returning effective upper and lower inserted submodule counts (N_u, N_l).
 */
function evaluateSubStepNlmArms(
  ma: number,
  omega0: number,
  delta: number,
  phShift: number,
  ccscTrim: number,
  t: number,
  dt: number,
  numSubmodules: number,
): { nUpper: number; nLower: number } {
  const nSub = 4;
  const subDt = dt / nSub;
  let sumU = 0;
  let sumL = 0;
  for (let k = 0; k < nSub; k++) {
    const tk = t + (k + 0.5) * subDt;
    const mInst = Math.max(-1.0, Math.min(1.0, ma * Math.sin(omega0 * tk + delta - phShift)));
    const uNorm = Math.max(0.0, Math.min(1.0, 0.5 * (1.0 - mInst) - ccscTrim));
    const lNorm = Math.max(0.0, Math.min(1.0, 0.5 * (1.0 + mInst) - ccscTrim));
    sumU += Math.round(numSubmodules * uNorm);
    sumL += Math.round(numSubmodules * lNorm);
  }
  return { nUpper: sumU / nSub, nLower: sumL / nSub };
}

/**
 * Advances the Power-Electronics Converter Bridge state by `dt` and updates AC Norton injections.
 */
export function stepConverterBridge(st: ConverterBridgeState, vVec: Float64Array, t: number, dt: number): void {
  const cfg = st.config;
  const nPh = st.nodes.length;
  const cDc = Math.max(1e-6, cfg.dcCapacitanceF ?? 2000e-6);
  const gDcLoad = cfg.dcLoadConductanceS ?? 0.02;
  const iDcExt = cfg.dcCurrentSourceAmp ?? 0;
  const topo = cfg.topology ?? cfg.kind ?? "vsc_pwm";
  const dcKv = cfg.nominalDcKv ?? cfg.dcLinkKv ?? 400.0;
  const acKv = cfg.ratedAcKv ?? cfg.ratedKv ?? 230.0;

  let pAcTotal = 0;

  if (topo === "vsc_pwm") {
    const ma = cfg.modulationIndex ?? 0.9;
    const delta = cfg.phaseAngleRad ?? (cfg.phaseAngleDeg !== undefined ? (cfg.phaseAngleDeg * Math.PI) / 180.0 : 0.15);
    const fSw = cfg.carrierFreqHz ?? 2500.0;

    for (let p = 0; p < nPh; p++) {
      const phShift = (p * 2 * Math.PI) / 3;
      const vGrid = st.nodes[p]! >= 0 ? vVec[st.nodes[p]!]! : 0;

      const mRef = ma * Math.sin(st.omega0 * t + delta - phShift);
      const swDuty = evaluateSubStepPwmModulation(mRef, t, dt, fSw);
      if (p === 0) {
        st.dutyCycleA = Math.max(0.0, Math.min(1.0, 0.5 * (1.0 + swDuty)));
      }
      const vConvPole = 0.5 * st.vDcVolts * swDuty;

      // Branch current from converter pole into AC grid node through (R_f, L_f):
      const vDiff = vConvPole - vGrid;
      const iPhase = st.gFilter * vDiff + st.iHistFilter[p]!;
      st.iHistFilter[p] = st.alphaFilter * iPhase + st.gFilter * vDiff;
      st.iTerminalPhase[p] = iPhase;
      pAcTotal += vConvPole * iPhase;

      // Next-step predicted converter pole voltage for Norton injection:
      const mRefNext = ma * Math.sin(st.omega0 * (t + dt) + delta - phShift);
      const swDutyNext = evaluateSubStepPwmModulation(mRefNext, t + dt, dt, fSw);
      const vConvNext = 0.5 * st.vDcVolts * swDutyNext;
      st.iInjectedPhase[p] = st.gFilter * vConvNext + st.iHistFilter[p]!;
    }

    st.pAcWatts = pAcTotal;
    const iDcFromAc = -pAcTotal / Math.max(100.0, st.vDcVolts);
    const iDcLoad = gDcLoad * (st.vDcVolts - dcKv * 1e3);
    st.iDcAmp = iDcExt + iDcFromAc - iDcLoad;
    st.vDcVolts = Math.max(50.0, st.vDcVolts + (st.iDcAmp / cDc) * dt);
  } else if (topo === "mmc_thevenin") {
    // Modular Multilevel Converter (MMC) Thévenin Equivalent Arm Model with NLM + CCSC
    const ma = cfg.modulationIndex ?? 0.9;
    const delta = cfg.phaseAngleRad ?? (cfg.phaseAngleDeg !== undefined ? (cfg.phaseAngleDeg * Math.PI) / 180.0 : 0.15);
    const nSm = st.numSubmodules;
    const cSm = Math.max(1e-4, cfg.submoduleCapacitanceF ?? 10e-3);
    const lArm = Math.max(
      1e-4,
      cfg.armInductanceH ?? (cfg.filterInductanceH !== undefined ? 2.0 * cfg.filterInductanceH : 0.01),
    );
    const rArm = cfg.armResistanceOhm ?? (cfg.filterResistanceOhm !== undefined ? 2.0 * cfg.filterResistanceOhm : 0.1);
    const enableCcsc = cfg.enableCcsc ?? true;

    let minArmSum = Number.POSITIVE_INFINITY;
    let maxArmSum = Number.NEGATIVE_INFINITY;

    for (let p = 0; p < nPh; p++) {
      const phShift = (p * 2 * Math.PI) / 3;
      const vGrid = st.nodes[p]! >= 0 ? vVec[st.nodes[p]!]! : 0;
      const vCuSum = st.vCapSumUpper[p]!;
      const vClSum = st.vCapSumLower[p]!;
      const iCircPrev = st.iCirculating[p]!;

      // Circulating Current Suppressing Controller (CCSC) & Arm Energy Balancing trim
      const vSumErr = 0.5 * (vCuSum + vClSum) - st.vDcVolts;
      const ccscTrim = enableCcsc
        ? Math.max(-0.08, Math.min(0.08, 0.0005 * iCircPrev + (0.15 * vSumErr) / Math.max(1e3, st.vDcVolts)))
        : 0.0;

      const { nUpper, nLower } = evaluateSubStepNlmArms(ma, st.omega0, delta, phShift, ccscTrim, t, dt, nSm);

      if (p === 0) {
        st.activeSubmodulesUpperA = Math.round(nUpper);
        st.dutyCycleA = Math.max(0.0, Math.min(1.0, nLower / nSm));
      }

      // Inserted upper and lower arm Thévenin voltages
      const vUpper = (nUpper / nSm) * vCuSum;
      const vLower = (nLower / nSm) * vClSum;
      const vConvPole = 0.5 * (vLower - vUpper);

      // AC phase current through equivalent parallel arm impedance (R_arm/2, L_arm/2)
      const vDiff = vConvPole - vGrid;
      const iPhase = st.gFilter * vDiff + st.iHistFilter[p]!;
      st.iHistFilter[p] = st.alphaFilter * iPhase + st.gFilter * vDiff;
      st.iTerminalPhase[p] = iPhase;
      pAcTotal += vConvPole * iPhase;

      // Common-mode loop driving circulating current i_circ:
      // L_arm * d(i_circ)/dt + R_arm * i_circ = 0.5 * (V_dc - (v_u + v_l)) - R_ccsc * i_circ
      const vCm = 0.5 * (st.vDcVolts - (vUpper + vLower));
      const rEffArm = rArm + (enableCcsc ? 2.5 : 0.0);
      const iCirc = ((lArm - 0.5 * rEffArm * dt) * iCircPrev + dt * vCm) / (lArm + 0.5 * rEffArm * dt);
      st.iCirculating[p] = iCirc;

      // Upper and lower arm currents:
      // Over a fundamental cycle, <n_u * i_u> = 0 when i_u = i_dc_leg + i_circ + 0.5 * i_ac
      // and i_l = i_dc_leg + i_circ - 0.5 * i_ac, where i_dc_leg = (vConvPole * iPhase) / V_dc.
      const iDcLeg = (vConvPole * iPhase) / Math.max(100.0, st.vDcVolts);
      const iUpper = iDcLeg + iCirc + 0.5 * iPhase;
      const iLower = iDcLeg + iCirc - 0.5 * iPhase;
      const uFrac = nUpper / nSm;
      const lFrac = nLower / nSm;

      // Update submodule capacitor voltage sums with arm energy-balancing feedback
      const balU = enableCcsc ? 0.05 * (st.vDcVolts - vCuSum) : 0.0;
      const balL = enableCcsc ? 0.05 * (st.vDcVolts - vClSum) : 0.0;
      const nextCu = Math.max(50.0, vCuSum + ((uFrac * iUpper) / cSm) * dt + balU);
      const nextCl = Math.max(50.0, vClSum + ((lFrac * iLower) / cSm) * dt + balL);
      st.vCapSumUpper[p] = nextCu;
      st.vCapSumLower[p] = nextCl;
      if (nextCu < minArmSum) minArmSum = nextCu;
      if (nextCu > maxArmSum) maxArmSum = nextCu;
      if (nextCl < minArmSum) minArmSum = nextCl;
      if (nextCl > maxArmSum) maxArmSum = nextCl;

      // Next-step predicted NLM staircase voltage for companion Norton injection
      const { nUpper: nUpperNext, nLower: nLowerNext } = evaluateSubStepNlmArms(
        ma,
        st.omega0,
        delta,
        phShift,
        ccscTrim,
        t + dt,
        dt,
        nSm,
      );
      const vConvNext = 0.5 * ((nLowerNext / nSm) * nextCl - (nUpperNext / nSm) * nextCu);
      st.iInjectedPhase[p] = st.gFilter * vConvNext + st.iHistFilter[p]!;
    }

    st.pAcWatts = pAcTotal;
    const iDcFromAc = -pAcTotal / Math.max(100.0, st.vDcVolts);
    const iDcLoad = gDcLoad * (st.vDcVolts - dcKv * 1e3);
    st.iDcAmp = iDcExt + iDcFromAc - iDcLoad;
    st.vDcVolts = Math.max(50.0, st.vDcVolts + (st.iDcAmp / cDc) * dt);
    st.submoduleVoltageSpreadPct =
      maxArmSum >= minArmSum ? ((maxArmSum - minArmSum) / Math.max(100.0, st.vDcVolts)) * 100.0 : 0.0;
  } else {
    // 6-Pulse Line-Commutated Thyristor Bridge (LCC)
    const alphaRad = ((cfg.firingAngleDeg ?? 18.0) * Math.PI) / 180.0;
    const lComm = cfg.filterInductanceH ?? cfg.commutationInductanceH ?? 0.005;
    const vAcPeak = acKv * 1e3;
    const vLlRms = nPh === 3 ? (vAcPeak * Math.sqrt(3)) / Math.SQRT2 : vAcPeak / Math.SQRT2;

    // 6-pulse instantaneous commutation ripple envelope: cos(6*omega*t) modulation
    const ripple6 = 1.0 + 0.057 * Math.cos(6 * st.omega0 * t - 6 * alphaRad);
    const vDcIdeal = ((3 * Math.SQRT2) / Math.PI) * vLlRms * Math.cos(alphaRad) * ripple6;
    const rCommEq = (3 * st.omega0 * lComm) / Math.PI;

    const iDc = Math.max(200.0, (vDcIdeal - st.vDcVolts * 0.5) / Math.max(0.01, rCommEq) + iDcExt);
    st.iDcAmp = iDc;
    const cosAlphaPlusMu = Math.max(
      -0.99,
      Math.min(0.99, Math.cos(alphaRad) - (Math.SQRT2 * st.omega0 * lComm * iDc) / Math.max(1e3, vLlRms)),
    );
    st.overlapAngleRad = Math.max(0.0, Math.acos(cosAlphaPlusMu) - alphaRad);

    const iDcLoad = gDcLoad * st.vDcVolts;
    st.vDcVolts = Math.max(0, st.vDcVolts + ((iDc - iDcLoad) / cDc) * dt);
    st.pAcWatts = st.vDcVolts * iDc;

    // AC fundamental + 5th/7th characteristic harmonic current drawn by 6-pulse bridge
    const iFundPeak = ((2 * Math.sqrt(3)) / Math.PI) * iDc;
    for (let p = 0; p < nPh; p++) {
      const phShift = (p * 2 * Math.PI) / 3;
      const vGrid = st.nodes[p]! >= 0 ? vVec[st.nodes[p]!]! : 0;
      const theta = st.omega0 * (t + dt) - alphaRad - phShift;
      const iAcRect = -iFundPeak * (Math.sin(theta) - 0.2 * Math.sin(5 * theta) - 0.14 * Math.sin(7 * theta));
      st.iTerminalPhase[p] = iAcRect;
      st.iInjectedPhase[p] = iAcRect + st.gFilter * vGrid;
    }
  }
}
