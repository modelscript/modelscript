import { ArenaDAEBuilder, EqKind, ExprKind } from "@modelscript/compiler";
import { colorJacobianColumns } from "@modelscript/symbolics";
import { evaluateArenaDualExpression } from "./arena-dual-evaluator.js";
import { Dual } from "./dual.js";

export interface SparseJacobian {
  n: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
  nnz: number;
}

function getArenaExprVariables(arena: ArenaDAEBuilder, exprId: number, vars: Set<number>) {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    vars.add(arena.getExprData1(exprId));
  }
  const left = arena.getExprLeft(exprId);
  const right = arena.getExprRight(exprId);
  if (left >= 0) getArenaExprVariables(arena, left, vars);
  if (right >= 0) getArenaExprVariables(arena, right, vars);
}

function extractDerArena(arena: ArenaDAEBuilder, exprId: number): string | null {
  if (exprId < 0) return null;
  if (arena.getExprKind(exprId) === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (arena.getExprKind(argId) === ExprKind.Name) {
      return arena.interner.resolve(arena.getExprData1(argId)) || null;
    }
  }
  return null;
}

export function buildSparseAdJacobian(
  dae: ArenaDAEBuilder,
  stateNames: string[],
): { evaluator: (time: number, y: number[]) => SparseJacobian; numColors: number; nnz: number } | null {
  const derEqs: { state: string; rhsExprId: number }[] = [];

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind !== EqKind.Simple && kind !== EqKind.Array) continue;

    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);

    const ld = extractDerArena(dae, lhsId);
    const rd = extractDerArena(dae, rhsId);

    if (kind === EqKind.Array) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? rhsId : lhsId;

      const vIdx = dae.getVarIdxByName(baseName);
      const dims = vIdx >= 0 ? dae.getVarShape(vIdx) : [];
      const size = dims && dims.length > 0 ? dims.reduce((a, b) => a * b, 1) : 1;

      for (let j = 0; j < size; j++) {
        derEqs.push({ state: `${baseName}[${j + 1}]`, rhsExprId: rhs });
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhsExprId: rhsId });
    else if (rd) derEqs.push({ state: rd, rhsExprId: lhsId });
  }

  const orderedDerEqs: { state: string; rhsExprId: number }[] = [];
  const derEqsMap = new Map<string, number>();
  for (const eq of derEqs) {
    derEqsMap.set(eq.state, eq.rhsExprId);
  }

  for (const name of stateNames) {
    const rhs = derEqsMap.get(name);
    if (rhs !== undefined) {
      orderedDerEqs.push({ state: name, rhsExprId: rhs });
    } else {
      return null;
    }
  }

  const n = stateNames.length;
  const row_indices: number[] = [];
  const col_ptr: number[] = [0];

  for (let col = 0; col < n; col++) {
    const stateName = stateNames[col];
    const stateNameId = stateName ? dae.interner.intern(stateName) : -1;

    for (let row = 0; row < n; row++) {
      const eq = orderedDerEqs[row];
      if (eq) {
        const deps = new Set<number>();
        getArenaExprVariables(dae, eq.rhsExprId, deps);
        if (stateNameId >= 0 && deps.has(stateNameId)) {
          row_indices.push(row);
        }
      }
    }
    col_ptr.push(row_indices.length);
  }

  const ccs = {
    row_indices: row_indices,
    col_ptr: col_ptr,
    m: n,
    n: n,
    nnz: row_indices.length,
  };

  const coloring = colorJacobianColumns(ccs, n);

  const rowCounts = new Int32Array(n);
  for (let col = 0; col < n; col++) {
    const start = ccs.col_ptr[col] ?? 0;
    const end = ccs.col_ptr[col + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const row = ccs.row_indices[p] ?? 0;
      if (row < n) rowCounts[row] = (rowCounts[row] ?? 0) + 1;
    }
  }

  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    rowPtr[i + 1] = (rowPtr[i] ?? 0) + (rowCounts[i] ?? 0);
  }
  const nnz = rowPtr[n] ?? 0;
  const colIdx = new Int32Array(nnz);
  const csrFillPos = new Int32Array(n);

  for (let col = 0; col < n; col++) {
    const start = ccs.col_ptr[col] ?? 0;
    const end = ccs.col_ptr[col + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const row = ccs.row_indices[p] ?? 0;
      if (row >= n) continue;
      const pos = (rowPtr[row] ?? 0) + (csrFillPos[row] ?? 0);
      colIdx[pos] = col;
      csrFillPos[row] = (csrFillPos[row] ?? 0) + 1;
    }
  }

  for (let row = 0; row < n; row++) {
    const start = rowPtr[row] ?? 0;
    const end = rowPtr[row + 1] ?? 0;
    const slice = Array.from(colIdx.subarray(start, end));
    slice.sort((a, b) => a - b);
    for (let k = 0; k < slice.length; k++) {
      colIdx[start + k] = slice[k] ?? 0;
    }
  }

  const values = new Float64Array(nnz);
  const sparseJ: SparseJacobian = { n, rowPtr, colIdx, values, nnz };

  const evaluator = (time: number, y: number[]): SparseJacobian => {
    values.fill(0);

    for (let c = 0; c < coloring.numColors; c++) {
      const group = coloring.colorGroups[c];
      if (!group || group.length === 0) continue;

      const dualVarsByStringId: Dual[] = new Array(dae.interner.size).fill(Dual.constant(0));

      const timeId = dae.interner.intern("time");
      dualVarsByStringId[timeId] = Dual.constant(time);

      for (let i = 0; i < n; i++) {
        const sName = stateNames[i];
        if (sName) {
          const nameId = dae.interner.intern(sName);
          dualVarsByStringId[nameId] = Dual.constant(y[i] ?? 0);
        }
      }

      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        const nameId = dae.getVarNameId(i);
        if ((dualVarsByStringId[nameId]?.val ?? 0) === 0 && dae.getVarExpression(i) !== undefined) {
          dualVarsByStringId[nameId] = Dual.constant(dae.getVarStartValue(i));
        }
      }

      for (const col of group) {
        const sName = stateNames[col];
        if (sName) {
          const nameId = dae.interner.intern(sName);
          const v = dualVarsByStringId[nameId]?.val ?? 0;
          dualVarsByStringId[nameId] = new Dual(v, 1);
        }
      }

      for (let row = 0; row < n; row++) {
        const eq = orderedDerEqs[row];
        if (!eq) continue;

        const res = evaluateArenaDualExpression(dae, eq.rhsExprId, dualVarsByStringId);
        if (res && res.dot !== 0) {
          const rStart = rowPtr[row] ?? 0;
          const rEnd = rowPtr[row + 1] ?? 0;
          for (let p = rStart; p < rEnd; p++) {
            const col = colIdx[p] ?? 0;
            if (coloring.colors[col] === c) {
              values[p] = res.dot;
              break;
            }
          }
        }
      }
    }

    return sparseJ;
  };

  return { evaluator, numColors: coloring.numColors, nnz };
}

export function sparseJacobianToDense(sj: SparseJacobian): number[][] {
  const J: number[][] = [];
  for (let i = 0; i < sj.n; i++) {
    const row = new Array<number>(sj.n).fill(0);
    const start = sj.rowPtr[i] ?? 0;
    const end = sj.rowPtr[i + 1] ?? 0;
    for (let p = start; p < end; p++) {
      row[sj.colIdx[p] ?? 0] = sj.values[p] ?? 0;
    }
    J.push(row);
  }
  return J;
}
