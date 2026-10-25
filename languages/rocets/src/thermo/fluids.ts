// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cryogenic and hydrocarbon propellant thermodynamic properties for rocket engine simulation.
 */

export interface FluidState {
  name: string;
  densityKgM3: number;
  specificHeatCpJouleKgK: number;
  bulkModulusPa: number;
  viscosityPaS: number;
  vaporPressurePa: number;
  normalBoilingPointK: number;
  gasConstantR?: number | undefined;
  gamma?: number | undefined;
}

export function getPropellantState(fluid: string, pressurePa = 101325.0, temperatureK = 293.15): FluidState {
  const norm = fluid.toUpperCase().replace(/[^A-Z0-9]/g, "");

  switch (norm) {
    case "LH2":
    case "HYDROGEN": {
      // Liquid Hydrogen
      const rho = Math.max(65.0, 70.85 * (1.0 + (pressurePa - 101325) / 2e9));
      return {
        name: "LH2",
        densityKgM3: rho,
        specificHeatCpJouleKgK: 9600.0,
        bulkModulusPa: 2.0e8,
        viscosityPaS: 1.3e-5,
        normalBoilingPointK: 20.3,
        vaporPressurePa: Math.min(pressurePa, 101325.0 * Math.exp(10.0 * (1.0 - 20.3 / Math.max(temperatureK, 14.0)))),
      };
    }

    case "GH2": {
      // Gaseous Hydrogen
      const R = 4124.0;
      const T = Math.max(20.0, temperatureK);
      const rho = pressurePa / (R * T);
      return {
        name: "GH2",
        densityKgM3: rho,
        specificHeatCpJouleKgK: 14300.0,
        bulkModulusPa: 1.4 * pressurePa,
        viscosityPaS: 8.8e-6,
        normalBoilingPointK: 20.3,
        vaporPressurePa: 0.0,
        gasConstantR: R,
        gamma: 1.4,
      };
    }

    case "LOX":
    case "OXYGEN": {
      // Liquid Oxygen
      const rho = Math.max(1050.0, 1141.0 * (1.0 + (pressurePa - 101325) / 1.5e9));
      return {
        name: "LOX",
        densityKgM3: rho,
        specificHeatCpJouleKgK: 1700.0,
        bulkModulusPa: 1.5e9,
        viscosityPaS: 1.9e-4,
        normalBoilingPointK: 90.2,
        vaporPressurePa: Math.min(pressurePa, 101325.0 * Math.exp(8.0 * (1.0 - 90.2 / Math.max(temperatureK, 60.0)))),
      };
    }

    case "LCH4":
    case "METHANE": {
      // Liquid Methane
      const rho = Math.max(380.0, 422.0 * (1.0 + (pressurePa - 101325) / 1.2e9));
      return {
        name: "LCH4",
        densityKgM3: rho,
        specificHeatCpJouleKgK: 3480.0,
        bulkModulusPa: 1.2e9,
        viscosityPaS: 1.1e-4,
        normalBoilingPointK: 111.6,
        vaporPressurePa: Math.min(pressurePa, 101325.0 * Math.exp(8.5 * (1.0 - 111.6 / Math.max(temperatureK, 90.0)))),
      };
    }

    case "RP1":
    case "KEROSENE": {
      // RP-1 Rocket Propellant
      return {
        name: "RP1",
        densityKgM3: 810.0,
        specificHeatCpJouleKgK: 2000.0,
        bulkModulusPa: 1.6e9,
        viscosityPaS: 2.2e-3,
        normalBoilingPointK: 489.0,
        vaporPressurePa: 1000.0,
      };
    }

    case "COMBUSTION_GAS":
    default: {
      // Typical rocket combustion product gas (e.g. H2O + H2 or CO2 + H2O)
      const R = 500.0;
      const gamma = 1.22;
      const T = Math.max(300.0, temperatureK);
      const rho = pressurePa / (R * T);
      return {
        name: norm || "COMBUSTION_GAS",
        densityKgM3: Math.max(1e-4, rho),
        specificHeatCpJouleKgK: (gamma * R) / (gamma - 1.0),
        bulkModulusPa: gamma * pressurePa,
        viscosityPaS: 3.5e-5,
        normalBoilingPointK: 373.15,
        vaporPressurePa: 0.0,
        gasConstantR: R,
        gamma,
      };
    }
  }
}
