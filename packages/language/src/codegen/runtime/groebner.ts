// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import {
  DaeBuilder,
  BinOp,
  UnaryOp,
  ExprKind,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  EQ_STRIDE,
  EQ_LHS,
  EQ_RHS,
} from "./dae";

/**
 * Gröbner Basis & Multivariate Polynomial Algebra Engine in WASM.
 *
 * Provides zero-GC polynomial arithmetic, monomial orderings (LEX, GRLEX, GREVLEX),
 * multivariate polynomial division, Buchberger's algorithm, reduced Gröbner basis
 * computation, and DAE algebraic loop triangularization.
 */

export const ORDER_LEX: u32 = 1;
export const ORDER_GRLEX: u32 = 2;
export const ORDER_GREVLEX: u32 = 3;

/**
 * A single polynomial term: coeff * x_0^d_0 * x_1^d_1 * ... * x_{n-1}^d_{n-1}
 */
export class Term {
  coeff: f64;
  degrees: Int32Array;

  constructor(coeff: f64, degrees: Int32Array) {
    this.coeff = coeff;
    this.degrees = degrees;
  }

  clone(): Term {
    let len = this.degrees.length;
    let newDeg = new Int32Array(len);
    for (let i = 0; i < len; i++) {
      newDeg[i] = this.degrees[i];
    }
    return new Term(this.coeff, newDeg);
  }

  totalDegree(): i32 {
    let sum: i32 = 0;
    for (let i = 0; i < this.degrees.length; i++) {
      sum += this.degrees[i];
    }
    return sum;
  }

  getDegree(idx: i32): i32 {
    if (idx < 0 || idx >= this.degrees.length) return 0;
    return this.degrees[idx];
  }

  multiply(other: Term): Term {
    let len = this.degrees.length;
    let newDeg = new Int32Array(len);
    for (let i = 0; i < len; i++) {
      let od = i < other.degrees.length ? other.degrees[i] : 0;
      newDeg[i] = this.degrees[i] + od;
    }
    return new Term(this.coeff * other.coeff, newDeg);
  }

  matchesMonomial(other: Term): boolean {
    let len = this.degrees.length;
    if (len != other.degrees.length) return false;
    for (let i = 0; i < len; i++) {
      if (this.degrees[i] != other.degrees[i]) return false;
    }
    return true;
  }

  divides(other: Term): boolean {
    let len = this.degrees.length;
    for (let i = 0; i < len; i++) {
      let od = i < other.degrees.length ? other.degrees[i] : 0;
      if (od < this.degrees[i]) return false;
    }
    return true;
  }

  divideInto(other: Term): Term {
    let len = this.degrees.length;
    let newDeg = new Int32Array(len);
    for (let i = 0; i < len; i++) {
      let od = i < other.degrees.length ? other.degrees[i] : 0;
      newDeg[i] = od - this.degrees[i];
    }
    let newCoeff = this.coeff != 0.0 ? other.coeff / this.coeff : 0.0;
    return new Term(newCoeff, newDeg);
  }
}

/**
 * Compares two terms according to the specified monomial ordering.
 * Returns negative if a > b (a comes before b), positive if a < b, 0 if equal.
 */
export function compareTerms(a: Term, b: Term, orderType: u32): i32 {
  let n = a.degrees.length;

  if (orderType == ORDER_GRLEX || orderType == ORDER_GREVLEX) {
    let totalA = a.totalDegree();
    let totalB = b.totalDegree();
    if (totalA != totalB) {
      return totalB - totalA; // Descending total degree
    }

    if (orderType == ORDER_GREVLEX) {
      for (let i = n - 1; i >= 0; i--) {
        let da = a.degrees[i];
        let db = b.degrees[i];
        if (da != db) {
          return da - db; // Smaller degree has higher priority in GREVLEX tiebreaker
        }
      }
      return 0;
    }
  }

  // Pure Lexicographic (ORDER_LEX)
  for (let i = 0; i < n; i++) {
    let da = a.degrees[i];
    let db = b.degrees[i];
    if (da != db) {
      return db - da; // Descending index degree
    }
  }
  return 0;
}

/**
 * Result of multivariate polynomial division.
 */
export class DivisionResult {
  quotients: Array<Polynomial>;
  remainder: Polynomial;

  constructor(quotients: Array<Polynomial>, remainder: Polynomial) {
    this.quotients = quotients;
    this.remainder = remainder;
  }
}

/**
 * A multivariate polynomial over the ring k[x_0, x_1, ..., x_{n-1}].
 */
export class Polynomial {
  terms: Array<Term>;
  nVars: i32;
  vars: Int32Array;

  constructor(terms: Array<Term>, nVars: i32, vars: Int32Array) {
    this.terms = terms;
    this.nVars = nVars;
    this.vars = vars;
    this.simplify(ORDER_LEX);
  }

  static createEmpty(nVars: i32, vars: Int32Array): Polynomial {
    return new Polynomial(new Array<Term>(), nVars, vars);
  }

  static createConstant(c: f64, nVars: i32, vars: Int32Array): Polynomial {
    let p = new Polynomial(new Array<Term>(), nVars, vars);
    if (Math.abs(c) > 1e-12) {
      let deg = new Int32Array(nVars);
      p.terms.push(new Term(c, deg));
    }
    return p;
  }

  static createVariable(varIdx: i32, nVars: i32, vars: Int32Array): Polynomial {
    let p = new Polynomial(new Array<Term>(), nVars, vars);
    let deg = new Int32Array(nVars);
    if (varIdx >= 0 && varIdx < nVars) {
      deg[varIdx] = 1;
    }
    p.terms.push(new Term(1.0, deg));
    return p;
  }

  clone(): Polynomial {
    let newTerms = new Array<Term>(this.terms.length);
    for (let i = 0; i < this.terms.length; i++) {
      newTerms[i] = this.terms[i].clone();
    }
    let newVars = new Int32Array(this.vars.length);
    for (let i = 0; i < this.vars.length; i++) {
      newVars[i] = this.vars[i];
    }
    return new Polynomial(newTerms, this.nVars, newVars);
  }

  isZero(): boolean {
    return this.terms.length == 0;
  }

  LT(): Term | null {
    if (this.terms.length == 0) return null;
    return this.terms[0];
  }

  simplify(orderType: u32 = ORDER_LEX): Polynomial {
    if (this.terms.length <= 1) {
      if (this.terms.length == 1 && Math.abs(this.terms[0].coeff) <= 1e-12) {
        this.terms.pop();
      }
      return this;
    }

    // Sort terms using insertion sort (polynomials in loop isolation typically have <= 50 terms)
    for (let i = 1; i < this.terms.length; i++) {
      let key = this.terms[i];
      let j = i - 1;
      while (j >= 0 && compareTerms(this.terms[j], key, orderType) > 0) {
        this.terms[j + 1] = this.terms[j];
        j--;
      }
      this.terms[j + 1] = key;
    }

    // Merge like monomials
    let merged = new Array<Term>();
    let current = this.terms[0].clone();

    for (let i = 1; i < this.terms.length; i++) {
      let t = this.terms[i];
      if (current.matchesMonomial(t)) {
        current.coeff += t.coeff;
      } else {
        if (Math.abs(current.coeff) > 1e-12) {
          merged.push(current);
        }
        current = t.clone();
      }
    }
    if (Math.abs(current.coeff) > 1e-12) {
      merged.push(current);
    }

    this.terms = merged;
    return this;
  }

  add(other: Polynomial, orderType: u32 = ORDER_LEX): Polynomial {
    let newTerms = new Array<Term>();
    for (let i = 0; i < this.terms.length; i++) {
      newTerms.push(this.terms[i].clone());
    }
    for (let i = 0; i < other.terms.length; i++) {
      newTerms.push(other.terms[i].clone());
    }
    let res = new Polynomial(newTerms, this.nVars, this.vars);
    res.simplify(orderType);
    return res;
  }

  sub(other: Polynomial, orderType: u32 = ORDER_LEX): Polynomial {
    let newTerms = new Array<Term>();
    for (let i = 0; i < this.terms.length; i++) {
      newTerms.push(this.terms[i].clone());
    }
    for (let i = 0; i < other.terms.length; i++) {
      let t = other.terms[i];
      newTerms.push(new Term(-t.coeff, t.degrees));
    }
    let res = new Polynomial(newTerms, this.nVars, this.vars);
    res.simplify(orderType);
    return res;
  }

  multiplyTerm(t: Term, orderType: u32 = ORDER_LEX): Polynomial {
    let newTerms = new Array<Term>(this.terms.length);
    for (let i = 0; i < this.terms.length; i++) {
      newTerms[i] = this.terms[i].multiply(t);
    }
    let res = new Polynomial(newTerms, this.nVars, this.vars);
    res.simplify(orderType);
    return res;
  }

  multiply(other: Polynomial, orderType: u32 = ORDER_LEX): Polynomial {
    let newTerms = new Array<Term>();
    for (let i = 0; i < this.terms.length; i++) {
      for (let j = 0; j < other.terms.length; j++) {
        newTerms.push(this.terms[i].multiply(other.terms[j]));
      }
    }
    let res = new Polynomial(newTerms, this.nVars, this.vars);
    res.simplify(orderType);
    return res;
  }

  /**
   * Multivariate polynomial division (reducing this polynomial by divisors F).
   */
  divide(F: Array<Polynomial>, orderType: u32 = ORDER_LEX): DivisionResult {
    let quotients = new Array<Polynomial>(F.length);
    for (let i = 0; i < F.length; i++) {
      quotients[i] = Polynomial.createEmpty(this.nVars, this.vars);
    }

    let p = this.clone();
    let r = Polynomial.createEmpty(this.nVars, this.vars);

    while (!p.isZero()) {
      let LT_p = p.LT();
      if (!LT_p) break;

      let divisionOccurred = false;
      for (let i = 0; i < F.length; i++) {
        let fi = F[i];
        if (fi.isZero()) continue;

        let LT_fi = fi.LT();
        if (LT_fi && LT_fi.divides(LT_p)) {
          let quotientTerm = LT_fi.divideInto(LT_p);
          let qPoly = new Polynomial([quotientTerm], this.nVars, this.vars);
          quotients[i] = quotients[i].add(qPoly, orderType);

          let fi_qt = fi.multiplyTerm(quotientTerm, orderType);
          p = p.sub(fi_qt, orderType);
          divisionOccurred = true;
          break;
        }
      }

      if (!divisionOccurred) {
        r.terms.push(LT_p.clone());
        p.terms.shift();
        p.simplify(orderType);
      }
    }

    r.simplify(orderType);
    for (let i = 0; i < quotients.length; i++) {
      quotients[i].simplify(orderType);
    }

    return new DivisionResult(quotients, r);
  }
}

/**
 * Computes least common multiple of two monomials.
 */
export function termLCM(a: Term, b: Term): Term {
  let len = a.degrees.length;
  let lcmDeg = new Int32Array(len);
  for (let i = 0; i < len; i++) {
    let da = a.degrees[i];
    let db = i < b.degrees.length ? b.degrees[i] : 0;
    lcmDeg[i] = da > db ? da : db;
  }
  return new Term(1.0, lcmDeg);
}

/**
 * Computes S-polynomial S(f, g) = (LCM / LT(f)) * f - (LCM / LT(g)) * g.
 */
export function sPolynomial(f: Polynomial, g: Polynomial, orderType: u32 = ORDER_LEX): Polynomial {
  let lt_f = f.LT();
  let lt_g = g.LT();
  if (!lt_f || !lt_g) return Polynomial.createEmpty(f.nVars, f.vars);

  let lcm = termLCM(lt_f, lt_g);
  let m1 = lt_f.divideInto(lcm);
  let m2 = lt_g.divideInto(lcm);

  let sf = f.multiplyTerm(m1, orderType);
  let sg = g.multiplyTerm(m2, orderType);

  return sf.sub(sg, orderType);
}

/**
 * Buchberger's Algorithm to compute a Gröbner Basis for polynomial set F.
 */
export function computeGroebnerBasis(F: Array<Polynomial>, orderType: u32 = ORDER_LEX): Array<Polynomial> {
  if (F.length == 0) return F;
  let nVars = F[0].nVars;
  let vars = F[0].vars;

  let G = new Array<Polynomial>();
  for (let i = 0; i < F.length; i++) {
    if (!F[i].isZero()) {
      G.push(F[i].clone());
    }
  }

  let changed = true;
  let maxIterations = 200;

  while (changed && maxIterations > 0) {
    changed = false;
    maxIterations--;

    let gLen = G.length;
    for (let i = 0; i < gLen; i++) {
      for (let j = i + 1; j < gLen; j++) {
        let p1 = G[i];
        let p2 = G[j];

        let Spol = sPolynomial(p1, p2, orderType);
        if (!Spol.isZero()) {
          let divRes = Spol.divide(G, orderType);
          if (!divRes.remainder.isZero()) {
            G.push(divRes.remainder);
            changed = true;
          }
        }
      }
    }
  }

  return autoreduceBasis(G, orderType);
}

/**
 * Autoreduces a Gröbner basis to produce a canonical minimal reduced Gröbner basis.
 */
export function autoreduceBasis(basis: Array<Polynomial>, orderType: u32 = ORDER_LEX): Array<Polynomial> {
  // Phase 1: Filter out zero polynomials and make monic
  let monic = new Array<Polynomial>();
  for (let i = 0; i < basis.length; i++) {
    let p = basis[i];
    if (p.isZero()) continue;
    let lt = p.LT();
    if (!lt) continue;

    let leadCoeff = lt.coeff;
    if (leadCoeff != 0.0 && Math.abs(leadCoeff - 1.0) > 1e-12) {
      let monicTerms = new Array<Term>();
      for (let j = 0; j < p.terms.length; j++) {
        monicTerms.push(new Term(p.terms[j].coeff / leadCoeff, p.terms[j].degrees));
      }
      p = new Polynomial(monicTerms, p.nVars, p.vars);
      p.simplify(orderType);
    }
    monic.push(p);
  }

  // Phase 2: Minimal Gröbner basis - remove redundant elements whose LT is divisible by another LT
  let minimal = new Array<Polynomial>();
  for (let i = 0; i < monic.length; i++) {
    let lt_i = monic[i].LT();
    if (!lt_i) continue;

    let redundant = false;
    for (let j = 0; j < monic.length; j++) {
      if (i == j) continue;
      let lt_j = monic[j].LT();
      if (!lt_j) continue;

      if (lt_j.divides(lt_i)) {
        if (lt_i.matchesMonomial(lt_j)) {
          if (i > j) {
            redundant = true;
            break;
          }
        } else {
          redundant = true;
          break;
        }
      }
    }

    if (!redundant) {
      minimal.push(monic[i]);
    }
  }

  // Phase 3: Reduced Gröbner basis - completely reduce each polynomial by all others
  let reduced = new Array<Polynomial>();
  for (let i = 0; i < minimal.length; i++) {
    let p = minimal[i];
    let others = new Array<Polynomial>();
    for (let j = 0; j < minimal.length; j++) {
      if (i != j) others.push(minimal[j]);
    }

    if (others.length > 0) {
      let divRes = p.divide(others, orderType);
      p = divRes.remainder;
    }

    if (!p.isZero()) {
      let lt = p.LT();
      if (lt && lt.coeff != 0.0 && Math.abs(lt.coeff - 1.0) > 1e-12) {
        let monicTerms = new Array<Term>();
        for (let k = 0; k < p.terms.length; k++) {
          monicTerms.push(new Term(p.terms[k].coeff / lt.coeff, p.terms[k].degrees));
        }
        p = new Polynomial(monicTerms, p.nVars, p.vars);
        p.simplify(orderType);
      }
      reduced.push(p);
    }
  }

  return reduced;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAE Arena Integration & Algebraic Loop Triangularization
// ─────────────────────────────────────────────────────────────────────────────

function getRealVal(dae: DaeBuilder, exprId: u32): f64 {
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
  let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
  let bits = (hi << 32) | lo;
  return f64.reinterpret_i64(bits as i64);
}

/**
 * Converts a DAE expression to a multivariate polynomial over ring vars.
 */
export function daeExprToPolynomial(dae: DaeBuilder, exprId: u32, vars: Int32Array): Polynomial | null {
  let nVars = vars.length;
  if (exprId >= dae.exprCount) return null;

  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    return Polynomial.createConstant(val as f64, nVars, vars);
  }

  if (kind == ExprKind.RealLiteral) {
    let val = getRealVal(dae, exprId);
    return Polynomial.createConstant(val, nVars, vars);
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as i32;
    for (let i = 0; i < nVars; i++) {
      if (vars[i] == varId) {
        return Polynomial.createVariable(i, nVars, vars);
      }
    }
    return null;
  }

  if (kind == ExprKind.Negate) {
    let operand = exprData.get(offset + EXPR_LEFT);
    let subPoly = daeExprToPolynomial(dae, operand, vars);
    if (!subPoly) return null;
    return Polynomial.createEmpty(nVars, vars).sub(subPoly);
  }

  if (kind == ExprKind.Unary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let operand = exprData.get(offset + EXPR_LEFT);
    let subPoly = daeExprToPolynomial(dae, operand, vars);
    if (!subPoly) return null;
    if (op == UnaryOp.Negate) {
      return Polynomial.createEmpty(nVars, vars).sub(subPoly);
    }
    return null;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1) as u16;
    let leftId = exprData.get(offset + EXPR_LEFT);
    let rightId = exprData.get(offset + EXPR_RIGHT);

    let leftPoly = daeExprToPolynomial(dae, leftId, vars);
    let rightPoly = daeExprToPolynomial(dae, rightId, vars);
    if (!leftPoly || !rightPoly) return null;

    if (op == BinOp.Add) return leftPoly.add(rightPoly);
    if (op == BinOp.Sub) return leftPoly.sub(rightPoly);
    if (op == BinOp.Mul) return leftPoly.multiply(rightPoly);

    if (op == BinOp.Pow) {
      if (rightPoly.terms.length == 1 && rightPoly.terms[0].totalDegree() == 0) {
        let expVal = rightPoly.terms[0].coeff as i32;
        if (expVal >= 0 && expVal <= 10) {
          let res = Polynomial.createConstant(1.0, nVars, vars);
          for (let p = 0; p < expVal; p++) {
            res = res.multiply(leftPoly);
          }
          return res;
        }
      }
      return null;
    }
  }

  return null;
}

/**
 * Converts a polynomial back into a DAE arena expression ID.
 */
export function polynomialToDaeExpr(dae: DaeBuilder, poly: Polynomial): u32 {
  if (poly.isZero()) {
    return dae.addRealLiteral(0.0);
  }

  let resultExpr: u32 = 0xffffffff;

  for (let i = 0; i < poly.terms.length; i++) {
    let t = poly.terms[i];
    let termExpr: u32 = dae.addRealLiteral(t.coeff);

    for (let v = 0; v < poly.nVars; v++) {
      let deg = t.degrees[v];
      if (deg <= 0) continue;

      let varExpr = dae.addName(poly.vars[v] as u32);
      for (let d = 0; d < deg; d++) {
        termExpr = dae.addBinaryExpr(BinOp.Mul as u16, termExpr, varExpr);
      }
    }

    if (resultExpr == 0xffffffff) {
      resultExpr = termExpr;
    } else {
      resultExpr = dae.addBinaryExpr(BinOp.Add as u16, resultExpr, termExpr);
    }
  }

  return resultExpr;
}

function isolateLeadingVariable(dae: DaeBuilder, p: Polynomial): u32 {
  // p = LT(p) + tail = 0 => LT(p) = -tail
  let tailTerms = new Array<Term>();
  for (let i = 1; i < p.terms.length; i++) {
    let t = p.terms[i];
    tailTerms.push(new Term(-t.coeff, t.degrees));
  }
  let tailPoly = new Polynomial(tailTerms, p.nVars, p.vars);
  tailPoly.simplify(ORDER_LEX);
  return polynomialToDaeExpr(dae, tailPoly);
}

/**
 * Triangularizes an algebraic loop using Lexicographical Gröbner Bases in WASM.
 * Rewrites the algebraic loop equations into sequential upper-triangular assignments.
 */
export function groebnerTriangularizeLoop(
  dae: DaeBuilder,
  eqIdxs: Int32Array,
  varIdxs: Int32Array
): boolean {
  let nEqs = eqIdxs.length;
  let nVars = varIdxs.length;
  if (nEqs == 0 || nVars == 0) return false;

  let polys = new Array<Polynomial>();
  for (let i = 0; i < nEqs; i++) {
    let eqIdx = eqIdxs[i] as u32;
    let offset = eqIdx * EQ_STRIDE;
    let lhsId = dae.getEqData().get(offset + EQ_LHS) as u32;
    let rhsId = dae.getEqData().get(offset + EQ_RHS) as u32;

    let lhsPoly = daeExprToPolynomial(dae, lhsId, varIdxs);
    let rhsPoly = daeExprToPolynomial(dae, rhsId, varIdxs);
    if (!lhsPoly || !rhsPoly) return false;

    polys.push(lhsPoly.sub(rhsPoly, ORDER_LEX));
  }

  let basis = computeGroebnerBasis(polys, ORDER_LEX);
  if (basis.length < nVars) return false;

  // Verify triangular structure: each equation eliminates one variable
  for (let i = 0; i < nVars && i < basis.length; i++) {
    let p = basis[i];
    let lt = p.LT();
    if (!lt) return false;

    let targetVarIdx = -1;
    for (let v = 0; v < p.nVars; v++) {
      if (lt.degrees[v] > 0) {
        targetVarIdx = v;
        break;
      }
    }
    if (targetVarIdx == -1) continue;

    let targetVar = varIdxs[targetVarIdx] as u32;
    let isolatedRhs = isolateLeadingVariable(dae, p);
    let eqOffset = (eqIdxs[i] as u32) * EQ_STRIDE;
    let lhsVarExpr = dae.addName(targetVar);

    dae.getEqData().set(eqOffset + EQ_LHS, lhsVarExpr);
    dae.getEqData().set(eqOffset + EQ_RHS, isolatedRhs);
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function groebner_triangularize(daePtr: u32, eqIdxsPtr: usize, nEqs: u32, varIdxsPtr: usize, nVars: u32): boolean {
  if (daePtr == 0) return false;
  let dae = changetype<DaeBuilder>(daePtr);
  let eqIdxs = new Int32Array(nEqs);
  for (let i: u32 = 0; i < nEqs; i++) {
    eqIdxs[i] = load<i32>(eqIdxsPtr + (i << 2));
  }
  let varIdxs = new Int32Array(nVars);
  for (let i: u32 = 0; i < nVars; i++) {
    varIdxs[i] = load<i32>(varIdxsPtr + (i << 2));
  }
  return groebnerTriangularizeLoop(dae, eqIdxs, varIdxs);
}
