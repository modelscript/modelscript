// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StdLogic } from "../types.js";

export const STD_LOGIC_VALUES: readonly StdLogic[] = ["U", "X", "0", "1", "Z", "W", "L", "H", "-"] as const;

const LOGIC_IDX: Record<StdLogic, number> = {
  U: 0,
  X: 1,
  "0": 2,
  "1": 3,
  Z: 4,
  W: 5,
  L: 6,
  H: 7,
  "-": 8,
};

const RESOLUTION_TABLE: readonly (readonly StdLogic[])[] = [
  // U    X    0    1    Z    W    L    H    -
  ["U", "U", "U", "U", "U", "U", "U", "U", "U"], // U
  ["U", "X", "X", "X", "X", "X", "X", "X", "X"], // X
  ["U", "X", "0", "X", "0", "0", "0", "0", "X"], // 0
  ["U", "X", "X", "1", "1", "1", "1", "1", "X"], // 1
  ["U", "X", "0", "1", "Z", "W", "L", "H", "X"], // Z
  ["U", "X", "0", "1", "W", "W", "W", "W", "X"], // W
  ["U", "X", "0", "1", "L", "W", "L", "W", "X"], // L
  ["U", "X", "0", "1", "H", "W", "W", "H", "X"], // H
  ["U", "X", "X", "X", "X", "X", "X", "X", "X"], // -
];

const NOT_TABLE: readonly StdLogic[] = ["U", "X", "1", "0", "X", "X", "1", "0", "X"];

const AND_TABLE: readonly (readonly StdLogic[])[] = [
  // U    X    0    1    Z    W    L    H    -
  ["U", "U", "0", "U", "U", "U", "0", "U", "U"], // U
  ["U", "X", "0", "X", "X", "X", "0", "X", "X"], // X
  ["0", "0", "0", "0", "0", "0", "0", "0", "0"], // 0
  ["U", "X", "0", "1", "X", "X", "0", "1", "X"], // 1
  ["U", "X", "0", "X", "X", "X", "0", "X", "X"], // Z
  ["U", "X", "0", "X", "X", "X", "0", "X", "X"], // W
  ["0", "0", "0", "0", "0", "0", "0", "0", "0"], // L
  ["U", "X", "0", "1", "X", "X", "0", "1", "X"], // H
  ["U", "X", "0", "X", "X", "X", "0", "X", "X"], // -
];

const OR_TABLE: readonly (readonly StdLogic[])[] = [
  // U    X    0    1    Z    W    L    H    -
  ["U", "U", "U", "1", "U", "U", "U", "1", "U"], // U
  ["U", "X", "X", "1", "X", "X", "X", "1", "X"], // X
  ["U", "X", "0", "1", "X", "X", "0", "1", "X"], // 0
  ["1", "1", "1", "1", "1", "1", "1", "1", "1"], // 1
  ["U", "X", "X", "1", "X", "X", "X", "1", "X"], // Z
  ["U", "X", "X", "1", "X", "X", "X", "1", "X"], // W
  ["U", "X", "0", "1", "X", "X", "0", "1", "X"], // L
  ["1", "1", "1", "1", "1", "1", "1", "1", "1"], // H
  ["U", "X", "X", "1", "X", "X", "X", "1", "X"], // -
];

const XOR_TABLE: readonly (readonly StdLogic[])[] = [
  // U    X    0    1    Z    W    L    H    -
  ["U", "U", "U", "U", "U", "U", "U", "U", "U"], // U
  ["U", "X", "X", "X", "X", "X", "X", "X", "X"], // X
  ["U", "X", "0", "1", "X", "X", "0", "1", "X"], // 0
  ["U", "X", "1", "0", "X", "X", "1", "0", "X"], // 1
  ["U", "X", "X", "X", "X", "X", "X", "X", "X"], // Z
  ["U", "X", "X", "X", "X", "X", "X", "X", "X"], // W
  ["U", "X", "0", "1", "X", "X", "0", "1", "X"], // L
  ["U", "X", "1", "0", "X", "X", "1", "0", "X"], // H
  ["U", "X", "X", "X", "X", "X", "X", "X", "X"], // -
];

export function toStdLogic(ch: string): StdLogic {
  const u = ch.toUpperCase();
  if (u in LOGIC_IDX) return u as StdLogic;
  return "X";
}

export function resolveStdLogic(drivers: readonly StdLogic[]): StdLogic {
  if (drivers.length === 0) return "Z";
  let acc = drivers[0]!;
  for (let i = 1; i < drivers.length; i++) {
    acc = RESOLUTION_TABLE[LOGIC_IDX[acc]]![LOGIC_IDX[drivers[i]!]]!;
  }
  return acc;
}

export function stdNot(a: StdLogic): StdLogic {
  return NOT_TABLE[LOGIC_IDX[a]]!;
}

export function stdAnd(a: StdLogic, b: StdLogic): StdLogic {
  return AND_TABLE[LOGIC_IDX[a]]![LOGIC_IDX[b]]!;
}

export function stdOr(a: StdLogic, b: StdLogic): StdLogic {
  return OR_TABLE[LOGIC_IDX[a]]![LOGIC_IDX[b]]!;
}

export function stdXor(a: StdLogic, b: StdLogic): StdLogic {
  return XOR_TABLE[LOGIC_IDX[a]]![LOGIC_IDX[b]]!;
}

export function stdNand(a: StdLogic, b: StdLogic): StdLogic {
  return stdNot(stdAnd(a, b));
}

export function stdNor(a: StdLogic, b: StdLogic): StdLogic {
  return stdNot(stdOr(a, b));
}

export function stdXnor(a: StdLogic, b: StdLogic): StdLogic {
  return stdNot(stdXor(a, b));
}

export function isHigh(v: StdLogic): boolean {
  return v === "1" || v === "H";
}

export function isLow(v: StdLogic): boolean {
  return v === "0" || v === "L";
}

export function bitsToUnsigned(bits: string): number {
  let acc = 0;
  for (const ch of bits) {
    acc = acc * 2 + (ch === "1" || ch === "H" ? 1 : 0);
  }
  return acc;
}

export function unsignedToBits(value: number, width: number): string {
  const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
  const v = (Math.trunc(value) >>> 0) & mask;
  return v.toString(2).padStart(width, "0").slice(-width);
}

export function bitsToSigned(bits: string): number {
  if (bits.length === 0) return 0;
  const u = bitsToUnsigned(bits);
  const signBit = 1 << (bits.length - 1);
  return u >= signBit ? u - (1 << bits.length) : u;
}

export function signedToBits(value: number, width: number): string {
  return unsignedToBits(value, width);
}

export function expandBitString(value: string, base: "B" | "O" | "X" = "B"): string {
  if (base === "B") return value.toUpperCase();
  const bitsPerDigit = base === "X" ? 4 : 3;
  let out = "";
  for (const ch of value) {
    if (ch === "_") continue;
    const digit = Number.parseInt(ch, base === "X" ? 16 : 8);
    if (Number.isNaN(digit)) {
      out += "X".repeat(bitsPerDigit);
    } else {
      out += digit.toString(2).padStart(bitsPerDigit, "0");
    }
  }
  return out;
}
