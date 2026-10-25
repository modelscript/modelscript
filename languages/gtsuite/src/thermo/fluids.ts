// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FuelProperties {
  name: string;
  stoichiometricAfr: number;
  lowerHeatingValueJPerKg: number;
  molecularWeightKgKmol: number;
}

export const STANDARD_FUELS: Record<string, FuelProperties> = {
  GASOLINE: {
    name: "Gasoline",
    stoichiometricAfr: 14.7,
    lowerHeatingValueJPerKg: 44.0e6,
    molecularWeightKgKmol: 114.0,
  },
  DIESEL: {
    name: "Diesel",
    stoichiometricAfr: 14.5,
    lowerHeatingValueJPerKg: 42.5e6,
    molecularWeightKgKmol: 170.0,
  },
  METHANE: {
    name: "Methane",
    stoichiometricAfr: 17.2,
    lowerHeatingValueJPerKg: 50.0e6,
    molecularWeightKgKmol: 16.04,
  },
  HYDROGEN: {
    name: "Hydrogen",
    stoichiometricAfr: 34.3,
    lowerHeatingValueJPerKg: 120.0e6,
    molecularWeightKgKmol: 2.016,
  },
  ETHANOL: {
    name: "Ethanol",
    stoichiometricAfr: 9.0,
    lowerHeatingValueJPerKg: 26.9e6,
    molecularWeightKgKmol: 46.07,
  },
};

export function getFuelProperties(fuelName: string): FuelProperties {
  const key = fuelName.trim().toUpperCase();
  return STANDARD_FUELS[key] ?? STANDARD_FUELS["GASOLINE"]!;
}

/**
 * Calculates temperature-dependent specific heat ratio gamma(T) and cp(T) for air / combustion products.
 */
export function calculateGasProperties(
  tempK: number,
  burnedFraction = 0.0,
): {
  gamma: number;
  cpJPerKgK: number;
  cvJPerKgK: number;
  gasConstantR: number;
  speedOfSoundMS: number;
} {
  const T = Math.max(200.0, Math.min(3500.0, tempK));

  // Polynomial fit for air / combustion gas specific heat
  // Unburned air: cp ~ 1005 J/kgK at 300K, rises to ~1250 at 2000K
  const cpAir = 1005.0 + 0.15 * (T - 300.0) + 0.00005 * Math.pow(T - 300.0, 2);
  // Burned products: higher cp due to CO2 and H2O triatomic molecules
  const cpBurned = 1150.0 + 0.22 * (T - 300.0) + 0.00008 * Math.pow(T - 300.0, 2);

  const cp = (1.0 - burnedFraction) * cpAir + burnedFraction * cpBurned;
  const R = 287.05; // J/kgK for air / light combustion mixture
  const cv = cp - R;
  const gamma = cp / cv;
  const a = Math.sqrt(gamma * R * T);

  return {
    gamma,
    cpJPerKgK: cp,
    cvJPerKgK: cv,
    gasConstantR: R,
    speedOfSoundMS: a,
  };
}
