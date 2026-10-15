// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 5th-Order 3-Phase Induction Machine & Doubly-Fed Induction Generator (DFIG) Model (`InductionMachine`)
 * for EMT Simulation.
 *
 * Implements Krause / Kundur synchronously rotating dq0 reference-frame differential equations:
 * - Stator & Rotor Flux / Transient EMF Dynamics:
 *     d(E'_q)/dt = -(1 / T'_0) * [ E'_q - (X_s - X') * I_ds ] - s * omega_0 * E'_d + omega_0 * (X_m / X_r) * V'_dr
 *     d(E'_d)/dt = -(1 / T'_0) * [ E'_d + (X_s - X') * I_qs ] + s * omega_0 * E'_q - omega_0 * (X_m / X_r) * V'_qr
 * - Mechanical Shaft Swing Equation:
 *     2H * d(omega_r)/dt = T_e - T_m - D * (omega_r - 1)
 *     s = 1 - omega_r
 * - Supports Squirrel-Cage Induction Motors (Direct-On-Line starting, voltage dip re-acceleration)
 *   and Wound-Rotor Doubly-Fed Induction Generators (Type-3 Wind Turbine DFIG with active rotor
 *   converter voltage injection and automatic rotor overcurrent Crowbar protection).
 */

export interface InductionMachineConfig {
  id: string;
  bus: string;
  ratedMva: number;
  ratedKv: number;
  machineType?: "squirrel_cage" | "dfig" | undefined;
  nominalFreqHz?: number | undefined;
  inertiaConstantH?: number | undefined; // Inertia constant H in s (default: 1.5 s)
  dampingD?: number | undefined; // Mechanical damping D in pu (default: 0.2)
  rsPu?: number | undefined; // Stator resistance R_s (default: 0.015 pu)
  xsPu?: number | undefined; // Stator leakage reactance X_ls (default: 0.10 pu)
  xmPu?: number | undefined; // Magnetizing reactance X_m (default: 3.50 pu)
  rrPu?: number | undefined; // Rotor resistance R'_r (default: 0.015 pu)
  xrPu?: number | undefined; // Rotor leakage reactance X'_lr (default: 0.10 pu)
  mechanicalTorquePu?: number | undefined; // Load torque T_m (>0 motor load, <0 wind turbine driving torque; default: 0.6 pu)
  initialSlip?: number | undefined; // Initial slip s_0 = 1 - omega_r0 (default: 0.02 for motor, -0.05 for DFIG)
  vRotorDPu?: number | undefined; // DFIG Rotor-Side Converter d-axis voltage V'_dr (pu)
  vRotorQPu?: number | undefined; // DFIG Rotor-Side Converter q-axis voltage V'_qr (pu)
  crowbarResistancePu?: number | undefined; // DFIG rotor crowbar protection resistance R_cb (default: 0.15 pu)
  crowbarTriggerCurrentPu?: number | undefined; // Rotor current threshold (pu) to trigger crowbar (default: 2.0 pu)
}

export interface InductionMachineState {
  config: InductionMachineConfig;
  nodes: number[];
  vBasePeak: number;
  iBasePeak: number;
  zBaseOhm: number;
  gSubOhmInv: number; // Transient Norton conductance stamped into [G] per phase node (S)
  omega0: number;
  xStatorPu: number; // X_s = X_ls + X_m
  xRotorPu: number; // X_r = X'_lr + X_m
  xTransientPu: number; // X' = X_s - X_m^2 / X_r
  // Dynamic states
  omegaRotorPu: number; // Rotor speed omega_r (pu)
  slip: number; // Slip s = 1 - omega_r
  thetaSyncRad: number; // Synchronous reference angle omega_0 * t (rad)
  thetaRotorRad: number; // Rotor electrical angle (rad)
  eqPrimePu: number; // Transient q-axis internal voltage E'_q (pu)
  edPrimePu: number; // Transient d-axis internal voltage E'_d (pu)
  elecTorquePu: number; // Electromagnetic torque T_e (pu, positive = motoring)
  statorCurrentMagPu: number; // Stator current magnitude (pu)
  rotorCurrentMagPu: number; // Rotor current magnitude (pu)
  crowbarActive: boolean; // True when DFIG rotor crowbar protection is engaged
  iInjectedPhase: Float64Array; // Norton current injected into each phase node (A)
  iTerminalPhase: Float64Array; // Net terminal current leaving each phase (A)
}

export function createInductionMachineState(
  cfg: InductionMachineConfig,
  nodes: number[],
  defaultFreqHz = 60.0,
): InductionMachineState {
  const freqHz = cfg.nominalFreqHz ?? defaultFreqHz;
  const omega0 = 2 * Math.PI * freqHz;
  const vBasePeak = cfg.ratedKv * 1e3;
  const sBaseVa = cfg.ratedMva * 1e6;
  const zBaseOhm = (vBasePeak * vBasePeak) / Math.max(1.0, sBaseVa);
  const iBasePeak = sBaseVa / Math.max(1.0, vBasePeak);

  const rsPu = cfg.rsPu ?? 0.015;
  const xsPu = cfg.xsPu ?? 0.1;
  const xmPu = cfg.xmPu ?? 3.5;
  const xrPu = cfg.xrPu ?? 0.1;

  const xStatorPu = xsPu + xmPu;
  const xRotorPu = xrPu + xmPu;
  const xTransientPu = Math.max(0.05, xStatorPu - (xmPu * xmPu) / xRotorPu);

  const zTransientPu = Math.hypot(rsPu, xTransientPu);
  const gSubOhmInv = 1.0 / Math.max(1e-6, zTransientPu * zBaseOhm);

  const isDfig = cfg.machineType === "dfig";
  const defaultSlip = isDfig ? -0.05 : 0.02;
  const initSlip = cfg.initialSlip ?? defaultSlip;
  const omegaRotorPu = 1.0 - initSlip;

  // Initialize internal EMF behind X' near steady state (reduced when starting from standstill s = 1)
  const initEmfScale = Math.max(0.15, 1.0 - 0.75 * Math.min(1.0, Math.abs(initSlip)));
  const eqPrime0 = 0.92 * initEmfScale;
  const edPrime0 = -0.08 * Math.sign(initSlip || 1) * initEmfScale;

  const nPh = nodes.length;
  const iInjectedPhase = new Float64Array(nPh);
  const iTerminalPhase = new Float64Array(nPh);

  const eMag0 = Math.hypot(eqPrime0, edPrime0);
  const ePhase0 = Math.atan2(edPrime0, eqPrime0);
  for (let p = 0; p < nPh; p++) {
    const phShift = (p * 2 * Math.PI) / 3;
    const eInternalVolts = vBasePeak * eMag0 * Math.sin(ePhase0 - phShift);
    iInjectedPhase[p] = gSubOhmInv * eInternalVolts;
  }

  return {
    config: cfg,
    nodes,
    vBasePeak,
    iBasePeak,
    zBaseOhm,
    gSubOhmInv,
    omega0,
    xStatorPu,
    xRotorPu,
    xTransientPu,
    omegaRotorPu,
    slip: initSlip,
    thetaSyncRad: 0,
    thetaRotorRad: 0,
    eqPrimePu: eqPrime0,
    edPrimePu: edPrime0,
    elecTorquePu: cfg.mechanicalTorquePu ?? (isDfig ? -0.6 : 0.6),
    statorCurrentMagPu: Math.min(4.0, Math.max(0.2, Math.abs(initSlip) * 5.0)),
    rotorCurrentMagPu: Math.min(4.0, Math.max(0.15, Math.abs(initSlip) * 4.8)),
    crowbarActive: false,
    iInjectedPhase,
    iTerminalPhase,
  };
}

/**
 * Advances the 5th-order induction machine / DFIG differential equations by `dt`
 * using solved terminal phase voltages `vVec` and updates the transient Norton current injections.
 */
export function stepInductionMachine(st: InductionMachineState, vVec: Float64Array, t: number, dt: number): void {
  const cfg = st.config;
  const nPh = st.nodes.length;
  const H = Math.max(0.1, cfg.inertiaConstantH ?? 1.5);
  const D = cfg.dampingD ?? 0.2;
  const rs = cfg.rsPu ?? 0.015;
  const xm = cfg.xmPu ?? 3.5;
  const rrBase = cfg.rrPu ?? 0.015;
  const rCrowbar = cfg.crowbarResistancePu ?? 0.15;
  const crowbarThreshold = cfg.crowbarTriggerCurrentPu ?? 2.0;
  const isDfig = cfg.machineType === "dfig";
  const tmPu = cfg.mechanicalTorquePu ?? (isDfig ? -0.6 : 0.6);

  const thetaSync = st.omega0 * t;
  st.thetaSyncRad = thetaSync;

  // 1. Park transformation of terminal voltages to synchronously rotating (d, q) frame
  let vdPu = 0;
  let vqPu = 0;
  if (nPh === 3) {
    const va = (st.nodes[0]! >= 0 ? vVec[st.nodes[0]!]! : 0) / st.vBasePeak;
    const vb = (st.nodes[1]! >= 0 ? vVec[st.nodes[1]!]! : 0) / st.vBasePeak;
    const vc = (st.nodes[2]! >= 0 ? vVec[st.nodes[2]!]! : 0) / st.vBasePeak;

    const sA = Math.sin(thetaSync);
    const cA = Math.cos(thetaSync);
    const sB = Math.sin(thetaSync - (2 * Math.PI) / 3);
    const cB = Math.cos(thetaSync - (2 * Math.PI) / 3);
    const sC = Math.sin(thetaSync + (2 * Math.PI) / 3);
    const cC = Math.cos(thetaSync + (2 * Math.PI) / 3);

    vqPu = (2 / 3) * (va * sA + vb * sB + vc * sC);
    vdPu = (2 / 3) * (va * cA + vb * cB + vc * cC);
  } else {
    const va = (st.nodes[0]! >= 0 ? vVec[st.nodes[0]!]! : 0) / st.vBasePeak;
    vqPu = Math.min(1.5, Math.max(0.2, Math.abs(va) * Math.SQRT2));
    vdPu = 0;
  }

  const vTermMagPu = Math.max(0.05, Math.hypot(vqPu, vdPu));

  // 2. Effective rotor resistance (including DFIG crowbar when triggered)
  const rrEff = st.crowbarActive ? rrBase + rCrowbar : rrBase;
  const T0Prime = st.xRotorPu / (st.omega0 * Math.max(1e-4, rrEff));

  // 3. Stator current in synchronous dq frame (motor load convention: I_s entering stator)
  const denom = rs * rs + st.xTransientPu * st.xTransientPu;
  const dvq = vqPu - st.eqPrimePu;
  const dvd = vdPu - st.edPrimePu;
  const iqsPu = Math.max(-6.0, Math.min(6.0, (rs * dvq - st.xTransientPu * dvd) / denom));
  const idsPu = Math.max(-6.0, Math.min(6.0, (st.xTransientPu * dvq + rs * dvd) / denom));

  // Combine transient dynamic current and steady-state slip-dependent rotor current
  const zSlip = Math.hypot(rrEff / Math.max(1e-3, Math.abs(st.slip)), st.xTransientPu);
  const iSlipMag = vTermMagPu / Math.max(0.08, zSlip);
  const iDynMag = Math.hypot(iqsPu, idsPu);
  st.statorCurrentMagPu = 0.5 * iDynMag + 0.5 * iSlipMag;
  st.rotorCurrentMagPu = (xm / st.xRotorPu) * st.statorCurrentMagPu;

  // Check DFIG rotor overcurrent crowbar protection trigger
  if (isDfig && st.rotorCurrentMagPu > crowbarThreshold) {
    st.crowbarActive = true;
  }

  // 4. Air-gap electromagnetic torque T_e (positive = motoring torque accelerating rotor toward synchronous speed)
  // Kloss / Equivalent-circuit torque + transient dq flux interaction:
  const sEff = st.slip;
  const r2OverS = Math.abs(sEff) > 1e-4 ? rrEff / sEff : rrEff * 1e4 * (sEff >= 0 ? 1 : -1);
  const teSteadyPu =
    (vTermMagPu * vTermMagPu * r2OverS) / (Math.pow(rs + r2OverS, 2) + st.xTransientPu * st.xTransientPu);

  const vdrPu = isDfig && !st.crowbarActive ? (cfg.vRotorDPu ?? 0.0) : 0.0;
  const vqrPu = isDfig && !st.crowbarActive ? (cfg.vRotorQPu ?? 0.0) : 0.0;
  const teConverterBoost = isDfig && !st.crowbarActive ? -(xm / st.xRotorPu) * vqrPu * vTermMagPu * 2.5 : 0.0;

  const teDynPu = st.eqPrimePu * iqsPu + st.edPrimePu * idsPu;
  st.elecTorquePu = 0.75 * (teSteadyPu + teConverterBoost) + 0.25 * teDynPu;

  // 5. Integrate 5th-order rotor transient EMF differential equations (sub-stepped for stiff slip)
  const subSteps = 4;
  const dtSub = dt / subSteps;
  const xDiff = st.xStatorPu - st.xTransientPu;
  for (let k = 0; k < subSteps; k++) {
    const slipOmega = st.slip * st.omega0;
    const dEq =
      -(st.eqPrimePu - xDiff * idsPu) / T0Prime - slipOmega * st.edPrimePu + st.omega0 * (xm / st.xRotorPu) * vdrPu;
    const dEd =
      -(st.edPrimePu + xDiff * iqsPu) / T0Prime + slipOmega * st.eqPrimePu - st.omega0 * (xm / st.xRotorPu) * vqrPu;

    st.eqPrimePu = Math.max(-1.5, Math.min(1.5, st.eqPrimePu + dEq * dtSub));
    st.edPrimePu = Math.max(-1.5, Math.min(1.5, st.edPrimePu + dEd * dtSub));
  }

  // 6. Integrate mechanical shaft swing equation: 2H * d(omega_r)/dt = T_e - T_m - D*(omega_r - 1)
  const dOmega = (st.elecTorquePu - tmPu - D * (st.omegaRotorPu - 1.0)) / (2.0 * H);
  st.omegaRotorPu = Math.max(0.0, Math.min(2.0, st.omegaRotorPu + dOmega * dt));
  st.slip = 1.0 - st.omegaRotorPu;
  st.thetaRotorRad += st.omegaRotorPu * st.omega0 * dt;

  // 7. Update next-step Norton current injections into the EMT network
  const thetaNext = st.omega0 * (t + dt);
  const eMagPu = Math.hypot(st.eqPrimePu, st.edPrimePu);
  const ePhaseShift = Math.atan2(st.edPrimePu, st.eqPrimePu);

  for (let p = 0; p < nPh; p++) {
    const phOffset = (p * 2 * Math.PI) / 3;
    const vTerm = st.nodes[p]! >= 0 ? vVec[st.nodes[p]!]! : 0;
    const eInstVolts = st.vBasePeak * eMagPu * Math.sin(thetaNext + ePhaseShift - phOffset);
    const iNorton = st.gSubOhmInv * eInstVolts;
    st.iInjectedPhase[p] = iNorton;
    st.iTerminalPhase[p] = iNorton - st.gSubOhmInv * vTerm;
  }
}
