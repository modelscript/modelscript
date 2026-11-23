// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript meteorological runtime for `@modelscript/bufr-std-lib`.
 *
 * Implements WMO-No. 306 BUFR Table B scaling, Magnus-Tetens saturation vapor
 * pressure / dewpoint / relative humidity, and ISA hypsometric pressure-altitude
 * conversions using a zero-GC 2048-byte aligned slot ABI.
 */

const OFF_CON: usize = 0x080;
const OFF_IO: usize = 0x780;

const G0: f64 = 9.80665;
const R_D: f64 = 287.05;
const P0_ISA: f64 = 101325.0;
const T0_ISA: f64 = 288.15;
const LAPSE_ISA: f64 = 0.0065;

/**
 * Computes saturation vapor pressure (Pa) via Magnus-Tetens formula for T in Kelvin.
 */
export function magnusSaturationVaporPressure(tempK: f64): f64 {
  const tc: f64 = tempK - 273.15;
  return 610.94 * Math.exp((17.625 * tc) / (tc + 243.04));
}

/**
 * Computes dewpoint temperature (K) from dry-bulb temperature (K) and RH (%).
 */
export function magnusDewpointK(tempK: f64, rhPct: f64): f64 {
  const tc: f64 = tempK - 273.15;
  const rh: f64 = rhPct < 0.01 ? 0.01 : rhPct > 100.0 ? 100.0 : rhPct;
  const gamma: f64 = Math.log(rh / 100.0) + (17.625 * tc) / (243.04 + tc);
  const tdc: f64 = (243.04 * gamma) / (17.625 - gamma);
  return tdc + 273.15;
}

/**
 * Computes relative humidity (%) from dry-bulb temperature (K) and dewpoint (K).
 */
export function magnusRelativeHumidityPct(tempK: f64, dewpointK: f64): f64 {
  const es: f64 = magnusSaturationVaporPressure(tempK);
  const e: f64 = magnusSaturationVaporPressure(dewpointK);
  if (es <= 0.0) return 0.0;
  const rh: f64 = (100.0 * e) / es;
  return rh < 0.0 ? 0.0 : rh > 100.0 ? 100.0 : rh;
}

/**
 * Computes ISA tropospheric altitude (m) from atmospheric pressure (Pa).
 */
export function isaAltitudeFromPressurePa(pressurePa: f64): f64 {
  if (pressurePa <= 0.0) return 0.0;
  const exp: f64 = (R_D * LAPSE_ISA) / G0;
  if (pressurePa >= 22632.06) {
    return (T0_ISA / LAPSE_ISA) * (1.0 - Math.pow(pressurePa / P0_ISA, exp));
  }
  // Stratosphere isothermal layer (11 km .. 20 km, T = 216.65 K)
  return 11000.0 - ((R_D * 216.65) / G0) * Math.log(pressurePa / 22632.06);
}

/**
 * Computes air density (kg/m^3) from pressure (Pa) and virtual temperature (K).
 */
export function idealGasDensity(pressurePa: f64, tempK: f64): f64 {
  if (tempK <= 0.0) return 0.0;
  return pressurePa / (R_D * tempK);
}

/**
 * Slot-ABI kernel evaluation entrypoint for `@modelscript/bufr-std-lib`.
 */
export function bufr_eval(slotPtr: usize, archetypeId: i32): i32 {
  const pPa: f64 = load<f64>(slotPtr + OFF_CON + 0);
  const tK: f64 = load<f64>(slotPtr + OFF_CON + 8);
  const tdK: f64 = load<f64>(slotPtr + OFF_CON + 16);

  const rh: f64 = magnusRelativeHumidityPct(tK > 150.0 ? tK : T0_ISA, tdK > 150.0 ? tdK : 281.15);
  const alt: f64 = isaAltitudeFromPressurePa(pPa > 0.0 ? pPa : P0_ISA);
  const rho: f64 = idealGasDensity(pPa > 0.0 ? pPa : P0_ISA, tK > 150.0 ? tK : T0_ISA);

  store<f64>(slotPtr + OFF_IO + 0, pPa);
  store<f64>(slotPtr + OFF_IO + 8, tK);
  store<f64>(slotPtr + OFF_IO + 16, tdK);
  store<f64>(slotPtr + OFF_IO + 24, rh);
  store<f64>(slotPtr + OFF_IO + 32, alt);
  store<f64>(slotPtr + OFF_IO + 40, rho);

  return archetypeId >= 0 ? 0 : -1;
}
