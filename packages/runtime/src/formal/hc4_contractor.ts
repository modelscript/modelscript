// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — HC4-Revise Non-Linear Interval Constraint Contractor.
 *
 * Implements:
 *   - Forward evaluation of interval bounds on computational DAGs.
 *   - Backward propagation of interval constraints using inverse arithmetic.
 *   - Non-linear constraint filtering for equations and inequalities: f(x) = 0, f(x) <= 0.
 *   - Zero external dependencies; builds directly on wasm_interval.ts.
 */

import { Interval, outwardRoundInterval } from "../analysis/wasm_interval.js";

export type ExprNode =
  | { kind: "var"; name: string }
  | { kind: "const"; value: number }
  | { kind: "add"; left: ExprNode; right: ExprNode }
  | { kind: "sub"; left: ExprNode; right: ExprNode }
  | { kind: "mul"; left: ExprNode; right: ExprNode }
  | { kind: "div"; left: ExprNode; right: ExprNode }
  | { kind: "neg"; child: ExprNode }
  | { kind: "sqr"; child: ExprNode }
  | { kind: "sqrt"; child: ExprNode }
  | { kind: "sin"; child: ExprNode }
  | { kind: "cos"; child: ExprNode };

export interface NonlinearConstraint {
  expr: ExprNode;
  rel: "<=" | ">=" | "==";
  rhs: number;
}

export class Hc4Contractor {
  /**
   * Evaluates the interval bound of an expression given variable interval bounds.
   * Employs outward directed rounding to ensure strict mathematical enclosure.
   */
  public static evalInterval(node: ExprNode, box: Map<string, Interval>): Interval {
    switch (node.kind) {
      case "var": {
        const inv = box.get(node.name);
        return inv ? new Interval(inv.lo, inv.hi) : new Interval(-Infinity, Infinity);
      }
      case "const":
        return outwardRoundInterval(node.value, node.value);
      case "neg": {
        const c = Hc4Contractor.evalInterval(node.child, box);
        return new Interval(-c.hi, -c.lo);
      }
      case "add": {
        const l = Hc4Contractor.evalInterval(node.left, box);
        const r = Hc4Contractor.evalInterval(node.right, box);
        return Interval.addOutward(l, r);
      }
      case "sub": {
        const l = Hc4Contractor.evalInterval(node.left, box);
        const r = Hc4Contractor.evalInterval(node.right, box);
        return Interval.subOutward(l, r);
      }
      case "mul": {
        const l = Hc4Contractor.evalInterval(node.left, box);
        const r = Hc4Contractor.evalInterval(node.right, box);
        return Interval.mulOutward(l, r);
      }
      case "div": {
        const l = Hc4Contractor.evalInterval(node.left, box);
        const r = Hc4Contractor.evalInterval(node.right, box);
        return Interval.divOutward(l, r);
      }
      case "sqr": {
        const c = Hc4Contractor.evalInterval(node.child, box);
        if (c.lo >= 0) return outwardRoundInterval(c.lo * c.lo, c.hi * c.hi);
        if (c.hi <= 0) return outwardRoundInterval(c.hi * c.hi, c.lo * c.lo);
        return outwardRoundInterval(0, Math.max(c.lo * c.lo, c.hi * c.hi));
      }
      case "sqrt": {
        const c = Hc4Contractor.evalInterval(node.child, box);
        if (c.hi < 0) return new Interval(NaN, NaN); // Empty domain
        return outwardRoundInterval(Math.sqrt(Math.max(0, c.lo)), Math.sqrt(Math.max(0, c.hi)));
      }
      case "sin": {
        const c = Hc4Contractor.evalInterval(node.child, box);
        if (c.hi - c.lo >= 2 * Math.PI) return new Interval(-1, 1);
        const vals = [Math.sin(c.lo), Math.sin(c.hi)];
        // Check local extrema
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const kLo = Math.ceil((c.lo - Math.PI / 2) / (2 * Math.PI));
        const kHi = Math.floor((c.hi - Math.PI / 2) / (2 * Math.PI));
        if (kLo <= kHi) hi = 1.0;
        const mLo = Math.ceil((c.lo + Math.PI / 2) / (2 * Math.PI));
        const mHi = Math.floor((c.hi + Math.PI / 2) / (2 * Math.PI));
        if (mLo <= mHi) lo = -1.0;
        return outwardRoundInterval(lo, hi);
      }
      case "cos": {
        const c = Hc4Contractor.evalInterval(node.child, box);
        if (c.hi - c.lo >= 2 * Math.PI) return new Interval(-1, 1);
        const vals = [Math.cos(c.lo), Math.cos(c.hi)];
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const kLo = Math.ceil(c.lo / (2 * Math.PI));
        const kHi = Math.floor(c.hi / (2 * Math.PI));
        if (kLo <= kHi) hi = 1.0;
        const mLo = Math.ceil((c.lo - Math.PI) / (2 * Math.PI));
        const mHi = Math.floor((c.hi - Math.PI) / (2 * Math.PI));
        if (mLo <= mHi) lo = -1.0;
        return outwardRoundInterval(lo, hi);
      }
    }
  }

  /**
   * Backward contractors: given desired bound on node output, contract child nodes.
   */
  public static contractNode(node: ExprNode, target: Interval, box: Map<string, Interval>): boolean {
    if (target.lo > target.hi) return false; // Inconsistent

    switch (node.kind) {
      case "var": {
        const current = box.get(node.name) ?? new Interval(-Infinity, Infinity);
        const intersectedLo = Math.max(current.lo, target.lo);
        const intersectedHi = Math.min(current.hi, target.hi);
        if (intersectedLo > intersectedHi) return false;
        box.set(node.name, new Interval(intersectedLo, intersectedHi));
        return true;
      }
      case "const": {
        return node.value >= target.lo && node.value <= target.hi;
      }
      case "neg": {
        // target is -child => child is -target
        const childTarget = new Interval(-target.hi, -target.lo);
        return Hc4Contractor.contractNode(node.child, childTarget, box);
      }
      case "add": {
        // z = left + right => left = z - right, right = z - left
        const leftVal = Hc4Contractor.evalInterval(node.left, box);
        const rightVal = Hc4Contractor.evalInterval(node.right, box);

        const newLeftTarget = new Interval(target.lo - rightVal.hi, target.hi - rightVal.lo);
        const newRightTarget = new Interval(target.lo - leftVal.hi, target.hi - leftVal.lo);

        return (
          Hc4Contractor.contractNode(node.left, newLeftTarget, box) &&
          Hc4Contractor.contractNode(node.right, newRightTarget, box)
        );
      }
      case "sub": {
        // z = left - right => left = z + right, right = left - z
        const leftVal = Hc4Contractor.evalInterval(node.left, box);
        const rightVal = Hc4Contractor.evalInterval(node.right, box);

        const newLeftTarget = new Interval(target.lo + rightVal.lo, target.hi + rightVal.hi);
        const newRightTarget = new Interval(leftVal.lo - target.hi, leftVal.hi - target.lo);

        return (
          Hc4Contractor.contractNode(node.left, newLeftTarget, box) &&
          Hc4Contractor.contractNode(node.right, newRightTarget, box)
        );
      }
      case "mul": {
        // z = left * right
        const leftVal = Hc4Contractor.evalInterval(node.left, box);
        const rightVal = Hc4Contractor.evalInterval(node.right, box);

        // if rightVal doesn't contain 0
        if (rightVal.lo > 0 || rightVal.hi < 0) {
          const p1 = target.lo / rightVal.lo;
          const p2 = target.lo / rightVal.hi;
          const p3 = target.hi / rightVal.lo;
          const p4 = target.hi / rightVal.hi;
          const newLeftTarget = new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
          if (!Hc4Contractor.contractNode(node.left, newLeftTarget, box)) return false;
        }

        if (leftVal.lo > 0 || leftVal.hi < 0) {
          const p1 = target.lo / leftVal.lo;
          const p2 = target.lo / leftVal.hi;
          const p3 = target.hi / leftVal.lo;
          const p4 = target.hi / leftVal.hi;
          const newRightTarget = new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
          if (!Hc4Contractor.contractNode(node.right, newRightTarget, box)) return false;
        }

        return true;
      }
      case "sqr": {
        // z = child^2
        if (target.hi < 0) return false;
        const maxRoot = Math.sqrt(Math.max(0, target.hi));
        const minRoot = target.lo > 0 ? Math.sqrt(target.lo) : 0;
        // child could be positive or negative root
        const childCurrent = Hc4Contractor.evalInterval(node.child, box);
        let childTarget: Interval;
        if (childCurrent.lo >= 0) {
          childTarget = new Interval(minRoot, maxRoot);
        } else if (childCurrent.hi <= 0) {
          childTarget = new Interval(-maxRoot, -minRoot);
        } else {
          childTarget = new Interval(-maxRoot, maxRoot);
        }
        return Hc4Contractor.contractNode(node.child, childTarget, box);
      }
      case "div": {
        // z = left / right => left = z * right, right = left / z
        const leftVal = Hc4Contractor.evalInterval(node.left, box);
        const rightVal = Hc4Contractor.evalInterval(node.right, box);

        // Contract left: left ∈ target * rightVal
        if (rightVal.lo > 0 || rightVal.hi < 0) {
          const p1 = target.lo * rightVal.lo;
          const p2 = target.lo * rightVal.hi;
          const p3 = target.hi * rightVal.lo;
          const p4 = target.hi * rightVal.hi;
          const newLeftTarget = new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
          if (!Hc4Contractor.contractNode(node.left, newLeftTarget, box)) return false;
        }

        // Contract right: right ∈ leftVal / target (when 0 ∉ target)
        if ((target.lo > 0 || target.hi < 0) && (leftVal.lo > 0 || leftVal.hi < 0)) {
          const p1 = leftVal.lo / target.lo;
          const p2 = leftVal.lo / target.hi;
          const p3 = leftVal.hi / target.lo;
          const p4 = leftVal.hi / target.hi;
          const newRightTarget = new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4));
          if (!Hc4Contractor.contractNode(node.right, newRightTarget, box)) return false;
        }

        return true;
      }
      case "sqrt": {
        // z = sqrt(child) => child ∈ [max(0, target.lo²), target.hi²]
        if (target.hi < 0) return false;
        const tLo = Math.max(0, target.lo);
        const childLo = tLo * tLo;
        const childHi = target.hi === Infinity ? Infinity : target.hi * target.hi;
        const childTarget2 = new Interval(childLo, childHi);
        return Hc4Contractor.contractNode(node.child, childTarget2, box);
      }
      case "sin": {
        // z = sin(child) => child ∈ arcsin(target) ∩ child_current
        // Multi-period: for each 2kπ period overlapping child, compute both branches
        const childCurrent = Hc4Contractor.evalInterval(node.child, box);
        const tLo = Math.max(-1, target.lo);
        const tHi = Math.min(1, target.hi);
        if (tLo > tHi) return false;
        if (tLo > 1 || tHi < -1) return false;

        const asinLo = Math.asin(tLo);
        const asinHi = Math.asin(tHi);

        // Collect all inverse branches within childCurrent
        let bestLo = Infinity;
        let bestHi = -Infinity;

        // Compute the range of periods k to check: child ∈ [childCurrent.lo, childCurrent.hi]
        // Branch 1: asin(z) + 2kπ — principal branch
        // Branch 2: π - asin(z) + 2kπ — reflected branch
        const kMin = Math.floor((childCurrent.lo + Math.PI) / (2 * Math.PI)) - 1;
        const kMax = Math.ceil((childCurrent.hi + Math.PI) / (2 * Math.PI)) + 1;

        for (let kk = kMin; kk <= kMax; kk++) {
          // Branch 1: [asinLo + 2kπ, asinHi + 2kπ]
          const b1Lo = asinLo + kk * 2 * Math.PI;
          const b1Hi = asinHi + kk * 2 * Math.PI;
          if (b1Hi >= childCurrent.lo && b1Lo <= childCurrent.hi) {
            bestLo = Math.min(bestLo, Math.max(b1Lo, childCurrent.lo));
            bestHi = Math.max(bestHi, Math.min(b1Hi, childCurrent.hi));
          }

          // Branch 2: [π - asinHi + 2kπ, π - asinLo + 2kπ]
          const b2Lo = Math.PI - asinHi + kk * 2 * Math.PI;
          const b2Hi = Math.PI - asinLo + kk * 2 * Math.PI;
          if (b2Hi >= childCurrent.lo && b2Lo <= childCurrent.hi) {
            bestLo = Math.min(bestLo, Math.max(b2Lo, childCurrent.lo));
            bestHi = Math.max(bestHi, Math.min(b2Hi, childCurrent.hi));
          }
        }

        if (bestLo > bestHi) return false;
        return Hc4Contractor.contractNode(node.child, new Interval(bestLo, bestHi), box);
      }
      case "cos": {
        // z = cos(child) => child ∈ arccos(target) ∩ child_current
        // Multi-period: for each 2kπ period, compute both branches of arccos
        const childCurrent = Hc4Contractor.evalInterval(node.child, box);
        const tLo = Math.max(-1, target.lo);
        const tHi = Math.min(1, target.hi);
        if (tLo > tHi) return false;
        if (tLo > 1 || tHi < -1) return false;

        // arccos is monotonically decreasing: arccos(tHi) <= arccos(tLo)
        const acosLo = Math.acos(tHi); // Smaller angle
        const acosHi = Math.acos(tLo); // Larger angle

        let bestLo = Infinity;
        let bestHi = -Infinity;

        const kMin = Math.floor(childCurrent.lo / (2 * Math.PI)) - 1;
        const kMax = Math.ceil(childCurrent.hi / (2 * Math.PI)) + 1;

        for (let kk = kMin; kk <= kMax; kk++) {
          // Branch 1: [acosLo + 2kπ, acosHi + 2kπ]
          const b1Lo = acosLo + kk * 2 * Math.PI;
          const b1Hi = acosHi + kk * 2 * Math.PI;
          if (b1Hi >= childCurrent.lo && b1Lo <= childCurrent.hi) {
            bestLo = Math.min(bestLo, Math.max(b1Lo, childCurrent.lo));
            bestHi = Math.max(bestHi, Math.min(b1Hi, childCurrent.hi));
          }

          // Branch 2: [-acosHi + 2kπ, -acosLo + 2kπ] (negative angles)
          const b2Lo = -acosHi + kk * 2 * Math.PI;
          const b2Hi = -acosLo + kk * 2 * Math.PI;
          if (b2Hi >= childCurrent.lo && b2Lo <= childCurrent.hi) {
            bestLo = Math.min(bestLo, Math.max(b2Lo, childCurrent.lo));
            bestHi = Math.max(bestHi, Math.min(b2Hi, childCurrent.hi));
          }
        }

        if (bestLo > bestHi) return false;
        return Hc4Contractor.contractNode(node.child, new Interval(bestLo, bestHi), box);
      }
      default:
        return true;
    }
  }

  /**
   * Revises a box with respect to a non-linear constraint.
   * Returns false if the constraint is definitively unsatisfiable.
   */
  public static revise(constraint: NonlinearConstraint, box: Map<string, Interval>): boolean {
    const exprInterval = Hc4Contractor.evalInterval(constraint.expr, box);

    let targetInterval: Interval;
    switch (constraint.rel) {
      case "<=":
        targetInterval = new Interval(-Infinity, constraint.rhs);
        break;
      case ">=":
        targetInterval = new Interval(constraint.rhs, Infinity);
        break;
      case "==":
        targetInterval = new Interval(constraint.rhs, constraint.rhs);
        break;
    }

    const intersectedLo = Math.max(exprInterval.lo, targetInterval.lo);
    const intersectedHi = Math.min(exprInterval.hi, targetInterval.hi);
    if (intersectedLo > intersectedHi) return false; // Inconsistent

    return Hc4Contractor.contractNode(constraint.expr, new Interval(intersectedLo, intersectedHi), box);
  }
}
