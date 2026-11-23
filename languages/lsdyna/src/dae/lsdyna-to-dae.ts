// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { ensureBuiltInLsDynaLibraryRegistered } from "../catalog/library-package-adapter.js";
import { computeCflAnalysis } from "../solver/explicit-solver.js";
import type { LsDynaDeck } from "../types.js";

export interface LsDynaDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  /** Maximum number of free nodes to lower directly as explicit ODEs (default: 64) */
  maxNodes?: number | undefined;
}

/**
 * Lowers an LS-DYNA explicit dynamics structural model ($M \ddot{u} + K u = F$)
 * directly into ModelScript's zero-GC WebAssembly `DAEBuilder` arena.
 *
 * Emits:
 * - Parameters: `cflTimestep`, `maxWaveSpeed`, `endTime`
 * - State pairs `(u_<nid>_x, v_<nid>_x)` for each active node with:
 *     `der(u_i) = v_i`
 *     `m_i * der(v_i) = F_i - sum_j k_ij * (u_i - u_j)`
 * - Global energy output variables: `KineticEnergy`, `InternalEnergy`, `TotalEnergy`
 */
export function lsdynaToDae(deck: LsDynaDeck, options?: LsDynaDaeOptions): DAEBuilder {
  ensureBuiltInLsDynaLibraryRegistered();
  const modelName = (options?.modelName ?? deck.title ?? "LsDynaModel").replace(/[^a-zA-Z0-9_]/g, "_") || "LsDynaModel";
  const dae = options?.builder ?? new DAEBuilder(undefined, modelName);
  const maxNodes = options?.maxNodes ?? 64;

  const cfl = computeCflAnalysis(deck);
  const endTime = deck.controlTermination?.endtim ?? 0.01;

  // Global parameters
  dae.addVariable("cflTimestep", VarType.Real, Variability.Parameter, Causality.Local, cfl.minDtCritical);
  dae.addVariable("maxWaveSpeed", VarType.Real, Variability.Parameter, Causality.Local, cfl.maxWaveSpeed);
  dae.addVariable("endTime", VarType.Real, Variability.Parameter, Causality.Local, endTime);

  // Build node list (capped by maxNodes)
  const nodeIds = Array.from(deck.nodes.keys())
    .sort((a, b) => a - b)
    .slice(0, maxNodes);
  const nidSet = new Set(nodeIds);

  // Assemble lumped masses and axial stiffness couplings along x (or element direction)
  const massMap = new Map<number, number>();
  const fixedX = new Set<number>();
  const initVelX = new Map<number, number>();
  const extForceX = new Map<number, number>();
  const couplings: Array<{ i: number; j: number; k: number }> = [];

  for (const nid of nodeIds) {
    massMap.set(nid, 0);
    const node = deck.nodes.get(nid)!;
    if (node.tc === 1 || node.tc === 4 || node.tc === 6 || node.tc === 7) {
      fixedX.add(nid);
    }
  }

  for (const spc of deck.boundaries) {
    if (!spc.dofx) continue;
    const targets = spc.targetType === "NODE" ? [spc.targetId] : (deck.nodeSets.get(spc.targetId)?.nodes ?? []);
    for (const nid of targets) {
      if (nidSet.has(nid)) fixedX.add(nid);
    }
  }

  for (const iv of deck.initialVelocities) {
    const targets = iv.nsid === 0 ? nodeIds : (deck.nodeSets.get(iv.nsid)?.nodes ?? []);
    for (const nid of targets) {
      if (nidSet.has(nid) && !fixedX.has(nid)) {
        initVelX.set(nid, iv.vx);
      }
    }
  }

  for (const load of deck.loads) {
    if (load.dof === 1 && nidSet.has(load.nid)) {
      const curve = load.lcid > 0 ? deck.curves.get(load.lcid) : undefined;
      const baseVal = curve && curve.points.length > 0 ? curve.points[0]!.ordinate * (curve.sfo || 1.0) : 1.0;
      extForceX.set(load.nid, (extForceX.get(load.nid) ?? 0) + load.sf * baseVal);
    }
  }

  for (const el of deck.elements.values()) {
    const part = deck.parts.get(el.pid);
    const mat = part ? deck.materials.get(part.mid) : undefined;
    const sec = part ? deck.sections.get(part.secid) : undefined;
    if (!mat || mat.e <= 0 || mat.ro <= 0) continue;

    if (el.nodes.length >= 2) {
      const n1 = el.nodes[0]!;
      const n2 = el.nodes[1]!;
      if (!nidSet.has(n1) || !nidSet.has(n2)) continue;
      const p1 = deck.nodes.get(n1)!;
      const p2 = deck.nodes.get(n2)!;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L <= 1e-15) continue;

      const area = sec?.area && sec.area > 0 ? sec.area : sec?.thickness && sec.thickness > 0 ? sec.thickness * L : 1.0;
      const mEl = mat.ro * area * L;
      massMap.set(n1, (massMap.get(n1) ?? 0) + 0.5 * mEl);
      massMap.set(n2, (massMap.get(n2) ?? 0) + 0.5 * mEl);

      const k = (mat.e * area) / L;
      couplings.push({ i: n1, j: n2, k });
    }
  }

  // Create displacement & velocity state variables for each node
  const uVarMap = new Map<number, number>();
  const vVarMap = new Map<number, number>();
  const fVarMap = new Map<number, number>();

  for (const nid of nodeIds) {
    const v0 = initVelX.get(nid) ?? 0.0;
    const f0 = extForceX.get(nid) ?? 0.0;
    const uVar = dae.addVariable(`u_${nid}_x`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const vVar = dae.addVariable(`v_${nid}_x`, VarType.Real, Variability.Continuous, Causality.Local, v0);
    const fVar = dae.addVariable(`F_${nid}_x`, VarType.Real, Variability.Continuous, Causality.Input, f0);
    uVarMap.set(nid, uVar);
    vVarMap.set(nid, vVar);
    fVarMap.set(nid, fVar);
  }

  // Build adjacency for stiffness terms
  const neighbors = new Map<number, Array<{ other: number; k: number }>>();
  for (const nid of nodeIds) neighbors.set(nid, []);
  for (const c of couplings) {
    neighbors.get(c.i)!.push({ other: c.j, k: c.k });
    neighbors.get(c.j)!.push({ other: c.i, k: c.k });
  }

  // Emit equations: der(u_i) = v_i and m_i * der(v_i) = F_i - sum_j k_ij * (u_i - u_j)
  for (const nid of nodeIds) {
    const uVar = uVarMap.get(nid)!;
    const vVar = vVarMap.get(nid)!;
    const fVar = fVarMap.get(nid)!;

    if (fixedX.has(nid)) {
      dae.addEquation(EqKind.Simple, uVar, dae.addRealLiteral(0.0));
      dae.addEquation(EqKind.Simple, vVar, dae.addRealLiteral(0.0));
      continue;
    }

    // der(u_i) = v_i
    dae.addEquation(EqKind.Simple, dae.addDer(uVar), vVar);

    const m = massMap.get(nid) ?? 1.0;
    const effMass = m > 1e-18 ? m : 1.0;
    const lhs = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(effMass), dae.addDer(vVar));

    const adj = neighbors.get(nid)!;
    let internalForceExpr: number | undefined;
    for (const edge of adj) {
      const otherU = uVarMap.get(edge.other)!;
      const diff = dae.addBinaryExpr(BinOp.Sub, uVar, otherU);
      const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(edge.k), diff);
      internalForceExpr =
        internalForceExpr === undefined ? term : dae.addBinaryExpr(BinOp.Add, internalForceExpr, term);
    }

    const rhs = internalForceExpr === undefined ? fVar : dae.addBinaryExpr(BinOp.Sub, fVar, internalForceExpr);

    dae.addEquation(EqKind.Simple, lhs, rhs);
  }

  // Global energy outputs
  const keVar = dae.addVariable("KineticEnergy", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  const ieVar = dae.addVariable("InternalEnergy", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  const totVar = dae.addVariable("TotalEnergy", VarType.Real, Variability.Continuous, Causality.Output, 0.0);

  let keSum: number | undefined;
  for (const nid of nodeIds) {
    if (fixedX.has(nid)) continue;
    const m = massMap.get(nid) ?? 0;
    if (m <= 0) continue;
    const vVar = vVarMap.get(nid)!;
    const v2 = dae.addBinaryExpr(BinOp.Mul, vVar, vVar);
    const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.5 * m), v2);
    keSum = keSum === undefined ? term : dae.addBinaryExpr(BinOp.Add, keSum, term);
  }
  dae.addEquation(EqKind.Simple, keVar, keSum ?? dae.addRealLiteral(0.0));

  let ieSum: number | undefined;
  for (const c of couplings) {
    const ui = uVarMap.get(c.i)!;
    const uj = uVarMap.get(c.j)!;
    const du = dae.addBinaryExpr(BinOp.Sub, uj, ui);
    const du2 = dae.addBinaryExpr(BinOp.Mul, du, du);
    const term = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.5 * c.k), du2);
    ieSum = ieSum === undefined ? term : dae.addBinaryExpr(BinOp.Add, ieSum, term);
  }
  dae.addEquation(EqKind.Simple, ieVar, ieSum ?? dae.addRealLiteral(0.0));

  dae.addEquation(EqKind.Simple, totVar, dae.addBinaryExpr(BinOp.Add, keVar, ieVar));

  return dae;
}
