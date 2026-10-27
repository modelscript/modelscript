// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Multi-Wheel Compressor Performance Maps & Anti-Surge Controller.
 *
 * Implements non-dimensional head-flow characteristics (Psi vs Phi), variable-speed governors,
 * polytropic efficiency curves, parabolic surge line detection, stonewall (choke) limits,
 * and automated anti-surge recycle valve modulation.
 */

export interface CompressorSpeedCurve {
  speedRpm: number;
  flowCoeffs: number[]; // Flow coefficient Phi = Q / (N * D^3)
  headCoeffs: number[]; // Head coefficient Psi = H_poly / (N^2 * D^2)
  efficiency: number[]; // Polytropic efficiency (0.0 to 1.0)
  surgeFlowM3s: number; // Actual volumetric flow at surge line (m3/s)
  stonewallFlowM3s: number; // Maximum volumetric flow before sonic choke (m3/s)
}

export interface CompressorPerformanceMap {
  impellerDiameter: number; // Impeller tip diameter in meters (e.g. 0.45 m)
  ratedSpeedRpm: number; // Nominal design speed (e.g. 10,000 RPM)
  minSpeedRpm: number; // Minimum governor speed (e.g. 7,000 RPM)
  maxSpeedRpm: number; // Maximum governor speed / trip speed (e.g. 11,500 RPM)
  referenceGasDensityKgM3: number; // Baseline gas density (e.g. 45.0 kg/m3)
  surgeSafetyMarginPercent?: number | undefined; // Anti-surge buffer (default 10%)
  driverType?: "GAS_TURBINE" | "ELECTRIC_MOTOR" | "STEAM_TURBINE" | undefined;
  driverRatingWatts: number; // Maximum driver shaft power rating
  driverThermalEfficiency?: number | undefined; // e.g. 0.38 for gas turbine, 0.96 for VFD motor
  mechanicalEfficiency?: number | undefined; // Gearbox/bearing efficiency (default 0.98)
  speedCurves: CompressorSpeedCurve[];
}

export interface CompressorOperatingPoint {
  speedRpm: number;
  speedRatio: number; // speedRpm / ratedSpeedRpm
  actualInletFlowM3s: number;
  massFlowThroughputKgS: number;
  suctionPressurePa: number;
  dischargePressurePa: number;
  pressureRatio: number;
  polytropicHeadJkg: number;
  polytropicEfficiency: number;
  gasPowerWatts: number;
  shaftPowerWatts: number;
  driverPowerWatts: number;
  fuelGasRateKgS: number;
  dischargeTempK: number;
  isSurging: boolean;
  isStonewalled: boolean;
  antiSurgeRecycleFlowM3s: number;
  surgeSafetyMarginActualPercent: number;
}

export class CompressorMapEngine {
  /**
   * Generates a standard default centrifugal compressor performance map
   * based on Solar Titan 130 / Mars 100 pipeline boost compressors.
   */
  static createDefaultPipelineMap(ratingWatts = 15.0e6, ratedRpm = 9500): CompressorPerformanceMap {
    const d = 0.52; // 520 mm impeller
    const speeds = [0.75, 0.85, 0.95, 1.0, 1.05].map((s) => s * ratedRpm);

    const speedCurves: CompressorSpeedCurve[] = speeds.map((rpm) => {
      const speedRatio = rpm / ratedRpm;
      const baseSurge = 1.2 * speedRatio;
      const baseChoke = 3.6 * speedRatio;

      return {
        speedRpm: rpm,
        flowCoeffs: [0.045, 0.065, 0.085, 0.105, 0.125],
        headCoeffs: [0.62 * speedRatio, 0.58 * speedRatio, 0.52 * speedRatio, 0.44 * speedRatio, 0.32 * speedRatio],
        efficiency: [0.74, 0.82, 0.85, 0.83, 0.76],
        surgeFlowM3s: baseSurge,
        stonewallFlowM3s: baseChoke,
      };
    });

    return {
      impellerDiameter: d,
      ratedSpeedRpm: ratedRpm,
      minSpeedRpm: ratedRpm * 0.7,
      maxSpeedRpm: ratedRpm * 1.08,
      referenceGasDensityKgM3: 42.0,
      surgeSafetyMarginPercent: 10.0,
      driverType: "GAS_TURBINE",
      driverRatingWatts: ratingWatts,
      driverThermalEfficiency: 0.36,
      mechanicalEfficiency: 0.98,
      speedCurves,
    };
  }

  /**
   * Evaluates the operating point of a compressor given inlet conditions,
   * desired discharge pressure target, and throughput mass flow rate.
   */
  static evaluate(
    map: CompressorPerformanceMap,
    suctionPressurePa: number,
    suctionTempK: number,
    targetDischargePressurePa: number,
    massFlowKgS: number,
    gasProps: { molarMass: number; zFactor: number; isentropicExponent: number; lhvMjKg?: number },
  ): CompressorOperatingPoint {
    const k = gasProps.isentropicExponent;
    const zAvg = gasProps.zFactor;
    const mm = gasProps.molarMass > 1.0 ? gasProps.molarMass / 1000.0 : gasProps.molarMass;
    const rSpec = 8.314462618 / mm;
    const lhv = gasProps.lhvMjKg ?? 47.0; // MJ/kg Lower Heating Value

    // Suction volumetric density
    const rhoInlet = suctionPressurePa / Math.max(100.0, zAvg * rSpec * suctionTempK);
    const actualInflowM3s = massFlowKgS / Math.max(0.1, rhoInlet);

    // Pressure ratio requested
    const targetPr = Math.max(1.0, targetDischargePressurePa / Math.max(1.0e5, suctionPressurePa));

    // Ideal isentropic head required
    const isentropicExponentTerm = (k - 1.0) / k;
    const hIsoRequired =
      (k / (k - 1.0)) * zAvg * rSpec * suctionTempK * (Math.pow(targetPr, isentropicExponentTerm) - 1.0);

    // Initial nominal polytropic efficiency estimate
    let etaPoly = 0.82;

    // Search for required rotational speed N (RPM) to achieve polytropic head
    let speedRpm = map.ratedSpeedRpm;
    let polytropicHead = hIsoRequired / etaPoly;

    // Head scales approximately as (N / N_0)^2
    const nominalHeadAtRated =
      ((k / (k - 1.0)) * zAvg * rSpec * suctionTempK * (Math.pow(1.5, isentropicExponentTerm) - 1.0)) / etaPoly;
    const speedRatioEst = Math.sqrt(Math.max(0.2, polytropicHead / Math.max(1000.0, nominalHeadAtRated)));
    speedRpm = Math.max(map.minSpeedRpm, Math.min(map.maxSpeedRpm, map.ratedSpeedRpm * speedRatioEst));

    // Find nearest or bounding speed curve
    let activeCurve = map.speedCurves[0];
    let minSpeedDiff = Infinity;
    for (const sc of map.speedCurves) {
      const diff = Math.abs(sc.speedRpm - speedRpm);
      if (diff < minSpeedDiff) {
        minSpeedDiff = diff;
        activeCurve = sc;
      }
    }

    // Evaluate efficiency from flow coefficient
    const d = map.impellerDiameter;
    const omega = (speedRpm * 2.0 * Math.PI) / 60.0;
    const phi = actualInflowM3s / Math.max(1e-4, omega * Math.pow(d, 3));

    // Interpolate efficiency from curve
    if (activeCurve && activeCurve.flowCoeffs.length > 1) {
      const phiMin = activeCurve.flowCoeffs[0] ?? 0;
      const phiMax = activeCurve.flowCoeffs[activeCurve.flowCoeffs.length - 1] ?? 1;
      const t = Math.max(0.0, Math.min(1.0, (phi - phiMin) / Math.max(1e-5, phiMax - phiMin)));
      const idx = Math.min(activeCurve.efficiency.length - 2, Math.floor(t * (activeCurve.efficiency.length - 1)));
      const frac = t * (activeCurve.efficiency.length - 1) - idx;
      etaPoly =
        (1.0 - frac) * (activeCurve.efficiency[idx] ?? etaPoly) + frac * (activeCurve.efficiency[idx + 1] ?? etaPoly);
    }

    // Actual delivered discharge pressure clamped by max speed head
    const maxHeadAtMaxSpeed = nominalHeadAtRated * Math.pow(map.maxSpeedRpm / map.ratedSpeedRpm, 2);
    polytropicHead = Math.min(maxHeadAtMaxSpeed, hIsoRequired / Math.max(0.5, etaPoly));
    const achievedPr = Math.pow(
      1.0 + (polytropicHead * etaPoly * (k - 1.0)) / (k * zAvg * rSpec * suctionTempK),
      k / (k - 1.0),
    );
    let dischargePressurePa = suctionPressurePa * achievedPr;
    if (Math.abs(dischargePressurePa - targetDischargePressurePa) < 1e-4 * targetDischargePressurePa) {
      dischargePressurePa = targetDischargePressurePa;
    }

    // Check surge and stonewall boundaries
    const surgeFlow = activeCurve?.surgeFlowM3s ?? 0;
    const stonewallFlow = activeCurve?.stonewallFlowM3s ?? Infinity;
    const safetyMarginPct = map.surgeSafetyMarginPercent ?? 10.0;
    const antiSurgeLineFlow = surgeFlow * (1.0 + safetyMarginPct / 100.0);

    const isSurging = actualInflowM3s < surgeFlow;
    const isStonewalled = actualInflowM3s > stonewallFlow;

    // Anti-surge recycle modulation
    let recycleFlowM3s = 0.0;
    if (actualInflowM3s < antiSurgeLineFlow) {
      recycleFlowM3s = antiSurgeLineFlow - actualInflowM3s;
    }

    const surgeSafetyMarginActualPercent = ((actualInflowM3s - surgeFlow) / Math.max(1e-3, surgeFlow)) * 100.0;

    // Power calculations:
    // Total throughput through compressor wheel includes recycled gas
    const totalMassRateKgS = massFlowKgS + recycleFlowM3s * rhoInlet;
    const gasPowerWatts = (totalMassRateKgS * polytropicHead) / Math.max(0.1, etaPoly);
    const mechEff = map.mechanicalEfficiency ?? 0.98;
    const shaftPowerWatts = Math.min(map.driverRatingWatts * 1.15, gasPowerWatts / mechEff);

    // Driver power & fuel consumption
    const driverEff = map.driverThermalEfficiency ?? 0.36;
    const driverPowerWatts = shaftPowerWatts / driverEff;
    // Fuel rate: Watts / (LHV [J/kg])
    const fuelGasRateKgS = map.driverType === "GAS_TURBINE" ? driverPowerWatts / (lhv * 1.0e6) : 0.0;

    // Discharge temperature: T_out = T_in * (P_out / P_in)^((k-1)/(k * eta_poly))
    const tempExponent = (k - 1.0) / (k * Math.max(0.5, etaPoly));
    const dischargeTempK = suctionTempK * Math.pow(achievedPr, tempExponent);

    return {
      speedRpm,
      speedRatio: speedRpm / map.ratedSpeedRpm,
      actualInletFlowM3s: actualInflowM3s,
      massFlowThroughputKgS: massFlowKgS,
      suctionPressurePa,
      dischargePressurePa,
      pressureRatio: achievedPr,
      polytropicHeadJkg: polytropicHead,
      polytropicEfficiency: etaPoly,
      gasPowerWatts,
      shaftPowerWatts,
      driverPowerWatts,
      fuelGasRateKgS,
      dischargeTempK,
      isSurging,
      isStonewalled,
      antiSurgeRecycleFlowM3s: recycleFlowM3s,
      surgeSafetyMarginActualPercent,
    };
  }
}
