// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Centrifugal Pump Station HQ & NPSH Performance Curves.
 *
 * Implements polynomial head-capacity curves H(Q), variable-frequency drive (VFD) affinity laws,
 * hydraulic efficiency models, shaft power sizing, and dynamic Net Positive Suction Head (NPSH)
 * cavitation margin verification.
 */

const G_ACCELERATION = 9.80665; // m/s2

export interface PumpPerformanceCurve {
  ratedSpeedRpm: number; // e.g. 1780 or 2950 RPM
  minSpeedRpm?: number | undefined; // VFD lower limit (e.g. 1200 RPM)
  maxSpeedRpm?: number | undefined; // VFD upper limit (e.g. 3500 RPM)
  // Polynomial coefficients for Head in meters vs Q in m3/s:
  // H(Q) = a0 + a1*Q + a2*Q^2 + a3*Q^3
  headCoefficients: [number, number, number, number];
  // Polynomial coefficients for Hydraulic Efficiency (0..1) vs Q in m3/s:
  // eta(Q) = b0 + b1*Q + b2*Q^2 + b3*Q^3
  efficiencyCoefficients: [number, number, number, number];
  // Polynomial coefficients for NPSH Required in meters vs Q in m3/s:
  // NPSHR(Q) = c0 + c1*Q + c2*Q^2
  npshrCoefficients: [number, number, number];
  bestEfficiencyFlowM3s?: number | undefined;
  driverRatingWatts: number; // Motor rating (Watts)
  motorEfficiency?: number | undefined; // e.g. 0.95 for induction motor
}

export interface PumpOperatingPoint {
  speedRpm: number;
  speedRatio: number; // speedRpm / ratedSpeedRpm
  flowM3s: number;
  flowM3h: number;
  headMeters: number;
  differentialPressurePa: number;
  suctionPressurePa: number;
  dischargePressurePa: number;
  hydraulicPowerWatts: number;
  shaftPowerWatts: number;
  electricalPowerWatts: number;
  efficiency: number;
  npshRequiredMeters: number;
  npshAvailableMeters: number;
  npshMarginMeters: number;
  isCavitationHazard: boolean;
  isMotorOverloaded: boolean;
}

export class PumpCurveEngine {
  /**
   * Creates a default centrifugal mainline pipeline pump curve
   * (representative of a 3000 kW multi-stage pipeline booster pump).
   */
  static createDefaultPipelinePump(ratingWatts = 3.0e6, ratedRpm = 2950): PumpPerformanceCurve {
    // Typical pipeline pump: 1200 m3/h (~0.333 m3/s), 650 m head (~55 bar differential on oil)
    return {
      ratedSpeedRpm: ratedRpm,
      minSpeedRpm: ratedRpm * 0.6,
      maxSpeedRpm: ratedRpm * 1.05,
      // Head: H(0) = 820 m shutoff, H(0.33) ~ 680 m, H(0.45) ~ 450 m
      headCoefficients: [820.0, -150.0, -1200.0, -400.0],
      // Efficiency: peak ~ 86% around Q = 0.33 m3/s
      efficiencyCoefficients: [0.35, 3.2, -4.8, 0.0],
      // NPSHR: ~ 3.5 m at low flow, 7.5 m at 0.33 m3/s, 12 m at runout
      npshrCoefficients: [3.5, 8.0, 15.0],
      bestEfficiencyFlowM3s: 0.333,
      driverRatingWatts: ratingWatts,
      motorEfficiency: 0.95,
    };
  }

  /**
   * Evaluates pump operating point at a given flow rate and speed,
   * accounting for liquid density, vapor pressure, and suction conditions.
   */
  static evaluate(
    curve: PumpPerformanceCurve,
    suctionPressurePa: number,
    flowM3s: number,
    liquidProps: { densityKgM3: number; vaporPressurePa: number },
    targetDischargePressurePa?: number | undefined,
    suctionVelocityMS = 2.0,
  ): PumpOperatingPoint {
    const rho = Math.max(500.0, liquidProps.densityKgM3);
    const pVap = Math.max(1.0, liquidProps.vaporPressurePa);
    const qClamped = Math.max(0.001, flowM3s);

    // 1. Determine speed: If target discharge pressure is specified, solve for speed via affinity laws
    let speedRpm = curve.ratedSpeedRpm;
    if (targetDischargePressurePa && targetDischargePressurePa > suctionPressurePa) {
      const deltaPRequired = targetDischargePressurePa - suctionPressurePa;
      const headRequired = deltaPRequired / (rho * G_ACCELERATION);
      // H_rated at rated flow
      const hRated = Math.max(
        10.0,
        curve.headCoefficients[0] +
          curve.headCoefficients[1] * qClamped +
          curve.headCoefficients[2] * Math.pow(qClamped, 2) +
          curve.headCoefficients[3] * Math.pow(qClamped, 3),
      );
      // Head ~ (N / N0)^2
      const speedRatio = Math.sqrt(Math.max(0.1, headRequired / hRated));
      const minRpm = curve.minSpeedRpm ?? curve.ratedSpeedRpm * 0.6;
      const maxRpm = curve.maxSpeedRpm ?? curve.ratedSpeedRpm * 1.05;
      speedRpm = Math.max(minRpm, Math.min(maxRpm, curve.ratedSpeedRpm * speedRatio));
    }

    const alpha = speedRpm / curve.ratedSpeedRpm; // Affinity speed scaling ratio

    // 2. Evaluate Head using affinity laws:
    // H(Q, alpha) = alpha^2 * H_rated(Q / alpha)
    const qEquivalent = qClamped / Math.max(0.1, alpha);
    const hBase =
      curve.headCoefficients[0] +
      curve.headCoefficients[1] * qEquivalent +
      curve.headCoefficients[2] * Math.pow(qEquivalent, 2) +
      curve.headCoefficients[3] * Math.pow(qEquivalent, 3);
    const headMeters = Math.max(1.0, Math.pow(alpha, 2) * hBase);

    // Differential pressure
    const differentialPressurePa = rho * G_ACCELERATION * headMeters;
    const dischargePressurePa = suctionPressurePa + differentialPressurePa;

    // 3. Efficiency
    const etaBase =
      curve.efficiencyCoefficients[0] +
      curve.efficiencyCoefficients[1] * qEquivalent +
      curve.efficiencyCoefficients[2] * Math.pow(qEquivalent, 2) +
      curve.efficiencyCoefficients[3] * Math.pow(qEquivalent, 3);
    const efficiency = Math.max(0.2, Math.min(0.92, etaBase));

    // 4. Power
    const hydraulicPowerWatts = rho * G_ACCELERATION * qClamped * headMeters;
    const shaftPowerWatts = hydraulicPowerWatts / efficiency;
    const motorEff = curve.motorEfficiency ?? 0.95;
    const electricalPowerWatts = shaftPowerWatts / motorEff;
    const isMotorOverloaded = shaftPowerWatts > curve.driverRatingWatts * 1.05;

    // 5. NPSH & Cavitation
    // NPSHR scales approximately as alpha^2
    const npshrBase =
      curve.npshrCoefficients[0] +
      curve.npshrCoefficients[1] * qEquivalent +
      curve.npshrCoefficients[2] * Math.pow(qEquivalent, 2);
    const npshRequiredMeters = Math.max(0.5, Math.pow(alpha, 2) * npshrBase);

    // Available NPSH: NPSHA = (P_suction - P_vapor)/(rho*g) + v^2/(2*g)
    const staticHead = (suctionPressurePa - pVap) / (rho * G_ACCELERATION);
    const velocityHead = Math.pow(suctionVelocityMS, 2) / (2.0 * G_ACCELERATION);
    const npshAvailableMeters = Math.max(0.0, staticHead + velocityHead);

    const npshMarginMeters = npshAvailableMeters - npshRequiredMeters;
    const isCavitationHazard = npshMarginMeters < 0.5; // less than 0.5m safety buffer

    return {
      speedRpm,
      speedRatio: alpha,
      flowM3s: qClamped,
      flowM3h: qClamped * 3600.0,
      headMeters,
      differentialPressurePa,
      suctionPressurePa,
      dischargePressurePa,
      hydraulicPowerWatts,
      shaftPowerWatts,
      electricalPowerWatts,
      efficiency,
      npshRequiredMeters,
      npshAvailableMeters,
      npshMarginMeters,
      isCavitationHazard,
      isMotorOverloaded,
    };
  }
}
