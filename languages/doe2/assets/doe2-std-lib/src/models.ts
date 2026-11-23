// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript building-energy runtime for `@modelscript/doe2-std-lib`.
 *
 * Implements ASHRAE Fundamentals Ch. 15/26 material R-value/capacitance, glazing
 * conduction + solar heat gain, and DOE-2.1E HVAC part-load EIR/COP & fan curves
 * using a zero-GC 1024-byte aligned slot ABI:
 *   - `0x000..0x0FF` (256 B): `CON[32]` (`f64`) — component parameters
 *   - `0x100..0x17F` (128 B): `IO[16]`  (`f64`) — thermal / HVAC I/O bus:
 *       IO[0] = areaM2 (m^2)          IO[1] = deltaTK (K)
 *       IO[2] = solarWPerM2 (W/m^2)   IO[3] = thermalLoadW (W, >0 heat, <0 cool)
 *       IO[4] = capacityW (W)         IO[5] = rValueSi (m^2*K/W)
 *       IO[6] = uValueSi (W/(m^2*K))  IO[7] = capacitancePerArea (J/(m^2*K))
 *       IO[8] = qConductiveW (W)      IO[9] = qSolarW (W)
 *       IO[10] = electricPowerW (W)   IO[11] = fuelPowerW (W)
 *       IO[12] = fanPowerW (W)        IO[13] = partLoadRatio (0..1)
 */

const OFF_CON: usize = 0x000;
const OFF_IO: usize = 0x100;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function doe2GetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Evaluates a DOE-2 standard library material, glazing, or HVAC archetype.
 */
export function doe2ModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  // 1. Envelope Materials (archetypeId 1..19)
  if (archetypeId >= 1 && archetypeId < 20) {
    const thickness = Math.max(1e-5, getCon(slotPtr, conCount, 0, 0.1));
    const k = Math.max(1e-5, getCon(slotPtr, conCount, 1, 1.0));
    const rho = Math.max(0.0, getCon(slotPtr, conCount, 2, 1000.0));
    const cp = Math.max(0.0, getCon(slotPtr, conCount, 3, 840.0));
    const explicitR = conCount > 4 ? getCon(slotPtr, conCount, 4, 0.0) : 0.0;

    const rSi = explicitR > 0.0 ? explicitR : thickness / k;
    const uSi = 1.0 / Math.max(1e-6, rSi);
    const cPerArea = rho * cp * thickness;
    const area = Math.max(0.0, getIo(slotPtr, 0));
    const dT = getIo(slotPtr, 1);

    setIo(slotPtr, 5, rSi);
    setIo(slotPtr, 6, uSi);
    setIo(slotPtr, 7, cPerArea);
    setIo(slotPtr, 8, uSi * area * dT);
    return;
  }

  // 2. Glazing Systems (archetypeId 20..29)
  if (archetypeId >= 20 && archetypeId < 30) {
    const uSi = Math.max(0.1, getCon(slotPtr, conCount, 0, 1.65));
    const shgc = clamp(getCon(slotPtr, conCount, 1, 0.42), 0.0, 1.0);
    const area = Math.max(0.0, getIo(slotPtr, 0));
    const dT = getIo(slotPtr, 1);
    const iSolar = Math.max(0.0, getIo(slotPtr, 2));

    setIo(slotPtr, 5, 1.0 / uSi);
    setIo(slotPtr, 6, uSi);
    setIo(slotPtr, 8, uSi * area * dT);
    setIo(slotPtr, 9, area * shgc * iSolar);
    return;
  }

  // 3. HVAC System Types (archetypeId 30..39: PSZ, VAVS, PIU, FC, PTAC)
  if (archetypeId >= 30 && archetypeId < 40) {
    const cop = Math.max(0.5, getCon(slotPtr, conCount, 0, 3.2));
    const heatEff = clamp(getCon(slotPtr, conCount, 1, 0.82), 0.2, 1.0);
    const fanRatio = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.07));
    const minPlr = clamp(getCon(slotPtr, conCount, 3, 0.25), 0.05, 1.0);

    const loadW = getIo(slotPtr, 3); // > 0 heating, < 0 cooling
    const capW = Math.max(1.0, getIo(slotPtr, 4) > 0.0 ? getIo(slotPtr, 4) : Math.abs(loadW));
    const plr = clamp(Math.abs(loadW) / capW, 0.0, 1.0);

    // DOE-2 quadratic EIR part-load factor: EIR_fPLR = 0.088065 + 1.12722*PLR - 0.215285*PLR^2
    const effPlr = plr > 0.0 ? Math.max(plr, minPlr) : 0.0;
    const eirMod = plr > 0.0 ? clamp(0.088065 + 1.12722 * effPlr - 0.215285 * effPlr * effPlr, 0.2, 1.3) : 0.0;

    // Fan power: cubic unloading for VAVS (31) / PIU (32), constant/cycling for PSZ/FC/PTAC
    const isVav = archetypeId == 31 || archetypeId == 32;
    const fanFrac = isVav ? 0.1 + 0.9 * effPlr * effPlr * effPlr : effPlr;
    const fanW = plr > 0.0 ? capW * fanRatio * fanFrac : 0.0;

    let elecW: f64 = fanW;
    let fuelW: f64 = 0.0;

    if (loadW < 0.0) {
      // Cooling mode
      const coolW = Math.abs(loadW);
      elecW += (coolW / cop) * (eirMod / Math.max(effPlr, 1e-4));
    } else if (loadW > 0.0) {
      // Heating mode
      fuelW = loadW / heatEff;
    }

    setIo(slotPtr, 10, elecW);
    setIo(slotPtr, 11, fuelW);
    setIo(slotPtr, 12, fanW);
    setIo(slotPtr, 13, plr);
  }
}
