// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Orthogonal A* Schematic Connection Router Kernel.
 *
 * Implements a zero-allocation, flat binary-heap A* search over a 2D routing grid
 * with directional state (4 orientations per cell), bend penalties, wire-crossing
 * penalties, and automatic collinear waypoint simplification in linear memory.
 */

// Grid cell flags:
// 0 = free
// 1 = blocked obstacle (component bounding box)
// 2 = existing horizontal wire segment
// 3 = existing vertical wire segment

/**
 * Routes an orthogonal connection on a `cols x rows` grid from `(startX, startY)`
 * to `(endX, endY)` with initial direction `startDir` (0=E, 1=S, 2=W, 3=N, -1=any).
 *
 * Workspace buffers in linear memory:
 * - `gridPtr`: `u8[cols * rows]`
 * - `gScorePtr`: `f64[cols * rows * 4]`
 * - `parentPtr`: `i32[cols * rows * 4]`
 * - `closedPtr`: `u8[cols * rows * 4]`
 * - `heapStatesPtr`: `i32[cols * rows * 4]`
 * - `heapPrioritiesPtr`: `f64[cols * rows * 4]`
 * - `outWaypointsPtr`: `i32[maxWaypoints * 2]` (output `[x0, y0, x1, y1, ...]`)
 *
 * Returns the number of simplified corner waypoints written to `outWaypointsPtr`.
 */
export function diagram_route_orthogonal_astar(
  cols: i32,
  rows: i32,
  startX: i32,
  startY: i32,
  endX: i32,
  endY: i32,
  startDir: i32,
  bendPenalty: f64,
  crossingPenalty: f64,
  gridPtr: usize,
  gScorePtr: usize,
  parentPtr: usize,
  closedPtr: usize,
  heapStatesPtr: usize,
  heapPrioritiesPtr: usize,
  outWaypointsPtr: usize,
  maxWaypoints: i32
): i32 {
  if (
    cols <= 0 ||
    rows <= 0 ||
    startX < 0 ||
    startX >= cols ||
    startY < 0 ||
    startY >= rows ||
    endX < 0 ||
    endX >= cols ||
    endY < 0 ||
    endY >= rows
  ) {
    return 0;
  }

  if (startX == endX && startY == endY) {
    store<i32>(outWaypointsPtr + 0, startX);
    store<i32>(outWaypointsPtr + 4, startY);
    return 1;
  }

  const totalStates = cols * rows * 4;
  for (let i: i32 = 0; i < totalStates; i++) {
    store<f64>(gScorePtr + ((i as usize) << 3), 1e30);
    store<i32>(parentPtr + ((i as usize) << 2), -1);
    store<u8>(closedPtr + (i as usize), 0);
  }

  let heapSize: i32 = 0;

  // Push helper (binary min-heap)
  const h0 = <f64>(Math.abs(endX - startX) + Math.abs(endY - startY));
  for (let d: i32 = 0; d < 4; d++) {
    if (startDir >= 0 && startDir < 4 && d != startDir) continue;
    const stateIdx = (startY * cols + startX) * 4 + d;
    store<f64>(gScorePtr + ((stateIdx as usize) << 3), 0.0);

    // Heap insert
    let pos = heapSize++;
    while (pos > 0) {
      const pPos = (pos - 1) >> 1;
      const pPrio = load<f64>(heapPrioritiesPtr + ((pPos as usize) << 3));
      if (h0 >= pPrio) break;
      store<i32>(heapStatesPtr + ((pos as usize) << 2), load<i32>(heapStatesPtr + ((pPos as usize) << 2)));
      store<f64>(heapPrioritiesPtr + ((pos as usize) << 3), pPrio);
      pos = pPos;
    }
    store<i32>(heapStatesPtr + ((pos as usize) << 2), stateIdx);
    store<f64>(heapPrioritiesPtr + ((pos as usize) << 3), h0);
  }

  let goalState: i32 = -1;

  while (heapSize > 0) {
    // Pop min from binary heap
    const currState = load<i32>(heapStatesPtr);
    heapSize--;
    if (heapSize > 0) {
      const lastState = load<i32>(heapStatesPtr + ((heapSize as usize) << 2));
      const lastPrio = load<f64>(heapPrioritiesPtr + ((heapSize as usize) << 3));
      let pos: i32 = 0;
      const half = heapSize >> 1;
      while (pos < half) {
        let child = (pos << 1) + 1;
        const right = child + 1;
        let childPrio = load<f64>(heapPrioritiesPtr + ((child as usize) << 3));
        if (right < heapSize) {
          const rightPrio = load<f64>(heapPrioritiesPtr + ((right as usize) << 3));
          if (rightPrio < childPrio) {
            child = right;
            childPrio = rightPrio;
          }
        }
        if (lastPrio <= childPrio) break;
        store<i32>(heapStatesPtr + ((pos as usize) << 2), load<i32>(heapStatesPtr + ((child as usize) << 2)));
        store<f64>(heapPrioritiesPtr + ((pos as usize) << 3), childPrio);
        pos = child;
      }
      store<i32>(heapStatesPtr + ((pos as usize) << 2), lastState);
      store<f64>(heapPrioritiesPtr + ((pos as usize) << 3), lastPrio);
    }

    if (load<u8>(closedPtr + (currState as usize)) != 0) continue;
    store<u8>(closedPtr + (currState as usize), 1);

    const cellIdx = currState >> 2;
    const dir = currState & 3;
    const cx = cellIdx % cols;
    const cy = cellIdx / cols;

    if (cx == endX && cy == endY) {
      goalState = currState;
      break;
    }

    const currG = load<f64>(gScorePtr + ((currState as usize) << 3));

    for (let nd: i32 = 0; nd < 4; nd++) {
      // Disallow 180-degree U-turn
      if (((dir + 2) & 3) == nd) continue;

      const nx = nd == 0 ? cx + 1 : nd == 2 ? cx - 1 : cx;
      const ny = nd == 1 ? cy + 1 : nd == 3 ? cy - 1 : cy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

      const nCell = ny * cols + nx;
      const cellFlag = load<u8>(gridPtr + (nCell as usize));
      // Allow stepping onto end cell even if inside port obstacle margin
      if (cellFlag == 1 && !(nx == endX && ny == endY)) continue;

      const nextState = (nCell << 2) + nd;
      if (load<u8>(closedPtr + (nextState as usize)) != 0) continue;

      let stepCost: f64 = 1.0;
      if (nd != dir) {
        stepCost += bendPenalty;
      }
      // Wire crossing penalty if moving horizontally across vertical wire or vice versa
      const isHoriz = nd == 0 || nd == 2;
      if ((isHoriz && cellFlag == 3) || (!isHoriz && cellFlag == 2)) {
        stepCost += crossingPenalty;
      }

      const tentativeG = currG + stepCost;
      const prevBestG = load<f64>(gScorePtr + ((nextState as usize) << 3));
      if (tentativeG < prevBestG) {
        store<f64>(gScorePtr + ((nextState as usize) << 3), tentativeG);
        store<i32>(parentPtr + ((nextState as usize) << 2), currState);

        const h = <f64>(Math.abs(endX - nx) + Math.abs(endY - ny));
        const f = tentativeG + h;

        let pos = heapSize++;
        while (pos > 0) {
          const pPos = (pos - 1) >> 1;
          const pPrio = load<f64>(heapPrioritiesPtr + ((pPos as usize) << 3));
          if (f >= pPrio) break;
          store<i32>(heapStatesPtr + ((pos as usize) << 2), load<i32>(heapStatesPtr + ((pPos as usize) << 2)));
          store<f64>(heapPrioritiesPtr + ((pos as usize) << 3), pPrio);
          pos = pPos;
        }
        store<i32>(heapStatesPtr + ((pos as usize) << 2), nextState);
        store<f64>(heapPrioritiesPtr + ((pos as usize) << 3), f);
      }
    }
  }

  if (goalState < 0) {
    return 0;
  }

  // Reconstruct raw cell path backwards into heapStatesPtr (reused as scratch)
  let rawLen: i32 = 0;
  let trace = goalState;
  while (trace >= 0 && rawLen < totalStates) {
    store<i32>(heapStatesPtr + ((rawLen as usize) << 2), trace >> 2);
    rawLen++;
    trace = load<i32>(parentPtr + ((trace as usize) << 2));
  }

  // Reverse and simplify collinear points into outWaypointsPtr
  let outCount: i32 = 0;
  for (let i: i32 = rawLen - 1; i >= 0; i--) {
    const cell = load<i32>(heapStatesPtr + ((i as usize) << 2));
    const px = cell % cols;
    const py = cell / cols;

    if (outCount > 0) {
      const prevOff = ((outCount - 1) * 2) as usize;
      const prevX = load<i32>(outWaypointsPtr + (prevOff << 2));
      const prevY = load<i32>(outWaypointsPtr + ((prevOff + 1) << 2));
      if (px == prevX && py == prevY) continue;

      if (outCount >= 2) {
        const prev2Off = ((outCount - 2) * 2) as usize;
        const prev2X = load<i32>(outWaypointsPtr + (prev2Off << 2));
        const prev2Y = load<i32>(outWaypointsPtr + ((prev2Off + 1) << 2));
        // If collinear horizontally or vertically, replace previous waypoint
        if ((prev2X == prevX && prevX == px) || (prev2Y == prevY && prevY == py)) {
          store<i32>(outWaypointsPtr + (prevOff << 2), px);
          store<i32>(outWaypointsPtr + ((prevOff + 1) << 2), py);
          continue;
        }
      }
    }

    if (outCount < maxWaypoints) {
      const off = (outCount * 2) as usize;
      store<i32>(outWaypointsPtr + (off << 2), px);
      store<i32>(outWaypointsPtr + ((off + 1) << 2), py);
      outCount++;
    }
  }

  return outCount;
}

/**
 * Compacts `n` 1D integer grid coordinates (`coordsPtr`, i32[n]) by eliminating unused gaps
 * while preserving relative ordering. Writes compacted coordinates (0..uniqueCount-1)
 * to `outCompactPtr` (i32[n]) and returns the number of unique coordinates (`span`).
 */
export function diagram_tsm_compact_1d(
  n: i32,
  coordsPtr: usize,
  outCompactPtr: usize
): i32 {
  if (n <= 0) return 0;
  const sorted = new StaticArray<i32>(n);
  for (let i: i32 = 0; i < n; i++) {
    unchecked((sorted[i] = load<i32>(coordsPtr + ((i as usize) << 2))));
  }
  // Insertion sort (n is typically < 256 in schematic TSM grids)
  for (let i: i32 = 1; i < n; i++) {
    const key = unchecked(sorted[i]);
    let j = i - 1;
    while (j >= 0 && unchecked(sorted[j]) > key) {
      unchecked((sorted[j + 1] = sorted[j]));
      j--;
    }
    unchecked((sorted[j + 1] = key));
  }

  // Deduplicate sorted in-place
  let uniqueCount: i32 = 1;
  for (let i: i32 = 1; i < n; i++) {
    if (unchecked(sorted[i]) != unchecked(sorted[uniqueCount - 1])) {
      unchecked((sorted[uniqueCount] = sorted[i]));
      uniqueCount++;
    }
  }

  // Binary search rank for each input coordinate
  for (let i: i32 = 0; i < n; i++) {
    const val = load<i32>(coordsPtr + ((i as usize) << 2));
    let lo: i32 = 0;
    let hi: i32 = uniqueCount - 1;
    let rank: i32 = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const mVal = unchecked(sorted[mid]);
      if (mVal == val) {
        rank = mid;
        break;
      } else if (mVal < val) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    store<i32>(outCompactPtr + ((i as usize) << 2), rank);
  }

  return uniqueCount;
}

/**
 * Solves 1D monotonic port alignment with minimum spacing `minSpacing` and box bounds
 * `[minBound, maxBound]` for `nPorts` sorted target offsets (`targetsPtr`, f64[nPorts]),
 * writing optimal conflict-free offsets to `outOffsetsPtr` (f64[nPorts]).
 */
export function diagram_port_align_1d(
  nPorts: i32,
  targetsPtr: usize,
  minSpacing: f64,
  minBound: f64,
  maxBound: f64,
  outOffsetsPtr: usize
): void {
  if (nPorts <= 0) return;

  // Forward pass: enforce lower bound and minimum spacing from left to right
  for (let i: i32 = 0; i < nPorts; i++) {
    const off = (i as usize) << 3;
    const target = load<f64>(targetsPtr + off);
    const lb = minBound + <f64>i * minSpacing;
    const prev = i > 0 ? load<f64>(outOffsetsPtr + (((i - 1) as usize) << 3)) + minSpacing : lb;
    let pos = target;
    if (pos < lb) pos = lb;
    if (pos < prev) pos = prev;
    store<f64>(outOffsetsPtr + off, pos);
  }

  // Backward pass: enforce upper bound and minimum spacing from right to left
  for (let i: i32 = nPorts - 1; i >= 0; i--) {
    const off = (i as usize) << 3;
    const ub = maxBound - <f64>(nPorts - 1 - i) * minSpacing;
    const next =
      i < nPorts - 1 ? load<f64>(outOffsetsPtr + (((i + 1) as usize) << 3)) - minSpacing : ub;
    let pos = load<f64>(outOffsetsPtr + off);
    if (pos > ub) pos = ub;
    if (pos > next) pos = next;
    store<f64>(outOffsetsPtr + off, pos);
  }
}

