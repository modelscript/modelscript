// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tape-based computation graph for reverse-mode automatic differentiation.
 *
 * During the forward pass, each operation is recorded as a TapeNode with
 * pointers to parent nodes and local partial derivatives. The backward pass
 * traverses the tape in reverse order, accumulating adjoints (∂output/∂node)
 * via the chain rule.
 *
 * Usage:
 *   const tape = new Tape();
 *   const x = tape.variable(3.0);
 *   const y = tape.variable(2.0);
 *   const z = tape.add(tape.mul(x, x), y);  // z = x² + y
 *   tape.backward(z);
 *   // x.adjoint === 6  (∂z/∂x = 2x = 6)
 *   // y.adjoint === 1  (∂z/∂y = 1)
 */

/** A node in the computation tape (Wengert list). */
export class TapeNode {
  /** Value computed during forward pass. */
  val: number;
  /** Adjoint (∂output/∂this) accumulated during backward pass. */
  adjoint = 0;
  /** Parent nodes and local partial derivatives for backpropagation. */
  parents: { node: TapeNode; localGrad: number }[];

  constructor(val: number, parents?: { node: TapeNode; localGrad: number }[]) {
    this.val = val;
    this.parents = parents ?? [];
  }
}

/** Computation tape that records operations for reverse-mode AD. */
export class Tape {
  nodes: TapeNode[] = [];

  /** Create a tracked variable (leaf node). */
  variable(val: number): TapeNode {
    const node = new TapeNode(val);
    this.nodes.push(node);
    return node;
  }

  /** Create a constant (tracked but has no parents to backprop through). */
  constant(val: number): TapeNode {
    const node = new TapeNode(val);
    this.nodes.push(node);
    return node;
  }

  // ── Arithmetic ──

  add(a: TapeNode, b: TapeNode): TapeNode {
    const node = new TapeNode(a.val + b.val, [
      { node: a, localGrad: 1 },
      { node: b, localGrad: 1 },
    ]);
    this.nodes.push(node);
    return node;
  }

  sub(a: TapeNode, b: TapeNode): TapeNode {
    const node = new TapeNode(a.val - b.val, [
      { node: a, localGrad: 1 },
      { node: b, localGrad: -1 },
    ]);
    this.nodes.push(node);
    return node;
  }

  mul(a: TapeNode, b: TapeNode): TapeNode {
    const node = new TapeNode(a.val * b.val, [
      { node: a, localGrad: b.val },
      { node: b, localGrad: a.val },
    ]);
    this.nodes.push(node);
    return node;
  }

  div(a: TapeNode, b: TapeNode): TapeNode {
    const node = new TapeNode(a.val / b.val, [
      { node: a, localGrad: 1 / b.val },
      { node: b, localGrad: -a.val / (b.val * b.val) },
    ]);
    this.nodes.push(node);
    return node;
  }

  pow(a: TapeNode, b: TapeNode): TapeNode {
    const v = a.val ** b.val;
    const parents: { node: TapeNode; localGrad: number }[] = [];
    // ∂(a^b)/∂a = b·a^(b-1)
    if (a.val !== 0) {
      parents.push({ node: a, localGrad: b.val * a.val ** (b.val - 1) });
    } else {
      parents.push({ node: a, localGrad: 0 });
    }
    // ∂(a^b)/∂b = a^b·ln(a)
    if (a.val > 0) {
      parents.push({ node: b, localGrad: v * Math.log(a.val) });
    } else {
      parents.push({ node: b, localGrad: 0 });
    }
    const node = new TapeNode(v, parents);
    this.nodes.push(node);
    return node;
  }

  neg(a: TapeNode): TapeNode {
    const node = new TapeNode(-a.val, [{ node: a, localGrad: -1 }]);
    this.nodes.push(node);
    return node;
  }

  // ── Trigonometric ──

  sin(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.sin(a.val), [{ node: a, localGrad: Math.cos(a.val) }]);
    this.nodes.push(node);
    return node;
  }

  cos(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.cos(a.val), [{ node: a, localGrad: -Math.sin(a.val) }]);
    this.nodes.push(node);
    return node;
  }

  tan(a: TapeNode): TapeNode {
    const t = Math.tan(a.val);
    const node = new TapeNode(t, [{ node: a, localGrad: 1 + t * t }]);
    this.nodes.push(node);
    return node;
  }

  asin(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.asin(a.val), [{ node: a, localGrad: 1 / Math.sqrt(1 - a.val * a.val) }]);
    this.nodes.push(node);
    return node;
  }

  acos(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.acos(a.val), [{ node: a, localGrad: -1 / Math.sqrt(1 - a.val * a.val) }]);
    this.nodes.push(node);
    return node;
  }

  atan(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.atan(a.val), [{ node: a, localGrad: 1 / (1 + a.val * a.val) }]);
    this.nodes.push(node);
    return node;
  }

  atan2(a: TapeNode, b: TapeNode): TapeNode {
    const denom = a.val * a.val + b.val * b.val;
    const node = new TapeNode(Math.atan2(a.val, b.val), [
      { node: a, localGrad: b.val / denom },
      { node: b, localGrad: -a.val / denom },
    ]);
    this.nodes.push(node);
    return node;
  }

  // ── Hyperbolic ──

  sinh(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.sinh(a.val), [{ node: a, localGrad: Math.cosh(a.val) }]);
    this.nodes.push(node);
    return node;
  }

  cosh(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.cosh(a.val), [{ node: a, localGrad: Math.sinh(a.val) }]);
    this.nodes.push(node);
    return node;
  }

  tanh(a: TapeNode): TapeNode {
    const t = Math.tanh(a.val);
    const node = new TapeNode(t, [{ node: a, localGrad: 1 - t * t }]);
    this.nodes.push(node);
    return node;
  }

  // ── Exponential / logarithmic ──

  exp(a: TapeNode): TapeNode {
    const e = Math.exp(a.val);
    const node = new TapeNode(e, [{ node: a, localGrad: e }]);
    this.nodes.push(node);
    return node;
  }

  log(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.log(a.val), [{ node: a, localGrad: 1 / a.val }]);
    this.nodes.push(node);
    return node;
  }

  log10(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.log10(a.val), [{ node: a, localGrad: 1 / (a.val * Math.LN10) }]);
    this.nodes.push(node);
    return node;
  }

  sqrt(a: TapeNode): TapeNode {
    const s = Math.sqrt(a.val);
    const node = new TapeNode(s, [{ node: a, localGrad: 1 / (2 * s) }]);
    this.nodes.push(node);
    return node;
  }

  // ── Piecewise / non-smooth ──

  abs(a: TapeNode): TapeNode {
    const s = a.val > 0 ? 1 : a.val < 0 ? -1 : 0;
    const node = new TapeNode(Math.abs(a.val), [{ node: a, localGrad: s }]);
    this.nodes.push(node);
    return node;
  }

  sign(a: TapeNode): TapeNode {
    // Piecewise constant → gradient 0
    const node = new TapeNode(Math.sign(a.val), [{ node: a, localGrad: 0 }]);
    this.nodes.push(node);
    return node;
  }

  ceil(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.ceil(a.val), [{ node: a, localGrad: 0 }]);
    this.nodes.push(node);
    return node;
  }

  floor(a: TapeNode): TapeNode {
    const node = new TapeNode(Math.floor(a.val), [{ node: a, localGrad: 0 }]);
    this.nodes.push(node);
    return node;
  }

  // ── Two-argument min/max ──

  max(a: TapeNode, b: TapeNode): TapeNode {
    if (a.val >= b.val) {
      const node = new TapeNode(a.val, [
        { node: a, localGrad: 1 },
        { node: b, localGrad: 0 },
      ]);
      this.nodes.push(node);
      return node;
    }
    const node = new TapeNode(b.val, [
      { node: a, localGrad: 0 },
      { node: b, localGrad: 1 },
    ]);
    this.nodes.push(node);
    return node;
  }

  min(a: TapeNode, b: TapeNode): TapeNode {
    if (a.val <= b.val) {
      const node = new TapeNode(a.val, [
        { node: a, localGrad: 1 },
        { node: b, localGrad: 0 },
      ]);
      this.nodes.push(node);
      return node;
    }
    const node = new TapeNode(b.val, [
      { node: a, localGrad: 0 },
      { node: b, localGrad: 1 },
    ]);
    this.nodes.push(node);
    return node;
  }

  // ── Mod / rem / div ──

  mod(a: TapeNode, b: TapeNode): TapeNode {
    const v = a.val - Math.floor(a.val / b.val) * b.val;
    const node = new TapeNode(v, [
      { node: a, localGrad: 1 },
      { node: b, localGrad: 0 },
    ]);
    this.nodes.push(node);
    return node;
  }

  rem(a: TapeNode, b: TapeNode): TapeNode {
    const v = a.val - Math.trunc(a.val / b.val) * b.val;
    const node = new TapeNode(v, [
      { node: a, localGrad: 1 },
      { node: b, localGrad: 0 },
    ]);
    this.nodes.push(node);
    return node;
  }

  trunc(a: TapeNode, b: TapeNode): TapeNode {
    const node = new TapeNode(Math.trunc(a.val / b.val), [
      { node: a, localGrad: 0 },
      { node: b, localGrad: 0 },
    ]);
    this.nodes.push(node);
    return node;
  }

  // ── Backward pass ──

  /**
   * Run reverse-mode backward pass: seeds output adjoint to 1,
   * then propagates through the tape in reverse topological order.
   *
   * After calling this, each TapeNode's `.adjoint` field holds ∂output/∂node.
   */
  backward(output: TapeNode): void {
    // Reset all adjoints
    for (const node of this.nodes) node.adjoint = 0;
    // Seed the output
    output.adjoint = 1;
    // Walk tape in reverse order (guaranteed reverse topological order
    // since nodes are appended in forward evaluation order)
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      if (node.adjoint === 0) continue; // Skip nodes with no contribution
      for (const parent of node.parents) {
        parent.node.adjoint += node.adjoint * parent.localGrad;
      }
    }
  }

  /** Clear the tape for reuse. */
  clear(): void {
    this.nodes.length = 0;
  }
}
