// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gensys — Cross-Wind Vehicle Aerodynamics (EN 14067-6)
 *
 * Implements standard railway aerodynamic safety assessment according to EN 14067-6:
 * - Relative effective airspeed v_eff and aerodynamic yaw angle beta (angle of attack)
 * - Aerodynamic side force F_y, lift force F_z, and overturning roll moment M_x
 * - Chinese Hat standardized wind gust profile:
 *     v(t) = v_mean + (Delta_v / 2) * (1 - cos(2*pi*(t - t0) / T_gust))
 * - Dynamic wheel unloading ratio Delta Q / Q0 <= 0.90 criterion
 * - Characteristic Wind Curve (CWC) computation
 */

export interface WindGustProfile {
  type: "steady" | "chinese_hat";
  meanWindSpeed: number; // Mean wind speed [m/s]
  gustAmplitude?: number; // Delta v_gust [m/s] (default 0)
  gustDuration?: number; // T_gust [s] (default 2.0 s)
  gustStartTime?: number; // t0 [s] (default 0 s)
  windAngleDeg: number; // Wind angle relative to track [deg] (90 deg = perpendicular crosswind)
}

export interface AerodynamicCoefficients {
  cY?: (betaRad: number) => number; // Side force coefficient C_Y(beta)
  cL?: (betaRad: number) => number; // Lift force coefficient C_L(beta)
  cMx?: (betaRad: number) => number; // Roll moment coefficient C_Mx(beta)
  cD?: (betaRad: number) => number; // Drag coefficient C_D(beta)
}

export interface CrossWindParameters {
  airDensity?: number; // Air density rho [kg/m^3] (default 1.225)
  referenceArea: number; // Reference frontal/side area A_ref [m^2] (typical ~10.0 m^2)
  referenceLength?: number; // Reference length L_ref [m] (typical ~20-25 m)
  referenceHeight?: number; // Moment arm from rail top to carbody center of pressure [m] (typical ~2.0-3.0 m)
  coefficients?: AerodynamicCoefficients;
}

export interface CrossWindInput {
  trainSpeed: number; // Forward train velocity v_train [m/s]
  windSpeed: number; // Instantaneous crosswind velocity v_wind [m/s]
  windAngleDeg: number; // Crosswind direction angle [deg]
  params: CrossWindParameters;
}

export interface CrossWindForcesResult {
  effectiveAirspeed: number; // v_eff [m/s]
  yawAngleRad: number; // Aerodynamic angle of attack beta [rad]
  yawAngleDeg: number; // beta in degrees
  dynamicPressure: number; // q = 0.5 * rho * v_eff^2 [Pa]
  sideForceY: number; // F_y [N]
  liftForceZ: number; // F_z [N] (positive upward)
  dragForceX: number; // F_x [N] (retarding train)
  rollMomentX: number; // M_x [Nm] (overturning roll moment about rail/center)
  coeffSideY: number; // C_Y(beta)
  coeffLiftZ: number; // C_L(beta)
  coeffRollX: number; // C_Mx(beta)
}

export interface WheelUnloadingAssessmentInput {
  nominalWheelLoadN: number; // Q0 [N] (static load per wheel, e.g. 50,000 N)
  trackGaugeM?: number; // Track gauge 2*b0 [m] (default 1.5 m)
  forces: CrossWindForcesResult;
  suspensionRollStiffness?: number; // c_phi [Nm/rad]
  carbodyMassKg?: number; // M_c [kg]
  centerOfGravityHeightM?: number; // h_cg [m]
}

export interface WheelUnloadingAssessmentResult {
  windwardWheelLoadN: number; // Q_windward [N] (relieved by overturning moment and lift)
  leewardWheelLoadN: number; // Q_leeward [N] (burdened by overturning moment)
  wheelUnloadingRatio: number; // Delta Q / Q0 = (Q0 - Q_windward) / Q0
  overturningLimitPassed: boolean; // Delta Q / Q0 <= 0.90
  criticalLimit: number; // 0.90 standard EN 14067-6 threshold
}

export interface CharacteristicWindCurvePoint {
  trainSpeedKmh: number;
  trainSpeedMs: number;
  criticalWindSpeedMs: number; // Maximum wind speed before Delta Q / Q0 reaches 0.90
  criticalWindSpeedKmh: number;
}

/**
 * Standard EN 14067-6 polynomial coefficient approximations for passenger EMU leading vehicle.
 */
export const defaultEn14067Coefficients: Required<AerodynamicCoefficients> = {
  cY: (beta: number) => 1.8 * Math.sin(beta) + 0.6 * Math.sin(2 * beta),
  cL: (beta: number) => 0.15 + 0.85 * Math.sin(beta) * Math.sin(beta),
  cMx: (beta: number) => 1.2 * Math.sin(beta) + 0.4 * Math.sin(2 * beta),
  cD: (beta: number) => 0.35 + 0.8 * Math.pow(Math.sin(beta), 1.5),
};

/**
 * Evaluates instantaneous wind speed and direction at time t for steady wind or Chinese Hat gust.
 */
export function evaluateWindProfile(
  profile: WindGustProfile,
  time: number,
): { windSpeed: number; windAngleDeg: number } {
  if (profile.type === "steady") {
    return { windSpeed: profile.meanWindSpeed, windAngleDeg: profile.windAngleDeg };
  }

  const gustDuration = profile.gustDuration ?? 2.0;
  const gustStart = profile.gustStartTime ?? 0.0;
  const gustAmp = profile.gustAmplitude ?? 0.0;

  if (time < gustStart || time > gustStart + gustDuration) {
    return { windSpeed: profile.meanWindSpeed, windAngleDeg: profile.windAngleDeg };
  }

  // Chinese Hat 1 - cos profile
  const tau = (time - gustStart) / gustDuration;
  const gustComponent = (gustAmp / 2) * (1 - Math.cos(2 * Math.PI * tau));
  return {
    windSpeed: profile.meanWindSpeed + gustComponent,
    windAngleDeg: profile.windAngleDeg,
  };
}

/**
 * Computes aerodynamic forces and overturning moments according to EN 14067-6.
 */
export function evaluateCrossWindAerodynamics(input: CrossWindInput): CrossWindForcesResult {
  const { trainSpeed, windSpeed, windAngleDeg, params } = input;
  const rho = params.airDensity ?? 1.225;
  const aRef = params.referenceArea;
  const dRef = params.referenceHeight ?? 2.5;

  const windAngleRad = (windAngleDeg * Math.PI) / 180;

  // Relative airspeed components: train moves in +x direction
  // Wind blows at angle windAngle relative to track direction
  const vxEff = trainSpeed + windSpeed * Math.cos(windAngleRad);
  const vyEff = windSpeed * Math.sin(windAngleRad);
  const vEff = Math.sqrt(vxEff * vxEff + vyEff * vyEff);

  // Aerodynamic yaw angle beta
  const yawAngleRad = vEff > 1e-6 ? Math.atan2(Math.abs(vyEff), Math.max(0, vxEff)) : 0;
  const yawAngleDeg = (yawAngleRad * 180) / Math.PI;

  const q = 0.5 * rho * vEff * vEff; // Dynamic pressure

  const coeffs = {
    cY: params.coefficients?.cY ?? defaultEn14067Coefficients.cY,
    cL: params.coefficients?.cL ?? defaultEn14067Coefficients.cL,
    cMx: params.coefficients?.cMx ?? defaultEn14067Coefficients.cMx,
    cD: params.coefficients?.cD ?? defaultEn14067Coefficients.cD,
  };

  const cyVal = coeffs.cY(yawAngleRad);
  const clVal = coeffs.cL(yawAngleRad);
  const cmxVal = coeffs.cMx(yawAngleRad);
  const cdVal = coeffs.cD(yawAngleRad);

  const sideForceSign = vyEff >= 0 ? 1 : -1;

  const sideForceY = sideForceSign * q * aRef * cyVal;
  const liftForceZ = q * aRef * clVal;
  const dragForceX = q * aRef * cdVal;
  const rollMomentX = sideForceSign * q * aRef * dRef * cmxVal;

  return {
    effectiveAirspeed: vEff,
    yawAngleRad,
    yawAngleDeg,
    dynamicPressure: q,
    sideForceY,
    liftForceZ,
    dragForceX,
    rollMomentX,
    coeffSideY: cyVal,
    coeffLiftZ: clVal,
    coeffRollX: cmxVal,
  };
}

/**
 * Assesses wheel unloading ratio Delta Q / Q0 according to EN 14067-6.
 * Limit: Delta Q / Q0 <= 0.90 to prevent wheel lift-off and vehicle derailment/overturning.
 */
export function evaluateWheelUnloading(input: WheelUnloadingAssessmentInput): WheelUnloadingAssessmentResult {
  const { nominalWheelLoadN, forces } = input;
  const trackGauge = input.trackGaugeM ?? 1.5; // Lateral distance between wheel-rail contact points 2*b0

  // The overturning roll moment M_x transfers vertical load from the windward to the leeward wheels:
  // Delta Q_roll = M_x / trackGauge (per axle or bogie)
  const deltaQRoll = Math.abs(forces.rollMomentX) / trackGauge;

  // The aerodynamic lift force F_z reduces total vertical load on both wheels equally:
  // Delta Q_lift = F_z / 4 (assuming 4 wheels per carbody/bogie)
  const deltaQLift = Math.max(0, forces.liftForceZ) / 4;

  // Windward wheel load is reduced by both overturning moment and aerodynamic lift:
  const windwardWheelLoadN = Math.max(0, nominalWheelLoadN - deltaQRoll - deltaQLift);
  const leewardWheelLoadN = nominalWheelLoadN + deltaQRoll - deltaQLift;

  // Wheel unloading ratio Delta Q / Q0
  const wheelUnloadingRatio =
    nominalWheelLoadN > 0 ? (nominalWheelLoadN - windwardWheelLoadN) / nominalWheelLoadN : 1.0;

  const criticalLimit = 0.9; // Standard EN 14067-6 requirement
  const overturningLimitPassed = wheelUnloadingRatio <= criticalLimit;

  return {
    windwardWheelLoadN,
    leewardWheelLoadN,
    wheelUnloadingRatio,
    overturningLimitPassed,
    criticalLimit,
  };
}

/**
 * Generates the Characteristic Wind Curve (CWC) according to EN 14067-6:
 * Determines the maximum permissible crosswind velocity v_crit across a range of train speeds.
 */
export function generateCharacteristicWindCurve(
  trainSpeedsKmh: number[],
  nominalWheelLoadN: number,
  params: CrossWindParameters,
  windAngleDeg: number = 90, // Pure perpendicular crosswind
  tolerance: number = 0.1, // m/s convergence
): CharacteristicWindCurvePoint[] {
  const points: CharacteristicWindCurvePoint[] = [];

  for (const vKmh of trainSpeedsKmh) {
    const vTrainMs = vKmh / 3.6;

    // Binary search for maximum permissible wind speed v_wind where Delta Q / Q0 = 0.90
    let lowWind = 0;
    let highWind = 80.0; // 80 m/s (~288 km/h hurricane)

    while (highWind - lowWind > tolerance) {
      const midWind = (lowWind + highWind) / 2;
      const forces = evaluateCrossWindAerodynamics({
        trainSpeed: vTrainMs,
        windSpeed: midWind,
        windAngleDeg,
        params,
      });

      const assessment = evaluateWheelUnloading({
        nominalWheelLoadN,
        forces,
      });

      if (assessment.overturningLimitPassed) {
        lowWind = midWind; // Can tolerate higher wind
      } else {
        highWind = midWind; // Exceeds limit
      }
    }

    const criticalWindMs = lowWind;
    points.push({
      trainSpeedKmh: vKmh,
      trainSpeedMs: vTrainMs,
      criticalWindSpeedMs: criticalWindMs,
      criticalWindSpeedKmh: criticalWindMs * 3.6,
    });
  }

  return points;
}
