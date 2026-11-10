// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ToughRock {
  name: string;
  density: number; // kg/m^3
  porosity: number; // fraction [0, 1]
  permeabilityX: number; // m^2
  permeabilityY: number; // m^2
  permeabilityZ: number; // m^2
  thermalConductivity: number; // W/(m*K)
  specificHeat: number; // J/(kg*K)
  line: number;
}

export interface ToughElement {
  name: string;
  rockName: string;
  volume: number; // m^3
  line: number;
}

export interface ToughConnection {
  elem1: string;
  elem2: string;
  dist1: number; // m
  dist2: number; // m
  area: number; // interface area m^2
  angle: number; // orientation angle (0 = horizontal)
  line: number;
}

export interface ToughGenerator {
  elem: string;
  name: string;
  type: string; // "MASS", "HEAT", "DELV"
  rate: number; // kg/s or J/s
  enthalpy: number; // J/kg
  line: number;
}

export interface ToughIncon {
  elem: string;
  pressure: number; // Pa
  temperature: number; // deg C
  line: number;
}

export interface ToughDeck {
  title?: string | undefined;
  rocks: ToughRock[];
  elements: ToughElement[];
  connections: ToughConnection[];
  generators: ToughGenerator[];
  inconds: ToughIncon[];
}

export interface GeothermalWellResult {
  element: string;
  wellName: string;
  massRateKgS: number;
  enthalpyJPerKg: number;
  thermalPowerMW: number;
  steamFraction: number;
}
