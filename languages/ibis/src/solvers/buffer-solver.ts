// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IbisDeck, IbisModel, TableRow } from "../types.js";

/**
 * Linearly interpolate current from an I/V table.
 */
export function interpolateIvTable(table: TableRow[] | undefined, v: number): number {
  if (!table || table.length === 0) return 0.0;
  if (table.length === 1) return table[0]!.typ;

  if (v <= table[0]!.vOrT) {
    // Extrapolate below first point using first slope
    const p0 = table[0]!;
    const p1 = table[1]!;
    const slope = (p1.typ - p0.typ) / (p1.vOrT - p0.vOrT || 1e-6);
    return p0.typ + slope * (v - p0.vOrT);
  }

  const last = table[table.length - 1]!;
  if (v >= last.vOrT) {
    // Extrapolate above last point using last slope
    const pPrev = table[table.length - 2]!;
    const slope = (last.typ - pPrev.typ) / (last.vOrT - pPrev.vOrT || 1e-6);
    return last.typ + slope * (v - last.vOrT);
  }

  // O(log N) Binary search for interval
  let low = 0;
  let high = table.length - 2;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const p0 = table[mid]!;
    const p1 = table[mid + 1]!;
    if (v >= p0.vOrT && v <= p1.vOrT) {
      const span = p1.vOrT - p0.vOrT;
      const frac = span > 1e-12 ? (v - p0.vOrT) / span : 0.0;
      return p0.typ + frac * (p1.typ - p0.typ);
    }
    if (v < p0.vOrT) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return last.typ;
}

/**
 * Evaluates transient output buffer current at voltage v and logic state (0 = LOW, 1 = HIGH).
 */
export function evaluateBufferCurrent(
  model: IbisModel,
  v: number,
  logicState: 0 | 1 = 1,
): { iTotal: number; iPullup: number; iPulldown: number; iClamp: number } {
  const vcc = model.voltageRange.typ;

  // Clamps always active
  const iGndClamp = interpolateIvTable(model.gndClamp, v);
  const iPwrClamp = interpolateIvTable(model.powerClamp, v - vcc);
  const iClamp = iGndClamp + iPwrClamp;

  let iPullup = 0.0;
  let iPulldown = 0.0;

  if (logicState === 1) {
    // HIGH state: Pullup active (Vtable = Vcc - v)
    iPullup = interpolateIvTable(model.pullup, vcc - v);
  } else {
    // LOW state: Pulldown active (Vtable = v)
    iPulldown = interpolateIvTable(model.pulldown, v);
  }

  const iTotal = (logicState === 1 ? iPullup : -iPulldown) + iClamp;

  return { iTotal, iPullup, iPulldown, iClamp };
}

/**
 * Estimate dynamic buffer output resistance (R_on) in Ohms.
 */
export function calculateOutputResistance(model: IbisModel): { rOnLow: number; rOnHigh: number } {
  // R_on low evaluated near 0.2V
  const vLow = 0.2;
  const iLow = Math.abs(interpolateIvTable(model.pulldown, vLow));
  const rOnLow = iLow > 1e-6 ? vLow / iLow : 25.0;

  // R_on high evaluated near Vcc - 0.2V
  const vHighDrop = 0.2;
  const iHigh = Math.abs(interpolateIvTable(model.pullup, vHighDrop));
  const rOnHigh = iHigh > 1e-6 ? vHighDrop / iHigh : 25.0;

  return { rOnLow, rOnHigh };
}

/**
 * Evaluates buffer characteristics from an entire IbisDeck by model name.
 */
export function evalIbisBufferOutput(
  deck: IbisDeck,
  modelName: string = "DEFAULT",
  voltage: number = 1.2,
): {
  modelName: string;
  resistance: { rOnLow: number; rOnHigh: number };
  current: { iTotal: number; iPullup: number; iPulldown: number; iClamp: number };
} | null {
  const model = deck.models.get(modelName) ?? deck.models.values().next().value;
  if (!model) return null;
  return {
    modelName: model.name,
    resistance: calculateOutputResistance(model),
    current: evaluateBufferCurrent(model, voltage, 1),
  };
}
