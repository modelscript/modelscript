/**
 * Transform Mixin Library
 *
 * Provides canned implementations for common transform pipelines that users
 * can spread into their grammar's `transforms` configuration. These mixins
 * implement standard mathematical rules that are commonly needed by the
 * reasoner's Simplex solver and the Pantelides structural analysis.
 */

import { add, constant, cos, div, mul, neg, sin, sub, TransformCombinator } from "../dsl.js";

// Type alias for a combinator node
type C = TransformCombinator;

// Helper: create a named node
function node(op: string, ...children: any[]): C {
  return new TransformCombinator(op, children);
}

// Helper: access child at index
function child(a: any, idx: number): C {
  return new TransformCombinator("child", [a, idx]);
}

/**
 * Standard Interval Arithmetic Mixin
 *
 * Implements monotone interval extensions for basic arithmetic operations:
 *   add([a,b], [c,d]) = [a+c, b+d]
 *   sub([a,b], [c,d]) = [a-d, b-c]
 *   mul([a,b], [c,d]) = [min(ac,ad,bc,bd), max(ac,ad,bc,bd)]
 *   sin([a,b])        = [-1, 1] (conservative)
 *   cos([a,b])        = [-1, 1] (conservative)
 *   exp([a,b])        = [exp(a), exp(b)]
 *   neg([a,b])        = [-b, -a]
 */
export const StandardIntervalMixin = {
  interval: {
    add: (a: C, b: C): C => node("INTERVAL", add(child(a, 0), child(b, 0)), add(child(a, 1), child(b, 1))),
    sub: (a: C, b: C): C => node("INTERVAL", sub(child(a, 0), child(b, 1)), sub(child(a, 1), child(b, 0))),
    mul: (a: C, b: C): C =>
      node(
        "INTERVAL",
        node(
          "MIN4",
          mul(child(a, 0), child(b, 0)),
          mul(child(a, 0), child(b, 1)),
          mul(child(a, 1), child(b, 0)),
          mul(child(a, 1), child(b, 1)),
        ),
        node(
          "MAX4",
          mul(child(a, 0), child(b, 0)),
          mul(child(a, 0), child(b, 1)),
          mul(child(a, 1), child(b, 0)),
          mul(child(a, 1), child(b, 1)),
        ),
      ),
    neg: (a: C): C => node("INTERVAL", neg(child(a, 1)), neg(child(a, 0))),
    sin: (_a: C): C => node("INTERVAL", constant(-1), constant(1)),
    cos: (_a: C): C => node("INTERVAL", constant(-1), constant(1)),
    exp: (a: C): C => node("INTERVAL", node("EXP", child(a, 0)), node("EXP", child(a, 1))),
    relu: (a: C): C => node("INTERVAL", node("MAX", child(a, 0), constant(0)), node("MAX", child(a, 1), constant(0))),
    sigmoid: (a: C): C => node("INTERVAL", node("SIGMOID", child(a, 0)), node("SIGMOID", child(a, 1))),
    tanh: (a: C): C => node("INTERVAL", node("TANH", child(a, 0)), node("TANH", child(a, 1))),
    gelu: (_a: C): C => node("INTERVAL", node("GELU", child(_a, 0)), node("GELU", child(_a, 1))),
    softmax: (_a: C): C => node("INTERVAL", constant(0), constant(1)),
    smoothstep: (_a: C): C => node("INTERVAL", constant(0), constant(1)),
  },
};

/**
 * Affine Arithmetic Mixin
 *
 * Provides tighter bounds than standard interval arithmetic by tracking
 * inter-variable correlations through noise symbols.
 */
export const AffineArithmeticMixin = (() => {
  let noiseCounter = 0;
  return {
    interval: {
      add: (a: C, b: C): C => node("AFFINE", add(child(a, 0), child(b, 0)), add(child(a, 1), child(b, 1))),
      sub: (a: C, b: C): C => node("AFFINE", sub(child(a, 0), child(b, 0)), sub(child(a, 1), child(b, 1))),
      mul: (a: C, b: C): C => {
        noiseCounter++;
        return node("AFFINE", mul(child(a, 0), child(b, 0)), node("AFFINE_MUL_NOISE", a, b, constant(noiseCounter)));
      },
      sin: (a: C): C => {
        noiseCounter++;
        return node("AFFINE", sin(child(a, 0)), constant(noiseCounter));
      },
      cos: (a: C): C => {
        noiseCounter++;
        return node("AFFINE", cos(child(a, 0)), constant(noiseCounter));
      },
      neg: (a: C): C => node("AFFINE", neg(child(a, 0)), neg(child(a, 1))),
      toInterval: (a: C): C => node("INTERVAL", node("AFFINE_LO", a), node("AFFINE_HI", a)),
    },
  };
})();

/**
 * McCormick Convex/Concave Relaxation Mixin (McCormick Cuts)
 *
 * Computes tight convex underestimators and concave overestimators for non-linear bilinear terms (x*y).
 */
export const McCormickMixin = {
  mccormick: {
    mul: (x: C, y: C, xLo: C, xHi: C, yLo: C, yHi: C): C =>
      node(
        "MCCORMICK",
        // Convex underestimators: max(xLo*y + x*yLo - xLo*yLo, xHi*y + x*yHi - xHi*yHi)
        node(
          "MAX2",
          sub(add(mul(xLo, y), mul(x, yLo)), mul(xLo, yLo)),
          sub(add(mul(xHi, y), mul(x, yHi)), mul(xHi, yHi)),
        ),
        // Concave overestimators: min(xHi*y + x*yLo - xHi*yLo, x*yHi + xLo*y - xLo*yHi)
        node(
          "MIN2",
          sub(add(mul(xHi, y), mul(x, yLo)), mul(xHi, yLo)),
          sub(add(mul(x, yHi), mul(xLo, y)), mul(xLo, yHi)),
        ),
      ),
  },
};

/**
 * Standard Forward-Mode Tangent Mixin (Automatic Differentiation for Pantelides)
 */
export const StandardTangentMixin = {
  tangent: {
    add: (a: C, b: C, da: C, db: C): C => add(da, db),
    mul: (a: C, b: C, da: C, db: C): C => add(mul(a, db), mul(b, da)),
    div: (a: C, b: C, da: C, db: C): C => div(sub(mul(da, b), mul(a, db)), mul(b, b)),
    sin: (a: C, da: C): C => mul(cos(a), da),
    cos: (a: C, da: C): C => mul(neg(constant(1)), mul(sin(a), da)),
    exp: (a: C, da: C): C => mul(node("EXP", a), da),
    sqrt: (a: C, da: C): C => div(da, mul(constant(2), node("SQRT", a))),
    constant: (): C => constant(0),
    relu: (a: C, da: C): C => mul(node("HEAVISIDE", a), da),
    sigmoid: (a: C, da: C): C => mul(mul(node("SIGMOID", a), sub(constant(1), node("SIGMOID", a))), da),
    tanh: (a: C, da: C): C => mul(sub(constant(1), mul(node("TANH", a), node("TANH", a))), da),
    gelu: (a: C, da: C): C => mul(node("GELU_DERIV", a), da),
    softmax: (a: C, da: C): C => mul(node("SOFTMAX_DERIV", a), da),
    smoothstep: (a: C, da: C): C => mul(node("SMOOTHSTEP_DERIV", a), da),
    fft: (a: C, da: C): C => node("FFT", da),
    ifft: (a: C, da: C): C => node("IFFT", da),
    complex_mul: (a: C, b: C, da: C, db: C): C => add(node("COMPLEX_MUL", a, db), node("COMPLEX_MUL", b, da)),
    distance: (a: C, b: C, da: C, db: C): C =>
      add(mul(node("DISTANCE_GRAD_A", a, b), da), mul(node("DISTANCE_GRAD_B", a, b), db)),
  },
};

/**
 * Standard Reverse-Mode Adjoint Mixin (Backpropagation)
 */
export const StandardAdjointMixin = {
  adjoint: {
    add: (adjoint: C): C[] => [adjoint, adjoint],
    mul: (a: C, b: C, adjoint: C): C[] => [mul(adjoint, b), mul(adjoint, a)],
    div: (a: C, b: C, adjoint: C): C[] => [div(adjoint, b), neg(div(mul(adjoint, a), mul(b, b)))],
    sin: (a: C, adjoint: C): C[] => [mul(adjoint, cos(a))],
    cos: (a: C, adjoint: C): C[] => [mul(neg(constant(1)), mul(adjoint, sin(a)))],
    exp: (a: C, adjoint: C): C[] => [mul(adjoint, node("EXP", a))],
    relu: (a: C, adjoint: C): C[] => [mul(adjoint, node("HEAVISIDE", a))],
    sigmoid: (a: C, adjoint: C): C[] => [mul(adjoint, mul(node("SIGMOID", a), sub(constant(1), node("SIGMOID", a))))],
    tanh: (a: C, adjoint: C): C[] => [mul(adjoint, sub(constant(1), mul(node("TANH", a), node("TANH", a))))],
    gelu: (a: C, adjoint: C): C[] => [mul(adjoint, node("GELU_DERIV", a))],
    softmax: (a: C, adjoint: C): C[] => [mul(adjoint, node("SOFTMAX_DERIV", a))],
    smoothstep: (a: C, adjoint: C): C[] => [mul(adjoint, node("SMOOTHSTEP_DERIV", a))],
    fft: (a: C, adjoint: C): C[] => [node("IFFT", adjoint)],
    ifft: (a: C, adjoint: C): C[] => [node("FFT", adjoint)],
    complex_mul: (a: C, b: C, adjoint: C): C[] => [
      node("COMPLEX_MUL", node("CONJ", b), adjoint),
      node("COMPLEX_MUL", node("CONJ", a), adjoint),
    ],
    distance: (a: C, b: C, adjoint: C): C[] => [
      mul(adjoint, node("DISTANCE_GRAD_A", a, b)),
      mul(adjoint, node("DISTANCE_GRAD_B", a, b)),
    ],
    cube: (sizeX: C, sizeY: C, sizeZ: C, adjoint: C): C[] => [
      mul(adjoint, node("CUBE_GRAD_X", sizeX, sizeY, sizeZ)),
      mul(adjoint, node("CUBE_GRAD_Y", sizeX, sizeY, sizeZ)),
      mul(adjoint, node("CUBE_GRAD_Z", sizeX, sizeY, sizeZ)),
    ],
    cylinder: (h: C, r: C, adjoint: C): C[] => [
      mul(adjoint, node("CYLINDER_GRAD_H", h, r)),
      mul(adjoint, node("CYLINDER_GRAD_R", h, r)),
    ],
  },
};

/**
 * Standard Hessian Mixin (Forward-over-Reverse)
 */
export const StandardHessianMixin = {
  hessian: {
    add: (a: C, b: C, da: C, db: C, d2a: C, d2b: C): C => add(d2a, d2b),
    mul: (a: C, b: C, da: C, db: C, d2a: C, d2b: C): C =>
      add(add(mul(a, d2b), mul(b, d2a)), mul(constant(2), mul(da, db))),
    sin: (a: C, da: C, d2a: C): C => sub(mul(cos(a), d2a), mul(sin(a), mul(da, da))),
    cos: (a: C, da: C, d2a: C): C => sub(neg(mul(sin(a), d2a)), mul(cos(a), mul(da, da))),
    constant: (): C => constant(0),
    relu: (_a: C, _da: C, _d2a: C): C => constant(0),
    sigmoid: (a: C, da: C, d2a: C): C => {
      const s = node("SIGMOID", a);
      const s1 = sub(constant(1), s);
      return add(mul(mul(mul(s, s1), sub(constant(1), mul(constant(2), s))), mul(da, da)), mul(mul(s, s1), d2a));
    },
    tanh: (a: C, da: C, d2a: C): C => {
      const t = node("TANH", a);
      const sech2 = sub(constant(1), mul(t, t));
      return add(mul(mul(neg(mul(constant(2), t)), sech2), mul(da, da)), mul(sech2, d2a));
    },
  },
};

/**
 * Structural Sparsity Mixin
 */
export const SparsityMixin = {
  sparsity: {
    add: (a: C, b: C): C => node("OR", a, b),
    sub: (a: C, b: C): C => node("OR", a, b),
    mul: (a: C, b: C): C => node("OR", a, b),
    div: (a: C, b: C): C => node("OR", a, b),
    sin: (a: C): C => a,
    cos: (a: C): C => a,
    constant: (): C => constant(0),
    relu: (a: C): C => a,
    sigmoid: (a: C): C => a,
    tanh: (a: C): C => a,
    gelu: (a: C): C => a,
    softmax: (a: C): C => a,
    smoothstep: (a: C): C => a,
    fft: (a: C): C => a,
    ifft: (a: C): C => a,
    complex_mul: (a: C, b: C): C => node("OR", a, b),
  },
};

/**
 * Constructive Solid Geometry (CSG) Mixin
 */
export const CSGMixin = {
  csg: {
    cube: (sizeX: C, sizeY: C, sizeZ: C): C => node("CUBE", sizeX, sizeY, sizeZ),
    sphere: (radius: C): C => node("SPHERE", radius),
    cylinder: (h: C, r: C): C => node("CYLINDER", h, r),
    union: (...children: C[]): C => node("UNION", children),
    difference: (a: C, b: C): C => node("DIFFERENCE", a, b),
    intersect: (...children: C[]): C => node("INTERSECT", children),
    translate: (vX: C, vY: C, vZ: C, child: C): C => node("TRANSLATE", vX, vY, vZ, child),
    rotate: (rX: C, rY: C, rZ: C, child: C): C => node("ROTATE", rX, rY, rZ, child),
  },
};
