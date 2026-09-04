// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Gröbner Basis & Multivariate Polynomial Algebra Engine.
 *
 * Provides:
 *  - Monomial terms, orderings (LEX, GRLEX, GREVLEX), polynomial arithmetic
 *  - Multivariate polynomial division and S-polynomial computation
 *  - Buchberger's algorithm with autoreduction and monic normalization
 *  - WasmGroebner bridge for zero-GC algebraic loop triangularization
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
        if (da !== db) return da - db;
      }
      return 0;
    },
};

/** A multivariate polynomial */
export class Polynomial {
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
        p.terms.shift();
        p.simplify(orderFn);
      }
    }

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
  if (!lt_f || !lt_g) return new Polynomial([], vars);

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
  let changed = true;
  while (changed) {
    changed = false;
    const pairs: [Polynomial, Polynomial][] = [];

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

  return G;
}

/**
 * Reduce a Gröbner basis to a minimal, monic reduced Gröbner basis.
 */
export function reduceGroebnerBasis(G: Polynomial[], vars: string[], orderFn = TermOrder.LEX(vars)): Polynomial[] {
  // Step 1: Remove polynomials whose leading term is divisible by another LT
  let minimal: Polynomial[] = [];
  for (let i = 0; i < G.length; i++) {
    const p = G[i]!;
    const lt = p.LT();
    if (!lt) continue;
    let redundant = false;
    for (let j = 0; j < G.length; j++) {
      if (i === j) continue;
      const otherLt = G[j]?.LT();
      if (otherLt && otherLt.divides(lt)) {
        redundant = true;
        break;
      }
    }
    if (!redundant) minimal.push(p);
  }

  // Step 2: Make monic and tail-reduce
  const reduced: Polynomial[] = [];
  for (let i = 0; i < minimal.length; i++) {
    const p = minimal[i]!;
    const lt = p.LT();
    if (!lt) continue;
    const monicTerms = p.terms.map((t) => new Term(t.coefficient / lt.coefficient, new Map(t.degrees)));
    const monicP = new Polynomial(monicTerms, vars);

    // Reduce against other polynomials in basis
    const others = minimal.filter((_, idx) => idx !== i);
    const { remainder } = monicP.divide(others, orderFn);
    if (!remainder.isZero()) {
      reduced.push(remainder);
    }
  }

  return reduced;
}

/**
 * WASM Gröbner basis bridge wrapper.
 */
export class WasmGroebner {
  private readonly exports: any;

  constructor(wasmExports: any) {
    this.exports = wasmExports;
  }

  triangularize(daePtr: number, eqIdxsPtr: number, nEqs: number, varIdxsPtr: number, nVars: number): boolean {
    if (!this.exports.groebner_triangularize) return false;
    return this.exports.groebner_triangularize(daePtr, eqIdxsPtr, nEqs, varIdxsPtr, nVars) === 1;
  }
}
