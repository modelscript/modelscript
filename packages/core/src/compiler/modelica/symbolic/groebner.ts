// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Gröbner Basis algorithms for multivariate polynomial algebra.
 *
 * This module provides the mathematical foundation for identifying,
 * factoring, and triangularizing non-linear algebraic loops in ModelScript.
 */

export type TermDegrees = Map<string, number>;

/** A single polynomial term: c * x1^d1 * x2^d2 ... */
export class Term {
  constructor(
    public coefficient: number,
    public degrees: TermDegrees,
  ) {}

  /** Create a structural clone of this term */
  clone(): Term {
    return new Term(this.coefficient, new Map(this.degrees));
  }

  /** Compute the total degree of this term */
  totalDegree(): number {
    let sum = 0;
    for (const d of this.degrees.values()) sum += d;
    return sum;
  }

  /** Retrieve the degree of a specific variable */
  getDegree(v: string): number {
    return this.degrees.get(v) ?? 0;
  }

  /** Multiply this term by another term */
  multiply(other: Term): Term {
    const newDegrees = new Map(this.degrees);
    for (const [v, d] of other.degrees.entries()) {
      newDegrees.set(v, (newDegrees.get(v) ?? 0) + d);
    }
    return new Term(this.coefficient * other.coefficient, newDegrees);
  }

  /** Check if this term's monomial structurally matches another */
  matchesMonomial(other: Term): boolean {
    const keys = new Set([...this.degrees.keys(), ...other.degrees.keys()]);
    for (const k of keys) {
      if (this.getDegree(k) !== other.getDegree(k)) return false;
    }
    return true;
  }

  /** Check if this term divides another term (i.e. 'this' divides 'other') */
  divides(other: Term): boolean {
    for (const [v, d] of this.degrees.entries()) {
      if (other.getDegree(v) < d) return false;
    }
    return true;
  }

  /** Divide 'other' by 'this' */
  divideInto(other: Term): Term {
    const newDegrees = new Map(other.degrees);
    for (const [v, d] of this.degrees.entries()) {
      const currentVal = newDegrees.get(v);
      const newD = (currentVal ?? 0) - d;
      if (newD > 0) newDegrees.set(v, newD);
      else newDegrees.delete(v);
    }
    return new Term(other.coefficient / this.coefficient, newDegrees);
  }
}

/** Monomial Term Orderings */
export const TermOrder = {
  /** Lexicographic Order */
  LEX:
    (vars: string[]) =>
    (a: Term, b: Term): number => {
      for (const v of vars) {
        const da = a.getDegree(v);
        const db = b.getDegree(v);
        if (da !== db) return db - da; // Descending order
      }
      return 0;
    },

  /** Graded Lexicographic Order */
  GRLEX:
    (vars: string[]) =>
    (a: Term, b: Term): number => {
      const totalA = a.totalDegree();
      const totalB = b.totalDegree();
      if (totalA !== totalB) return totalB - totalA;
      return TermOrder.LEX(vars)(a, b);
    },

  /** Graded Reverse Lexicographic Order */
  GREVLEX:
    (vars: string[]) =>
    (a: Term, b: Term): number => {
      const totalA = a.totalDegree();
      const totalB = b.totalDegree();
      if (totalA !== totalB) return totalB - totalA;

      // Reverse lexical check from right to left
      for (let i = vars.length - 1; i >= 0; i--) {
        const v = vars[i];
        if (v === undefined) continue;
        const da = a.getDegree(v);
        const db = b.getDegree(v);
        if (da !== db) return da - db; // Note: smaller degree is "larger" term in GREVLEX tiebreaker
      }
      return 0;
    },
};

/** A multivariate polynomial */
export class Polynomial {
  /**
   * Variables in consideration for ordering (ordered array)
   * The order in this array defines the term ranking priorities.
   */
  public vars: string[];

  constructor(
    public terms: Term[],
    vars: string[],
  ) {
    this.vars = vars;
    this.simplify();
  }

  /** Returns true if polynomial is zero (empty terms array) */
  isZero(): boolean {
    return this.terms.length === 0;
  }

  /** Group identical monomials and drop zero terms */
  simplify(orderFn = TermOrder.LEX(this.vars)): this {
    const grouped = new Map<string, Term>();
    for (const t of this.terms) {
      // Build monomial signature
      const sigKeys = Array.from(t.degrees.keys()).sort();
      const sig = sigKeys.map((k) => `${k}^${t.degrees.get(k)}`).join("*");

      const existing = grouped.get(sig);
      if (existing) {
        existing.coefficient += t.coefficient;
      } else {
        grouped.set(sig, t.clone());
      }
    }

    this.terms = [];
    for (const t of grouped.values()) {
      if (Math.abs(t.coefficient) > 1e-12) {
        this.terms.push(t);
      }
    }

    this.terms.sort(orderFn);
    return this;
  }

  /** Leading Term */
  LT(): Term | null {
    const first = this.terms[0];
    return first ? first : null;
  }

  /** Add another polynomial to this one */
  add(other: Polynomial): Polynomial {
    return new Polynomial([...this.terms, ...other.terms], this.vars);
  }

  /** Subtract another polynomial */
  sub(other: Polynomial): Polynomial {
    const neg = other.terms.map((t) => new Term(-t.coefficient, new Map(t.degrees)));
    return new Polynomial([...this.terms, ...neg], this.vars);
  }

  /** Multiply by a term */
  multiplyTerm(t: Term): Polynomial {
    return new Polynomial(
      this.terms.map((term) => term.multiply(t)),
      this.vars,
    );
  }

  /** Multivariate Polynomial Division (reduces this polynomial by F) */
  divide(F: Polynomial[], orderFn = TermOrder.LEX(this.vars)): { quotients: Polynomial[]; remainder: Polynomial } {
    const quotients = F.map(() => new Polynomial([], this.vars));
    let p = new Polynomial(this.terms, this.vars);
    const r = new Polynomial([], this.vars);

    while (!p.isZero()) {
      const LT_p = p.LT();
      if (!LT_p) break;
      let divisionOccurred = false;

      for (let i = 0; i < F.length; i++) {
        const fi = F[i];
        if (!fi) continue;
        const LT_fi = fi.LT();
        if (LT_fi && LT_fi.divides(LT_p)) {
          const quotientTerm = LT_fi.divideInto(LT_p);
          const q = quotients[i];
          if (q) {
            quotients[i] = q.add(new Polynomial([quotientTerm], this.vars));
          }
          const fi_qt = fi.multiplyTerm(quotientTerm);
          p = p.sub(fi_qt).simplify(orderFn);
          divisionOccurred = true;
          break;
        }
      }

      if (!divisionOccurred) {
        r.terms.push(LT_p);
        p.terms.shift(); // Remove LT_p
        p.simplify(orderFn);
      }
    }

    // Attempt final simplify
    r.simplify(orderFn);
    for (const q of quotients) q.simplify(orderFn);

    return { quotients, remainder: r };
  }
}

/** Compute the Least Common Multiple of two terms' monomials */
export function termLCM(a: Term, b: Term): Term {
  const lcmDegrees = new Map(a.degrees);
  for (const [v, d] of b.degrees.entries()) {
    const current = lcmDegrees.get(v) ?? 0;
    if (d > current) lcmDegrees.set(v, d);
  }
  return new Term(1, lcmDegrees);
}

/** Compute the S-polynomial of f and g */
export function sPolynomial(f: Polynomial, g: Polynomial, vars: string[], orderFn = TermOrder.LEX(vars)): Polynomial {
  const lt_f = f.LT();
  const lt_g = g.LT();
  if (!lt_f || !lt_g) return new Polynomial([], vars); // zero

  const lcm = termLCM(lt_f, lt_g);

  const m1 = lt_f.divideInto(lcm);
  const m2 = lt_g.divideInto(lcm);

  const sf = f.multiplyTerm(m1);
  const sg = g.multiplyTerm(m2);

  return sf.sub(sg).simplify(orderFn);
}

/**
 * Buchberger's Algorithm to compute a Gröbner Basis for a set of polynomials.
 */
export function computeGroebnerBasis(F: Polynomial[], vars: string[], orderFn = TermOrder.LEX(vars)): Polynomial[] {
  const G = [...F];
  // Simple Buchberger loop
  let changed = true;
  while (changed) {
    changed = false;
    const pairs: [Polynomial, Polynomial][] = [];

    // Collect all pairs
    for (let i = 0; i < G.length; i++) {
      for (let j = i + 1; j < G.length; j++) {
        const pi = G[i];
        const pj = G[j];
        if (pi && pj) {
          pairs.push([pi, pj]);
        }
      }
    }

    for (const [p1, p2] of pairs) {
      const Spol = sPolynomial(p1, p2, vars, orderFn);
      if (!Spol.isZero()) {
        const { remainder } = Spol.divide(G, orderFn);
        if (!remainder.isZero()) {
          G.push(remainder);
          changed = true;
        }
      }
    }
  }

  // To do: Reduced Gröbner Basis computation (autoreduce and make monic)
  return G;
}
