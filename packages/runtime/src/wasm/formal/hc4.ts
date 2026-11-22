// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript HC4 (Hull Consistency) Forward-Backward Interval Constraint Contractor.
 * Operates over flat bytecode expression DAGs in linear memory with zero allocations.
 *
 * Node encoding (stride 4 x i32): [op, left, right, varOrConstIdx]
 *   op: 0 = Const (lo=hi=constBuf[idx]), 1 = Var (idx in varLo/varHi),
 *       2 = Add, 3 = Sub, 4 = Mul, 5 = Div, 6 = Neg, 7 = Sqr, 8 = Sqrt
 */

const HC4_OP_CONST: i32 = 0;
const HC4_OP_VAR: i32 = 1;
const HC4_OP_ADD: i32 = 2;
const HC4_OP_SUB: i32 = 3;
const HC4_OP_MUL: i32 = 4;
const HC4_OP_DIV: i32 = 5;
const HC4_OP_NEG: i32 = 6;
const HC4_OP_SQR: i32 = 7;
const HC4_OP_SQRT: i32 = 8;

/**
 * Executes one forward-backward HC4 revision pass on constraint `node[numNodes - 1] in [targetLo, targetHi]`.
 * Updates `varLoPtr` and `varHiPtr` in place.
 * Returns: 1 = consistent (possibly contracted), 0 = empty / UNSAT.
 */
export function hc4_revise(
  nodesPtr: usize,
  numNodes: i32,
  constPtr: usize,
  varLoPtr: usize,
  varHiPtr: usize,
  targetLo: f64,
  targetHi: f64,
): i32 {
  if (numNodes <= 0) return 1;

  const nLo = heap.alloc(<usize>numNodes << 3);
  const nHi = heap.alloc(<usize>numNodes << 3);

  // 1. Forward interval evaluation (topological order 0..numNodes-1)
  for (let i: i32 = 0; i < numNodes; i++) {
    const base = nodesPtr + (<usize>(i * 4) << 2);
    const op = load<i32>(base);
    const l = load<i32>(base + 4);
    const r = load<i32>(base + 8);
    const idx = load<i32>(base + 12);

    let lo: f64 = -Infinity;
    let hi: f64 = Infinity;

    if (op == HC4_OP_CONST) {
      const c = load<f64>(constPtr + (<usize>idx << 3));
      lo = c;
      hi = c;
    } else if (op == HC4_OP_VAR) {
      lo = load<f64>(varLoPtr + (<usize>idx << 3));
      hi = load<f64>(varHiPtr + (<usize>idx << 3));
    } else if (op == HC4_OP_ADD) {
      lo = load<f64>(nLo + (<usize>l << 3)) + load<f64>(nLo + (<usize>r << 3));
      hi = load<f64>(nHi + (<usize>l << 3)) + load<f64>(nHi + (<usize>r << 3));
    } else if (op == HC4_OP_SUB) {
      lo = load<f64>(nLo + (<usize>l << 3)) - load<f64>(nHi + (<usize>r << 3));
      hi = load<f64>(nHi + (<usize>l << 3)) - load<f64>(nLo + (<usize>r << 3));
    } else if (op == HC4_OP_MUL) {
      const al = load<f64>(nLo + (<usize>l << 3));
      const ah = load<f64>(nHi + (<usize>l << 3));
      const bl = load<f64>(nLo + (<usize>r << 3));
      const bh = load<f64>(nHi + (<usize>r << 3));
      const p1 = al * bl;
      const p2 = al * bh;
      const p3 = ah * bl;
      const p4 = ah * bh;
      lo = Math.min(Math.min(p1, p2), Math.min(p3, p4));
      hi = Math.max(Math.max(p1, p2), Math.max(p3, p4));
    } else if (op == HC4_OP_DIV) {
      const al = load<f64>(nLo + (<usize>l << 3));
      const ah = load<f64>(nHi + (<usize>l << 3));
      const bl = load<f64>(nLo + (<usize>r << 3));
      const bh = load<f64>(nHi + (<usize>r << 3));
      if (bl > 0.0 || bh < 0.0) {
        const q1 = al / bl;
        const q2 = al / bh;
        const q3 = ah / bl;
        const q4 = ah / bh;
        lo = Math.min(Math.min(q1, q2), Math.min(q3, q4));
        hi = Math.max(Math.max(q1, q2), Math.max(q3, q4));
      }
    } else if (op == HC4_OP_NEG) {
      lo = -load<f64>(nHi + (<usize>l << 3));
      hi = -load<f64>(nLo + (<usize>l << 3));
    } else if (op == HC4_OP_SQR) {
      const al = load<f64>(nLo + (<usize>l << 3));
      const ah = load<f64>(nHi + (<usize>l << 3));
      if (al >= 0.0) {
        lo = al * al;
        hi = ah * ah;
      } else if (ah <= 0.0) {
        lo = ah * ah;
        hi = al * al;
      } else {
        lo = 0.0;
        hi = Math.max(al * al, ah * ah);
      }
    } else if (op == HC4_OP_SQRT) {
      const al = load<f64>(nLo + (<usize>l << 3));
      const ah = load<f64>(nHi + (<usize>l << 3));
      if (ah < 0.0) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      lo = al > 0.0 ? Math.sqrt(al) : 0.0;
      hi = Math.sqrt(ah);
    }

    store<f64>(nLo + (<usize>i << 3), lo);
    store<f64>(nHi + (<usize>i << 3), hi);
  }

  // Intersect root with [targetLo, targetHi]
  const rootIdx = numNodes - 1;
  const rLo = Math.max(load<f64>(nLo + (<usize>rootIdx << 3)), targetLo);
  const rHi = Math.min(load<f64>(nHi + (<usize>rootIdx << 3)), targetHi);
  if (rLo > rHi + 1e-12) {
    heap.free(nLo);
    heap.free(nHi);
    return 0;
  }
  store<f64>(nLo + (<usize>rootIdx << 3), rLo);
  store<f64>(nHi + (<usize>rootIdx << 3), rHi);

  // 2. Backward projection (reverse topological order)
  for (let i: i32 = rootIdx; i >= 0; i--) {
    const base = nodesPtr + (<usize>(i * 4) << 2);
    const op = load<i32>(base);
    const l = load<i32>(base + 4);
    const r = load<i32>(base + 8);
    const idx = load<i32>(base + 12);

    const pLo = load<f64>(nLo + (<usize>i << 3));
    const pHi = load<f64>(nHi + (<usize>i << 3));

    if (op == HC4_OP_VAR) {
      const curLo = load<f64>(varLoPtr + (<usize>idx << 3));
      const curHi = load<f64>(varHiPtr + (<usize>idx << 3));
      const newLo = Math.max(curLo, pLo);
      const newHi = Math.min(curHi, pHi);
      if (newLo > newHi + 1e-12) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      store<f64>(varLoPtr + (<usize>idx << 3), newLo);
      store<f64>(varHiPtr + (<usize>idx << 3), newHi);
    } else if (op == HC4_OP_ADD) {
      const ll = load<f64>(nLo + (<usize>l << 3));
      const lh = load<f64>(nHi + (<usize>l << 3));
      const rl = load<f64>(nLo + (<usize>r << 3));
      const rh = load<f64>(nHi + (<usize>r << 3));
      const nlLo = Math.max(ll, pLo - rh);
      const nlHi = Math.min(lh, pHi - rl);
      const nrLo = Math.max(rl, pLo - lh);
      const nrHi = Math.min(rh, pHi - ll);
      if (nlLo > nlHi + 1e-12 || nrLo > nrHi + 1e-12) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      store<f64>(nLo + (<usize>l << 3), nlLo);
      store<f64>(nHi + (<usize>l << 3), nlHi);
      store<f64>(nLo + (<usize>r << 3), nrLo);
      store<f64>(nHi + (<usize>r << 3), nrHi);
    } else if (op == HC4_OP_SUB) {
      const ll = load<f64>(nLo + (<usize>l << 3));
      const lh = load<f64>(nHi + (<usize>l << 3));
      const rl = load<f64>(nLo + (<usize>r << 3));
      const rh = load<f64>(nHi + (<usize>r << 3));
      const nlLo = Math.max(ll, pLo + rl);
      const nlHi = Math.min(lh, pHi + rh);
      const nrLo = Math.max(rl, ll - pHi);
      const nrHi = Math.min(rh, lh - pLo);
      if (nlLo > nlHi + 1e-12 || nrLo > nrHi + 1e-12) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      store<f64>(nLo + (<usize>l << 3), nlLo);
      store<f64>(nHi + (<usize>l << 3), nlHi);
      store<f64>(nLo + (<usize>r << 3), nrLo);
      store<f64>(nHi + (<usize>r << 3), nrHi);
    } else if (op == HC4_OP_NEG) {
      const ll = load<f64>(nLo + (<usize>l << 3));
      const lh = load<f64>(nHi + (<usize>l << 3));
      const nlLo = Math.max(ll, -pHi);
      const nlHi = Math.min(lh, -pLo);
      if (nlLo > nlHi + 1e-12) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      store<f64>(nLo + (<usize>l << 3), nlLo);
      store<f64>(nHi + (<usize>l << 3), nlHi);
    } else if (op == HC4_OP_SQR) {
      if (pHi < 0.0) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      const rootHi = Math.sqrt(pHi);
      const rootLo = pLo > 0.0 ? Math.sqrt(pLo) : 0.0;
      const ll = load<f64>(nLo + (<usize>l << 3));
      const lh = load<f64>(nHi + (<usize>l << 3));
      // Hull of ([ll, lh] ∩ [-rootHi, -rootLo]) ∪ ([ll, lh] ∩ [rootLo, rootHi])
      const negLo = Math.max(ll, -rootHi);
      const negHi = Math.min(lh, -rootLo);
      const posLo = Math.max(ll, rootLo);
      const posHi = Math.min(lh, rootHi);
      const negOk = negLo <= negHi + 1e-12;
      const posOk = posLo <= posHi + 1e-12;
      if (!negOk && !posOk) {
        heap.free(nLo);
        heap.free(nHi);
        return 0;
      }
      const nlLo = negOk ? negLo : posLo;
      const nlHi = posOk ? posHi : negHi;
      store<f64>(nLo + (<usize>l << 3), nlLo);
      store<f64>(nHi + (<usize>l << 3), nlHi);
    }
  }

  heap.free(nLo);
  heap.free(nHi);
  return 1;
}
