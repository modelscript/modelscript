// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room QUDV / ISO-80000 SI Unit & QuantityKind Catalog.
 *
 * Maps standard OMG SysML QUDV / ISO-80000 unit symbols and names
 * for display in BDD compartments, hover tooltips, and SysML v2 / Modelica projections.
 */

export interface QudvUnitSpec {
  symbol: string;
  name: string;
  quantityKind: string;
  siFactor?: number | undefined;
}

export const QUDV_STANDARD_UNITS: readonly QudvUnitSpec[] = [
  { symbol: "m", name: "metre", quantityKind: "Length" },
  { symbol: "mm", name: "millimetre", quantityKind: "Length", siFactor: 1e-3 },
  { symbol: "km", name: "kilometre", quantityKind: "Length", siFactor: 1e3 },
  { symbol: "kg", name: "kilogram", quantityKind: "Mass" },
  { symbol: "g", name: "gram", quantityKind: "Mass", siFactor: 1e-3 },
  { symbol: "s", name: "second", quantityKind: "Time" },
  { symbol: "ms", name: "millisecond", quantityKind: "Time", siFactor: 1e-3 },
  { symbol: "A", name: "ampere", quantityKind: "ElectricCurrent" },
  { symbol: "K", name: "kelvin", quantityKind: "ThermodynamicTemperature" },
  { symbol: "degC", name: "degreeCelsius", quantityKind: "CelsiusTemperature" },
  { symbol: "mol", name: "mole", quantityKind: "AmountOfSubstance" },
  { symbol: "cd", name: "candela", quantityKind: "LuminousIntensity" },
  { symbol: "N", name: "newton", quantityKind: "Force" },
  { symbol: "Pa", name: "pascal", quantityKind: "Pressure" },
  { symbol: "bar", name: "bar", quantityKind: "Pressure", siFactor: 1e5 },
  { symbol: "J", name: "joule", quantityKind: "Energy" },
  { symbol: "W", name: "watt", quantityKind: "Power" },
  { symbol: "kW", name: "kilowatt", quantityKind: "Power", siFactor: 1e3 },
  { symbol: "V", name: "volt", quantityKind: "ElectricPotential" },
  { symbol: "Ohm", name: "ohm", quantityKind: "ElectricResistance" },
  { symbol: "F", name: "farad", quantityKind: "Capacitance" },
  { symbol: "H", name: "henry", quantityKind: "Inductance" },
  { symbol: "Hz", name: "hertz", quantityKind: "Frequency" },
  { symbol: "rad", name: "radian", quantityKind: "PlaneAngle" },
  { symbol: "deg", name: "degree", quantityKind: "PlaneAngle", siFactor: Math.PI / 180 },
  { symbol: "m/s", name: "metrePerSecond", quantityKind: "Velocity" },
  { symbol: "m/s2", name: "metrePerSecondSquared", quantityKind: "Acceleration" },
  { symbol: "N*m", name: "newtonMetre", quantityKind: "Torque" },
  { symbol: "Wh", name: "wattHour", quantityKind: "Energy", siFactor: 3600 },
  { symbol: "kWh", name: "kilowattHour", quantityKind: "Energy", siFactor: 3.6e6 },
];

const UNIT_BY_KEY = new Map<string, QudvUnitSpec>();
for (const u of QUDV_STANDARD_UNITS) {
  UNIT_BY_KEY.set(u.symbol.toLowerCase(), u);
  UNIT_BY_KEY.set(u.name.toLowerCase(), u);
}

export function lookupQudvUnit(nameOrSymbol: string): QudvUnitSpec | undefined {
  const cleaned = nameOrSymbol.trim().replace(/^ISO-80000::|^QUDV::|^SI::/i, "");
  return UNIT_BY_KEY.get(cleaned.toLowerCase());
}
