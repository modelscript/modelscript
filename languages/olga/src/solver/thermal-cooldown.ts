// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Transient Pipeline Cooldown & Deadleg No-Touch Time Analysis.
 *
 * Simulates radial multi-layer heat conduction and thermal capacitance decay
 * during production shut-in (zero-flow cooldown), determining the available
 * "No-Touch Time" before fluid enters the hydrate dissociation boundary.
 */

import type { OlgaHeatTransfer } from "../types.js";

export interface CooldownLayer {
  material: string;
  thickness: number; // m
  conductivity: number; // W / (m * K)
  density?: number | undefined; // kg / m^3
  heatCapacity?: number | undefined; // J / (kg * K)
}

export interface CooldownParams {
  innerDiameter: number; // m
  pipeLength: number; // m
  initialTemperatureK: number; // K
  ambientTemperatureK: number; // K
  shutInPressurePa: number; // Pa
  liquidHoldup?: number | undefined; // fraction 0..1
  oilDensity?: number | undefined; // kg / m^3
  waterDensity?: number | undefined; // kg / m^3
  gasDensity?: number | undefined; // kg / m^3
  heatTransfer?: OlgaHeatTransfer | undefined;
  ambientHeatTransferCoeff?: number | undefined; // W / (m^2 * K)
}

export interface CooldownResult {
  /** Overall heat transfer coefficient U [W / (m^2 * K)] based on outer area. */
  uHeatTransfer: number;
  /** Total thermal capacitance of fluid contents and pipe wall per unit length [J / (m * K)]. */
  thermalCapacitancePerMeter: number;
  /** Thermal cooling time constant tau = (M * Cp) / (U * A) [s]. */
  timeConstantSeconds: number;
  /** Hydrate formation temperature at shut-in pressure [K]. */
  hydrateTempK: number;
  /**
   * Available No-Touch Time [s] until fluid cools down to the hydrate equilibrium temperature.
   * If initial temperature is already at or below hydrate curve, returns 0.
   */
  noTouchTimeSeconds: number;
  /** Temperature evolution trajectory at discrete hourly intervals. */
  trajectory: { timeHours: number; temperatureC: number; inHydrateZone: boolean }[];
}

/**
 * Evaluates Hydrate Equilibrium Temperature [K] via standard gas hydrate correlation.
 */
export function getHydrateFormationTemperatureK(pressurePa: number): number {
  const pBar = Math.max(2.0, pressurePa / 1.0e5);
  const lnP = Math.log(pBar);
  return 265.85 + 5.25 * lnP - 0.075 * lnP * lnP;
}

/**
 * Computes transient shut-in cooldown and determines operator No-Touch Time window.
 */
export function evaluatePipelineCooldown(params: CooldownParams): CooldownResult {
  const D_in = Math.max(0.02, params.innerDiameter);
  const r_in = 0.5 * D_in;
  const T_init = params.initialTemperatureK;
  const T_amb = params.ambientTemperatureK;
  const P_shut = params.shutInPressurePa;

  const alphaL = params.liquidHoldup ?? 0.35;
  const rhoL = params.oilDensity ?? 850.0;
  const rhoG = params.gasDensity ?? 40.0;

  // 1. Fluid thermal capacity per meter length
  const A_in = 0.25 * Math.PI * D_in * D_in;
  const cpLiquid = 2100.0; // J / (kg * K) for light crude/condensate
  const cpGas = 2300.0; // J / (kg * K) for natural gas
  const fluidCapacitancePerMeter = A_in * (alphaL * rhoL * cpLiquid + (1.0 - alphaL) * rhoG * cpGas);

  // 2. Multi-layer wall thermal resistance and wall thermal capacitance
  let currentR = r_in;
  let rThermalConduction = 0.0;
  let wallCapacitancePerMeter = 0.0;

  const defaultSteelThick = 0.016; // 16mm steel pipe
  const defaultInsulThick = 0.05; // 50mm insulation

  const layers: CooldownLayer[] =
    params.heatTransfer && params.heatTransfer.layers.length > 0
      ? params.heatTransfer.layers
      : [
          {
            material: "Carbon Steel",
            thickness: defaultSteelThick,
            conductivity: 45.0,
            density: 7850.0,
            heatCapacity: 480.0,
          },
          {
            material: "Polypropylene Foam",
            thickness: defaultInsulThick,
            conductivity: 0.16,
            density: 750.0,
            heatCapacity: 1900.0,
          },
        ];

  for (const layer of layers) {
    const r_next = currentR + layer.thickness;
    // Radial cylindrical thermal conduction resistance: ln(r_out / r_in) / (2 * pi * k)
    const kMat = Math.max(0.01, layer.conductivity);
    rThermalConduction += Math.log(r_next / currentR) / (2.0 * Math.PI * kMat);

    // Wall capacitance: pi * (r_out^2 - r_in^2) * rho * cp
    const rhoMat = layer.density ?? 5000.0;
    const cpMat = layer.heatCapacity ?? 1000.0;
    const volLayerPerMeter = Math.PI * (r_next * r_next - currentR * currentR);
    wallCapacitancePerMeter += volLayerPerMeter * rhoMat * cpMat;

    currentR = r_next;
  }

  const r_out = currentR;
  const D_out = 2.0 * r_out;
  const A_outPerMeter = Math.PI * D_out;

  // External ambient convection resistance: 1 / (h_ext * A_ext)
  const hAmb = params.ambientHeatTransferCoeff ?? params.heatTransfer?.ambientHeatTransferCoeff ?? 45.0; // seawater convection
  const rAmbientConvection = 1.0 / (hAmb * A_outPerMeter);

  // Internal fluid convection resistance (shut-in liquid layer free convection)
  const hInt = 80.0; // W / (m^2 * K)
  const rInternalConvection = 1.0 / (hInt * Math.PI * D_in);

  const totalResistancePerMeter = rInternalConvection + rThermalConduction + rAmbientConvection;
  // Overall heat transfer coefficient U [W / (m^2 * K)] normalized by outer surface area
  const uHeatTransfer = 1.0 / (totalResistancePerMeter * A_outPerMeter);

  // Total lumped capacitance: fluid + effective 50% wall participation
  const totalCapacitancePerMeter = fluidCapacitancePerMeter + 0.5 * wallCapacitancePerMeter;

  // Thermal time constant: tau = (totalCapacitancePerMeter) / (U * A_outPerMeter)
  const timeConstantSeconds = totalCapacitancePerMeter / Math.max(1e-3, uHeatTransfer * A_outPerMeter);

  // Hydrate dissociation temperature
  const hydrateTempK = getHydrateFormationTemperatureK(P_shut);

  // No-Touch Time calculation:
  // T(t) = T_amb + (T_init - T_amb) * exp(-t / tau)
  // Solve for t when T(t) = hydrateTempK:
  let noTouchTimeSeconds = 0.0;
  if (T_init <= hydrateTempK) {
    noTouchTimeSeconds = 0.0; // already in hydrate zone!
  } else if (hydrateTempK <= T_amb) {
    noTouchTimeSeconds = Infinity; // ambient temperature is warmer than hydrate curve; hydrates will never form!
  } else {
    const fraction = (hydrateTempK - T_amb) / (T_init - T_amb);
    if (fraction > 0 && fraction < 1) {
      noTouchTimeSeconds = -timeConstantSeconds * Math.log(fraction);
    } else {
      noTouchTimeSeconds = 0.0;
    }
  }

  // Generate 24-hour cooldown trajectory
  const trajectory: { timeHours: number; temperatureC: number; inHydrateZone: boolean }[] = [];
  for (let hr = 0; hr <= 48; hr += 2) {
    const tSec = hr * 3600.0;
    const tK = T_amb + (T_init - T_amb) * Math.exp(-tSec / timeConstantSeconds);
    trajectory.push({
      timeHours: hr,
      temperatureC: tK - 273.15,
      inHydrateZone: tK <= hydrateTempK,
    });
  }

  return {
    uHeatTransfer,
    thermalCapacitancePerMeter: totalCapacitancePerMeter,
    timeConstantSeconds,
    hydrateTempK,
    noTouchTimeSeconds,
    trajectory,
  };
}
