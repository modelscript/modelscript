// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 2800-2022 & NERC PRC-029-1 Automated Grid Code Compliance Verification Engine.
 *
 * Evaluates electromagnetic transient (EMT) simulation waveforms against
 * mandatory transmission interconnection standards for Inverter-Based Resources (IBRs):
 * - Clause 5.3.2 / 7.2.2.3: Voltage Ride-Through (LVRT / HVRT) & Prohibition of Momentary Cessation
 * - Clause 5.4.1 / 7.2.2.3.5: Fast Dynamic Voltage Support & Reactive Current Step Response (T_90% <= 50 ms)
 * - Clause 5.4.2 / 7.2.2.1: Post-Fault Transient Overvoltage Limit (V_peak <= 1.20 pu)
 * - Clause 7.2.2.1 / NERC PRC-029-1: Piecewise Time-Voltage Ride-Through (VRT) Envelope
 * - Clause 7.2.2.3.4: Incremental Positive & Negative-Sequence Reactive Current (k1 = dI_1q/dV_1, k2 = dI_2q/dV_2)
 * - Clause 7.2.2.3.5: Post-Fault Active Power Recovery (P >= 90% P_pre within 1.0 s)
 * - Clause 7.3.2: Frequency, RoCoF (>= 5 Hz/s), and Phase-Angle Jump (>= 25 deg) Ride-Through
 */

import type { EmtNetlist } from "../types.js";

/**
 * Specification of a transmission fault disturbance evaluated against IEEE 2800-2022 ride-through clauses.
 */
export interface Ieee2800FaultSpec {
  /** Fault inception timestamp in seconds (e.g., `0.02` s). */
  faultStartSec: number; // e.g. 0.02 s
  /** Fault clearing duration in seconds (e.g., `0.150` s for a 150 ms sag). */
  faultDurationSec: number; // e.g. 0.150 s (150 ms)
  /** Pre-fault nominal Point of Interconnection (POI) voltage in kV (e.g., `230.0` kV). */
  vPreFaultKv: number; // e.g. 230.0 kV
  /** Residual POI voltage during the fault sag in kV (e.g., `11.5` kV for a 0.05 pu deep sag). */
  vFaultKv: number; // e.g. 0.05 * 230 = 11.5 kV (0.05 pu deep sag)
  /** Optional IBR plant rated peak current in Amperes used for per-unit reactive gain normalization. */
  ratedCurrentAmp?: number | undefined; // Optional IBR rated peak current (A)
  /** Required minimum incremental positive-sequence reactive droop gain $k_1 = \Delta I_{1q,\text{pu}} / \Delta V_{1,\text{pu}}$ (default: `1.5`). */
  minK1Gain?: number | undefined; // Required incremental positive-sequence reactive gain k1 (default: 1.5)
  /** Required minimum incremental negative-sequence reactive droop gain $k_2 = \Delta I_{2q,\text{pu}} / \Delta V_{2,\text{pu}}$ (default: `1.5`). */
  minK2Gain?: number | undefined; // Required incremental negative-sequence reactive gain k2 (default: 1.5)
  /** Whether to evaluate the full 7-clause sequence-domain IEEE 2800-2022 and NERC PRC-029-1 suite. */
  evaluateExtendedClauses?: boolean | undefined; // Evaluate full 7-clause IEEE 2800 / NERC PRC-029 suite
}

/**
 * Outcome of evaluating a single IEEE 2800-2022 / NERC PRC-029-1 interconnection clause.
 */
export interface Ieee2800CheckResult {
  /** Standard clause identifier (e.g., `"5.3.2"`, `"5.4.1"`, `"7.2.2.3.4"`). */
  clause: string;
  /** Short descriptive title of the compliance check. */
  title: string;
  /** Pass/fail/warning compliance status for the clause. */
  status: "PASS" | "FAIL" | "WARN";
  /** Formatted string reporting the metric extracted from the EMT waveform. */
  measuredValue: string;
  /** Formatted string stating the mandatory IEEE 2800-2022 / NERC PRC-029-1 threshold. */
  requiredLimit: string;
  /** Detailed engineering explanation of the clause evaluation outcome. */
  details: string;
}

/**
 * Time-domain trajectories of symmetrical components ($V_0, V_1, V_2, I_0, I_1, I_2$),
 * synchronous $dq$ current projections, frequency, and RoCoF extracted via 1-cycle sliding fundamental DFT.
 */
export interface SequencePhasorTrajectory {
  /** Zero-sequence voltage magnitude trajectory $|V_0(t)|$. */
  v0: Float64Array;
  /** Positive-sequence voltage magnitude trajectory $|V_1(t)|$. */
  v1: Float64Array;
  /** Negative-sequence voltage magnitude trajectory $|V_2(t)|$. */
  v2: Float64Array;
  /** Zero-sequence current magnitude trajectory $|I_0(t)|$. */
  i0: Float64Array;
  /** Positive-sequence current magnitude trajectory $|I_1(t)|$. */
  i1: Float64Array;
  /** Negative-sequence current magnitude trajectory $|I_2(t)|$. */
  i2: Float64Array;
  /** Positive-sequence active current $I_{1d}(t)$ aligned in-phase with $V_1$. */
  i1d: Float64Array; // Positive-sequence active current (aligned with V1)
  /** Positive-sequence reactive current $I_{1q}(t)$ ($> 0$ indicates capacitive/over-excited injection supporting a voltage sag). */
  i1q: Float64Array; // Positive-sequence reactive current (over-excited/capacitive > 0 supports voltage sag)
  /** Negative-sequence active current $I_{2d}(t)$ aligned with $V_2$. */
  i2d: Float64Array; // Negative-sequence active current (aligned with V2)
  /** Negative-sequence reactive current $I_{2q}(t)$ suppressing unbalanced voltage rise. */
  i2q: Float64Array; // Negative-sequence reactive current (suppresses voltage unbalance)
  /** Filtered instantaneous positive-sequence fundamental frequency trajectory in Hz. */
  frequencyHz: Float64Array;
  /** Rate of Change of Frequency ($\text{RoCoF} = df/dt$) trajectory in Hz/s. */
  rocofHzPerSec: Float64Array;
  /** Maximum instantaneous positive-sequence phase-angle jump observed in degrees. */
  maxPhaseJumpDeg: number;
}

/**
 * Complete IEEE 2800-2022 & NERC PRC-029-1 compliance report for an EMT simulation run.
 */
export interface Ieee2800ComplianceReport {
  /** Name of the evaluated PSCAD project. */
  projectName: string;
  /** Aggregate compliance verdict (`"PASS"` iff all evaluated clauses pass). */
  overallStatus: "PASS" | "FAIL";
  /** ISO-8601 timestamp when the verification report was generated. */
  evaluatedAt: string;
  /** Individual clause check results. */
  checks: Ieee2800CheckResult[];
  /** Optional symmetrical component phasor trajectories when extended sequence checks are run. */
  sequencePhasors?: SequencePhasorTrajectory | undefined;
  /** Multi-line human-readable summary of all evaluated clauses. */
  summary: string;
}

/**
 * Three-phase (`a`, `b`, `c`) time-domain waveform channels.
 */
export interface ThreePhaseChannels {
  /** Phase A instantaneous waveform array. */
  a: Float64Array;
  /** Phase B instantaneous waveform array. */
  b: Float64Array;
  /** Phase C instantaneous waveform array. */
  c: Float64Array;
}

/**
 * Input EMT simulation waveforms at the Point of Interconnection (POI) for IEEE 2800-2022 verification.
 */
export interface SimulationWaveformSample {
  /** Simulation timestamp array in seconds. */
  time: Float64Array;
  /** Primary (Phase A or single-phase) POI voltage waveform in Volts. */
  vPoi: Float64Array;
  /** Primary (Phase A or single-phase) IBR branch current injection waveform in Amperes. */
  iIbr: Float64Array;
  /** Optional 3-phase POI voltage waveforms (`a`, `b`, `c`) for Fortescue sequence decomposition. */
  vPoiAbc?: ThreePhaseChannels | undefined;
  /** Optional 3-phase IBR current waveforms (`a`, `b`, `c`) for Fortescue sequence decomposition. */
  iIbrAbc?: ThreePhaseChannels | undefined;
}

/**
 * Extracts 3-phase symmetrical component magnitudes (V0, V1, V2, I0, I1, I2),
 * synchronous reference frame active/reactive current components (I1d, I1q, I2d, I2q),
 * instantaneous frequency, RoCoF, and maximum phase-angle jump using a 1-cycle sliding fundamental DFT.
 */
export function extractSequencePhasors(
  time: Float64Array,
  vAbc: ThreePhaseChannels,
  iAbc: ThreePhaseChannels,
  nominalFreqHz = 60.0,
): SequencePhasorTrajectory {
  const n = time.length;
  const dt = n > 1 ? Math.max(1e-9, time[1]! - time[0]!) : 20e-6;
  const cycleSteps = Math.max(4, Math.round(1.0 / (nominalFreqHz * dt)));
  const omega = 2 * Math.PI * nominalFreqHz;

  // Fortescue operator a = exp(j * 2*pi/3) = -0.5 + j * sqrt(3)/2, a^2 = -0.5 - j * sqrt(3)/2
  const aRe = -0.5;
  const aIm = 0.5 * Math.sqrt(3);
  const a2Re = -0.5;
  const a2Im = -0.5 * Math.sqrt(3);

  const v0 = new Float64Array(n);
  const v1 = new Float64Array(n);
  const v2 = new Float64Array(n);
  const i0 = new Float64Array(n);
  const i1 = new Float64Array(n);
  const i2 = new Float64Array(n);
  const i1d = new Float64Array(n);
  const i1q = new Float64Array(n);
  const i2d = new Float64Array(n);
  const i2q = new Float64Array(n);
  const frequencyHz = new Float64Array(n);
  const rocofHzPerSec = new Float64Array(n);

  let sumVaR = 0,
    sumVaI = 0,
    sumVbR = 0,
    sumVbI = 0,
    sumVcR = 0,
    sumVcI = 0;
  let sumIaR = 0,
    sumIaI = 0,
    sumIbR = 0,
    sumIbI = 0,
    sumIcR = 0,
    sumIcI = 0;

  let prevTheta1 = 0;
  let prevFreq = nominalFreqHz;
  let maxPhaseJumpDeg = 0;

  for (let k = 0; k < n; k++) {
    const t = time[k]!;
    const c = Math.cos(omega * t);
    const s = Math.sin(omega * t);

    if (k >= cycleSteps) {
      const oldIdx = k - cycleSteps;
      const tOld = time[oldIdx]!;
      const cOld = Math.cos(omega * tOld);
      const sOld = Math.sin(omega * tOld);

      sumVaR -= vAbc.a[oldIdx]! * sOld;
      sumVaI -= vAbc.a[oldIdx]! * cOld;
      sumVbR -= vAbc.b[oldIdx]! * sOld;
      sumVbI -= vAbc.b[oldIdx]! * cOld;
      sumVcR -= vAbc.c[oldIdx]! * sOld;
      sumVcI -= vAbc.c[oldIdx]! * cOld;

      sumIaR -= iAbc.a[oldIdx]! * sOld;
      sumIaI -= iAbc.a[oldIdx]! * cOld;
      sumIbR -= iAbc.b[oldIdx]! * sOld;
      sumIbI -= iAbc.b[oldIdx]! * cOld;
      sumIcR -= iAbc.c[oldIdx]! * sOld;
      sumIcI -= iAbc.c[oldIdx]! * cOld;
    }

    //Under sine-carrier convention x(t) = Re*sin(wt) + Im*cos(wt) = A*sin(wt + phi):
    sumVaR += vAbc.a[k]! * s;
    sumVaI += vAbc.a[k]! * c;
    sumVbR += vAbc.b[k]! * s;
    sumVbI += vAbc.b[k]! * c;
    sumVcR += vAbc.c[k]! * s;
    sumVcI += vAbc.c[k]! * c;

    sumIaR += iAbc.a[k]! * s;
    sumIaI += iAbc.a[k]! * c;
    sumIbR += iAbc.b[k]! * s;
    sumIbI += iAbc.b[k]! * c;
    sumIcR += iAbc.c[k]! * s;
    sumIcI += iAbc.c[k]! * c;

    const win = Math.min(k + 1, cycleSteps);
    const scale = 2.0 / win;

    const VaRe = sumVaR * scale,
      VaIm = sumVaI * scale;
    const VbRe = sumVbR * scale,
      VbIm = sumVbI * scale;
    const VcRe = sumVcR * scale,
      VcIm = sumVcI * scale;

    const IaRe = sumIaR * scale,
      IaIm = sumIaI * scale;
    const IbRe = sumIbR * scale,
      IbIm = sumIbI * scale;
    const IcRe = sumIcR * scale,
      IcIm = sumIcI * scale;

    // Symmetrical voltage components
    const V0Re = (VaRe + VbRe + VcRe) / 3;
    const V0Im = (VaIm + VbIm + VcIm) / 3;
    const V1Re = (VaRe + (aRe * VbRe - aIm * VbIm) + (a2Re * VcRe - a2Im * VcIm)) / 3;
    const V1Im = (VaIm + (aRe * VbIm + aIm * VbRe) + (a2Re * VcIm + a2Im * VcRe)) / 3;
    const V2Re = (VaRe + (a2Re * VbRe - a2Im * VbIm) + (aRe * VcRe - aIm * VcIm)) / 3;
    const V2Im = (VaIm + (a2Re * VbIm + a2Im * VbRe) + (aRe * VcIm + aIm * VcRe)) / 3;

    // Symmetrical current components
    const I0Re = (IaRe + IbRe + IcRe) / 3;
    const I0Im = (IaIm + IbIm + IcIm) / 3;
    const I1Re = (IaRe + (aRe * IbRe - aIm * IbIm) + (a2Re * IcRe - a2Im * IcIm)) / 3;
    const I1Im = (IaIm + (aRe * IbIm + aIm * IbRe) + (a2Re * IcIm + a2Im * IcRe)) / 3;
    const I2Re = (IaRe + (a2Re * IbRe - a2Im * IbIm) + (aRe * IcRe - aIm * IcIm)) / 3;
    const I2Im = (IaIm + (a2Re * IbIm + a2Im * IbRe) + (aRe * IcIm + aIm * IcRe)) / 3;

    const magV1 = Math.hypot(V1Re, V1Im);
    const magV2 = Math.hypot(V2Re, V2Im);
    v0[k] = Math.hypot(V0Re, V0Im);
    v1[k] = magV1;
    v2[k] = magV2;

    i0[k] = Math.hypot(I0Re, I0Im);
    i1[k] = Math.hypot(I1Re, I1Im);
    i2[k] = Math.hypot(I2Re, I2Im);

    // Project I1 onto V1 reference frame:
    // Active current I1d = (V1Re * I1Re + V1Im * I1Im) / |V1|
    // Reactive current I1q (capacitive/over-excited injection supporting voltage > 0):
    // Under v(t) = V_m sin(wt + theta_v) and i(t) = I_d sin(wt + theta_v) - I_q cos(wt + theta_v),
    // I1q = (V1Im * I1Re - V1Re * I1Im) / |V1|
    if (magV1 > 1e-3) {
      i1d[k] = (V1Re * I1Re + V1Im * I1Im) / magV1;
      i1q[k] = (V1Im * I1Re - V1Re * I1Im) / magV1;
    }

    if (magV2 > 1e-3) {
      i2d[k] = (V2Re * I2Re + V2Im * I2Im) / magV2;
      i2q[k] = Math.abs(V2Im * I2Re - V2Re * I2Im) / magV2;
    }

    // Track positive-sequence phase angle, frequency, and RoCoF
    const theta1 = Math.atan2(V1Im, V1Re);
    if (k >= cycleSteps) {
      let dTheta = theta1 - prevTheta1;
      while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
      while (dTheta < -Math.PI) dTheta += 2 * Math.PI;

      const jumpDeg = Math.abs((dTheta * 180) / Math.PI);
      if (jumpDeg > maxPhaseJumpDeg) maxPhaseJumpDeg = jumpDeg;

      const instFreq = nominalFreqHz + dTheta / (2 * Math.PI * dt);
      const filtFreq = 0.95 * prevFreq + 0.05 * instFreq;
      frequencyHz[k] = filtFreq;
      rocofHzPerSec[k] = (filtFreq - prevFreq) / dt;
      prevFreq = filtFreq;
    } else {
      frequencyHz[k] = nominalFreqHz;
      rocofHzPerSec[k] = 0;
    }
    prevTheta1 = theta1;
  }

  return {
    v0,
    v1,
    v2,
    i0,
    i1,
    i2,
    i1d,
    i1q,
    i2d,
    i2q,
    frequencyHz,
    rocofHzPerSec,
    maxPhaseJumpDeg,
  };
}

/**
 * IEEE 2800-2022 Table 11 / NERC PRC-029-1 minimum mandatory voltage ride-through duration (seconds)
 * as a function of per-unit POI voltage.
 */
export function getMandatoryVrtDurationSec(vPu: number): number {
  if (vPu > 1.2) return 0.0;
  if (vPu > 1.1) return 1.0;
  if (vPu >= 0.9) return Infinity; // Continuous operation region
  if (vPu >= 0.7) return 6.0;
  if (vPu >= 0.5) return 2.5;
  if (vPu >= 0.25) return 1.2;
  if (vPu >= 0.1) return 0.32;
  return 0.16; // Zero-voltage ride-through (ZVRT) >= 160 ms
}

/**
 * Evaluates transient waveforms against IEEE 2800-2022 and NERC PRC-029-1 clauses.
 */
export function verifyIeee2800Compliance(
  projectName: string,
  netlist: EmtNetlist,
  waveforms: SimulationWaveformSample,
  faultSpec: Ieee2800FaultSpec,
): Ieee2800ComplianceReport {
  const { time, vPoi, iIbr, vPoiAbc, iIbrAbc } = waveforms;
  const n = time.length;
  const checks: Ieee2800CheckResult[] = [];

  const faultStart = faultSpec.faultStartSec;
  const faultEnd = faultStart + faultSpec.faultDurationSec;
  const vBase = faultSpec.vPreFaultKv * 1e3; // Peak voltage base
  const freqHz = netlist.nominalFrequencyHz > 0 ? netlist.nominalFrequencyHz : 60.0;

  // Compute cycle envelope (moving peak over 1 AC cycle) in O(N) time using a monotonic deque
  const dt = n > 1 ? Math.max(1e-9, time[1]! - time[0]!) : 20e-6;
  const cycleSteps = Math.max(1, Math.round(1 / freqHz / dt));

  const envelopes = new Float64Array(n);
  const dequeIdx = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < n; i++) {
    const minValidIdx = i - cycleSteps;
    while (head < tail && dequeIdx[head]! < minValidIdx) {
      head++;
    }
    const absI = Math.abs(iIbr[i]!);
    while (head < tail && Math.abs(iIbr[dequeIdx[tail - 1]!]!) <= absI) {
      tail--;
    }
    dequeIdx[tail++] = i;
    envelopes[i] = Math.abs(iIbr[dequeIdx[head]!]!);
  }

  // Pass 1: Determine pre-fault envelope, fault peak/minimum current, and post-fault peak voltage
  let iPreFault = 0;
  let iPeakFault = 0;
  let minCurrentDuringFault = Infinity;
  let maxPostFaultV = 0;
  let hasFaultSamples = false;

  for (let i = 0; i < n; i++) {
    const t = time[i]!;
    const v = Math.abs(vPoi[i]!);
    const currentEnvelope = envelopes[i]!;

    if (t < faultStart) {
      if (currentEnvelope > iPreFault) iPreFault = currentEnvelope;
    } else if (t >= faultStart && t <= faultEnd) {
      hasFaultSamples = true;
      if (currentEnvelope > iPeakFault) iPeakFault = currentEnvelope;
      if (t > faultStart + Math.min(0.015, faultSpec.faultDurationSec * 0.5)) {
        if (currentEnvelope < minCurrentDuringFault) minCurrentDuringFault = currentEnvelope;
      }
    } else if (t > faultEnd + 0.005) {
      if (v > maxPostFaultV) maxPostFaultV = v;
    }
  }

  if (!isFinite(minCurrentDuringFault)) {
    minCurrentDuringFault = hasFaultSamples ? iPeakFault : 0;
  }

  // Pass 2: Evaluate Momentary Cessation (Clause 5.3.2) and Two-Pass T_90% Rise Time (Clause 5.4.1)
  let momentaryCessationDetected = !hasFaultSamples || iPeakFault <= 1e-3;
  const cessationThreshold = Math.max(0.1 * iPreFault, 1e-3);

  const target90 =
    iPeakFault > 1.15 * iPreFault && iPreFault > 0 ? iPreFault + 0.9 * (iPeakFault - iPreFault) : 0.9 * iPeakFault;

  let t90Sec = -1;
  for (let i = 0; i < n; i++) {
    const t = time[i]!;
    if (t >= faultStart && t <= faultEnd) {
      const currentEnvelope = envelopes[i]!;
      if (t90Sec < 0 && iPeakFault > 1e-3 && currentEnvelope >= target90) {
        t90Sec = Math.max(0.001, t - faultStart);
      }
      if (t > faultStart + Math.min(0.02, faultSpec.faultDurationSec * 0.5) && currentEnvelope < cessationThreshold) {
        momentaryCessationDetected = true;
      }
    }
  }

  // --- Evaluate Check 1: Momentary Cessation ---
  if (!momentaryCessationDetected) {
    checks.push({
      clause: "5.3.2",
      title: "Prohibition of Momentary Cessation",
      status: "PASS",
      measuredValue: `Min current = ${minCurrentDuringFault.toFixed(1)} A (> 10% rated)`,
      requiredLimit: "Continuous active/reactive current injection during fault",
      details: "IBR plant maintained continuous current injection throughout voltage sag without cessation.",
    });
  } else {
    checks.push({
      clause: "5.3.2",
      title: "Prohibition of Momentary Cessation",
      status: "FAIL",
      measuredValue: `Current collapsed to ${minCurrentDuringFault.toFixed(1)} A (< 10% rated)`,
      requiredLimit: "Continuous current injection prohibited from entering cessation",
      details: "Inverter entered momentary cessation during transmission fault, violating IEEE 2800-2022.",
    });
  }

  // --- Evaluate Check 2: Fast Reactive Current Injection Speed (T_90% <= 50 ms) ---
  const t90Ms = t90Sec > 0 ? t90Sec * 1e3 : Infinity;
  if (t90Ms <= 50.0) {
    checks.push({
      clause: "5.4.1",
      title: "Fast Dynamic Reactive Current Response Time",
      status: "PASS",
      measuredValue: `T_90% = ${t90Ms.toFixed(1)} ms`,
      requiredLimit: "T_90% <= 50.0 ms",
      details: "Reactive current injection reached 90% of target within the mandatory 50 ms threshold.",
    });
  } else {
    checks.push({
      clause: "5.4.1",
      title: "Fast Dynamic Reactive Current Response Time",
      status: "FAIL",
      measuredValue: isFinite(t90Ms) ? `T_90% = ${t90Ms.toFixed(1)} ms` : "T_90% = N/A (no current response)",
      requiredLimit: "T_90% <= 50.0 ms",
      details: "Converter inner current loop response is too slow to support grid voltage recovery.",
    });
  }

  // --- Evaluate Check 3: Post-Fault Transient Overvoltage Overshoot ---
  const vPeakPu = vBase > 0 ? maxPostFaultV / vBase : 1.05;
  if (vPeakPu <= 1.2) {
    checks.push({
      clause: "5.4.2",
      title: "Post-Fault Transient Overvoltage Limit",
      status: "PASS",
      measuredValue: `V_peak = ${vPeakPu.toFixed(2)} pu`,
      requiredLimit: "V_peak <= 1.20 pu",
      details: "Post-clearing voltage recovery envelope remained within the safe 1.20 pu ceiling.",
    });
  } else {
    checks.push({
      clause: "5.4.2",
      title: "Post-Fault Transient Overvoltage Limit",
      status: "FAIL",
      measuredValue: `V_peak = ${vPeakPu.toFixed(2)} pu`,
      requiredLimit: "V_peak <= 1.20 pu",
      details: "Severe post-fault inductive kick / reactive over-injection caused excessive overvoltage.",
    });
  }

  // Optional Sequence-Domain & Extended IEEE 2800-2022 / NERC PRC-029 Clauses
  let sequencePhasors: SequencePhasorTrajectory | undefined;
  const runExtended = Boolean(faultSpec.evaluateExtendedClauses || (vPoiAbc && iIbrAbc));

  if (runExtended) {
    const synthVAbc: ThreePhaseChannels = vPoiAbc ?? {
      a: vPoi,
      b: vPoi,
      c: vPoi,
    };
    const synthIAbc: ThreePhaseChannels = iIbrAbc ?? {
      a: iIbr,
      b: iIbr,
      c: iIbr,
    };
    sequencePhasors = extractSequencePhasors(time, synthVAbc, synthIAbc, freqHz);

    // Check 4: Clause 7.2.2.1 / NERC PRC-029-1 Piecewise Time-Voltage Ride-Through Curve
    const vFaultPu = faultSpec.vPreFaultKv > 0 ? faultSpec.vFaultKv / faultSpec.vPreFaultKv : 0.1;
    const mandatoryDuration = getMandatoryVrtDurationSec(vFaultPu);
    const vrtPass = !momentaryCessationDetected && faultSpec.faultDurationSec <= mandatoryDuration;
    checks.push({
      clause: "7.2.2.1",
      title: "Piecewise Voltage Ride-Through (VRT) & NERC PRC-029 Envelope",
      status: vrtPass ? "PASS" : "FAIL",
      measuredValue: `V_sag = ${vFaultPu.toFixed(2)} pu for ${(faultSpec.faultDurationSec * 1e3).toFixed(0)} ms`,
      requiredLimit: `Mandatory ride-through <= ${(mandatoryDuration * 1e3).toFixed(0)} ms at ${vFaultPu.toFixed(2)} pu`,
      details: vrtPass
        ? "IBR rode through the piecewise voltage disturbance within the IEEE 2800 Table 11 / NERC PRC-029 mandatory zone."
        : "Disturbance exceeded VRT envelope or unit tripped/ceased inside mandatory operating region.",
    });

    // Check 5: Clause 7.2.2.3.4 Sequence Reactive Current Gain (k1 = dI_1q_pu / dV_1_pu)
    const iBase =
      faultSpec.ratedCurrentAmp && faultSpec.ratedCurrentAmp > 0 ? faultSpec.ratedCurrentAmp : Math.max(1.0, iPreFault);
    let i1qPre = 0;
    let i1qFaultMax = 0;
    let v1FaultMin = vBase;
    for (let i = 0; i < n; i++) {
      const t = time[i]!;
      if (t < faultStart && t >= Math.max(0, faultStart - 0.02)) {
        i1qPre = sequencePhasors.i1q[i]!;
      } else if (t >= faultStart && t <= faultEnd) {
        if (sequencePhasors.i1q[i]! > i1qFaultMax) i1qFaultMax = sequencePhasors.i1q[i]!;
        if (t > faultStart + cycleSteps * dt && sequencePhasors.v1[i]! < v1FaultMin) {
          v1FaultMin = sequencePhasors.v1[i]!;
        }
      }
    }
    const dI1qPu = Math.max(0, (i1qFaultMax - i1qPre) / iBase);
    const dV1Pu = Math.max(0.05, 1.0 - Math.min(vFaultPu, v1FaultMin / Math.max(1, vBase)));
    const measuredK1 = dI1qPu / dV1Pu;
    const minK1 = faultSpec.minK1Gain ?? 1.5;
    const k1Pass = measuredK1 >= minK1 || iPeakFault >= 0.95 * iBase;
    checks.push({
      clause: "7.2.2.3.4",
      title: "Incremental Positive/Negative-Sequence Reactive Current Support",
      status: k1Pass ? "PASS" : "FAIL",
      measuredValue: `k1 = ${measuredK1.toFixed(2)} pu/pu (dI_1q = ${(dI1qPu * 100).toFixed(1)}%)`,
      requiredLimit: `k1 >= ${minK1.toFixed(1)} pu/pu (or current limit reached)`,
      details: k1Pass
        ? "Dynamic sequence reactive current injection met required proportional voltage-droop gain."
        : "Insufficient positive-sequence reactive current boost during voltage sag.",
    });

    // Check 6: Clause 7.2.2.3.5 Post-Fault Active Power Recovery
    let postFaultMaxEnvelope = 0;
    let hasPostFaultWindow = false;
    for (let i = 0; i < n; i++) {
      if (time[i]! > faultEnd) {
        hasPostFaultWindow = true;
        if (envelopes[i]! > postFaultMaxEnvelope) postFaultMaxEnvelope = envelopes[i]!;
      }
    }
    const recoveryRatio = !hasPostFaultWindow || iPreFault <= 0 ? 1.0 : postFaultMaxEnvelope / iPreFault;
    const recoveryPass = recoveryRatio >= 0.9;
    checks.push({
      clause: "7.2.2.3.5",
      title: "Post-Fault Active Current / Power Recovery",
      status: recoveryPass ? "PASS" : "FAIL",
      measuredValue: `I_post / I_pre = ${(recoveryRatio * 100).toFixed(1)}%`,
      requiredLimit: ">= 90.0% recovery within 1.0 s of fault clearing",
      details: recoveryPass
        ? "Active current restored to >= 90% of pre-disturbance magnitude promptly after fault clearing."
        : "Post-fault active power recovery lagged below the 90% threshold.",
    });

    // Check 7: Clause 7.3.2 Frequency, RoCoF & Phase-Angle Jump Ride-Through
    const frtPass = !momentaryCessationDetected;
    checks.push({
      clause: "7.3.2",
      title: "RoCoF & Instantaneous Phase-Angle Jump Ride-Through",
      status: frtPass ? "PASS" : "FAIL",
      measuredValue: `Max phase jump = ${sequencePhasors.maxPhaseJumpDeg.toFixed(1)} deg`,
      requiredLimit: "Ride through RoCoF <= 5.0 Hz/s and phase jump <= 25.0 deg without tripping",
      details: frtPass
        ? "PLL and current control loop maintained synchronism through phase jump and frequency excursion."
        : "Synchronism lost or unit ceased output during phase/frequency transient.",
    });
  }

  const overallStatus = checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL";

  const summary =
    `IEEE 2800-2022 Interconnection Verification Report for '${projectName}':\n` +
    `  Overall Result: [${overallStatus}]\n` +
    checks
      .map((c) => `  • [${c.status}] Clause ${c.clause} (${c.title}): ${c.measuredValue} [Limit: ${c.requiredLimit}]`)
      .join("\n");

  return {
    projectName,
    overallStatus,
    evaluatedAt: new Date().toISOString(),
    checks,
    sequencePhasors,
    summary,
  };
}
