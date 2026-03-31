// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-non-null-assertion, @typescript-eslint/prefer-for-of */
// @ts-nocheck — Performance-critical numeric code; noUncheckedIndexedAccess generates false positives on typed array compound assignments

/**
 * N-Dimensional Tensor Expression Graph for Automatic Differentiation.
 *
 * While the scalar `Tape` (tape.ts) tracks individual numbers through a Wengert list,
 * this module operates on dense/sparse N-dimensional tensors as first-class objects.
 * Each `TensorNode` carries a `Float64Array` of values with an associated
 * `TensorShape`, and the backward pass propagates block-level adjoints using
 * matrix/tensor identities rather than scalar chain-rule products.
 *
 * This bridges Modelica's native N-dimensional array mathematics directly to
 * optimal control memory models without scalar unrolling.
 *
 * Key concepts:
 *   - `TensorShape`:     dimension vector, e.g. [3,3] for a 3×3 matrix
 *   - `SparsityPattern`: bitset tracking structural non-zeros per tensor
 *   - `TensorNode`:      node in the computation graph carrying shape + values
 *   - `TensorTape`:      the computation graph with block-level AD operations
 */

// ─────────────────────────────────────────────────────────────────────
// Shape utilities
// ─────────────────────────────────────────────────────────────────────

/** Dimension vector for an N-dimensional tensor. */
export type TensorShape = readonly number[];

/** Total number of elements in a tensor of the given shape. */
export function shapeSize(shape: TensorShape): number {
  let n = 1;
  for (const d of shape) n *= d;
  return n;
}

/** Check if two shapes are element-wise equal. */
export function shapesEqual(a: TensorShape, b: TensorShape): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compute the broadcast shape of two tensors following NumPy-style rules.
 * Returns null if the shapes are not broadcast-compatible.
 */
export function broadcastShape(a: TensorShape, b: TensorShape): TensorShape | null {
  const rank = Math.max(a.length, b.length);
  const result: number[] = new Array(rank);
  for (let i = 0; i < rank; i++) {
    const da = a[a.length - 1 - i] ?? 1;
    const db = b[b.length - 1 - i] ?? 1;
    if (da === db) {
      result[rank - 1 - i] = da;
    } else if (da === 1) {
      result[rank - 1 - i] = db;
    } else if (db === 1) {
      result[rank - 1 - i] = da;
    } else {
      return null; // Incompatible
    }
  }
  return result;
}

/**
 * Compute the shape of matmul(A, B).
 * A: [..., M, K], B: [..., K, N] → [..., M, N]
 * Returns null if inner dimensions don't match.
 */
export function matmulShape(a: TensorShape, b: TensorShape): TensorShape | null {
  if (a.length < 2 || b.length < 2) return null;
  const M = a[a.length - 2]!;
  const K1 = a[a.length - 1]!;
  const K2 = b[b.length - 2]!;
  const N = b[b.length - 1]!;
  if (K1 !== K2) return null;

  // Broadcast batch dimensions
  const batchA = a.slice(0, a.length - 2);
  const batchB = b.slice(0, b.length - 2);
  const batchOut = broadcastShape(batchA, batchB);
  if (!batchOut) return null;
  return [...batchOut, M, N];
}

// ─────────────────────────────────────────────────────────────────────
// Sparsity Pattern
// ─────────────────────────────────────────────────────────────────────

/**
 * Tracks structural non-zeros in a flattened tensor.
 * Uses a dense boolean array (memory-efficient for typical Modelica models
 * with dimensions < 10,000 elements).
 */
export class SparsityPattern {
  /** True at index i if element i is structurally non-zero. */
  readonly nonzero: Uint8Array;
  readonly shape: TensorShape;

  constructor(shape: TensorShape, nonzero?: Uint8Array) {
    this.shape = shape;
    const size = shapeSize(shape);
    if (nonzero) {
      this.nonzero = nonzero;
    } else {
      // Default: all elements are structurally non-zero (dense)
      this.nonzero = new Uint8Array(size).fill(1);
    }
  }

  /** Number of structural non-zeros. */
  get nnz(): number {
    let count = 0;
    for (let i = 0; i < this.nonzero.length; i++) {
      if (this.nonzero[i]) count++;
    }
    return count;
  }

  /** Create a fully dense pattern. */
  static dense(shape: TensorShape): SparsityPattern {
    return new SparsityPattern(shape);
  }

  /** Create a fully zero (empty) pattern. */
  static zero(shape: TensorShape): SparsityPattern {
    return new SparsityPattern(shape, new Uint8Array(shapeSize(shape)));
  }

  /** Create an identity-like pattern for a square 2D tensor. */
  static identity(n: number): SparsityPattern {
    const nz = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) nz[i * n + i] = 1;
    return new SparsityPattern([n, n], nz);
  }

  /** Element-wise OR of two patterns (union of non-zero entries). */
  static union(a: SparsityPattern, b: SparsityPattern): SparsityPattern {
    const size = Math.max(a.nonzero.length, b.nonzero.length);
    const nz = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      nz[i] = a.nonzero[i] || b.nonzero[i] ? 1 : 0;
    }
    // Use the larger shape (assumes broadcastShape compatibility)
    const shape = a.nonzero.length >= b.nonzero.length ? a.shape : b.shape;
    return new SparsityPattern(shape, nz);
  }

  /**
   * Compute the sparsity pattern of matmul(A, B) for 2D patterns.
   * C[i,j] is non-zero iff there exists k such that A[i,k] and B[k,j] are both non-zero.
   */
  static matmul(a: SparsityPattern, b: SparsityPattern): SparsityPattern {
    if (a.shape.length !== 2 || b.shape.length !== 2) {
      // Fallback: dense for higher-dimensional cases
      const outShape = matmulShape(a.shape, b.shape);
      return outShape ? SparsityPattern.dense(outShape) : SparsityPattern.dense([1]);
    }

    const M = a.shape[0]!;
    const K = a.shape[1]!;
    const N = b.shape[1]!;
    const nz = new Uint8Array(M * N);

    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < K; k++) {
          if (a.nonzero[i * K + k] && b.nonzero[k * N + j]) {
            nz[i * N + j] = 1;
            break; // Found a non-zero contributor, no need to check further
          }
        }
      }
    }

    return new SparsityPattern([M, N], nz);
  }

  /** Transpose sparsity for a 2D pattern. */
  static transpose2D(pat: SparsityPattern): SparsityPattern {
    if (pat.shape.length !== 2) return pat;
    const M = pat.shape[0]!;
    const N = pat.shape[1]!;
    const nz = new Uint8Array(N * M);
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        nz[j * M + i] = pat.nonzero[i * N + j]!;
      }
    }
    return new SparsityPattern([N, M], nz);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tensor Node
// ─────────────────────────────────────────────────────────────────────

/** Operation types for the tensor tape. */
export type TensorOpType =
  | "variable"
  | "constant"
  | "add"
  | "sub"
  | "mul_elementwise"
  | "neg"
  | "matmul"
  | "transpose"
  | "scalar_mul"
  | "sum"
  | "slice"
  | "reshape"
  | "broadcast"
  | "sin"
  | "cos"
  | "exp"
  | "log"
  | "sqrt"
  | "pow_scalar";

/**
 * A node in the tensor computation graph.
 *
 * Analogous to `TapeNode` in tape.ts, but each node carries:
 *   - An N-dimensional value tensor (Float64Array with a TensorShape)
 *   - An N-dimensional adjoint tensor (accumulated during backward pass)
 *   - Optional sparsity pattern metadata
 */
export class TensorNode {
  /** Forward-pass values, stored flat in row-major order. */
  values: Float64Array;
  /** Shape of the tensor. */
  shape: TensorShape;
  /** Adjoint tensor (∂output/∂this), accumulated during backward pass. */
  adjoint: Float64Array;
  /** Operation that produced this node. */
  op: TensorOpType;
  /** Parent nodes in the computation graph. */
  parents: TensorNode[];
  /** Optional scalar exponent for pow_scalar op. */
  exponent?: number;
  /** Optional axis for sum/slice ops. */
  axis?: number;
  /** Optional name for variable nodes. */
  name?: string;
  /** Structural sparsity pattern. */
  sparsity: SparsityPattern;

  constructor(values: Float64Array, shape: TensorShape, op: TensorOpType, parents: TensorNode[] = []) {
    this.values = values;
    this.shape = shape;
    this.adjoint = new Float64Array(values.length);
    this.op = op;
    this.parents = parents;
    this.sparsity = SparsityPattern.dense(shape);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tensor Tape
// ─────────────────────────────────────────────────────────────────────

/**
 * Computation graph for N-dimensional tensor operations with block-level
 * reverse-mode automatic differentiation.
 *
 * Usage:
 *   const tape = new TensorTape();
 *   const A = tape.variable("A", [2, 3], new Float64Array([1,2,3,4,5,6]));
 *   const B = tape.variable("B", [3, 2], new Float64Array([7,8,9,10,11,12]));
 *   const C = tape.matmul(A, B);     // C: [2, 2]
 *   const loss = tape.sum(C);        // scalar
 *   tape.backward(loss);
 *   // A.adjoint holds ∂loss/∂A, B.adjoint holds ∂loss/∂B
 */
export class TensorTape {
  nodes: TensorNode[] = [];

  // ── Leaf nodes ──

  /** Create a tracked variable (leaf node). */
  variable(name: string, shape: TensorShape, values: Float64Array): TensorNode {
    const node = new TensorNode(values, shape, "variable");
    node.name = name;
    this.nodes.push(node);
    return node;
  }

  /** Create a constant tensor. */
  constant(shape: TensorShape, values: Float64Array): TensorNode {
    const node = new TensorNode(values, shape, "constant");
    this.nodes.push(node);
    return node;
  }

  /** Create a scalar constant. */
  scalar(val: number): TensorNode {
    return this.constant([1], new Float64Array([val]));
  }

  /** Create a zero tensor of the given shape. */
  zeros(shape: TensorShape): TensorNode {
    return this.constant(shape, new Float64Array(shapeSize(shape)));
  }

  /** Create a ones tensor of the given shape. */
  ones(shape: TensorShape): TensorNode {
    const vals = new Float64Array(shapeSize(shape)).fill(1);
    return this.constant(shape, vals);
  }

  /** Create an identity matrix. */
  eye(n: number): TensorNode {
    const vals = new Float64Array(n * n);
    for (let i = 0; i < n; i++) vals[i * n + i] = 1;
    const node = this.constant([n, n], vals);
    node.sparsity = SparsityPattern.identity(n);
    return node;
  }

  // ── Elementwise binary ops ──

  add(a: TensorNode, b: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = a.values[i]! + b.values[i]!;
    const node = new TensorNode(out, a.shape, "add", [a, b]);
    node.sparsity = SparsityPattern.union(a.sparsity, b.sparsity);
    this.nodes.push(node);
    return node;
  }

  sub(a: TensorNode, b: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = a.values[i]! - b.values[i]!;
    const node = new TensorNode(out, a.shape, "sub", [a, b]);
    node.sparsity = SparsityPattern.union(a.sparsity, b.sparsity);
    this.nodes.push(node);
    return node;
  }

  /** Hadamard (element-wise) product. */
  mulElementwise(a: TensorNode, b: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = a.values[i]! * b.values[i]!;
    const node = new TensorNode(out, a.shape, "mul_elementwise", [a, b]);
    // Intersection pattern: both must be non-zero
    const nz = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      nz[i] = a.sparsity.nonzero[i] && b.sparsity.nonzero[i] ? 1 : 0;
    }
    node.sparsity = new SparsityPattern(a.shape, nz);
    this.nodes.push(node);
    return node;
  }

  neg(a: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = -a.values[i]!;
    const node = new TensorNode(out, a.shape, "neg", [a]);
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  // ── Matrix operations ──

  /** Matrix multiplication. A: [..., M, K], B: [..., K, N] → [..., M, N]. */
  matmul(a: TensorNode, b: TensorNode): TensorNode {
    const outShape = matmulShape(a.shape, b.shape);
    if (!outShape) throw new Error(`Incompatible shapes for matmul: [${a.shape}] × [${b.shape}]`);

    const M = a.shape[a.shape.length - 2]!;
    const K = a.shape[a.shape.length - 1]!;
    const N = b.shape[b.shape.length - 1]!;
    const size = shapeSize(outShape);
    const out = new Float64Array(size);

    // Batch-unaware 2D matmul for now (batch dims broadcast trivially for rank-2)
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < K; k++) {
          sum += a.values[i * K + k]! * b.values[k * N + j]!;
        }
        out[i * N + j] = sum;
      }
    }

    const node = new TensorNode(out, outShape, "matmul", [a, b]);
    node.sparsity = SparsityPattern.matmul(a.sparsity, b.sparsity);
    this.nodes.push(node);
    return node;
  }

  /** Transpose last two dimensions. */
  transpose(a: TensorNode): TensorNode {
    if (a.shape.length < 2) {
      // Scalar or 1D: transpose is identity
      const node = new TensorNode(new Float64Array(a.values), a.shape, "transpose", [a]);
      node.sparsity = a.sparsity;
      this.nodes.push(node);
      return node;
    }

    const M = a.shape[a.shape.length - 2]!;
    const N = a.shape[a.shape.length - 1]!;
    const outShape = [...a.shape.slice(0, -2), N, M];
    const out = new Float64Array(a.values.length);

    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        out[j * M + i] = a.values[i * N + j]!;
      }
    }

    const node = new TensorNode(out, outShape, "transpose", [a]);
    node.sparsity = SparsityPattern.transpose2D(a.sparsity);
    this.nodes.push(node);
    return node;
  }

  /** Multiply every element by a scalar. */
  scalarMul(a: TensorNode, scalar: TensorNode): TensorNode {
    const s = scalar.values[0]!;
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = a.values[i]! * s;
    const node = new TensorNode(out, a.shape, "scalar_mul", [a, scalar]);
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  // ── Reductions ──

  /** Sum all elements to a scalar. */
  sum(a: TensorNode): TensorNode {
    let s = 0;
    for (let i = 0; i < a.values.length; i++) s += a.values[i]!;
    const node = new TensorNode(new Float64Array([s]), [1], "sum", [a]);
    this.nodes.push(node);
    return node;
  }

  // ── Elementwise nonlinear ops ──

  sin(a: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = Math.sin(a.values[i]!);
    const node = new TensorNode(out, a.shape, "sin", [a]);
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  cos(a: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = Math.cos(a.values[i]!);
    const node = new TensorNode(out, a.shape, "cos", [a]);
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  exp(a: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = Math.exp(a.values[i]!);
    const node = new TensorNode(out, a.shape, "exp", [a]);
    // exp(0) = 1 ≠ 0, so sparsity becomes dense
    node.sparsity = SparsityPattern.dense(a.shape);
    this.nodes.push(node);
    return node;
  }

  log(a: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = Math.log(a.values[i]!);
    const node = new TensorNode(out, a.shape, "log", [a]);
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  sqrt(a: TensorNode): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = Math.sqrt(a.values[i]!);
    const node = new TensorNode(out, a.shape, "sqrt", [a]);
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  /** Element-wise power by a scalar exponent. */
  powScalar(a: TensorNode, exponent: number): TensorNode {
    const size = a.values.length;
    const out = new Float64Array(size);
    for (let i = 0; i < size; i++) out[i] = a.values[i]! ** exponent;
    const node = new TensorNode(out, a.shape, "pow_scalar", [a]);
    node.exponent = exponent;
    node.sparsity = a.sparsity;
    this.nodes.push(node);
    return node;
  }

  // ── Backward pass ──

  /**
   * Run reverse-mode backward pass through the tensor computation graph.
   *
   * Seeds the output node's adjoint to all-ones (for scalar outputs) or
   * a provided seed tensor, then propagates block-level adjoints in reverse
   * topological order.
   *
   * After calling this, each TensorNode's `.adjoint` field holds ∂output/∂node.
   */
  backward(output: TensorNode, seed?: Float64Array): void {
    // Reset all adjoints
    for (const node of this.nodes) {
      node.adjoint.fill(0);
    }

    // Seed the output
    if (seed) {
      output.adjoint.set(seed);
    } else {
      output.adjoint.fill(1);
    }

    // Walk tape in reverse order (guaranteed reverse topological order)
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i]!;

      // Skip nodes with zero adjoint
      let hasNonZero = false;
      for (let j = 0; j < node.adjoint.length; j++) {
        if (node.adjoint[j] !== 0) {
          hasNonZero = true;
          break;
        }
      }
      if (!hasNonZero) continue;

      switch (node.op) {
        case "variable":
        case "constant":
          // Leaf nodes: adjoint accumulation stops here
          break;

        case "add": {
          // ∂L/∂a += ∂L/∂out, ∂L/∂b += ∂L/∂out
          const a = node.parents[0]!,
            b = node.parents[1]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]!;
            b.adjoint[j] += node.adjoint[j]!;
          }
          break;
        }

        case "sub": {
          const a = node.parents[0]!,
            b = node.parents[1]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]!;
            b.adjoint[j] -= node.adjoint[j]!;
          }
          break;
        }

        case "mul_elementwise": {
          // ∂L/∂a_i += ∂L/∂out_i × b_i
          const a = node.parents[0]!,
            b = node.parents[1]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]! * b.values[j]!;
            b.adjoint[j] += node.adjoint[j]! * a.values[j]!;
          }
          break;
        }

        case "neg": {
          const a = node.parents[0]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] -= node.adjoint[j]!;
          }
          break;
        }

        case "matmul": {
          // C = A @ B where A: [M,K], B: [K,N], C: [M,N]
          // ∂L/∂A += ∂L/∂C @ B^T
          // ∂L/∂B += A^T @ ∂L/∂C
          const a = node.parents[0]!,
            b = node.parents[1]!;
          const M = a.shape[a.shape.length - 2]!;
          const K = a.shape[a.shape.length - 1]!;
          const N = b.shape[b.shape.length - 1]!;

          // ∂L/∂A += dC @ B^T   (MxN × NxK = MxK)
          for (let ii = 0; ii < M; ii++) {
            for (let kk = 0; kk < K; kk++) {
              let sum = 0;
              for (let jj = 0; jj < N; jj++) {
                sum += node.adjoint[ii * N + jj]! * b.values[kk * N + jj]!;
              }
              a.adjoint[ii * K + kk] += sum;
            }
          }

          // ∂L/∂B += A^T @ dC   (KxM × MxN = KxN)
          for (let kk = 0; kk < K; kk++) {
            for (let jj = 0; jj < N; jj++) {
              let sum = 0;
              for (let ii = 0; ii < M; ii++) {
                sum += a.values[ii * K + kk]! * node.adjoint[ii * N + jj]!;
              }
              b.adjoint[kk * N + jj] += sum;
            }
          }
          break;
        }

        case "transpose": {
          // ∂L/∂A = transpose(∂L/∂C)
          const a = node.parents[0]!;
          if (a.shape.length >= 2) {
            const M = a.shape[a.shape.length - 2]!;
            const N = a.shape[a.shape.length - 1]!;
            for (let ii = 0; ii < M; ii++) {
              for (let jj = 0; jj < N; jj++) {
                a.adjoint[ii * N + jj] += node.adjoint[jj * M + ii]!;
              }
            }
          } else {
            // 1D or scalar: identity
            for (let j = 0; j < node.adjoint.length; j++) {
              a.adjoint[j] += node.adjoint[j]!;
            }
          }
          break;
        }

        case "scalar_mul": {
          // C = s * A
          // ∂L/∂A_i += s * ∂L/∂C_i
          // ∂L/∂s += sum(A_i * ∂L/∂C_i)
          const a = node.parents[0]!,
            scalar = node.parents[1]!;
          const s = scalar.values[0]!;
          let gradS = 0;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += s * node.adjoint[j]!;
            gradS += a.values[j]! * node.adjoint[j]!;
          }
          scalar.adjoint[0] += gradS;
          break;
        }

        case "sum": {
          // ∂L/∂A_i += ∂L/∂sum (broadcast scalar to all elements)
          const a = node.parents[0]!;
          const dSum = node.adjoint[0]!;
          for (let j = 0; j < a.adjoint.length; j++) {
            a.adjoint[j] += dSum;
          }
          break;
        }

        case "sin": {
          // ∂L/∂a_i += ∂L/∂out_i * cos(a_i)
          const a = node.parents[0]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]! * Math.cos(a.values[j]!);
          }
          break;
        }

        case "cos": {
          const a = node.parents[0]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] -= node.adjoint[j]! * Math.sin(a.values[j]!);
          }
          break;
        }

        case "exp": {
          const a = node.parents[0]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]! * node.values[j]!;
          }
          break;
        }

        case "log": {
          const a = node.parents[0]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]! / a.values[j]!;
          }
          break;
        }

        case "sqrt": {
          const a = node.parents[0]!;
          for (let j = 0; j < node.adjoint.length; j++) {
            a.adjoint[j] += node.adjoint[j]! / (2 * node.values[j]!);
          }
          break;
        }

        case "pow_scalar": {
          // y_i = a_i^p → ∂L/∂a_i += ∂L/∂y_i * p * a_i^(p-1)
          const a = node.parents[0]!;
          if (node.exponent !== undefined) {
            const p = node.exponent;
            for (let j = 0; j < node.adjoint.length; j++) {
              a.adjoint[j] += node.adjoint[j]! * p * a.values[j]! ** (p - 1);
            }
          }
          break;
        }
      }
    }
  }

  /** Clear the tape for reuse. */
  clear(): void {
    this.nodes.length = 0;
  }

  /**
   * Compute the Jacobian matrix of a vector-valued output w.r.t. a vector-valued input.
   * Returns a dense M×N matrix where M = output size, N = input size.
   *
   * Uses N backward passes (one per output element), exploiting the block structure
   * where possible.
   */
  jacobian(output: TensorNode, input: TensorNode): Float64Array {
    const M = output.values.length;
    const N = input.values.length;
    const jac = new Float64Array(M * N);

    for (let i = 0; i < M; i++) {
      // Seed: one-hot in output dimension i
      const seed = new Float64Array(M);
      seed[i] = 1;
      this.backward(output, seed);
      // Extract row i of the Jacobian from input's adjoint
      for (let j = 0; j < N; j++) {
        jac[i * N + j] = input.adjoint[j]!;
      }
    }

    return jac;
  }
}
