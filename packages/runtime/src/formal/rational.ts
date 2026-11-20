// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Exact Arbitrary-Precision Rational Arithmetic (`BigInt`).
 *
 * Used by `ExactLraSimplexSolver` for zero-drift Dutertre–de Moura Simplex solving
 * on ill-conditioned linear systems and exact Gomory Mixed-Integer (GMI) cut generation.
 */

function gcdBigInt(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

export class Rational {
  public readonly num: bigint;
  public readonly den: bigint;

  public static readonly ZERO = new Rational(0n, 1n, true);
  public static readonly ONE = new Rational(1n, 1n, true);
  public static readonly NEG_ONE = new Rational(-1n, 1n, true);

  constructor(num: bigint, den: bigint = 1n, alreadyReduced = false) {
    if (den === 0n) {
      throw new RangeError("Rational denominator cannot be zero");
    }
    if (alreadyReduced) {
      this.num = num;
      this.den = den;
      return;
    }
    if (num === 0n) {
      this.num = 0n;
      this.den = 1n;
      return;
    }
    let n = num;
    let d = den;
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBigInt(n, d);
    this.num = n / g;
    this.den = d / g;
  }

  /**
   * Converts a finite JS number to an exact Rational using its shortest decimal representation
   * (so `0.1` -> `1/10`, `1.5` -> `3/2`, integers -> `BigInt(n)/1n`).
   */
  public static fromNumber(val: number): Rational {
    if (!Number.isFinite(val)) {
      throw new RangeError(`Cannot convert non-finite number ${val} to Rational`);
    }
    if (val === 0) return Rational.ZERO;
    if (Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return new Rational(BigInt(val), 1n, true);
    }
    const s = val.toString();
    const expIdx = s.indexOf("e") !== -1 ? s.indexOf("e") : s.indexOf("E");
    let mantissa = expIdx !== -1 ? s.slice(0, expIdx) : s;
    const exp = expIdx !== -1 ? parseInt(s.slice(expIdx + 1), 10) : 0;

    let neg = false;
    if (mantissa.startsWith("-")) {
      neg = true;
      mantissa = mantissa.slice(1);
    } else if (mantissa.startsWith("+")) {
      mantissa = mantissa.slice(1);
    }

    const dotIdx = mantissa.indexOf(".");
    let digits: string;
    let fracDigits = 0;
    if (dotIdx !== -1) {
      digits = mantissa.slice(0, dotIdx) + mantissa.slice(dotIdx + 1);
      fracDigits = mantissa.length - dotIdx - 1;
    } else {
      digits = mantissa;
    }

    const totalExp = exp - fracDigits;
    let num = BigInt(digits);
    if (neg) num = -num;

    if (totalExp >= 0) {
      return new Rational(num * 10n ** BigInt(totalExp), 1n, true);
    }
    return new Rational(num, 10n ** BigInt(-totalExp));
  }

  public isZero(): boolean {
    return this.num === 0n;
  }

  public isPositive(): boolean {
    return this.num > 0n;
  }

  public isNegative(): boolean {
    return this.num < 0n;
  }

  public isInteger(): boolean {
    return this.den === 1n;
  }

  public neg(): Rational {
    if (this.num === 0n) return Rational.ZERO;
    return new Rational(-this.num, this.den, true);
  }

  public abs(): Rational {
    if (this.num >= 0n) return this;
    return new Rational(-this.num, this.den, true);
  }

  public add(other: Rational): Rational {
    if (this.num === 0n) return other;
    if (other.num === 0n) return this;
    if (this.den === other.den) {
      return new Rational(this.num + other.num, this.den);
    }
    return new Rational(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  public sub(other: Rational): Rational {
    if (other.num === 0n) return this;
    if (this.num === 0n) return other.neg();
    if (this.den === other.den) {
      return new Rational(this.num - other.num, this.den);
    }
    return new Rational(this.num * other.den - other.num * this.den, this.den * other.den);
  }

  public mul(other: Rational): Rational {
    if (this.num === 0n || other.num === 0n) return Rational.ZERO;
    if (this.den === 1n && other.den === 1n) {
      return new Rational(this.num * other.num, 1n, true);
    }
    return new Rational(this.num * other.num, this.den * other.den);
  }

  public div(other: Rational): Rational {
    if (other.num === 0n) {
      throw new RangeError("Division by zero Rational");
    }
    if (this.num === 0n) return Rational.ZERO;
    return new Rational(this.num * other.den, this.den * other.num);
  }

  public cmp(other: Rational): number {
    if (this.num === other.num && this.den === other.den) return 0;
    const lhs = this.num * other.den;
    const rhs = other.num * this.den;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  public equals(other: Rational): boolean {
    return this.num === other.num && this.den === other.den;
  }

  /** Largest integer <= this rational. */
  public floor(): bigint {
    if (this.den === 1n) return this.num;
    const q = this.num / this.den;
    const r = this.num % this.den;
    if (r < 0n) return q - 1n;
    return q;
  }

  /** Smallest integer >= this rational. */
  public ceil(): bigint {
    if (this.den === 1n) return this.num;
    const q = this.num / this.den;
    const r = this.num % this.den;
    if (r > 0n) return q + 1n;
    return q;
  }

  /** Fractional part `this - floor(this)` in `[0, 1)`. */
  public frac(): Rational {
    if (this.den === 1n) return Rational.ZERO;
    const fl = this.floor();
    return new Rational(this.num - fl * this.den, this.den, true);
  }

  public toNumber(): number {
    if (this.num === 0n) return 0;
    if (this.den === 1n) return Number(this.num);
    // Avoid BigInt -> Number overflow when numerator and denominator are both huge
    const nStr = (this.num < 0n ? -this.num : this.num).toString();
    const dStr = this.den.toString();
    if (nStr.length > 300 || dStr.length > 300) {
      const scale = Math.min(nStr.length, dStr.length) - 18;
      if (scale > 0) {
        const divPow = 10n ** BigInt(scale);
        return Number(this.num / divPow) / Number(this.den / divPow);
      }
    }
    return Number(this.num) / Number(this.den);
  }

  public toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }
}
