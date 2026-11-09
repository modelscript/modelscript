// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE / IEC Digital Protection Relay Suite for EMT & Transient Simulation.
 *
 * Implements microprocessor numerical relay elements with 1-cycle fundamental/harmonic
 * sliding DFT phasor extraction and breaker trip output contacts:
 * - ANSI 21: Distance Relay (Mho & Quadrilateral Zones 1, 2, 3 + Power Swing Blocking 68)
 * - ANSI 87T / 87L: Dual-Slope Percentage Differential Relay with 2nd/5th Harmonic Restraint
 * - ANSI 50 / 51 / 67: Instantaneous & IEEE C37.112 / IEC 60255 Inverse-Time Directional Overcurrent
 * - ANSI 27 / 59 / 81U / 81O / 81R: Under/Over-Voltage, Under/Over-Frequency, and RoCoF Protection
 */

export type InverseTimeCurveType =
  | "ieee_moderately_inverse"
  | "ieee_very_inverse"
  | "ieee_extremely_inverse"
  | "iec_standard_inverse"
  | "iec_very_inverse"
  | "iec_extremely_inverse"
  | "definite_time";

export interface DistanceZoneSpec {
  zone: 1 | 2 | 3;
  characteristic: "mho" | "quadrilateral";
  /** Positive-sequence impedance reach magnitude |Z_reach| (Ohm) for Mho, or reactance reach X_reach (Ohm) for Quad. */
  reachOhm: number;
  /** Resistance blinder reach R_reach (Ohm) for quadrilateral characteristic. */
  resistanceReachOhm?: number | undefined;
  /** Line characteristic angle theta_L (deg, default: 80 deg). */
  lineAngleDeg?: number | undefined;
  /** Intentional coordination time delay (s): e.g. 0.0 s for Zone 1, 0.3 s for Zone 2, 0.8 s for Zone 3. */
  timeDelaySec: number;
  /** Direction: "forward" (default) or "reverse". */
  direction?: "forward" | "reverse" | undefined;
}

export interface DistanceRelayConfig {
  id: string;
  kind: "distance_21";
  nominalFreqHz?: number | undefined;
  /** Zero-sequence residual compensation factor k0 = |Z0 - Z1| / (3 * |Z1|). Default: 0.67. */
  k0Factor?: number | undefined;
  zones: DistanceZoneSpec[];
  /** Enable ANSI 68 Power Swing Blocking based on d|Z|/dt rate-of-change threshold (Ohm/s). */
  powerSwingBlockRateOhmPerSec?: number | undefined;
}

export interface DifferentialRelayConfig {
  id: string;
  kind: "differential_87";
  /** Minimum operating differential current pickup I_op,min (p.u. or A). Default: 0.20. */
  pickupCurrent: number;
  /** Slope 1 percentage restraint k1 (e.g. 0.25 for 25%). */
  slope1: number;
  /** Slope 2 percentage restraint k2 (e.g. 0.60 for 60%). */
  slope2: number;
  /** Restraint current breakpoint I_bias,knee where Slope 2 begins. Default: 2.0. */
  slope2KneeCurrent: number;
  /** 2nd-harmonic restraint ratio threshold I_2nd / I_1st for transformer inrush blocking (default: 0.15). */
  secondHarmonicBlockRatio?: number | undefined;
  /** 5th-harmonic restraint ratio threshold I_5th / I_1st for overexcitation blocking (default: 0.35). */
  fifthHarmonicBlockRatio?: number | undefined;
  /** Trip coordination delay (s, default: 0.0). */
  timeDelaySec?: number | undefined;
}

export interface OvercurrentRelayConfig {
  id: string;
  kind: "overcurrent_50_51_67";
  /** Time-current inverse characteristic curve (ANSI 51). */
  curve: InverseTimeCurveType;
  /** Pickup current I_pickup (A or p.u.). */
  pickupCurrent: number;
  /** Time Dial Setting (TDS / TMS). Default: 1.0. */
  timeDial: number;
  /** Optional ANSI 50 instantaneous high-set trip threshold I_inst (A or p.u.). */
  instantaneousPickup?: number | undefined;
  /** Optional ANSI 67 Maximum Torque Angle (MTA, deg) for forward directional supervision. */
  directionalMtaDeg?: number | undefined;
}

export interface VoltageFrequencyRelayConfig {
  id: string;
  kind: "voltage_freq_27_59_81";
  nominalVoltage?: number | undefined;
  nominalFreqHz?: number | undefined;
  /** ANSI 27 under-voltage pickup threshold (p.u. or V). */
  underVoltagePickup?: number | undefined;
  underVoltageDelaySec?: number | undefined;
  /** ANSI 59 over-voltage pickup threshold (p.u. or V). */
  overVoltagePickup?: number | undefined;
  overVoltageDelaySec?: number | undefined;
  /** ANSI 81U under-frequency pickup threshold (Hz). */
  underFreqHz?: number | undefined;
  underFreqDelaySec?: number | undefined;
  /** ANSI 81O over-frequency pickup threshold (Hz). */
  overFreqHz?: number | undefined;
  overFreqDelaySec?: number | undefined;
  /** ANSI 81R Rate-of-Change-of-Frequency (RoCoF) pickup threshold |df/dt| (Hz/s). */
  rocofHzPerSec?: number | undefined;
  rocofDelaySec?: number | undefined;
}

export type ProtectionRelayConfig =
  | DistanceRelayConfig
  | DifferentialRelayConfig
  | OvercurrentRelayConfig
  | VoltageFrequencyRelayConfig;

export interface ProtectionRelayOutput {
  id: string;
  pickedUp: boolean;
  tripped: boolean;
  tripTimeSec?: number | undefined;
  activeElement?: string | undefined;
  measuredImpedanceOhm?: { r: number; x: number; mag: number } | undefined;
  differentialCurrent?: { iOp: number; iRes: number; harmonicBlocked: boolean } | undefined;
  overcurrentAccumulator?: number | undefined;
}

/**
 * Evaluates standard IEEE C37.112 and IEC 60255 inverse-time overcurrent trip duration t(M)
 * for current multiple M = I / I_pickup > 1.0.
 */
export function evaluateInverseTimeCurveSec(curve: InverseTimeCurveType, multipleM: number, timeDial: number): number {
  if (multipleM <= 1.0) return Number.POSITIVE_INFINITY;
  const td = Math.max(0.01, timeDial);
  switch (curve) {
    case "ieee_moderately_inverse":
      return td * (0.0515 / (Math.pow(multipleM, 0.02) - 1.0) + 0.114);
    case "ieee_very_inverse":
      return td * (19.61 / (Math.pow(multipleM, 2.0) - 1.0) + 0.491);
    case "ieee_extremely_inverse":
      return td * (28.2 / (Math.pow(multipleM, 2.0) - 1.0) + 0.1217);
    case "iec_standard_inverse":
      return td * (0.14 / (Math.pow(multipleM, 0.02) - 1.0));
    case "iec_very_inverse":
      return td * (13.5 / (multipleM - 1.0));
    case "iec_extremely_inverse":
      return td * (80.0 / (Math.pow(multipleM, 2.0) - 1.0));
    case "definite_time":
      return td;
  }
}

/**
 * Stateful Digital Protection Relay Element executing at each simulation step `dt`.
 */
export class DigitalProtectionRelay {
  public readonly config: ProtectionRelayConfig;
  private tripped = false;
  private tripTimeSec: number | undefined;
  private activeElement: string | undefined;

  // Timers & state accumulators
  private zoneTimers = new Float64Array(4);
  private prevZMag = Number.POSITIVE_INFINITY;
  private swingBlocked = false;
  private diffTimer = 0;
  private ocAccumulator = 0;
  private uvTimer = 0;
  private ovTimer = 0;
  private ufTimer = 0;
  private ofTimer = 0;
  private rocofTimer = 0;

  constructor(config: ProtectionRelayConfig) {
    this.config = config;
  }

  public reset(): void {
    this.tripped = false;
    this.tripTimeSec = undefined;
    this.activeElement = undefined;
    this.zoneTimers.fill(0);
    this.prevZMag = Number.POSITIVE_INFINITY;
    this.swingBlocked = false;
    this.diffTimer = 0;
    this.ocAccumulator = 0;
    this.uvTimer = 0;
    this.ovTimer = 0;
    this.ufTimer = 0;
    this.ofTimer = 0;
    this.rocofTimer = 0;
  }

  /**
   * Steps an ANSI 21 Distance Relay given fundamental voltage phasor V = (vRe + j*vIm)
   * and current phasor I = (iRe + j*iIm), plus optional zero-sequence current I0 = (i0Re + j*i0Im).
   */
  public stepDistance(
    t: number,
    dt: number,
    vPhasor: { re: number; im: number },
    iPhasor: { re: number; im: number },
    i0Phasor?: { re: number; im: number },
  ): ProtectionRelayOutput {
    if (this.config.kind !== "distance_21") {
      throw new Error(`Relay '${this.config.id}' is not an ANSI 21 distance relay.`);
    }
    const cfg = this.config;
    const k0 = cfg.k0Factor ?? 0.67;
    const iCompRe = iPhasor.re + (i0Phasor ? 3.0 * k0 * i0Phasor.re : 0);
    const iCompIm = iPhasor.im + (i0Phasor ? 3.0 * k0 * i0Phasor.im : 0);
    const iMagSq = iCompRe * iCompRe + iCompIm * iCompIm;

    let zRe = 1e6;
    let zIm = 1e6;
    if (iMagSq > 1e-6) {
      zRe = (vPhasor.re * iCompRe + vPhasor.im * iCompIm) / iMagSq;
      zIm = (vPhasor.im * iCompRe - vPhasor.re * iCompIm) / iMagSq;
    }
    const zMag = Math.hypot(zRe, zIm);

    // ANSI 68 Power Swing Blocking check: slow d|Z|/dt enters outer zone, whereas a fault steps instantaneously
    if (cfg.powerSwingBlockRateOhmPerSec !== undefined && Number.isFinite(this.prevZMag) && dt > 0) {
      const dzDt = Math.abs(zMag - this.prevZMag) / dt;
      if (zMag < 2.0 * (cfg.zones[0]?.reachOhm ?? 50.0) && dzDt > 1.0 && dzDt < cfg.powerSwingBlockRateOhmPerSec) {
        this.swingBlocked = true;
      } else if (dzDt >= cfg.powerSwingBlockRateOhmPerSec * 2.0) {
        this.swingBlocked = false;
      }
    }
    this.prevZMag = zMag;

    let anyPickup = false;
    if (!this.swingBlocked) {
      for (let idx = 0; idx < cfg.zones.length; idx++) {
        const zSpec = cfg.zones[idx]!;
        const thetaRad = ((zSpec.lineAngleDeg ?? 80.0) * Math.PI) / 180.0;
        const dirSign = zSpec.direction === "reverse" ? -1.0 : 1.0;
        const zR = dirSign * zRe;
        const zX = dirSign * zIm;

        let inZone = false;
        if (zSpec.characteristic === "mho") {
          // Mho circle passing through origin with diameter Z_reach at angle thetaRad:
          // |Z - (Z_reach / 2) * e^{j*theta}| <= Z_reach / 2
          const centerR = 0.5 * zSpec.reachOhm * Math.cos(thetaRad);
          const centerX = 0.5 * zSpec.reachOhm * Math.sin(thetaRad);
          const dist = Math.hypot(zR - centerR, zX - centerX);
          inZone = dist <= 0.5 * zSpec.reachOhm;
        } else {
          // Quadrilateral: 0 <= X <= X_reach and |R - X / tan(theta)| <= R_reach
          const rReach = zSpec.resistanceReachOhm ?? 0.5 * zSpec.reachOhm;
          const cotTheta = Math.cos(thetaRad) / Math.max(1e-3, Math.sin(thetaRad));
          inZone = zX >= 0 && zX <= zSpec.reachOhm && Math.abs(zR - zX * cotTheta) <= rReach;
        }

        if (inZone) {
          anyPickup = true;
          this.zoneTimers[idx] = this.zoneTimers[idx]! + dt;
          if (!this.tripped && this.zoneTimers[idx]! + 1e-9 >= zSpec.timeDelaySec) {
            this.tripped = true;
            this.tripTimeSec = t;
            this.activeElement = `21-Z${zSpec.zone}`;
          }
        } else {
          this.zoneTimers[idx] = 0;
        }
      }
    }

    return {
      id: cfg.id,
      pickedUp: anyPickup,
      tripped: this.tripped,
      tripTimeSec: this.tripTimeSec,
      activeElement: this.activeElement,
      measuredImpedanceOhm: { r: zRe, x: zIm, mag: zMag },
    };
  }

  /**
   * Steps an ANSI 87T / 87L Dual-Slope Percentage Differential Relay with 2nd/5th Harmonic Restraint.
   */
  public stepDifferential(
    t: number,
    dt: number,
    iTerminal1: { re: number; im: number },
    iTerminal2: { re: number; im: number },
    harmonics?: { i2ndMag?: number | undefined; i5thMag?: number | undefined },
  ): ProtectionRelayOutput {
    if (this.config.kind !== "differential_87") {
      throw new Error(`Relay '${this.config.id}' is not an ANSI 87 differential relay.`);
    }
    const cfg = this.config;
    const iOpRe = iTerminal1.re + iTerminal2.re;
    const iOpIm = iTerminal1.im + iTerminal2.im;
    const iOp = Math.hypot(iOpRe, iOpIm);
    const iRes = 0.5 * (Math.hypot(iTerminal1.re, iTerminal1.im) + Math.hypot(iTerminal2.re, iTerminal2.im));

    const reqThreshold =
      iRes <= cfg.slope2KneeCurrent
        ? Math.max(cfg.pickupCurrent, cfg.slope1 * iRes)
        : Math.max(cfg.pickupCurrent, cfg.slope1 * cfg.slope2KneeCurrent + cfg.slope2 * (iRes - cfg.slope2KneeCurrent));

    const h2Ratio = (harmonics?.i2ndMag ?? 0) / Math.max(1e-6, iOp);
    const h5Ratio = (harmonics?.i5thMag ?? 0) / Math.max(1e-6, iOp);
    const harmonicBlocked =
      h2Ratio >= (cfg.secondHarmonicBlockRatio ?? 0.15) || h5Ratio >= (cfg.fifthHarmonicBlockRatio ?? 0.35);

    const pickedUp = iOp >= reqThreshold && !harmonicBlocked;
    if (pickedUp) {
      this.diffTimer += dt;
      if (!this.tripped && this.diffTimer + 1e-9 >= (cfg.timeDelaySec ?? 0)) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = "87-DIFF";
      }
    } else {
      this.diffTimer = 0;
    }

    return {
      id: cfg.id,
      pickedUp,
      tripped: this.tripped,
      tripTimeSec: this.tripTimeSec,
      activeElement: this.activeElement,
      differentialCurrent: { iOp, iRes, harmonicBlocked },
    };
  }

  /**
   * Steps an ANSI 50 / 51 / 67 Instantaneous & Inverse-Time Directional Overcurrent Relay.
   */
  public stepOvercurrent(
    t: number,
    dt: number,
    currentMag: number,
    directionalAngleDeg?: number,
  ): ProtectionRelayOutput {
    if (this.config.kind !== "overcurrent_50_51_67") {
      throw new Error(`Relay '${this.config.id}' is not an ANSI 50/51/67 overcurrent relay.`);
    }
    const cfg = this.config;

    // ANSI 67 Directional check: |angle - MTA| <= 85 deg
    let directionForward = true;
    if (cfg.directionalMtaDeg !== undefined && directionalAngleDeg !== undefined) {
      let diff = ((directionalAngleDeg - cfg.directionalMtaDeg + 180) % 360) - 180;
      if (diff < -180) diff += 360;
      directionForward = Math.abs(diff) <= 85.0;
    }

    // ANSI 50 Instantaneous element
    if (
      directionForward &&
      cfg.instantaneousPickup !== undefined &&
      currentMag >= cfg.instantaneousPickup &&
      !this.tripped
    ) {
      this.tripped = true;
      this.tripTimeSec = t;
      this.activeElement = "50-INST";
    }

    const multipleM = currentMag / Math.max(1e-9, cfg.pickupCurrent);
    const pickedUp = directionForward && multipleM > 1.0;

    if (pickedUp) {
      const tripSec = evaluateInverseTimeCurveSec(cfg.curve, multipleM, cfg.timeDial);
      if (tripSec > 0 && Number.isFinite(tripSec)) {
        this.ocAccumulator += dt / tripSec;
      }
      if (!this.tripped && this.ocAccumulator >= 1.0 - 1e-9) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = cfg.directionalMtaDeg !== undefined ? "67-TOC" : "51-TOC";
      }
    } else if (multipleM < 1.0 && this.ocAccumulator > 0) {
      // Dynamic disk reset
      this.ocAccumulator = Math.max(0, this.ocAccumulator - dt * 0.5);
    }

    return {
      id: cfg.id,
      pickedUp,
      tripped: this.tripped,
      tripTimeSec: this.tripTimeSec,
      activeElement: this.activeElement,
      overcurrentAccumulator: this.ocAccumulator,
    };
  }

  /**
   * Steps an ANSI 27 / 59 / 81U / 81O / 81R Voltage, Frequency, & RoCoF Protection Relay.
   */
  public stepVoltageFrequency(
    t: number,
    dt: number,
    voltageMag: number,
    freqHz: number,
    rocofHzPerSec = 0,
  ): ProtectionRelayOutput {
    if (this.config.kind !== "voltage_freq_27_59_81") {
      throw new Error(`Relay '${this.config.id}' is not an ANSI 27/59/81 voltage/frequency relay.`);
    }
    const cfg = this.config;
    let pickedUp = false;

    if (cfg.underVoltagePickup !== undefined && voltageMag < cfg.underVoltagePickup) {
      pickedUp = true;
      this.uvTimer += dt;
      if (!this.tripped && this.uvTimer + 1e-9 >= (cfg.underVoltageDelaySec ?? 0.1)) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = "27-UV";
      }
    } else {
      this.uvTimer = 0;
    }

    if (cfg.overVoltagePickup !== undefined && voltageMag > cfg.overVoltagePickup) {
      pickedUp = true;
      this.ovTimer += dt;
      if (!this.tripped && this.ovTimer + 1e-9 >= (cfg.overVoltageDelaySec ?? 0.1)) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = "59-OV";
      }
    } else {
      this.ovTimer = 0;
    }

    if (cfg.underFreqHz !== undefined && freqHz < cfg.underFreqHz) {
      pickedUp = true;
      this.ufTimer += dt;
      if (!this.tripped && this.ufTimer + 1e-9 >= (cfg.underFreqDelaySec ?? 0.1)) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = "81U-UF";
      }
    } else {
      this.ufTimer = 0;
    }

    if (cfg.overFreqHz !== undefined && freqHz > cfg.overFreqHz) {
      pickedUp = true;
      this.ofTimer += dt;
      if (!this.tripped && this.ofTimer + 1e-9 >= (cfg.overFreqDelaySec ?? 0.1)) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = "81O-OF";
      }
    } else {
      this.ofTimer = 0;
    }

    if (cfg.rocofHzPerSec !== undefined && Math.abs(rocofHzPerSec) >= cfg.rocofHzPerSec) {
      pickedUp = true;
      this.rocofTimer += dt;
      if (!this.tripped && this.rocofTimer + 1e-9 >= (cfg.rocofDelaySec ?? 0.05)) {
        this.tripped = true;
        this.tripTimeSec = t;
        this.activeElement = "81R-ROCOF";
      }
    } else {
      this.rocofTimer = 0;
    }

    return {
      id: cfg.id,
      pickedUp,
      tripped: this.tripped,
      tripTimeSec: this.tripTimeSec,
      activeElement: this.activeElement,
    };
  }
}
