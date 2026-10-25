// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtSimulationResult, GtSimulationResultPoint } from "../types.js";

/**
 * Parses GT-POST trajectory output data (.gdx, .gxv, .csv export from GT-POST).
 */
export function parseGdxTrajectory(rawText: string, modelName = "GT_Run"): GtSimulationResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    return {
      modelName,
      trajectories: [],
      summary: {
        meanTorqueNm: 0,
        meanPowerKw: 0,
        meanBsfcGPerKwh: 0,
        maxCylinderPressureBar: 0,
        volumetricEfficiency: 0,
        indicatedMeanEffectivePressureBar: 0,
        brakeMeanEffectivePressureBar: 0,
        thermalEfficiency: 0,
        knockMargin: 1.0,
      },
    };
  }

  // Find header row
  let headerIndex = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const l = lines[i]!.toLowerCase();
    if (l.includes("time") || l.includes("crank") || l.includes("angle") || l.includes("press")) {
      headerIndex = i;
      break;
    }
  }

  const headerLine = lines[headerIndex]!;
  const delimiter = headerLine.includes(",") ? "," : /\s+/;
  const rawHeaders = headerLine.split(delimiter).map((h) => h.trim().toLowerCase());

  // Index column positions
  const colTime = rawHeaders.findIndex((h) => h.includes("time"));
  const colCrank = rawHeaders.findIndex((h) => h.includes("crank") || h.includes("angle") || h.includes("ca"));
  const colPcyl = rawHeaders.findIndex(
    (h) => h.includes("pcyl") || h.includes("p_cyl") || (h.includes("press") && h.includes("cyl")),
  );
  const colTcyl = rawHeaders.findIndex(
    (h) => h.includes("tcyl") || h.includes("temp_cyl") || (h.includes("temp") && h.includes("cyl")),
  );
  const colPim = rawHeaders.findIndex((h) => h.includes("pim") || h.includes("intake") || h.includes("boost"));
  const colPexh = rawHeaders.findIndex((h) => h.includes("pexh") || h.includes("exhaust"));
  const colTorque = rawHeaders.findIndex((h) => h.includes("torque") || h.includes("trq"));
  const colPower = rawHeaders.findIndex((h) => h.includes("power") || h.includes("kw"));
  const colMdotAir = rawHeaders.findIndex((h) => h.includes("air") && h.includes("flow"));
  const colMdotFuel = rawHeaders.findIndex((h) => h.includes("fuel") && h.includes("flow"));
  const colTurbo = rawHeaders.findIndex((h) => h.includes("turbo") || h.includes("rpm"));
  const colBsfc = rawHeaders.findIndex((h) => h.includes("bsfc"));
  const colNox = rawHeaders.findIndex((h) => h.includes("nox"));

  const trajectories: GtSimulationResultPoint[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const row = lines[i]!.split(delimiter).map(Number);
    if (row.length < 2 || Number.isNaN(row[0])) continue;

    const timeS = colTime >= 0 ? (row[colTime] ?? 0) : i * 0.001;
    const crankAngleDeg = colCrank >= 0 ? (row[colCrank] ?? 0) : (timeS * 6000) % 720;
    const pcyl = colPcyl >= 0 ? (row[colPcyl] ?? 1e5) : 1e5;
    const tcyl = colTcyl >= 0 ? (row[colTcyl] ?? 300) : 300;
    const torque = colTorque >= 0 ? (row[colTorque] ?? 0) : 0;
    const power = colPower >= 0 ? (row[colPower] ?? 0) : (torque * 314.15) / 1000;

    trajectories.push({
      timeS,
      crankAngleDeg,
      cylinderPressurePa: [pcyl],
      cylinderTemperatureK: [tcyl],
      cylinderVolumeM3: [0.0005],
      engineBrakeTorqueNm: torque,
      enginePowerKw: power,
      intakeManifoldPressurePa: colPim >= 0 ? (row[colPim] ?? 1e5) : 1e5,
      exhaustManifoldPressurePa: colPexh >= 0 ? (row[colPexh] ?? 1e5) : 1e5,
      airMassFlowKgS: colMdotAir >= 0 ? (row[colMdotAir] ?? 0.05) : 0.05,
      fuelMassFlowKgS: colMdotFuel >= 0 ? (row[colMdotFuel] ?? 0.0035) : 0.0035,
      turboSpeedRpm: colTurbo >= 0 ? (row[colTurbo] ?? 100000) : 100000,
      bsfcGPerKwh: colBsfc >= 0 ? (row[colBsfc] ?? 240) : 240,
      noxPpm: colNox >= 0 ? (row[colNox] ?? 45) : 45,
    });
  }

  // Summary statistics
  const torques = trajectories.map((t) => t.engineBrakeTorqueNm);
  const powers = trajectories.map((t) => t.enginePowerKw);
  const bsfcVals = trajectories.map((t) => t.bsfcGPerKwh);
  const pressures = trajectories.flatMap((t) => t.cylinderPressurePa);

  const meanTorque = torques.length > 0 ? torques.reduce((a, b) => a + b, 0) / torques.length : 0;
  const meanPower = powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / powers.length : 0;
  const meanBsfc = bsfcVals.length > 0 ? bsfcVals.reduce((a, b) => a + b, 0) / bsfcVals.length : 240;
  const maxPcyl = pressures.length > 0 ? Math.max(...pressures) / 1e5 : 1.0;

  return {
    modelName,
    trajectories,
    summary: {
      meanTorqueNm: meanTorque,
      meanPowerKw: meanPower,
      meanBsfcGPerKwh: meanBsfc,
      maxCylinderPressureBar: maxPcyl,
      volumetricEfficiency: 0.88,
      indicatedMeanEffectivePressureBar: (meanTorque * 4 * Math.PI) / (0.002 * 1e5),
      brakeMeanEffectivePressureBar: ((meanTorque * 4 * Math.PI) / (0.002 * 1e5)) * 0.85,
      thermalEfficiency: meanBsfc > 0 ? 3600 / (meanBsfc * 43.5) : 0.35,
      knockMargin: 1.25,
    },
  };
}
