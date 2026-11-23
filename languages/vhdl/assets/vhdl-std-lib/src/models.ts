// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript IEEE 1164 / NUMERIC_STD / Gate runtime for `@modelscript/vhdl-std-lib`.
 *
 * 9-value `std_ulogic` encoding:
 *   0='U', 1='X', 2='0', 3='1', 4='Z', 5='W', 6='L', 7='H', 8='-'
 */

export const LOGIC_U: i32 = 0;
export const LOGIC_X: i32 = 1;
export const LOGIC_0: i32 = 2;
export const LOGIC_1: i32 = 3;
export const LOGIC_Z: i32 = 4;
export const LOGIC_W: i32 = 5;
export const LOGIC_L: i32 = 6;
export const LOGIC_H: i32 = 7;
export const LOGIC_D: i32 = 8;

// IEEE Std 1164 9x9 resolution table (row * 9 + col)
const RESOLUTION_TABLE: StaticArray<i32> = [
  // U, X, 0, 1, Z, W, L, H, -
  0, 0, 0, 0, 0, 0, 0, 0, 0, // U
  0, 1, 1, 1, 1, 1, 1, 1, 1, // X
  0, 1, 2, 1, 2, 2, 2, 2, 1, // 0
  0, 1, 1, 3, 3, 3, 3, 3, 1, // 1
  0, 1, 2, 3, 4, 5, 6, 7, 1, // Z
  0, 1, 2, 3, 5, 5, 5, 5, 1, // W
  0, 1, 2, 3, 6, 5, 6, 5, 1, // L
  0, 1, 2, 3, 7, 5, 5, 7, 1, // H
  0, 1, 1, 1, 1, 1, 1, 1, 1, // -
];

// IEEE 1164 NOT table
const NOT_TABLE: StaticArray<i32> = [0, 1, 3, 2, 1, 1, 3, 2, 1];

// IEEE 1164 AND table (row * 9 + col)
const AND_TABLE: StaticArray<i32> = [
  // U, X, 0, 1, Z, W, L, H, -
  0, 0, 2, 0, 0, 0, 2, 0, 0, // U
  0, 1, 2, 1, 1, 1, 2, 1, 1, // X
  2, 2, 2, 2, 2, 2, 2, 2, 2, // 0
  0, 1, 2, 3, 1, 1, 2, 3, 1, // 1
  0, 1, 2, 1, 1, 1, 2, 1, 1, // Z
  0, 1, 2, 1, 1, 1, 2, 1, 1, // W
  2, 2, 2, 2, 2, 2, 2, 2, 2, // L
  0, 1, 2, 3, 1, 1, 2, 3, 1, // H
  0, 1, 2, 1, 1, 1, 2, 1, 1, // -
];

// IEEE 1164 OR table (row * 9 + col)
const OR_TABLE: StaticArray<i32> = [
  // U, X, 0, 1, Z, W, L, H, -
  0, 0, 0, 3, 0, 0, 0, 3, 0, // U
  0, 1, 1, 3, 1, 1, 1, 3, 1, // X
  0, 1, 2, 3, 1, 1, 2, 3, 1, // 0
  3, 3, 3, 3, 3, 3, 3, 3, 3, // 1
  0, 1, 1, 3, 1, 1, 1, 3, 1, // Z
  0, 1, 1, 3, 1, 1, 1, 3, 1, // W
  0, 1, 2, 3, 1, 1, 2, 3, 1, // L
  3, 3, 3, 3, 3, 3, 3, 3, 3, // H
  0, 1, 1, 3, 1, 1, 1, 3, 1, // -
];

// IEEE 1164 XOR table (row * 9 + col)
const XOR_TABLE: StaticArray<i32> = [
  // U, X, 0, 1, Z, W, L, H, -
  0, 0, 0, 0, 0, 0, 0, 0, 0, // U
  0, 1, 1, 1, 1, 1, 1, 1, 1, // X
  0, 1, 2, 3, 1, 1, 2, 3, 1, // 0
  0, 1, 3, 2, 1, 1, 3, 2, 1, // 1
  0, 1, 1, 1, 1, 1, 1, 1, 1, // Z
  0, 1, 1, 1, 1, 1, 1, 1, 1, // W
  0, 1, 2, 3, 1, 1, 2, 3, 1, // L
  0, 1, 3, 2, 1, 1, 3, 2, 1, // H
  0, 1, 1, 1, 1, 1, 1, 1, 1, // -
];

@inline
function clampLogic(v: i32): i32 {
  return v >= 0 && v < 9 ? v : LOGIC_X;
}

/** IEEE 1164 2-driver resolution function. */
export function resolveStdLogic(a: i32, b: i32): i32 {
  return unchecked(RESOLUTION_TABLE[clampLogic(a) * 9 + clampLogic(b)]);
}

/** IEEE 1164 NOT gate. */
export function stdNot(a: i32): i32 {
  return unchecked(NOT_TABLE[clampLogic(a)]);
}

/** IEEE 1164 AND gate. */
export function stdAnd(a: i32, b: i32): i32 {
  return unchecked(AND_TABLE[clampLogic(a) * 9 + clampLogic(b)]);
}

/** IEEE 1164 OR gate. */
export function stdOr(a: i32, b: i32): i32 {
  return unchecked(OR_TABLE[clampLogic(a) * 9 + clampLogic(b)]);
}

/** IEEE 1164 XOR gate. */
export function stdXor(a: i32, b: i32): i32 {
  return unchecked(XOR_TABLE[clampLogic(a) * 9 + clampLogic(b)]);
}

/** IEEE 1164 NAND gate. */
export function stdNand(a: i32, b: i32): i32 {
  return stdNot(stdAnd(a, b));
}

/** IEEE 1164 NOR gate. */
export function stdNor(a: i32, b: i32): i32 {
  return stdNot(stdOr(a, b));
}

/** 2-to-1 MUX (sel = 2/'0' -> d0, sel = 3/'1' -> d1). */
export function stdMux2(d0: i32, d1: i32, sel: i32): i32 {
  const s = clampLogic(sel);
  if (s == LOGIC_0 || s == LOGIC_L) return clampLogic(d0);
  if (s == LOGIC_1 || s == LOGIC_H) return clampLogic(d1);
  return LOGIC_X;
}

/** 1-bit full adder: returns (cout << 4) | sum. */
export function fullAdder1(a: i32, b: i32, cin: i32): i32 {
  const axorb = stdXor(a, b);
  const sum = stdXor(axorb, cin);
  const cout = stdOr(stdAnd(a, b), stdAnd(cin, axorb));
  return (cout << 4) | sum;
}

/** Rising edge detector: returns 1 if prev was 0/L and curr is 1/H. */
export function isRisingEdge(prev: i32, curr: i32): i32 {
  const wasLow = prev == LOGIC_0 || prev == LOGIC_L;
  const isHigh = curr == LOGIC_1 || curr == LOGIC_H;
  return wasLow && isHigh ? 1 : 0;
}

/** Falling edge detector: returns 1 if prev was 1/H and curr is 0/L. */
export function isFallingEdge(prev: i32, curr: i32): i32 {
  const wasHigh = prev == LOGIC_1 || prev == LOGIC_H;
  const isLow = curr == LOGIC_0 || curr == LOGIC_L;
  return wasHigh && isLow ? 1 : 0;
}

/** Modular unsigned addition (NUMERIC_STD). */
export function addUnsigned(a: u32, b: u32, width: i32): u32 {
  const mask: u32 = width >= 32 ? 0xffffffff : ((<u32>1 << width) - 1);
  return (a + b) & mask;
}

/** Modular unsigned subtraction (NUMERIC_STD). */
export function subUnsigned(a: u32, b: u32, width: i32): u32 {
  const mask: u32 = width >= 32 ? 0xffffffff : ((<u32>1 << width) - 1);
  return (a - b) & mask;
}

/** Unified archetype dispatch for stdlib kernel evaluation. */
export function vhdlStdEval(archetypeId: i32, in0: i32, in1: i32, in2: i32): i32 {
  if (archetypeId == 13) return resolveStdLogic(in0, in1); // RESOLVED
  if (archetypeId == 14) return isRisingEdge(in0, in1); // RISING_EDGE
  if (archetypeId == 15) return isFallingEdge(in0, in1); // FALLING_EDGE
  if (archetypeId == 24) return <i32>addUnsigned(<u32>in0, <u32>in1, in2 > 0 ? in2 : 4); // ADD_UNSIGNED
  if (archetypeId == 25) return <i32>subUnsigned(<u32>in0, <u32>in1, in2 > 0 ? in2 : 4); // SUB_UNSIGNED
  if (archetypeId == 30) return stdAnd(in0, in1); // AND2
  if (archetypeId == 31) return stdOr(in0, in1); // OR2
  if (archetypeId == 32) return stdXor(in0, in1); // XOR2
  if (archetypeId == 33) return stdNand(in0, in1); // NAND2
  if (archetypeId == 34) return stdNor(in0, in1); // NOR2
  if (archetypeId == 35) return stdNot(in0); // INV
  if (archetypeId == 36) return stdMux2(in0, in1, in2); // MUX2
  if (archetypeId == 37) return fullAdder1(in0, in1, in2); // FA1
  return LOGIC_U;
}
