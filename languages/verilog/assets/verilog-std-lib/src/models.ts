// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript IEEE 1364 4-state digital logic runtime for `@modelscript/verilog-std-lib`.
 *
 * 4-state bit encoding (IEEE 1364):
 *   0 = Logic 0 (low)
 *   1 = Logic 1 (high)
 *   2 = Logic X (unknown / contention)
 *   3 = Logic Z (high-impedance)
 */

const LOGIC_0: i32 = 0;
const LOGIC_1: i32 = 1;
const LOGIC_X: i32 = 2;
const LOGIC_Z: i32 = 3;

// Archetype IDs (matching VerilogArchetypeId in verilog-std-schemas.ts)
const ARCH_AND: i32 = 1;
const ARCH_NAND: i32 = 2;
const ARCH_OR: i32 = 3;
const ARCH_NOR: i32 = 4;
const ARCH_XOR: i32 = 5;
const ARCH_XNOR: i32 = 6;
const ARCH_BUF: i32 = 7;
const ARCH_NOT: i32 = 8;
const ARCH_BUFIF0: i32 = 9;
const ARCH_BUFIF1: i32 = 10;
const ARCH_NOTIF0: i32 = 11;
const ARCH_NOTIF1: i32 = 12;
const ARCH_MUX2: i32 = 30;
const ARCH_HALF_ADDER: i32 = 40;
const ARCH_FULL_ADDER: i32 = 41;
const ARCH_ALU4: i32 = 42;

@inline
function bitNot(a: i32): i32 {
  if (a == LOGIC_0) return LOGIC_1;
  if (a == LOGIC_1) return LOGIC_0;
  return LOGIC_X;
}

@inline
function bitBuf(a: i32): i32 {
  if (a == LOGIC_0) return LOGIC_0;
  if (a == LOGIC_1) return LOGIC_1;
  return LOGIC_X;
}

@inline
function bitAnd(a: i32, b: i32): i32 {
  if (a == LOGIC_0 || b == LOGIC_0) return LOGIC_0;
  if (a == LOGIC_1 && b == LOGIC_1) return LOGIC_1;
  return LOGIC_X;
}

@inline
function bitOr(a: i32, b: i32): i32 {
  if (a == LOGIC_1 || b == LOGIC_1) return LOGIC_1;
  if (a == LOGIC_0 && b == LOGIC_0) return LOGIC_0;
  return LOGIC_X;
}

@inline
function bitXor(a: i32, b: i32): i32 {
  if (a >= LOGIC_X || b >= LOGIC_X) return LOGIC_X;
  return (a ^ b) & 1;
}

@inline
function bitBufIf1(a: i32, en: i32): i32 {
  if (en == LOGIC_0) return LOGIC_Z;
  if (en == LOGIC_1) return bitBuf(a);
  return LOGIC_X;
}

@inline
function bitBufIf0(a: i32, en: i32): i32 {
  if (en == LOGIC_1) return LOGIC_Z;
  if (en == LOGIC_0) return bitBuf(a);
  return LOGIC_X;
}

@inline
function bitNotIf1(a: i32, en: i32): i32 {
  if (en == LOGIC_0) return LOGIC_Z;
  if (en == LOGIC_1) return bitNot(a);
  return LOGIC_X;
}

@inline
function bitNotIf0(a: i32, en: i32): i32 {
  if (en == LOGIC_1) return LOGIC_Z;
  if (en == LOGIC_0) return bitNot(a);
  return LOGIC_X;
}

/**
 * Evaluates a single IEEE 1364 primitive or RTL block kernel.
 * Returns packed result (for adders: `(cout << 8) | sum`; for gates: 4-state output `0..3`).
 */
export function verilogEvalPrimitive(archetypeId: i32, a: i32, b: i32, c: i32): i32 {
  if (archetypeId == ARCH_AND) return bitAnd(a, b);
  if (archetypeId == ARCH_NAND) return bitNot(bitAnd(a, b));
  if (archetypeId == ARCH_OR) return bitOr(a, b);
  if (archetypeId == ARCH_NOR) return bitNot(bitOr(a, b));
  if (archetypeId == ARCH_XOR) return bitXor(a, b);
  if (archetypeId == ARCH_XNOR) return bitNot(bitXor(a, b));
  if (archetypeId == ARCH_BUF) return bitBuf(a);
  if (archetypeId == ARCH_NOT) return bitNot(a);
  if (archetypeId == ARCH_BUFIF0) return bitBufIf0(a, b);
  if (archetypeId == ARCH_BUFIF1) return bitBufIf1(a, b);
  if (archetypeId == ARCH_NOTIF0) return bitNotIf0(a, b);
  if (archetypeId == ARCH_NOTIF1) return bitNotIf1(a, b);

  if (archetypeId == ARCH_MUX2) {
    if (c == LOGIC_0) return bitBuf(a);
    if (c == LOGIC_1) return bitBuf(b);
    if (a == b && a <= LOGIC_1) return a;
    return LOGIC_X;
  }

  if (archetypeId == ARCH_HALF_ADDER) {
    const sum = bitXor(a, b);
    const cout = bitAnd(a, b);
    return (cout << 8) | sum;
  }

  if (archetypeId == ARCH_FULL_ADDER) {
    const axorb = bitXor(a, b);
    const sum = bitXor(axorb, c);
    const ab = bitAnd(a, b);
    const cinaxorb = bitAnd(c, axorb);
    const cout = bitOr(ab, cinaxorb);
    return (cout << 8) | sum;
  }

  if (archetypeId == ARCH_ALU4) {
    const ua = a & 0xf;
    const ub = b & 0xf;
    const op = c & 0x7;
    if (op == 0) return (ua + ub) & 0xf;
    if (op == 1) return (ua - ub) & 0xf;
    if (op == 2) return ua & ub;
    if (op == 3) return ua | ub;
    if (op == 4) return ua ^ ub;
    if (op == 5) return (~ua) & 0xf;
    if (op == 6) return (ua << 1) & 0xf;
    return (ua >> 1) & 0xf;
  }

  return LOGIC_X;
}

/**
 * Advances a 7-bit maximal-length PRBS-7 LFSR (x^7 + x^6 + 1) by one clock cycle.
 */
export function verilogStepLfsr7(state: i32): i32 {
  const s = state & 0x7f;
  const feedback = ((s >> 6) ^ (s >> 5)) & 1;
  return ((s << 1) | feedback) & 0x7f;
}
