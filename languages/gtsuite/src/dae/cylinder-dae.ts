// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  calculateCrankSliderKinematics,
  calculateWoschniHeatTransfer,
  calculateZeldovichNoxRate,
  evaluateBurnRate,
  evaluateLivengoodWuKnock,
  getFuelProperties,
} from "../thermo/index.js";
import type { GtCylinderComponent, GtModel, GtSimulationResult, GtSimulationResultPoint } from "../types.js";

export interface GtSimulateOptions {
  durationSeconds?: number;
  timeStepSeconds?: number;
  engineSpeedRpm?: number;
}

/**
 * High-performance transient simulator for GT-SUITE engine models.
 * Solves 0D/1D closed-cycle cylinder thermodynamics, Wiebe heat release,
 * Woschni heat transfer, manifold dynamics, and emissions.
 */
export function simulateGtSuiteTransient(model: GtModel, options?: GtSimulateOptions): GtSimulationResult {
  const duration = options?.durationSeconds ?? model.simulationSettings.durationSeconds ?? 0.5;
  const dt = options?.timeStepSeconds ?? model.simulationSettings.timeStepSeconds ?? 0.0002;
  const rpm = options?.engineSpeedRpm ?? model.simulationSettings.engineSpeedRpm ?? 3000.0;
  const omega = (rpm * 2.0 * Math.PI) / 60.0; // rad/s
  const degPerSec = rpm * 6.0;

  const cylinders = model.components.filter((c) => c.kind === "cylinder") as GtCylinderComponent[];
  const mainCyl = cylinders[0] ?? {
    id: "CYL1",
    kind: "cylinder",
    boreM: 0.0825,
    strokeM: 0.0928,
    connectingRodLengthM: 0.144,
    compressionRatio: 10.0,
    combustionModel: {
      type: "wiebe",
      anchorAngleDeg: 15.0,
      durationDeg: 45.0,
      wiebeExponentM: 2.0,
      wiebeEfficiencyA: 5.0,
    },
    heatTransferModel: {
      type: "woschni",
      wallTemperatureK: 450.0,
    },
    intakeValveIds: [],
    exhaustValveIds: [],
  };

  const bore = mainCyl.boreM;
  const stroke = mainCyl.strokeM;
  const rod = mainCyl.connectingRodLengthM;
  const cr = mainCyl.compressionRatio;
  const dispM3 = (Math.PI / 4) * bore * bore * stroke;
  const fuel = getFuelProperties("Gasoline");

  // Dynamic states
  let pim = 140000.0; // Pa (intake boost)
  const pexh = 125000.0; // Pa (exhaust backpressure)
  let turboSpeedRpm = 110000.0;
  let accumulatedKnock = 0.0;
  let cumWallHeatLossJ = 0.0;
  let totalIndicatedWorkJ = 0.0;
  let totalSweptRad = 0.0;
  const numCyl = Math.max(4, cylinders.length);
  const pAtm = 101325.0;

  // Helper to evaluate cylinder pressure and kinematics at a given relative crank angle [-360, 360)
  const evalCylinderStateAtAngle = (caDeg: number, currentPim: number, wallLossJ: number) => {
    let relCa = ((caDeg % 720.0) + 720.0) % 720.0;
    if (relCa > 360.0) relCa -= 720.0;

    const kin = calculateCrankSliderKinematics(relCa, bore, stroke, rod, cr, rpm);
    const vCyl = kin.volumeM3;

    let pCyl = pAtm;
    let tCyl = 320.0;
    let burnedFrac = 0.0;

    if (relCa >= -180.0 && relCa < 0.0) {
      const vBdc = dispM3 * (cr / (cr - 1));
      const compRatioLocal = Math.max(1.0, vBdc / Math.max(1e-6, vCyl));
      pCyl = currentPim * Math.pow(compRatioLocal, 1.34);
      tCyl = 320.0 * Math.pow(compRatioLocal, 0.34);
    } else if (relCa >= 0.0 && relCa < 180.0) {
      const burn = evaluateBurnRate(relCa, mainCyl.combustionModel);
      burnedFrac = burn.mfb;

      const mFuelCyl =
        (dispM3 * 1.18 * (currentPim / pAtm)) / (14.7 * (model.simulationSettings.airFuelRatioLambda || 1.0));
      const qTotal = Math.max(0.0, mFuelCyl * fuel.lowerHeatingValueJPerKg * 0.98 - wallLossJ);
      const vTdc = dispM3 / (cr - 1);
      const pPeakRise = (0.33 * qTotal) / vTdc;

      const vExpRatio = Math.max(1.0, vCyl / vTdc);
      const isentropicExp = (currentPim * Math.pow(cr, 1.34) + pPeakRise * burnedFrac) / Math.pow(vExpRatio, 1.28);
      pCyl = Math.max(pexh, isentropicExp);
      const tempDropWall = wallLossJ / Math.max(1e-4, dispM3 * 1.18 * 750.0);
      tCyl = Math.max(
        400.0,
        320.0 * Math.pow(cr, 0.34) + (1800.0 * burnedFrac - tempDropWall) / Math.pow(vExpRatio, 0.28),
      );
    } else if (relCa >= 180.0 && relCa < 360.0) {
      pCyl = pexh * 1.05;
      tCyl = 950.0;
    } else {
      pCyl = currentPim * 0.98;
      tCyl = 315.0;
    }

    return { relCa, kin, vCyl, pCyl, tCyl, burnedFrac };
  };

  const points: GtSimulationResultPoint[] = [];
  const numSteps = Math.min(5000, Math.floor(duration / dt));
  let filteredBrakeTorque = 220.0;

  for (let step = 0; step < numSteps; step++) {
    const timeS = step * dt;
    const crankAngleDeg = (timeS * degPerSec) % 720.0; // 4-stroke 720 deg cycle

    const cyl1 = evalCylinderStateAtAngle(crankAngleDeg, pim, cumWallHeatLossJ);
    const { relCa, kin, vCyl, pCyl, tCyl, burnedFrac } = cyl1;

    if (relCa < -180.0 || relCa >= 180.0) {
      cumWallHeatLossJ = 0.0;
    }

    // Heat transfer (Woschni) — integrated into closed-cycle energy loss
    const isComb = relCa >= 0.0 && relCa <= 90.0;
    const htRes = calculateWoschniHeatTransfer(
      bore,
      pCyl,
      tCyl,
      kin.meanPistonSpeedMS,
      dispM3,
      isComb,
      pCyl - pim,
      mainCyl.heatTransferModel.wallTemperatureK,
      kin.cylinderWallAreaM2,
    );
    const qHt = htRes.totalHeatLossW;
    if (relCa >= -180.0 && relCa < 180.0) {
      cumWallHeatLossJ = Math.min(250.0, cumWallHeatLossJ + qHt * dt);
    }

    // Integrate cycle work dW = P_cyl * (dV/dtheta) * dtheta for Cylinder 1
    const dThetaRad = omega * dt;
    totalIndicatedWorkJ += (pCyl - pAtm) * kin.dVolumeDThetaM3PerRad * dThetaRad;
    totalSweptRad += dThetaRad;

    // Multi-cylinder instantaneous crank-slider torque: sum_{k=0..numCyl-1} (P_k - P_atm) * (dV_k / dtheta)
    let instIndicatedTorqueNm = 0.0;
    const phaseStepDeg = 720.0 / numCyl;
    for (let k = 0; k < numCyl; k++) {
      const cylK = k === 0 ? cyl1 : evalCylinderStateAtAngle(crankAngleDeg + k * phaseStepDeg, pim, cumWallHeatLossJ);
      // Crank-slider torque contribution: (P_cyl - P_atm) * A_p * (dx/dtheta) = (P_cyl - P_atm) * (dV/dtheta)
      instIndicatedTorqueNm += (cylK.pCyl - pAtm) * cylK.kin.dVolumeDThetaM3PerRad;
    }

    // Friction torque corresponding to ~1.5 bar FMEP across all cylinders
    const fmepPa = 1.5e5;
    const frictionTorqueNm = (fmepPa * dispM3 * numCyl) / (4.0 * Math.PI);
    const instBrakeTorqueNm = instIndicatedTorqueNm - frictionTorqueNm;
    // Crankshaft/flywheel rotational inertia smoothing
    filteredBrakeTorque = 0.92 * filteredBrakeTorque + 0.08 * instBrakeTorqueNm;
    const engineTorque = Math.max(50.0, filteredBrakeTorque);

    // Kinetics & Emissions
    const noxRes = calculateZeldovichNoxRate(tCyl, pCyl, burnedFrac, 1.0);

    // Livengood-Wu knock evaluation on unburned end-gas during combustion
    if (relCa < -170.0) {
      accumulatedKnock = 0.0; // Reset at fresh charge induction
    }
    if (relCa >= 0.0 && relCa <= 60.0 && burnedFrac < 0.95) {
      const tUnburned = Math.max(300.0, 310.0 * Math.pow(Math.max(1.0, pCyl / pim), 0.24));
      const knockRes = evaluateLivengoodWuKnock(tUnburned, pCyl, dt, accumulatedKnock, 98.0);
      accumulatedKnock = knockRes.currentIntegral;
    }

    // Manifold dynamics update
    const mdotAir = 0.045 * (pim / 100000.0) * (rpm / 3000.0);
    const mdotFuel = mdotAir / 14.7;
    const enginePower = (engineTorque * omega) / 1000.0;
    const bsfc = (mdotFuel * 3600.0 * 1000.0) / Math.max(1.0, enginePower);

    // Turbocharger speed & manifold response
    pim += dt * (15000.0 * (turboSpeedRpm / 120000.0) - mdotAir * 1e5);
    pim = Math.max(90000.0, Math.min(280000.0, pim));
    turboSpeedRpm += dt * (enginePower * 10.0 - 0.005 * turboSpeedRpm);

    points.push({
      timeS,
      crankAngleDeg,
      cylinderPressurePa: [pCyl],
      cylinderTemperatureK: [tCyl],
      cylinderVolumeM3: [vCyl],
      engineBrakeTorqueNm: engineTorque,
      enginePowerKw: enginePower,
      intakeManifoldPressurePa: pim,
      exhaustManifoldPressurePa: pexh,
      airMassFlowKgS: mdotAir,
      fuelMassFlowKgS: mdotFuel,
      turboSpeedRpm,
      bsfcGPerKwh: Math.max(180.0, Math.min(450.0, bsfc)),
      noxPpm: noxRes.noxPpm,
    });
  }

  // Aggregate metrics
  const torques = points.map((p) => p.engineBrakeTorqueNm);
  const powers = points.map((p) => p.enginePowerKw);
  const bsfcs = points.map((p) => p.bsfcGPerKwh);
  const maxP = Math.max(...points.flatMap((p) => p.cylinderPressurePa));

  const meanTorque = torques.reduce((a, b) => a + b, 0) / torques.length;
  const meanPower = powers.reduce((a, b) => a + b, 0) / powers.length;
  const meanBsfc = bsfcs.reduce((a, b) => a + b, 0) / bsfcs.length;

  // Integrated cycle IMEP and BMEP (in bar)
  const numCycles = Math.max(1e-6, totalSweptRad / (4.0 * Math.PI));
  const workPerCycleJ = totalIndicatedWorkJ / numCycles;
  const imepBar = Math.max(1.0, workPerCycleJ / (dispM3 * 1e5));
  const bmepBar = Math.max(1.0, (4.0 * Math.PI * meanTorque) / (dispM3 * numCyl * 1e5));

  return {
    modelName: model.name,
    trajectories: points,
    summary: {
      meanTorqueNm: meanTorque,
      meanPowerKw: meanPower,
      meanBsfcGPerKwh: meanBsfc,
      maxCylinderPressureBar: maxP / 1e5,
      volumetricEfficiency: 0.92,
      indicatedMeanEffectivePressureBar: imepBar,
      brakeMeanEffectivePressureBar: bmepBar,
      thermalEfficiency: 3600.0 / (meanBsfc * 44.0),
      knockMargin: Math.max(0.0, 1.0 - accumulatedKnock),
    },
  };
}
