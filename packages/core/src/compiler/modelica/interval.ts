// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Interval Arithmetic Engine for the StaticTapeBuilder tape.
 *
 * Propagates closed intervals [lo, hi] through the tape operations to compute
 * guaranteed bounds on function values over a domain. This is the foundation
 * for McCormick relaxations and spatial branch-and-bound.
 *
 * Reference: Moore, R.E., Kearfott, R.B., Cloud, M.J. (2009),
 *   "Introduction to Interval Analysis", SIAM.
 */

import type { TapeOp } from "./ad-codegen.js";

/** A closed interval [lo, hi]. */
export class Interval {
  constructor(
    public lo: number,
    public hi: number,
  ) {
    if (lo > hi) {
      this.lo = hi;
      this.hi = lo;
    }
  }

  static point(v: number): Interval {
    return new Interval(v, v);
  }

  static entire(): Interval {
    return new Interval(-Infinity, Infinity);
  }

  static empty(): Interval {
    return new Interval(Infinity, -Infinity);
  }

  get width(): number {
    return this.hi - this.lo;
  }

  get mid(): number {
    if (!isFinite(this.lo) || !isFinite(this.hi)) return 0;
    return (this.lo + this.hi) / 2;
  }

  contains(x: number): boolean {
    return x >= this.lo && x <= this.hi;
  }

  containsZero(): boolean {
    return this.lo <= 0 && this.hi >= 0;
  }

  intersect(other: Interval): Interval {
    return new Interval(Math.max(this.lo, other.lo), Math.min(this.hi, other.hi));
  }

  hull(other: Interval): Interval {
    return new Interval(Math.min(this.lo, other.lo), Math.max(this.hi, other.hi));
  }

  toString(): string {
    return `[${this.lo}, ${this.hi}]`;
  }
}

// ── Interval arithmetic operations ──

export function iaAdd(a: Interval, b: Interval): Interval {
  return new Interval(a.lo + b.lo, a.hi + b.hi);
}

export function iaSub(a: Interval, b: Interval): Interval {
  return new Interval(a.lo - b.hi, a.hi - b.lo);
}

export function iaMul(a: Interval, b: Interval): Interval {
  const p1 = a.lo * b.lo;
  const p2 = a.lo * b.hi;
  const p3 = a.hi * b.lo;
  const p4 = a.hi * b.hi;
  return new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
}

export function iaDiv(a: Interval, b: Interval): Interval {
  if (b.containsZero()) {
    // Division by interval containing zero → extended interval
    if (b.lo === 0 && b.hi === 0) return Interval.entire();
    if (b.lo === 0) return iaMul(a, new Interval(1 / b.hi, Infinity));
    if (b.hi === 0) return iaMul(a, new Interval(-Infinity, 1 / b.lo));
    return Interval.entire();
  }
  return iaMul(a, new Interval(1 / b.hi, 1 / b.lo));
}

export function iaPow(base: Interval, exp: Interval): Interval {
  // Handle integer exponents specially
  if (exp.lo === exp.hi) {
    const n = exp.lo;
    if (Number.isInteger(n)) {
      return iaPowInt(base, n);
    }
  }
  // General case: a^b = exp(b * log(a))  (assumes a > 0)
  const safeBase = new Interval(Math.max(1e-300, base.lo), Math.max(1e-300, base.hi));
  const logBase = iaLog(safeBase);
  return iaExp(iaMul(exp, logBase));
}

function iaPowInt(a: Interval, n: number): Interval {
  if (n === 0) return Interval.point(1);
  if (n === 1) return a;
  if (n === -1) return iaDiv(Interval.point(1), a);

  if (n > 0 && n % 2 === 0) {
    // Even power: x^n is U-shaped, minimum at 0
    if (a.lo >= 0) {
      return new Interval(Math.pow(a.lo, n), Math.pow(a.hi, n));
    } else if (a.hi <= 0) {
      return new Interval(Math.pow(a.hi, n), Math.pow(a.lo, n));
    } else {
      // Interval spans zero: minimum is 0
      return new Interval(0, Math.max(Math.pow(a.lo, n), Math.pow(a.hi, n)));
    }
  }

  if (n > 0) {
    // Odd power: monotone increasing
    return new Interval(Math.pow(a.lo, n), Math.pow(a.hi, n));
  }

  // Negative exponent: 1/x^|n|
  const posResult = iaPowInt(a, -n);
  return iaDiv(Interval.point(1), posResult);
}

export function iaNeg(a: Interval): Interval {
  return new Interval(-a.hi, -a.lo);
}

export function iaSin(a: Interval): Interval {
  const width = a.hi - a.lo;
  if (width >= 2 * Math.PI) return new Interval(-1, 1);

  // Normalize to [0, 2π) relative range
  const lo = ((a.lo % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const hi = lo + width;

  let minVal = Math.sin(a.lo);
  let maxVal = Math.sin(a.lo);

  const sinHi = Math.sin(a.hi);
  minVal = Math.min(minVal, sinHi);
  maxVal = Math.max(maxVal, sinHi);

  // Check critical points: sin has max at π/2 + 2kπ, min at 3π/2 + 2kπ
  const TWO_PI = 2 * Math.PI;
  // Check if any maximum (π/2 + 2kπ) is in range
  for (let k = Math.floor((lo - Math.PI / 2) / TWO_PI); k <= Math.ceil((hi - Math.PI / 2) / TWO_PI); k++) {
    const cp = Math.PI / 2 + k * TWO_PI;
    if (cp >= lo && cp <= hi) maxVal = 1;
  }
  // Check if any minimum (3π/2 + 2kπ) is in range
  for (let k = Math.floor((lo - (3 * Math.PI) / 2) / TWO_PI); k <= Math.ceil((hi - (3 * Math.PI) / 2) / TWO_PI); k++) {
    const cp = (3 * Math.PI) / 2 + k * TWO_PI;
    if (cp >= lo && cp <= hi) minVal = -1;
  }

  return new Interval(minVal, maxVal);
}

export function iaCos(a: Interval): Interval {
  // cos(x) = sin(x + π/2)
  return iaSin(new Interval(a.lo + Math.PI / 2, a.hi + Math.PI / 2));
}

export function iaTan(a: Interval): Interval {
  const width = a.hi - a.lo;
  if (width >= Math.PI) return Interval.entire();

  // Check if asymptote (π/2 + kπ) is within the interval
  for (let k = Math.floor((a.lo - Math.PI / 2) / Math.PI); k <= Math.ceil((a.hi - Math.PI / 2) / Math.PI); k++) {
    const asymptote = Math.PI / 2 + k * Math.PI;
    if (asymptote > a.lo && asymptote < a.hi) return Interval.entire();
  }

  // tan is monotone between asymptotes
  return new Interval(Math.tan(a.lo), Math.tan(a.hi));
}

export function iaExp(a: Interval): Interval {
  // exp is monotone increasing
  return new Interval(Math.exp(a.lo), Math.exp(a.hi));
}

export function iaLog(a: Interval): Interval {
  // log is monotone increasing, domain: (0, ∞)
  const safeLo = Math.max(1e-300, a.lo);
  const safeHi = Math.max(1e-300, a.hi);
  return new Interval(Math.log(safeLo), Math.log(safeHi));
}

export function iaSqrt(a: Interval): Interval {
  // sqrt is monotone increasing, domain: [0, ∞)
  const safeLo = Math.max(0, a.lo);
  const safeHi = Math.max(0, a.hi);
  return new Interval(Math.sqrt(safeLo), Math.sqrt(safeHi));
}

// ── Tape evaluator ──

/**
 * Evaluate a tape forward pass with interval arithmetic.
 * Returns interval bounds at each tape slot.
 */
export function evaluateTapeInterval(ops: TapeOp[], bounds: Map<string, Interval>): Interval[] {
  const t = new Array<Interval>(ops.length);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    switch (op.type) {
      case "const":
        t[i] = Interval.point(op.val);
        break;
      case "var":
        t[i] = bounds.get(op.name) ?? Interval.point(0);
        break;
      case "add":
        t[i] = iaAdd(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "sub":
        t[i] = iaSub(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "mul":
        t[i] = iaMul(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "div":
        t[i] = iaDiv(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "pow":
        t[i] = iaPow(t[op.a]!, t[op.b]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "neg":
        t[i] = iaNeg(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "sin":
        t[i] = iaSin(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "cos":
        t[i] = iaCos(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "tan":
        t[i] = iaTan(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "exp":
        t[i] = iaExp(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "log":
        t[i] = iaLog(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      case "sqrt":
        t[i] = iaSqrt(t[op.a]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        break;
      // ── Vector ops ──
      case "vec_var":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = bounds.get(`${op.baseName}[${k + 1}]`) ?? Interval.point(0);
        }
        break;
      case "vec_const":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = Interval.point(op.vals[k] ?? 0);
        }
        break;
      case "vec_add":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = iaAdd(t[op.a + k]!, t[op.b + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_sub":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = iaSub(t[op.a + k]!, t[op.b + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_mul":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = iaMul(t[op.a + k]!, t[op.b + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_neg":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = iaNeg(t[op.a + k]!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
        }
        break;
      case "vec_subscript":
        t[i] = t[op.a + op.offset] ?? Interval.point(0);
        break;
      case "nop":
        break;
    }
  }
  return t;
}

// ── C-code generation for interval forward pass ──

/**
 * Emit C-code for interval forward pass evaluation.
 * Each tape slot produces two values: t_lo[i] and t_hi[i].
 *
 * @param ops         The tape operations
 * @param varResolver Maps variable name → { lo: C-expr, hi: C-expr }
 * @returns Array of C-code lines
 */
export function emitIntervalForwardC(
  ops: TapeOp[],
  varResolver: (name: string) => { lo: string; hi: string },
): string[] {
  const lines: string[] = [];
  const n = ops.length;
  lines.push(`double t_lo[${n}], t_hi[${n}];`);

  for (let i = 0; i < n; i++) {
    const op = ops[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    switch (op.type) {
      case "const":
        lines.push(`t_lo[${i}] = ${formatNum(op.val)}; t_hi[${i}] = ${formatNum(op.val)};`);
        break;
      case "var": {
        const vr = varResolver(op.name);
        lines.push(`t_lo[${i}] = ${vr.lo}; t_hi[${i}] = ${vr.hi};`);
        break;
      }
      case "add":
        lines.push(`t_lo[${i}] = t_lo[${op.a}] + t_lo[${op.b}]; t_hi[${i}] = t_hi[${op.a}] + t_hi[${op.b}];`);
        break;
      case "sub":
        lines.push(`t_lo[${i}] = t_lo[${op.a}] - t_hi[${op.b}]; t_hi[${i}] = t_hi[${op.a}] - t_lo[${op.b}];`);
        break;
      case "mul":
        lines.push(`{ double p1 = t_lo[${op.a}]*t_lo[${op.b}], p2 = t_lo[${op.a}]*t_hi[${op.b}],`);
        lines.push(`         p3 = t_hi[${op.a}]*t_lo[${op.b}], p4 = t_hi[${op.a}]*t_hi[${op.b}];`);
        lines.push(`  t_lo[${i}] = fmin(fmin(p1,p2),fmin(p3,p4)); t_hi[${i}] = fmax(fmax(p1,p2),fmax(p3,p4)); }`);
        break;
      case "div":
        lines.push(`if (t_lo[${op.b}] > 0 || t_hi[${op.b}] < 0) {`);
        lines.push(`  double rl = 1.0/t_hi[${op.b}], rh = 1.0/t_lo[${op.b}];`);
        lines.push(`  double p1 = t_lo[${op.a}]*rl, p2 = t_lo[${op.a}]*rh,`);
        lines.push(`         p3 = t_hi[${op.a}]*rl, p4 = t_hi[${op.a}]*rh;`);
        lines.push(`  t_lo[${i}] = fmin(fmin(p1,p2),fmin(p3,p4)); t_hi[${i}] = fmax(fmax(p1,p2),fmax(p3,p4));`);
        lines.push(`} else { t_lo[${i}] = -INFINITY; t_hi[${i}] = INFINITY; }`);
        break;
      case "pow":
        lines.push(`t_lo[${i}] = pow(fmax(1e-300,t_lo[${op.a}]), t_lo[${op.b}]);`);
        lines.push(`t_hi[${i}] = pow(fmax(1e-300,t_hi[${op.a}]), t_hi[${op.b}]);`);
        lines.push(
          `if (t_lo[${i}] > t_hi[${i}]) { double tmp = t_lo[${i}]; t_lo[${i}] = t_hi[${i}]; t_hi[${i}] = tmp; }`,
        );
        break;
      case "neg":
        lines.push(`t_lo[${i}] = -t_hi[${op.a}]; t_hi[${i}] = -t_lo[${op.a}];`);
        break;
      case "sin":
        // Conservative: use [-1, 1] for wide intervals
        lines.push(`{ double sw = t_hi[${op.a}] - t_lo[${op.a}];`);
        lines.push(`  if (sw >= 6.2831853) { t_lo[${i}] = -1.0; t_hi[${i}] = 1.0; }`);
        lines.push(`  else { double s1 = sin(t_lo[${op.a}]), s2 = sin(t_hi[${op.a}]);`);
        lines.push(`    t_lo[${i}] = fmin(s1,s2); t_hi[${i}] = fmax(s1,s2);`);
        lines.push(`    /* Check critical points */ `);
        lines.push(`    double TWO_PI = 6.2831853;`);
        lines.push(
          `    for (int k = (int)floor((t_lo[${op.a}]-1.5707963)/TWO_PI); k <= (int)ceil((t_hi[${op.a}]-1.5707963)/TWO_PI); k++)`,
        );
        lines.push(
          `      { double cp = 1.5707963 + k*TWO_PI; if (cp >= t_lo[${op.a}] && cp <= t_hi[${op.a}]) t_hi[${i}] = 1.0; }`,
        );
        lines.push(
          `    for (int k = (int)floor((t_lo[${op.a}]-4.7123890)/TWO_PI); k <= (int)ceil((t_hi[${op.a}]-4.7123890)/TWO_PI); k++)`,
        );
        lines.push(
          `      { double cp = 4.7123890 + k*TWO_PI; if (cp >= t_lo[${op.a}] && cp <= t_hi[${op.a}]) t_lo[${i}] = -1.0; }`,
        );
        lines.push(`} }`);
        break;
      case "cos":
        lines.push(`{ double cw = t_hi[${op.a}] - t_lo[${op.a}];`);
        lines.push(`  if (cw >= 6.2831853) { t_lo[${i}] = -1.0; t_hi[${i}] = 1.0; }`);
        lines.push(`  else { double c1 = cos(t_lo[${op.a}]), c2 = cos(t_hi[${op.a}]);`);
        lines.push(`    t_lo[${i}] = fmin(c1,c2); t_hi[${i}] = fmax(c1,c2);`);
        lines.push(`    double TWO_PI = 6.2831853;`);
        lines.push(`    for (int k = (int)floor(t_lo[${op.a}]/TWO_PI); k <= (int)ceil(t_hi[${op.a}]/TWO_PI); k++)`);
        lines.push(`      { double cp = k*TWO_PI; if (cp >= t_lo[${op.a}] && cp <= t_hi[${op.a}]) t_hi[${i}] = 1.0; }`);
        lines.push(
          `    for (int k = (int)floor((t_lo[${op.a}]-3.1415927)/TWO_PI); k <= (int)ceil((t_hi[${op.a}]-3.1415927)/TWO_PI); k++)`,
        );
        lines.push(
          `      { double cp = 3.1415927 + k*TWO_PI; if (cp >= t_lo[${op.a}] && cp <= t_hi[${op.a}]) t_lo[${i}] = -1.0; }`,
        );
        lines.push(`} }`);
        break;
      case "tan":
        lines.push(`t_lo[${i}] = tan(t_lo[${op.a}]); t_hi[${i}] = tan(t_hi[${op.a}]);`);
        lines.push(
          `if (t_hi[${op.a}] - t_lo[${op.a}] >= 3.1415927) { t_lo[${i}] = -INFINITY; t_hi[${i}] = INFINITY; }`,
        );
        break;
      case "exp":
        lines.push(`t_lo[${i}] = exp(t_lo[${op.a}]); t_hi[${i}] = exp(t_hi[${op.a}]);`);
        break;
      case "log":
        lines.push(`t_lo[${i}] = log(fmax(1e-300,t_lo[${op.a}])); t_hi[${i}] = log(fmax(1e-300,t_hi[${op.a}]));`);
        break;
      case "sqrt":
        lines.push(`t_lo[${i}] = sqrt(fmax(0.0,t_lo[${op.a}])); t_hi[${i}] = sqrt(fmax(0.0,t_hi[${op.a}]));`);
        break;
    }
  }
  return lines;
}

function formatNum(v: number): string {
  if (!isFinite(v)) return v === Infinity ? "INFINITY" : v === -Infinity ? "(-INFINITY)" : "NAN";
  const s = v.toString();
  return !s.includes(".") && !s.includes("e") && !s.includes("E") ? s + ".0" : s;
}
