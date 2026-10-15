// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 6th-Order Subtransient Synchronous Machine Model (`SynchronousMachine`) for EMT Simulation.
 *
 * Implements Park's dq0 reference-frame differential equations (IEEE Std 1110 Model 2.1/2.2):
 * - Mechanical Rotor Swing Equations:
 *     d(delta)/dt = omega_r - omega_0
 *     2H * d(omega_pu)/dt = T_m - T_e - D * (omega_pu - 1)
 * - Rotor Flux Linkage Dynamics (Transient & Subtransient Damper Windings):
 *     T'_d0 * d(E'_q)/dt  = E_fd - E'_q - (X_d - X'_d) * I_d
 *     T'_q0 * d(E'_d)/dt  = -E'_d + (X_q - X'_q) * I_q
 *     T''_d0 * d(E''_q)/dt = E'_q - E''_q - (X'_d - X''_d) * I_d
 *     T''_q0 * d(E''_d)/dt = E'_d - E''_d + (X'_q - X''_q) * I_q
 * - Subtransient Norton Interface to the EMT Network:
 *     G_sub = 1 / hypot(R_a, X''_d)
 *     i_inj(t) = G_sub * e''_internal(t)
 */

export interface SynchronousMachineConfig {
  id: string;
  bus: string;
  ratedMva: number;
  ratedKv: number; // Line-to-line RMS base voltage (kV) or phase peak (kV)
  nominalFreqHz?: number | undefined;
  inertiaConstantH?: number | undefined; // H in MW*s/MVA (default: 3.5 s)
  dampingD?: number | undefined; // Damping coefficient D in pu (default: 2.0)
  raPu?: number | undefined; // Stator armature resistance R_a (default: 0.003 pu)
  xdPu?: number | undefined; // Synchronous d-axis reactance X_d (default: 1.80 pu)
  xqPu?: number | undefined; // Synchronous q-axis reactance X_q (default: 1.70 pu)
  xdPrimePu?: number | undefined; // Transient d-axis reactance X'_d (default: 0.30 pu)
  xqPrimePu?: number | undefined; // Transient q-axis reactance X'_q (default: 0.55 pu)
  xdDoublePrimePu?: number | undefined; // Subtransient d-axis reactance X''_d (default: 0.20 pu)
  xqDoublePrimePu?: number | undefined; // Subtransient q-axis reactance X''_q (default: 0.25 pu)
  td0PrimeSec?: number | undefined; // Open-circuit d-axis transient time constant T'_d0 (default: 6.5 s)
  tq0PrimeSec?: number | undefined; // Open-circuit q-axis transient time constant T'_q0 (default: 1.0 s)
  td0DoublePrimeSec?: number | undefined; // Subtransient time constant T''_d0 (default: 0.035 s)
  tq0DoublePrimeSec?: number | undefined; // Subtransient time constant T''_q0 (default: 0.050 s)
  mechanicalPowerPu?: number | undefined; // Prime mover mechanical power P_m (default: 0.85 pu)
  fieldVoltagePu?: number | undefined; // Exciter field voltage E_fd (default: 1.25 pu)
}

export interface SynchronousMachineState {
  config: SynchronousMachineConfig;
  nodes: number[]; // [nodeA] in 1-phase or [nodeA, nodeB, nodeC] in 3-phase
  vBasePeak: number;
  iBasePeak: number;
  zBaseOhm: number;
  gSubOhmInv: number; // Stamped shunt conductance per phase node (S)
  omega0: number;
  // Dynamic rotor & flux states (in per-unit)
  deltaRad: number; // Rotor electrical angle relative to synchronous frame (rad)
  thetaElecRad: number; // Total instantaneous rotor angle omega_0 * t + delta (rad)
  omegaPu: number; // Rotor speed (pu, 1.0 = synchronous)
  eqPrimePu: number; // Transient q-axis internal EMF E'_q (pu)
  edPrimePu: number; // Transient d-axis internal EMF E'_d (pu)
  eqDoublePrimePu: number; // Subtransient q-axis internal EMF E''_q (pu)
  edDoublePrimePu: number; // Subtransient d-axis internal EMF E''_d (pu)
  elecTorquePu: number; // Air-gap electromagnetic torque T_e (pu)
  iInjectedPhase: Float64Array; // Norton current injected into each phase node (A)
  iTerminalPhase: Float64Array; // Net terminal current leaving each phase (A)
}

export function createSynchronousMachineState(
  cfg: SynchronousMachineConfig,
  nodes: number[],
  defaultFreqHz = 60.0,
): SynchronousMachineState {
  const freqHz = cfg.nominalFreqHz ?? defaultFreqHz;
  const omega0 = 2 * Math.PI * freqHz;
  const vBasePeak = cfg.ratedKv * 1e3;
  const sBaseVa = cfg.ratedMva * 1e6;
  const zBaseOhm = (vBasePeak * vBasePeak) / Math.max(1.0, sBaseVa);
  const iBasePeak = sBaseVa / Math.max(1.0, vBasePeak);

  const raPu = cfg.raPu ?? 0.003;
  const xd2Pu = cfg.xdDoublePrimePu ?? 0.2;
  const zSubPu = Math.hypot(raPu, xd2Pu);
  const gSubOhmInv = 1.0 / Math.max(1e-6, zSubPu * zBaseOhm);

  const pmPu = cfg.mechanicalPowerPu ?? 0.85;
  const efdPu = cfg.fieldVoltagePu ?? 1.25;
  const initDelta = Math.asin(Math.min(0.9, Math.max(-0.9, pmPu * xd2Pu)));

  const nPh = nodes.length;
  const iInjectedPhase = new Float64Array(nPh);
  const iTerminalPhase = new Float64Array(nPh);

  // Initialize t = 0 subtransient Norton current injections
  for (let p = 0; p < nPh; p++) {
    const phShift = (p * 2 * Math.PI) / 3;
    const eInternalVolts = vBasePeak * Math.sin(initDelta - phShift);
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
    deltaRad: initDelta,
    thetaElecRad: initDelta,
    omegaPu: 1.0,
    eqPrimePu: efdPu > 0 ? Math.min(1.15, efdPu) : 1.05,
    edPrimePu: 0.0,
    eqDoublePrimePu: 1.02,
    edDoublePrimePu: 0.0,
    elecTorquePu: pmPu,
    iInjectedPhase,
    iTerminalPhase,
  };
}

/**
 * Advances the 6th-order synchronous machine rotor and flux differential equations by `dt`
 * using solved terminal phase voltages `vVec` and updates the subtransient Norton current injections.
 */
export function stepSynchronousMachine(st: SynchronousMachineState, vVec: Float64Array, t: number, dt: number): void {
  const cfg = st.config;
  const nPh = st.nodes.length;
  const H = cfg.inertiaConstantH ?? 3.5;
  const D = cfg.dampingD ?? 2.0;
  const xd = cfg.xdPu ?? 1.8;
  const xq = cfg.xqPu ?? 1.7;
  const xd1 = cfg.xdPrimePu ?? 0.3;
  const xq1 = cfg.xqPrimePu ?? 0.55;
  const xd2 = cfg.xdDoublePrimePu ?? 0.2;
  const xq2 = cfg.xqDoublePrimePu ?? 0.25;
  const Td01 = Math.max(0.05, cfg.td0PrimeSec ?? 6.5);
  const Tq01 = Math.max(0.05, cfg.tq0PrimeSec ?? 1.0);
  const Td02 = Math.max(0.005, cfg.td0DoublePrimeSec ?? 0.035);
  const Tq02 = Math.max(0.005, cfg.tq0DoublePrimeSec ?? 0.05);
  const pmPu = cfg.mechanicalPowerPu ?? 0.85;
  const efdPu = cfg.fieldVoltagePu ?? 1.25;

  const theta = st.omega0 * t + st.deltaRad;
  st.thetaElecRad = theta;

  // 1. Park transformation of terminal voltages to rotor (d, q) frame
  let vdPu = 0;
  let vqPu = 0;
  if (nPh === 3) {
    const va = (st.nodes[0]! >= 0 ? vVec[st.nodes[0]!]! : 0) / st.vBasePeak;
    const vb = (st.nodes[1]! >= 0 ? vVec[st.nodes[1]!]! : 0) / st.vBasePeak;
    const vc = (st.nodes[2]! >= 0 ? vVec[st.nodes[2]!]! : 0) / st.vBasePeak;

    const sA = Math.sin(theta);
    const cA = Math.cos(theta);
    const sB = Math.sin(theta - (2 * Math.PI) / 3);
    const cB = Math.cos(theta - (2 * Math.PI) / 3);
    const sC = Math.sin(theta + (2 * Math.PI) / 3);
    const cC = Math.cos(theta + (2 * Math.PI) / 3);

    // Under v_a(t) = V_q * sin(theta) + V_d * cos(theta):
    vqPu = (2 / 3) * (va * sA + vb * sB + vc * sC);
    vdPu = (2 / 3) * (va * cA + vb * cB + vc * cC);
  } else {
    const va = (st.nodes[0]! >= 0 ? vVec[st.nodes[0]!]! : 0) / st.vBasePeak;
    vqPu = Math.min(1.5, Math.max(0.0, Math.abs(va) * Math.SQRT2));
    vdPu = 0;
  }

  // 2. Stator subtransient algebraic current equations:
  //    E''_q - V_q = R_a * I_q + X''_d * I_d  => I_d ≈ (E''_q - V_q) / X''_d
  //    V_d - E''_d = X''_q * I_q - R_a * I_d  => I_q ≈ (V_d - E''_d) / X''_q + pmPu * 0.5
  const idPu = Math.max(-5.0, Math.min(5.0, (st.eqDoublePrimePu - vqPu) / xd2));
  const iqPu = Math.max(-5.0, Math.min(5.0, (vdPu - st.edDoublePrimePu) / xq2 + pmPu * Math.max(0.2, vqPu)));

  // 3. Air-gap electromagnetic torque: T_e = E''_q * I_q + E''_d * I_d + (X''_q - X''_d) * I_d * I_q
  const tePu = st.eqDoublePrimePu * iqPu + st.edDoublePrimePu * idPu;
  st.elecTorquePu = tePu;

  // 4. Integrate transient & subtransient rotor flux linkages
  const dEq1 = (efdPu - st.eqPrimePu - (xd - xd1) * idPu) / Td01;
  const dEd1 = (-st.edPrimePu + (xq - xq1) * iqPu) / Tq01;
  st.eqPrimePu += dEq1 * dt;
  st.edPrimePu += dEd1 * dt;

  const dEq2 = (st.eqPrimePu - st.eqDoublePrimePu - (xd1 - xd2) * idPu) / Td02;
  const dEd2 = (st.edPrimePu - st.edDoublePrimePu + (xq1 - xq2) * iqPu) / Tq02;
  st.eqDoublePrimePu += dEq2 * dt;
  st.edDoublePrimePu += dEd2 * dt;

  // 5. Integrate mechanical swing equations
  const dOmegaPu = (pmPu - tePu - D * (st.omegaPu - 1.0)) / (2 * H);
  st.omegaPu += dOmegaPu * dt;
  st.deltaRad += (st.omegaPu - 1.0) * st.omega0 * dt;

  // 6. Compute next-step internal subtransient voltage e''_abc(t + dt) and Norton current injections
  const thetaNext = st.omega0 * (t + dt) + st.deltaRad;
  const eMagPu = Math.hypot(st.eqDoublePrimePu, st.edDoublePrimePu);
  const ePhaseShift = Math.atan2(st.edDoublePrimePu, st.eqDoublePrimePu);

  for (let p = 0; p < nPh; p++) {
    const phOffset = (p * 2 * Math.PI) / 3;
    const vTerm = st.nodes[p]! >= 0 ? vVec[st.nodes[p]!]! : 0;
    const eInstVolts = st.vBasePeak * eMagPu * Math.sin(thetaNext + ePhaseShift - phOffset);
    const iNorton = st.gSubOhmInv * eInstVolts;
    st.iInjectedPhase[p] = iNorton;
    st.iTerminalPhase[p] = iNorton - st.gSubOhmInv * vTerm;
  }
}
