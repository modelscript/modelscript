
/**
 * Built-in Modelica Standard Library (MSL) Math & Matrix Runtime.
 * High-performance, zero-allocation WASM numerical and linear algebra routines.
 */

// ----------------------------------------------------------------------------
// Elementary & Trigonometric Functions
// ----------------------------------------------------------------------------

export function math_sin(x: f64): f64 { return Math.sin(x); }
export function math_cos(x: f64): f64 { return Math.cos(x); }
export function math_tan(x: f64): f64 { return Math.tan(x); }
export function math_asin(x: f64): f64 { return Math.asin(x); }
export function math_acos(x: f64): f64 { return Math.acos(x); }
export function math_atan(x: f64): f64 { return Math.atan(x); }
export function math_atan2(y: f64, x: f64): f64 { return Math.atan2(y, x); }
export function math_sinh(x: f64): f64 { return Math.sinh(x); }
export function math_cosh(x: f64): f64 { return Math.cosh(x); }
export function math_tanh(x: f64): f64 { return Math.tanh(x); }
export function math_exp(x: f64): f64 { return Math.exp(x); }
export function math_log(x: f64): f64 { return Math.log(x); }
export function math_log10(x: f64): f64 { return Math.log10(x); }
export function math_sqrt(x: f64): f64 { return Math.sqrt(x); }
export function math_abs(x: f64): f64 { return Math.abs(x); }
export function math_sign(x: f64): f64 {
  if (x > 0.0) return 1.0;
  if (x < 0.0) return -1.0;
  return 0.0;
}
export function math_smooth(p: i32, expr: f64): f64 { return expr; }
export function math_noEvent(expr: f64): f64 { return expr; }

// ----------------------------------------------------------------------------
// Matrix & Vector Linear Algebra
// ----------------------------------------------------------------------------

import { DenseMatrixView, UnmanagedFloat64Array } from "../core/array";

/**
 * Transposes an M x N row-major matrix into an N x M matrix.
 */
export function matrix_transpose(srcPtr: usize, dstPtr: usize, rows: u32, cols: u32): void {
  let src = DenseMatrixView.at(srcPtr, rows, cols);
  let dst = DenseMatrixView.at(dstPtr, cols, rows);
  for (let r: u32 = 0; r < rows; r++) {
    for (let c: u32 = 0; c < cols; c++) {
      dst.set(c, r, src.get(r, c));
    }
  }
}

/**
 * Multiplies an M x K matrix A by a K x N matrix B, storing into an M x N matrix C.
 */
export function matrix_multiply(
  aPtr: usize,
  bPtr: usize,
  cPtr: usize,
  m: u32,
  k: u32,
  n: u32
): void {
  let a = DenseMatrixView.at(aPtr, m, k);
  let b = DenseMatrixView.at(bPtr, k, n);
  let c = DenseMatrixView.at(cPtr, m, n);
  for (let i: u32 = 0; i < m; i++) {
    for (let j: u32 = 0; j < n; j++) {
      let sum: f64 = 0.0;
      for (let p: u32 = 0; p < k; p++) {
        sum += a.get(i, p) * b.get(p, j);
      }
      c.set(i, j, sum);
    }
  }
}

/**
 * Computes the Euclidean 2-norm of an N-dimensional vector.
 */
export function vector_norm2(vecPtr: usize, n: u32): f64 {
  let vec = changetype<UnmanagedFloat64Array>(vecPtr);
  let sumSq: f64 = 0.0;
  for (let i: u32 = 0; i < n; i++) {
    let v = vec[i];
    sumSq += v * v;
  }
  return Math.sqrt(sumSq);
}

/**
 * Solves a 2x2 linear system A * x = b via Cramer's rule.
 */
export function matrix_solve2x2(aPtr: usize, bPtr: usize, xPtr: usize): boolean {
  let a = changetype<UnmanagedFloat64Array>(aPtr);
  let b = changetype<UnmanagedFloat64Array>(bPtr);
  let x = changetype<UnmanagedFloat64Array>(xPtr);

  let a00 = a[0];
  let a01 = a[1];
  let a10 = a[2];
  let a11 = a[3];

  let det = a00 * a11 - a01 * a10;
  if (Math.abs(det) < 1e-14) return false; // Singular matrix

  let b0 = b[0];
  let b1 = b[1];

  let x0 = (b0 * a11 - a01 * b1) / det;
  let x1 = (a00 * b1 - b0 * a10) / det;

  x[0] = x0;
  x[1] = x1;
  return true;
}

// ----------------------------------------------------------------------------
// CSG (Constructive Solid Geometry) Primitives & Boolean Operations
// ----------------------------------------------------------------------------

export const CSG_SPHERE: u16 = 1;
export const CSG_BOX: u16 = 2;
export const CSG_CYLINDER: u16 = 3;
export const CSG_UNION: u16 = 4;
export const CSG_INTERSECT: u16 = 5;
export const CSG_DIFFERENCE: u16 = 6;

/** Signed Distance Function (SDF) for Sphere at origin with radius r. */
export function csg_sdf_sphere(px: f64, py: f64, pz: f64, r: f64): f64 {
  let len = Math.sqrt(px * px + py * py + pz * pz);
  return len - r;
}

/** Signed Distance Function (SDF) for Box centered at origin with half-extents (hx, hy, hz). */
export function csg_sdf_box(px: f64, py: f64, pz: f64, hx: f64, hy: f64, hz: f64): f64 {
  let dx = Math.abs(px) - hx;
  let dy = Math.abs(py) - hy;
  let dz = Math.abs(pz) - hz;

  let ox = Math.max(dx, 0.0);
  let oy = Math.max(dy, 0.0);
  let oz = Math.max(dz, 0.0);
  let outside = Math.sqrt(ox * ox + oy * oy + oz * oz);

  let inside = Math.min(Math.max(dx, Math.max(dy, dz)), 0.0);
  return outside + inside;
}

/** CSG Union of two SDF distances: min(d1, d2). */
export function csg_op_union(d1: f64, d2: f64): f64 {
  return Math.min(d1, d2);
}

/** CSG Intersection of two SDF distances: max(d1, d2). */
export function csg_op_intersect(d1: f64, d2: f64): f64 {
  return Math.max(d1, d2);
}

/** CSG Difference of two SDF distances: max(d1, -d2). */
export function csg_op_difference(d1: f64, d2: f64): f64 {
  return Math.max(d1, -d2);
}
