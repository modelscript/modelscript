// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Symbolic 1D PDE Method-of-Lines (MOL) Lowering to DAEBuilder.
 *
 * Mirrors `MethodOfLines.jl`: automatically discretizes 1D Advection-Diffusion-Reaction PDEs
 *   ∂u/∂t = D * ∂²u/∂x² - v * ∂u/∂x + k * u
 * with Dirichlet, Neumann, or Periodic boundary conditions into a sparse `DAEBuilder` ODE system
 * ready for `ROCK2`, `Rodas5P`, or `Tsit5`.
 */

import { BinOp, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";

export type BoundaryCondition1D =
  { kind: "dirichlet"; value: number } | { kind: "neumann"; flux: number } | { kind: "periodic" };

export interface Pde1DMolSpec {
  /** Field variable prefix (default: "u"). */
  varPrefix?: string | undefined;
  /** Spatial domain `[xMin, xMax]`. */
  domain: [number, number];
  /** Number of spatial grid points `N` (>= 3). */
  numPoints: number;
  /** Diffusion coefficient `D >= 0`. */
  diffusion: number;
  /** Advection velocity `v` (upwind-differenced for stability). */
  advection?: number | undefined;
  /** Linear reaction rate `k` (`+ k * u`). */
  reaction?: number | undefined;
  /** Left boundary condition at `xMin`. */
  leftBc: BoundaryCondition1D;
  /** Right boundary condition at `xMax`. */
  rightBc: BoundaryCondition1D;
  /** Initial profile `u(x, 0)`. */
  initialProfile: (x: number) => number;
}

export interface LoweredPde1DMol {
  dae: DAEBuilder;
  gridX: number[];
  varNames: string[];
  dx: number;
}

/**
 * Lowers a 1D Advection-Diffusion-Reaction PDE into a `DAEBuilder` ODE system via
 * 2nd-order central diffusion + upwind advection Method of Lines.
 */
export function lowerPde1DMolToDae(spec: Pde1DMolSpec): LoweredPde1DMol {
  const N = Math.max(3, spec.numPoints);
  const [xMin, xMax] = spec.domain;
  const dx = (xMax - xMin) / (N - 1);
  const prefix = spec.varPrefix ?? "u";
  const D = spec.diffusion;
  const v = spec.advection ?? 0;
  const k = spec.reaction ?? 0;

  const dae = new DAEBuilder();
  const gridX: number[] = [];
  const varNames: string[] = [];
  const nameExprs: number[] = [];

  for (let i = 0; i < N; i++) {
    const x = xMin + i * dx;
    gridX.push(x);
    const name = `${prefix}_${i}`;
    varNames.push(name);
    const u0 = spec.initialProfile(x);
    const idx = dae.addVariable(name, VarType.Real, Variability.Continuous, 0, u0);
    dae.setVarStartValue(idx, u0);
    nameExprs.push(dae.addNameExpr(name));
  }

  const invDx2 = D / (dx * dx);
  const invDx = v / dx;

  const buildStencilRhs = (i: number): number => {
    const ui = nameExprs[i]!;
    const uLeft =
      i > 0
        ? nameExprs[i - 1]!
        : spec.leftBc.kind === "periodic"
          ? nameExprs[N - 2]!
          : spec.leftBc.kind === "neumann"
            ? dae.addBinaryExpr(BinOp.Sub, nameExprs[1]!, dae.addRealLiteral(2 * dx * spec.leftBc.flux))
            : dae.addRealLiteral(spec.leftBc.value);

    const uRight =
      i < N - 1
        ? nameExprs[i + 1]!
        : spec.rightBc.kind === "periodic"
          ? nameExprs[1]!
          : spec.rightBc.kind === "neumann"
            ? dae.addBinaryExpr(BinOp.Add, nameExprs[N - 2]!, dae.addRealLiteral(2 * dx * spec.rightBc.flux))
            : dae.addRealLiteral(spec.rightBc.value);

    let rhs = dae.addRealLiteral(0.0);

    // Diffusion: D/dx^2 * (uLeft - 2*ui + uRight)
    if (D !== 0) {
      const twoUi = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), ui);
      const lap = dae.addBinaryExpr(BinOp.Add, dae.addBinaryExpr(BinOp.Sub, uLeft, twoUi), uRight);
      const diffTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(invDx2), lap);
      rhs = diffTerm;
    }

    // Upwind advection: -v * du/dx
    if (v !== 0) {
      const grad = v > 0 ? dae.addBinaryExpr(BinOp.Sub, ui, uLeft) : dae.addBinaryExpr(BinOp.Sub, uRight, ui);
      const advTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(invDx), grad);
      rhs = dae.addBinaryExpr(BinOp.Sub, rhs, advTerm);
    }

    // Linear reaction: + k * ui
    if (k !== 0) {
      const rxTerm = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(k), ui);
      rhs = dae.addBinaryExpr(BinOp.Add, rhs, rxTerm);
    }

    return rhs;
  };

  for (let i = 0; i < N; i++) {
    const ui = nameExprs[i]!;
    if (i === 0 && spec.leftBc.kind === "dirichlet") {
      dae.addEquation(EqKind.Simple, dae.addDerExpr(ui), dae.addRealLiteral(0.0));
    } else if (i === N - 1 && spec.rightBc.kind === "dirichlet") {
      dae.addEquation(EqKind.Simple, dae.addDerExpr(ui), dae.addRealLiteral(0.0));
    } else {
      dae.addEquation(EqKind.Simple, dae.addDerExpr(ui), buildStencilRhs(i));
    }
  }

  return { dae, gridX, varNames, dx };
}
