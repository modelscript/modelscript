// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Classic 1980s PLD fuse-matrix architecture profiles:
 * PAL16L8, PAL16R8, GAL16V8, GAL22V10, and generic fallback.
 */

import type { JedecDeviceName, JedecDocument } from "../types.js";

export interface JedecColumnPair {
  /** Even column index (true literal). */
  trueCol: number;
  /** Odd column index (complemented literal). */
  compCol: number;
  /** Physical 1-based IC pin number. */
  pin: number;
  /** Canonical signal name for this input column. */
  signalName: string;
}

export interface JedecMacrocellSpec {
  outputIndex: number;
  pin: number;
  signalName: string;
  /** First product term row index (0-based). */
  startRow: number;
  /** Total product term rows belonging to this macrocell (including optional OE row). */
  rowCount: number;
  /** True if `startRow` is the tristate output-enable product term. */
  hasOeRow: boolean;
  /** Default polarity: true for active-low (`!SOP`), false for active-high (`SOP`). */
  defaultActiveLow: boolean;
  /** Optional XOR polarity fuse address (GAL16V8: 0 = active-low, 1 = active-high). */
  xorFuseAddress?: number | undefined;
}

export interface JedecDeviceProfile {
  deviceName: JedecDeviceName;
  pinCount: number;
  fuseCount: number;
  matrixRows: number;
  matrixCols: number;
  columnPairs: JedecColumnPair[];
  macrocells: JedecMacrocellSpec[];
  dedicatedInputPins: number[];
  outputPins: number[];
  powerPins: number[];
}

/**
 * Standard MMI PAL16L8 / Lattice GAL16V8 32-column input-literal mapping.
 * Each pair `(2*k, 2*k+1)` represents `(pin, !pin)`.
 */
const PAL16_COLUMN_PINS: ReadonlyArray<{ pin: number; name: string }> = [
  { pin: 2, name: "I2" },
  { pin: 1, name: "I1" },
  { pin: 3, name: "I3" },
  { pin: 18, name: "IO18" },
  { pin: 4, name: "I4" },
  { pin: 17, name: "IO17" },
  { pin: 5, name: "I5" },
  { pin: 16, name: "IO16" },
  { pin: 6, name: "I6" },
  { pin: 15, name: "IO15" },
  { pin: 7, name: "I7" },
  { pin: 14, name: "IO14" },
  { pin: 8, name: "I8" },
  { pin: 13, name: "IO13" },
  { pin: 9, name: "I9" },
  { pin: 11, name: "I11" },
];

function buildPal16ColumnPairs(): JedecColumnPair[] {
  return PAL16_COLUMN_PINS.map((entry, idx) => ({
    trueCol: idx * 2,
    compCol: idx * 2 + 1,
    pin: entry.pin,
    signalName: entry.name,
  }));
}

function buildPal16Macrocells(hasOeRow: boolean, includeGalXorFuses: boolean): JedecMacrocellSpec[] {
  const outputPins = [19, 18, 17, 16, 15, 14, 13, 12];
  return outputPins.map((pin, idx) => ({
    outputIndex: idx,
    pin,
    signalName: `O${pin}`,
    startRow: idx * 8,
    rowCount: 8,
    hasOeRow,
    defaultActiveLow: true,
    xorFuseAddress: includeGalXorFuses ? 2048 + idx : undefined,
  }));
}

function buildGal22V10ColumnPairs(): JedecColumnPair[] {
  const pins = [1, 23, 2, 22, 3, 21, 4, 20, 5, 19, 6, 18, 7, 17, 8, 16, 9, 15, 10, 14, 11, 13];
  return pins.map((pin, idx) => ({
    trueCol: idx * 2,
    compCol: idx * 2 + 1,
    pin,
    signalName: pin <= 11 || pin === 13 ? `I${pin}` : `IO${pin}`,
  }));
}

function buildGal22V10Macrocells(): JedecMacrocellSpec[] {
  // GAL22V10 variable product term distribution: 8,10,12,14,16,16,14,12,10,8 (+1 OE row each)
  const termCounts = [8, 10, 12, 14, 16, 16, 14, 12, 10, 8];
  const outputPins = [23, 22, 21, 20, 19, 18, 17, 16, 15, 14];
  let row = 1; // Row 0 is global AR (Asynchronous Reset)
  return outputPins.map((pin, idx) => {
    const count = (termCounts[idx] ?? 8) + 1; // 1 OE + N product terms
    const spec: JedecMacrocellSpec = {
      outputIndex: idx,
      pin,
      signalName: `O${pin}`,
      startRow: row,
      rowCount: count,
      hasOeRow: true,
      defaultActiveLow: true,
      xorFuseAddress: 5808 + idx * 2,
    };
    row += count;
    return spec;
  });
}

export const PAL16L8_PROFILE: JedecDeviceProfile = {
  deviceName: "PAL16L8",
  pinCount: 20,
  fuseCount: 2048,
  matrixRows: 64,
  matrixCols: 32,
  columnPairs: buildPal16ColumnPairs(),
  macrocells: buildPal16Macrocells(true, false),
  dedicatedInputPins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
  outputPins: [19, 18, 17, 16, 15, 14, 13, 12],
  powerPins: [10, 20],
};

export const PAL16R8_PROFILE: JedecDeviceProfile = {
  deviceName: "PAL16R8",
  pinCount: 20,
  fuseCount: 2048,
  matrixRows: 64,
  matrixCols: 32,
  columnPairs: buildPal16ColumnPairs(),
  macrocells: buildPal16Macrocells(false, false),
  dedicatedInputPins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
  outputPins: [19, 18, 17, 16, 15, 14, 13, 12],
  powerPins: [10, 20],
};

export const GAL16V8_PROFILE: JedecDeviceProfile = {
  deviceName: "GAL16V8",
  pinCount: 20,
  fuseCount: 2194,
  matrixRows: 64,
  matrixCols: 32,
  columnPairs: buildPal16ColumnPairs(),
  macrocells: buildPal16Macrocells(true, true),
  dedicatedInputPins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
  outputPins: [19, 18, 17, 16, 15, 14, 13, 12],
  powerPins: [10, 20],
};

export const GAL22V10_PROFILE: JedecDeviceProfile = {
  deviceName: "GAL22V10",
  pinCount: 24,
  fuseCount: 5892,
  matrixRows: 132,
  matrixCols: 44,
  columnPairs: buildGal22V10ColumnPairs(),
  macrocells: buildGal22V10Macrocells(),
  dedicatedInputPins: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13],
  outputPins: [23, 22, 21, 20, 19, 18, 17, 16, 15, 14],
  powerPins: [12, 24],
};

/**
 * Selects the matching `JedecDeviceProfile` for a parsed `JedecDocument`.
 */
export function getJedecDeviceProfile(doc: JedecDocument): JedecDeviceProfile {
  switch (doc.deviceName) {
    case "PAL16L8":
      return PAL16L8_PROFILE;
    case "PAL16R8":
      return PAL16R8_PROFILE;
    case "GAL16V8":
      return GAL16V8_PROFILE;
    case "GAL22V10":
      return GAL22V10_PROFILE;
    default: {
      // Build a clean generic profile matching fuseCount and pinCount
      const fuseCount = Math.max(doc.fuseCount ?? doc.fuses.length, 0);
      const pinCount = doc.pinCount ?? 20;
      if (fuseCount >= 2048 && pinCount === 20) {
        return PAL16L8_PROFILE;
      }
      const cols = Math.min(32, Math.max(2, Math.floor((pinCount - 2) / 2) * 2));
      const rows = fuseCount > 0 ? Math.max(1, Math.floor(fuseCount / cols)) : 0;
      const numPairs = Math.floor(cols / 2);
      const columnPairs: JedecColumnPair[] = [];
      for (let i = 0; i < numPairs; i++) {
        columnPairs.push({
          trueCol: i * 2,
          compCol: i * 2 + 1,
          pin: i + 1,
          signalName: `I${i + 1}`,
        });
      }
      const outPin = Math.max(numPairs + 1, pinCount - 1);
      const macrocells: JedecMacrocellSpec[] =
        rows > 0
          ? [
              {
                outputIndex: 0,
                pin: outPin,
                signalName: `O${outPin}`,
                startRow: 0,
                rowCount: rows,
                hasOeRow: false,
                defaultActiveLow: false,
              },
            ]
          : [];
      return {
        deviceName: "GENERIC",
        pinCount,
        fuseCount,
        matrixRows: rows,
        matrixCols: cols,
        columnPairs,
        macrocells,
        dedicatedInputPins: columnPairs.map((c) => c.pin),
        outputPins: macrocells.map((m) => m.pin),
        powerPins: [],
      };
    }
  }
}
