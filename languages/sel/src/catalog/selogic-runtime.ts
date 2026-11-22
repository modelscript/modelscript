// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom SELogic Boolean & Timer Expression Evaluator and Standard Relay Word Bit Presets
 * for SEL-421 (Transmission Line), SEL-487 (Transformer/Bus Differential), and SEL-351 (Feeder).
 *
 * Supported SELogic operators (in descending precedence):
 *   1. Parentheses: `( ... )`
 *   2. Unary prefix: `!` / `NOT` (logical negation), `/` (rising edge), `\` (falling edge)
 *   3. Conjunction: `*` / `AND`
 *   4. Disjunction: `+` / `OR`
 *
 * Provenance: IEEE Std C37.2-2022; IEC 61131-3; public SEL-351/421/487 instruction manuals.
 */

export type SelRelayFamily = "SEL-421" | "SEL-487" | "SEL-351";

export interface SeLogicTimerSpec {
  /** Target output Relay Word bit name (e.g. "SV1T") */
  name: string;
  /** SELogic boolean input equation (e.g. "Z2P * !52B") */
  inputExpr: string;
  /** Pickup delay SVnPU in seconds */
  pickupDelaySec: number;
  /** Dropout delay SVnDO in seconds */
  dropoutDelaySec: number;
}

export interface SeLogicTimerState {
  puTimer: number;
  doTimer: number;
  output: boolean;
}

export interface SeLogicStepResult {
  wordBits: Record<string, boolean>;
  timerStates: Record<string, SeLogicTimerState>;
}

const COMMON_BASE_WORD_BITS: readonly string[] = [
  "52A",
  "52B",
  "TRIP",
  "CLOSE",
  "OUT101",
  "OUT102",
  "OUT103",
  "IN101",
  "IN102",
  "IN103",
  "SV1T",
  "SV2T",
  "SV3T",
  "SV4T",
  "LT01",
  "LT02",
  "LT03",
  "LT04",
  "50P1",
  "50P2",
  "51P1T",
  "50G1",
  "51G1T",
];

/** Standard SEL-421 transmission line distance & directional protection Relay Word bit presets. */
export const SEL_421_WORD_BIT_PRESETS: readonly string[] = [
  ...COMMON_BASE_WORD_BITS,
  "Z1P",
  "Z2P",
  "Z3P",
  "Z1G",
  "Z2G",
  "Z3G",
  "M1P",
  "M2P",
  "M3P",
  "67P1",
  "67G1",
  "LOP",
  "85RIO",
  "79RS",
  "79CY",
  "79LO",
  "50BF",
];

/** Standard SEL-487 transformer & bus differential protection Relay Word bit presets. */
export const SEL_487_WORD_BIT_PRESETS: readonly string[] = [
  ...COMMON_BASE_WORD_BITS,
  "87R",
  "87U",
  "87R1",
  "87R2",
  "87R3",
  "87BL2",
  "87BL5",
  "24T",
  "49T",
  "50BF",
];

/** Standard SEL-351 distribution feeder protection & reclosing Relay Word bit presets. */
export const SEL_351_WORD_BIT_PRESETS: readonly string[] = [
  ...COMMON_BASE_WORD_BITS,
  "67P1",
  "67G1",
  "27P1",
  "59P1",
  "81D1T",
  "81D2T",
  "79RS",
  "79CY",
  "79LO",
  "50BF",
];

/**
 * Instantiates a cleanroom Relay Word bit dictionary initialized to `false` for a standard
 * SEL-421, SEL-487, or SEL-351 relay family, merged with optional initial bit overrides.
 */
export function createRelayWordBitPreset(
  family: SelRelayFamily,
  overrides?: Record<string, boolean>,
): Record<string, boolean> {
  const list =
    family === "SEL-421"
      ? SEL_421_WORD_BIT_PRESETS
      : family === "SEL-487"
        ? SEL_487_WORD_BIT_PRESETS
        : SEL_351_WORD_BIT_PRESETS;
  const bits: Record<string, boolean> = {};
  for (const name of list) {
    bits[name] = false;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      bits[k.toUpperCase()] = v;
    }
  }
  return bits;
}

function tokenizeSeLogic(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "*" || ch === "+" || ch === "!" || ch === "/" || ch === "\\") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[A-Za-z0-9_.]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(expr[j]!)) {
        j++;
      }
      tokens.push(expr.slice(i, j).toUpperCase());
      i = j;
      continue;
    }
    i++;
  }
  return tokens;
}

function lookupBit(bits: Record<string, boolean>, key: string): boolean {
  if (bits[key] !== undefined) return bits[key]!;
  const upper = key.toUpperCase();
  if (bits[upper] !== undefined) return bits[upper]!;
  const lower = key.toLowerCase();
  if (bits[lower] !== undefined) return bits[lower]!;
  return false;
}

interface DualEval {
  curr: boolean;
  prev: boolean;
}

/**
 * Evaluates a cleanroom SELogic boolean expression supporting:
 *   - `*` / `AND` (logical AND)
 *   - `+` / `OR` (logical OR)
 *   - `!` / `NOT` (logical NOT)
 *   - `(` `)` parentheses
 *   - `/` (rising edge: `curr && !prev`) and `\` (falling edge: `!curr && prev`)
 *
 * When `prevWordBits` is omitted, previous bit values default to `false` (so rising edge `/`
 * on an asserted bit evaluates to `true`, and falling edge `\` evaluates to `false`).
 */
export function evalSeLogicExpression(
  expr: string,
  wordBits: Record<string, boolean>,
  prevWordBits?: Record<string, boolean>,
): boolean {
  const tokens = tokenizeSeLogic(expr);
  if (tokens.length === 0) return false;
  const prev = prevWordBits ?? {};
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string {
    return tokens[pos++] ?? "";
  }

  function parseOr(): DualEval {
    let left = parseAnd();
    while (peek() === "+" || peek() === "OR") {
      consume();
      const right = parseAnd();
      left = { curr: left.curr || right.curr, prev: left.prev || right.prev };
    }
    return left;
  }

  function parseAnd(): DualEval {
    let left = parseUnary();
    while (peek() === "*" || peek() === "AND") {
      consume();
      const right = parseUnary();
      left = { curr: left.curr && right.curr, prev: left.prev && right.prev };
    }
    return left;
  }

  function parseUnary(): DualEval {
    const t = peek();
    if (t === "!" || t === "NOT") {
      consume();
      const v = parseUnary();
      return { curr: !v.curr, prev: !v.prev };
    }
    if (t === "/") {
      consume();
      const v = parseUnary();
      const rising = v.curr && !v.prev;
      return { curr: rising, prev: false };
    }
    if (t === "\\") {
      consume();
      const v = parseUnary();
      const falling = !v.curr && v.prev;
      return { curr: falling, prev: false };
    }
    return parsePrimary();
  }

  function parsePrimary(): DualEval {
    const t = peek();
    if (!t) return { curr: false, prev: false };
    if (t === "(") {
      consume();
      const inner = parseOr();
      if (peek() === ")") consume();
      return inner;
    }
    consume();
    if (t === "1" || t === "TRUE") return { curr: true, prev: true };
    if (t === "0" || t === "FALSE") return { curr: false, prev: false };
    return {
      curr: lookupBit(wordBits, t),
      prev: lookupBit(prev, t),
    };
  }

  return parseOr().curr;
}

/**
 * Stateful SELogic equation & `SV_TIMER` (pickup/dropout timer) evaluator supporting
 * rising/falling edge detection (`/`, `\`) across discrete simulation steps.
 */
export class SeLogicEngine {
  private readonly timers: SeLogicTimerSpec[];
  private readonly timerStates: Map<string, SeLogicTimerState> = new Map();
  private prevBits: Record<string, boolean> = {};

  constructor(timers: SeLogicTimerSpec[] = []) {
    this.timers = timers;
    for (const t of timers) {
      this.timerStates.set(t.name.toUpperCase(), { puTimer: 0, doTimer: 0, output: false });
    }
  }

  public reset(): void {
    this.prevBits = {};
    for (const st of this.timerStates.values()) {
      st.puTimer = 0;
      st.doTimer = 0;
      st.output = false;
    }
  }

  /**
   * Advances all configured `SV_TIMER` blocks and evaluates `equations` over timestep `dtSec`.
   */
  public step(
    dtSec: number,
    inputWordBits: Record<string, boolean>,
    equations: Record<string, string> = {},
  ): SeLogicStepResult {
    const dt = Math.max(0, dtSec);
    const bits: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(inputWordBits)) {
      bits[k.toUpperCase()] = v;
    }

    // Seed previous timer outputs so equations referencing SVnT see current state
    for (const [name, st] of this.timerStates.entries()) {
      bits[name] = st.output;
    }

    // Advance SV_TIMER pickup/dropout timers
    for (const spec of this.timers) {
      const key = spec.name.toUpperCase();
      const st = this.timerStates.get(key) ?? { puTimer: 0, doTimer: 0, output: false };
      const inp = evalSeLogicExpression(spec.inputExpr, bits, this.prevBits);

      if (inp) {
        st.doTimer = 0;
        if (!st.output) {
          st.puTimer += dt;
          if (st.puTimer >= spec.pickupDelaySec - 1e-9) {
            st.output = true;
          }
        }
      } else {
        st.puTimer = 0;
        if (st.output) {
          st.doTimer += dt;
          if (st.doTimer >= spec.dropoutDelaySec - 1e-9) {
            st.output = false;
          }
        }
      }
      this.timerStates.set(key, st);
      bits[key] = st.output;
    }

    // Evaluate SELogic boolean equations (up to 4 passes for chained intermediate variables)
    const eqEntries = Object.entries(equations);
    for (let pass = 0; pass < 4 && eqEntries.length > 0; pass++) {
      let changed = false;
      for (const [target, expr] of eqEntries) {
        const key = target.toUpperCase();
        const val = evalSeLogicExpression(expr, bits, this.prevBits);
        if (bits[key] !== val) {
          bits[key] = val;
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Snapshot current bits as previous bits for next step's rising/falling edge detection
    this.prevBits = { ...bits };

    const timerOut: Record<string, SeLogicTimerState> = {};
    for (const [k, st] of this.timerStates.entries()) {
      timerOut[k] = { ...st };
    }
    return { wordBits: bits, timerStates: timerOut };
  }
}
