/* eslint-disable */
// AssemblyScript implementation of Bipartite Matching and Tarjan's SCC

// We will use Typed Arrays instead of Map/Set for much higher performance
// since our variable and equation IDs are densely packed integers [0, N-1].

function dfs(start_e: i32, iter: i32, visited: Int32Array, eqDeps: Int32Array[], match: Int32Array): boolean {
  const eStack = new Array<i32>();
  const idxStack = new Array<i32>();
  const vStack = new Array<i32>();

  eStack.push(start_e);
  idxStack.push(0);
  vStack.push(-1);

  let childReturnedTrue = false;

  while (eStack.length > 0) {
    const e = eStack[eStack.length - 1];
    let idx = idxStack[idxStack.length - 1];
    const v = vStack[vStack.length - 1];

    if (childReturnedTrue) {
      match[v] = e;
      eStack.pop();
      idxStack.pop();
      vStack.pop();
      childReturnedTrue = true;
      continue;
    }

    const deps = eqDeps[e];
    let advanced = false;

    while (idx < deps.length) {
      const nextV = deps[idx];
      idx++;

      if (visited[nextV] !== iter) {
        visited[nextV] = iter;
        if (match[nextV] === -1) {
          match[nextV] = e;
          eStack.pop();
          idxStack.pop();
          vStack.pop();
          childReturnedTrue = true;
          advanced = true;
          break;
        } else {
          idxStack[idxStack.length - 1] = idx;
          vStack[vStack.length - 1] = nextV;

          eStack.push(match[nextV]);
          idxStack.push(0);
          vStack.push(-1);
          advanced = true;
          break;
        }
      }
    }

    if (!advanced && !childReturnedTrue) {
      eStack.pop();
      idxStack.pop();
      vStack.pop();
      childReturnedTrue = false;
    }
  }

  return childReturnedTrue;
}

function strongconnect(
  start_v: i32,
  indexArr: Int32Array,
  lowlinkArr: Int32Array,
  onStackArr: Uint8Array,
  stack: i32[],
  sccs: i32[][],
  match: Int32Array,
  eqDeps: Int32Array[],
  indexCounterRef: Int32Array,
): void {
  const callStack_v = new Array<i32>();
  const callStack_idx = new Array<i32>();

  callStack_v.push(start_v);
  callStack_idx.push(0);

  const startIdx = indexCounterRef[0];
  indexArr[start_v] = startIdx;
  lowlinkArr[start_v] = startIdx;
  indexCounterRef[0] = startIdx + 1;
  stack.push(start_v);
  onStackArr[start_v] = 1;

  while (callStack_v.length > 0) {
    const v = callStack_v[callStack_v.length - 1];
    let idx = callStack_idx[callStack_idx.length - 1];

    let deps: Int32Array | null = null;
    const eqIdx = match[v];
    if (eqIdx !== -1) {
      deps = eqDeps[eqIdx];
    }

    let advanced = false;
    if (deps) {
      while (idx < deps.length) {
        const w = deps[idx];
        idx++;

        if (w === v) continue;

        if (indexArr[w] === -1) {
          callStack_idx[callStack_idx.length - 1] = idx;

          const newIdx = indexCounterRef[0];
          indexArr[w] = newIdx;
          lowlinkArr[w] = newIdx;
          indexCounterRef[0] = newIdx + 1;
          stack.push(w);
          onStackArr[w] = 1;

          callStack_v.push(w);
          callStack_idx.push(0);
          advanced = true;
          break;
        } else if (onStackArr[w] === 1) {
          const vLow = lowlinkArr[v];
          const wIdx = indexArr[w];
          lowlinkArr[v] = Math.min(vLow, wIdx) as i32;
        }
      }
    }

    if (advanced) {
      continue;
    }

    callStack_v.pop();
    callStack_idx.pop();

    if (callStack_v.length > 0) {
      const parent_v = callStack_v[callStack_v.length - 1];
      const pLow = lowlinkArr[parent_v];
      const vLow = lowlinkArr[v];
      lowlinkArr[parent_v] = Math.min(pLow, vLow) as i32;
    }

    if (lowlinkArr[v] === indexArr[v]) {
      const scc = new Array<i32>();
      let w: i32 = -1;
      do {
        if (stack.length > 0) {
          w = stack.pop();
          onStackArr[w] = 0;
          scc.push(w);
        } else {
          break;
        }
      } while (w !== v);
      sccs.push(scc);
    }
  }
}

export function computeBlt(
  numUnknowns: i32,
  numEquations: i32,
  adjPtr: usize,
  outEqsPtr: usize,
  outBlocksPtr: usize,
): i32 {
  // 1. Read adjacency list from memory
  let offset = adjPtr;
  const eqDeps = new Array<Int32Array>(numEquations);
  const allUnknownsArr = new Array<i32>();
  const isUnknownKnown = new Uint8Array(numUnknowns);

  for (let i = 0; i < numEquations; i++) {
    const count = load<i32>(offset);
    offset += 4;
    const deps = new Int32Array(count);
    for (let j = 0; j < count; j++) {
      const v = load<i32>(offset);
      deps[j] = v;
      offset += 4;
      if (v >= 0 && v < numUnknowns && isUnknownKnown[v] === 0) {
        isUnknownKnown[v] = 1;
        allUnknownsArr.push(v);
      }
    }
    eqDeps[i] = deps;
  }

  // 2. Bipartite matching (Var -> Eq)
  const match = new Int32Array(numUnknowns);
  match.fill(-1);
  const assignedEqs = new Uint8Array(numEquations);

  // A global visited array for DFS to avoid allocations
  const visited = new Int32Array(numUnknowns);
  visited.fill(-1);

  for (let i = 0; i < numEquations; i++) {
    if (dfs(i, i, visited, eqDeps, match)) {
      assignedEqs[i] = 1;
    }
  }

  // 3. Tarjan's SCC
  const indexArr = new Int32Array(numUnknowns);
  indexArr.fill(-1);
  const lowlinkArr = new Int32Array(numUnknowns);
  lowlinkArr.fill(-1);
  const onStackArr = new Uint8Array(numUnknowns);
  const stack = new Array<i32>();
  const sccs = new Array<i32[]>();

  const indexCounterRef = new Int32Array(1);
  indexCounterRef[0] = 0;

  for (let i = 0; i < allUnknownsArr.length; i++) {
    const v = allUnknownsArr[i];
    if (indexArr[v] === -1) {
      strongconnect(v, indexArr, lowlinkArr, onStackArr, stack, sccs, match, eqDeps, indexCounterRef);
    }
  }

  // 4. Build output
  let eqsOffset = outEqsPtr;
  let blocksOffset = outBlocksPtr;

  store<i32>(blocksOffset, sccs.length);
  blocksOffset += 4;

  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i];
    const sccEqs = new Array<i32>();
    for (let j = 0; j < scc.length; j++) {
      const v = scc[j];
      const m = match[v];
      if (m !== -1) {
        sccEqs.push(m);
      }
    }

    // Write block sizes
    store<i32>(blocksOffset, sccEqs.length);
    blocksOffset += 4;
    store<i32>(blocksOffset, scc.length);
    blocksOffset += 4;

    // Write equations
    for (let j = 0; j < sccEqs.length; j++) {
      store<i32>(eqsOffset, sccEqs[j]);
      eqsOffset += 4;
      store<i32>(blocksOffset, sccEqs[j]);
      blocksOffset += 4;
    }
    // Write vars
    for (let j = 0; j < scc.length; j++) {
      store<i32>(blocksOffset, scc[j]);
      blocksOffset += 4;
    }
  }

  // Unused equations
  for (let i = 0; i < numEquations; i++) {
    if (assignedEqs[i] === 0) {
      store<i32>(eqsOffset, i);
      eqsOffset += 4;
    }
  }

  return sccs.length;
}

export function alloc(size: i32): usize {
  return heap.alloc(size);
}

export function free(ptr: usize): void {
  heap.free(ptr);
}
