// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dual numbers for forward-mode automatic differentiation.
 *
 * A dual number `(val, dot)` represents a value `val` along with its
 * derivative `dot` with respect to some seed variable. Arithmetic and
 * math functions propagate derivatives via the chain rule automatically.
 *
 * Usage:
 *   const x = Dual.variable(3.0);  // dx/dx = 1
 *   const y = Dual.constant(2.0);  // dy/dx = 0
 *   const z = x.mul(x).add(y);     // z = x² + 2, dz/dx = 2x = 6
 *   // z.val === 11, z.dot === 6
 */

export class Dual {
  constructor(
    public readonly val: number,
    public readonly dot: number,
  ) {}

  /** Create a constant (derivative = 0). */
  static constant(v: number): Dual {
    return new Dual(v, 0);
  }

  /** Create a seed variable (derivative = 1). */
  static variable(v: number): Dual {
    return new Dual(v, 1);
  }

  // ── Arithmetic ──

  add(b: Dual): Dual {
    return new Dual(this.val + b.val, this.dot + b.dot);
  }

  sub(b: Dual): Dual {
    return new Dual(this.val - b.val, this.dot - b.dot);
  }

  mul(b: Dual): Dual {
    // Product rule: d(a·b) = a·ḃ + ȧ·b
    return new Dual(this.val * b.val, this.val * b.dot + this.dot * b.val);
  }

  div(b: Dual): Dual {
    // Quotient rule: d(a/b) = (ȧ·b - a·ḃ) / b²
    const b2 = b.val * b.val;
    return new Dual(this.val / b.val, (this.dot * b.val - this.val * b.dot) / b2);
  }

  pow(b: Dual): Dual {
    // General power rule: d(a^b) = a^b · (b·ȧ/a + ḃ·ln(a))
    // Special cases for efficiency:
    if (b.dot === 0) {
      // Constant exponent: d(a^n) = n·a^(n-1)·ȧ
      const v = this.val ** b.val;
      return new Dual(v, b.val * this.val ** (b.val - 1) * this.dot);
    }
    if (this.dot === 0) {
      // Constant base: d(c^b) = c^b·ln(c)·ḃ
      const v = this.val ** b.val;
      return new Dual(v, v * Math.log(this.val) * b.dot);
    }
    // General case
    const v = this.val ** b.val;
    const d = v * ((b.val * this.dot) / this.val + b.dot * Math.log(this.val));
    return new Dual(v, d);
  }

  neg(): Dual {
    return new Dual(-this.val, -this.dot);
  }

  // ── Trigonometric functions ──

  static sin(d: Dual): Dual {
    return new Dual(Math.sin(d.val), d.dot * Math.cos(d.val));
  }

  static cos(d: Dual): Dual {
    return new Dual(Math.cos(d.val), -d.dot * Math.sin(d.val));
  }

  static tan(d: Dual): Dual {
    const t = Math.tan(d.val);
    return new Dual(t, d.dot * (1 + t * t));
  }

  static asin(d: Dual): Dual {
    return new Dual(Math.asin(d.val), d.dot / Math.sqrt(1 - d.val * d.val));
  }

  static acos(d: Dual): Dual {
    return new Dual(Math.acos(d.val), -d.dot / Math.sqrt(1 - d.val * d.val));
  }

  static atan(d: Dual): Dual {
    return new Dual(Math.atan(d.val), d.dot / (1 + d.val * d.val));
  }

  static atan2(a: Dual, b: Dual): Dual {
    // d(atan2(a,b)) = (b·ȧ - a·ḃ) / (a² + b²)
    const denom = a.val * a.val + b.val * b.val;
    return new Dual(Math.atan2(a.val, b.val), (b.val * a.dot - a.val * b.dot) / denom);
  }

  // ── Hyperbolic functions ──

  static sinh(d: Dual): Dual {
    return new Dual(Math.sinh(d.val), d.dot * Math.cosh(d.val));
  }

  static cosh(d: Dual): Dual {
    return new Dual(Math.cosh(d.val), d.dot * Math.sinh(d.val));
  }

  static tanh(d: Dual): Dual {
    const t = Math.tanh(d.val);
    return new Dual(t, d.dot * (1 - t * t));
  }

  // ── Exponential / logarithmic ──

  static exp(d: Dual): Dual {
    const e = Math.exp(d.val);
    return new Dual(e, d.dot * e);
  }

  static log(d: Dual): Dual {
    return new Dual(Math.log(d.val), d.dot / d.val);
  }

  static log10(d: Dual): Dual {
    const ln10 = Math.LN10;
    return new Dual(Math.log10(d.val), d.dot / (d.val * ln10));
  }

  // ── Power / root ──

  static sqrt(d: Dual): Dual {
    const s = Math.sqrt(d.val);
    return new Dual(s, d.dot / (2 * s));
  }

  // ── Piecewise / non-smooth ──

  static abs(d: Dual): Dual {
    // Subgradient at 0: use 0
    const s = d.val > 0 ? 1 : d.val < 0 ? -1 : 0;
    return new Dual(Math.abs(d.val), d.dot * s);
  }

  static sign(d: Dual): Dual {
    // Piecewise constant → derivative 0
    return new Dual(Math.sign(d.val), 0);
  }

  static ceil(d: Dual): Dual {
    return new Dual(Math.ceil(d.val), 0);
  }

  static floor(d: Dual): Dual {
    return new Dual(Math.floor(d.val), 0);
  }

  // ── Two-argument min/max ──

  static max(a: Dual, b: Dual): Dual {
    return a.val >= b.val ? a : b;
  }

  static min(a: Dual, b: Dual): Dual {
    return a.val <= b.val ? a : b;
  }

  // ── Mod / rem / div (piecewise → derivative follows dominant term) ──

  static mod(a: Dual, b: Dual): Dual {
    // mod(a,b) = a - floor(a/b)*b
    const v = a.val - Math.floor(a.val / b.val) * b.val;
    // Derivative: d(a - floor(a/b)*b) ≈ ȧ (ignoring floor discontinuity)
    return new Dual(v, a.dot);
  }

  static rem(a: Dual, b: Dual): Dual {
    const v = a.val - Math.trunc(a.val / b.val) * b.val;
    return new Dual(v, a.dot);
  }

  static trunc(a: Dual, b: Dual): Dual {
    return new Dual(Math.trunc(a.val / b.val), 0);
  }
}
