// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion */

/**
 * Tensor-aware E-Graph extensions for equality saturation on N-dimensional
 * tensor operations.
 *
 * Extends the scalar E-Graph engine (egraph.ts) with:
 *   - Tensor-specific e-node operators (tmatmul, ttranspose, etc.)
 *   - Algebraic rewrite rules for tensor identities
 *   - FLOP-aware cost function for extraction
 *   - XLA-style kernel fusion pass
 */

import type { EClassId, ENode, RewriteRule } from "./egraph.js";
import { EGraph, rewrite } from "./egraph.js";

// ─────────────────────────────────────────────────────────────────────
// Tensor Rewrite Rules
// ─────────────────────────────────────────────────────────────────────

/** Transpose of transpose is identity: (A^T)^T = A */
const transposeRules: RewriteRule[] = [rewrite("transpose-involution", "(ttranspose (ttranspose ?A))", "?A")];

/** Transpose distributes over matmul: (A × B)^T = B^T × A^T */
const matmulTransposeRules: RewriteRule[] = [
  rewrite("matmul-transpose-dist", "(ttranspose (tmatmul ?A ?B))", "(tmatmul (ttranspose ?B) (ttranspose ?A))"),
];

/** Scalar multiplication hoisting: c*(A × B) = (c*A) × B */
const scalarHoistRules: RewriteRule[] = [
  rewrite("scalar-mul-matmul-hoist-l", "(tmatmul (tscalar_mul ?c ?A) ?B)", "(tscalar_mul ?c (tmatmul ?A ?B))"),
  rewrite("scalar-mul-matmul-hoist-r", "(tmatmul ?A (tscalar_mul ?c ?B))", "(tscalar_mul ?c (tmatmul ?A ?B))"),
];

/** Matmul associativity: A × (B × C) = (A × B) × C */
const matmulAssocRules: RewriteRule[] = [
  rewrite("matmul-assoc-l", "(tmatmul (tmatmul ?A ?B) ?C)", "(tmatmul ?A (tmatmul ?B ?C))"),
  rewrite("matmul-assoc-r", "(tmatmul ?A (tmatmul ?B ?C))", "(tmatmul (tmatmul ?A ?B) ?C)"),
];

/** Tensor addition rules */
const tensorAddRules: RewriteRule[] = [
  rewrite("tadd-comm", "(tadd ?A ?B)", "(tadd ?B ?A)"),
  rewrite("tadd-assoc", "(tadd (tadd ?A ?B) ?C)", "(tadd ?A (tadd ?B ?C))"),
  rewrite("tsub-self", "(tsub ?A ?A)", "tzero"),
];

/** Scalar multiplication algebra */
const scalarAlgebraRules: RewriteRule[] = [
  rewrite("scalar-mul-compose", "(tscalar_mul ?a (tscalar_mul ?b ?A))", "(tscalar_mul (smul ?a ?b) ?A)"),
  rewrite("scalar-mul-one", "(tscalar_mul 1 ?A)", "?A"),
  rewrite("scalar-mul-zero", "(tscalar_mul 0 ?A)", "tzero"),
];

/** Kronecker product rules */
const kroneckerRules: RewriteRule[] = [
  rewrite("kron-transpose", "(ttranspose (tkron ?A ?B))", "(tkron (ttranspose ?A) (ttranspose ?B))"),
];

/** All tensor rewrite rules. */
export const TENSOR_RULES: RewriteRule[] = [
  ...transposeRules,
  ...matmulTransposeRules,
  ...scalarHoistRules,
  ...matmulAssocRules,
  ...tensorAddRules,
  ...scalarAlgebraRules,
  ...kroneckerRules,
];

// ─────────────────────────────────────────────────────────────────────
// FLOP-Aware Cost Function
// ─────────────────────────────────────────────────────────────────────

/** Estimated FLOP counts for tensor operations. */
const TENSOR_OP_COSTS: Record<string, number> = {
  tmatmul: 10, // Cubic cost, heavily penalize
  ttranspose: 1, // Essentially free (just a view)
  tscalar_mul: 2, // Linear cost
  tadd: 2, // Linear cost
  tsub: 2,
  tkron: 15, // Very expensive
  tzero: 0, // Free
};

/**
 * FLOP-aware cost function for tensor E-Graph extraction.
 * Prefers fused forms and transpose-free expressions.
 */
export function tensorNodeCost(node: ENode, childCosts: number[]): number {
  const baseCost = TENSOR_OP_COSTS[node.op] ?? 1;
  const childTotal = childCosts.reduce((a, b) => a + b, 0);
  return baseCost + childTotal;
}

// ─────────────────────────────────────────────────────────────────────
// XLA-Style Kernel Fusion Pass
// ─────────────────────────────────────────────────────────────────────

/** A fused kernel: a sequence of tensor ops that can be emitted as a single loop. */
export interface FusedKernel {
  /** Human-readable name for the fused kernel. */
  name: string;
  /** Ordered list of e-node ops in the fused chain. */
  ops: string[];
  /** Input e-class IDs (external inputs to the fused kernel). */
  inputs: EClassId[];
  /** Output e-class ID. */
  output: EClassId;
}

/** Operations that are fusable (elementwise + reductions). */
const FUSABLE_OPS = new Set([
  "tadd",
  "tsub",
  "tscalar_mul",
  "ttranspose",
  "tsin",
  "tcos",
  "texp",
  "tlog",
  "tsqrt",
  "tneg",
  "tmul_elem",
]);

/**
 * Identify fusable producer-consumer chains in the extracted tensor AST.
 *
 * A chain is fusable if it consists of elementwise ops, scalar multiplications,
 * and transposes that can be collapsed into a single loop nest.
 */
export function identifyFusableChains(egraph: EGraph): FusedKernel[] {
  const kernels: FusedKernel[] = [];
  const visited = new Set<EClassId>();
  let kernelId = 0;

  for (const classId of egraph.classIds()) {
    const canonical = egraph.find(classId);
    if (visited.has(canonical)) continue;

    const nodes = egraph.getNodes(canonical);
    for (const node of nodes) {
      if (!FUSABLE_OPS.has(node.op)) continue;

      // Try to extend the chain through children
      const chain: string[] = [node.op];
      const inputs: EClassId[] = [];
      const chainVisited = new Set<EClassId>([canonical]);

      const stack = [...node.children];
      while (stack.length > 0) {
        const childId = egraph.find(stack.pop()!);
        if (chainVisited.has(childId)) continue;
        chainVisited.add(childId);

        const childNodes = egraph.getNodes(childId);
        let fused = false;
        for (const cn of childNodes) {
          if (FUSABLE_OPS.has(cn.op)) {
            chain.push(cn.op);
            stack.push(...cn.children);
            fused = true;
            break;
          }
        }
        if (!fused) {
          inputs.push(childId);
        }
      }

      if (chain.length >= 2) {
        kernels.push({
          name: `fused_kernel_${kernelId++}`,
          ops: chain,
          inputs,
          output: canonical,
        });
        for (const id of chainVisited) visited.add(id);
      }
    }
  }

  return kernels;
}

/**
 * Emit C code for a fused kernel.
 * The fused kernel computes the entire chain in a single loop
 * without intermediate heap allocations.
 */
export function emitFusedKernelC(kernel: FusedKernel, _size: number): string[] {
  const lines: string[] = [];
  lines.push(`/* ${kernel.name}: fused ${kernel.ops.join(" → ")} */`);
  lines.push(`static void ${kernel.name}(`);

  // Input/output parameters
  for (let i = 0; i < kernel.inputs.length; i++) {
    lines.push(`    const double* restrict in${i},`);
  }
  lines.push(`    double* restrict out,`);
  lines.push(`    int n) {`);

  // Single fused loop
  lines.push(`  for (int i = 0; i < n; i++) {`);

  // Generate the chain computation inline
  let regIdx = 0;
  const regNames: string[] = [];
  for (let i = 0; i < kernel.ops.length; i++) {
    const op = kernel.ops[i]!;
    const reg = `r${regIdx++}`;
    regNames.push(reg);

    switch (op) {
      case "tadd":
        lines.push(`    double ${reg} = ${regNames[i - 2] ?? `in0[i]`} + ${regNames[i - 1] ?? `in1[i]`};`);
        break;
      case "tsub":
        lines.push(`    double ${reg} = ${regNames[i - 2] ?? `in0[i]`} - ${regNames[i - 1] ?? `in1[i]`};`);
        break;
      case "tscalar_mul":
        lines.push(
          `    double ${reg} = ${regNames[i - 1] ?? `in0[i]`} * in${Math.min(i, kernel.inputs.length - 1)}[0];`,
        );
        break;
      case "tneg":
        lines.push(`    double ${reg} = -${regNames[i - 1] ?? `in0[i]`};`);
        break;
      case "tsin":
        lines.push(`    double ${reg} = sin(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "tcos":
        lines.push(`    double ${reg} = cos(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "texp":
        lines.push(`    double ${reg} = exp(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "tlog":
        lines.push(`    double ${reg} = log(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "tsqrt":
        lines.push(`    double ${reg} = sqrt(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      default:
        lines.push(`    double ${reg} = in0[i]; /* fallback: ${op} */`);
    }
  }

  // Write the final result
  const lastReg = regNames[regNames.length - 1] ?? "0.0";
  lines.push(`    out[i] = ${lastReg};`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines;
}

/**
 * High-level API: simplify a tensor expression using equality saturation
 * with tensor-specific rewrite rules.
 */
export function tensorEgraphSimplify(egraph: EGraph, rootId: EClassId, maxIterations = 20): EClassId {
  egraph.saturate(TENSOR_RULES, maxIterations);
  return egraph.find(rootId);
}
