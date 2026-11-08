// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Propagation-Delay Graph Partitioner for Distributed EMT Simulation.
 *
 * Partitions an electrical network across `numPartitions` parallel domains by:
 *   1. Contracting zero-delay RLC/transformer branches (and sub-step lines with tau < dt)
 *      into indivisible super-nodes via path-compressed Disjoint-Set Union-Find.
 *   2. Constructing the reduced quotient graph over delay-decoupled transmission lines (tau >= dt).
 *   3. Executing BFS-seeded balanced k-way region growth followed by Fiduccia-Mattheyses (FM)
 *      local boundary refinement to minimize cut transmission lines while balancing node counts.
 */

import { atomicChunkAlloc } from "../arena";

@inline
function ufFind(parentPtr: usize, x: i32): i32 {
  let root = x;
  while (true) {
    let p = load<i32>(parentPtr + (((root as usize)) << 2));
    if (p == root) break;
    root = p;
  }
  let curr = x;
  while (curr != root) {
    let nxt = load<i32>(parentPtr + (((curr as usize)) << 2));
    store<i32>(parentPtr + (((curr as usize)) << 2), root);
    curr = nxt;
  }
  return root;
}

@inline
function ufUnion(parentPtr: usize, sizePtr: usize, a: i32, b: i32): void {
  let ra = ufFind(parentPtr, a);
  let rb = ufFind(parentPtr, b);
  if (ra == rb) return;
  let sa = load<i32>(sizePtr + (((ra as usize)) << 2));
  let sb = load<i32>(sizePtr + (((rb as usize)) << 2));
  if (sa < sb) {
    store<i32>(parentPtr + (((ra as usize)) << 2), rb);
    store<i32>(sizePtr + (((rb as usize)) << 2), sa + sb);
  } else {
    store<i32>(parentPtr + (((rb as usize)) << 2), ra);
    store<i32>(sizePtr + (((ra as usize)) << 2), sa + sb);
  }
}

/**
 * Partitions an EMT network of `nNodes` electrical nodes into `numPartitions` delay-decoupled
 * subdomains. Writes each node's partition index `[0 .. numPartitions - 1]` to `outNodePartPtr`
 * (`Int32Array[nNodes]`) and returns the number of cut delay-decoupled transmission lines.
 */
export function emt_partition_network(
  nNodes: u32,
  nZeroDelayBranches: u32,
  branchFromPtr: usize,
  branchToPtr: usize,
  nDelayLines: u32,
  lineFromPtr: usize,
  lineToPtr: usize,
  lineDelaySecPtr: usize,
  dtSec: f64,
  numPartitions: u32,
  outNodePartPtr: usize
): i32 {
  if (nNodes == 0) return 0;
  let kParts: i32 = numPartitions > 1 ? (numPartitions as i32) : 1;
  if (kParts == 1) {
    for (let i: u32 = 0; i < nNodes; i++) {
      store<i32>(outNodePartPtr + (((i as usize)) << 2), 0);
    }
    return 0;
  }

  let parentPtr = atomicChunkAlloc(nNodes * sizeof<i32>());
  let sizePtr = atomicChunkAlloc(nNodes * sizeof<i32>());
  for (let i: u32 = 0; i < nNodes; i++) {
    store<i32>(parentPtr + (((i as usize)) << 2), i as i32);
    store<i32>(sizePtr + (((i as usize)) << 2), 1);
  }

  // 1. Contract all zero-delay branches into super-nodes
  for (let b: u32 = 0; b < nZeroDelayBranches; b++) {
    let u = load<i32>(branchFromPtr + (((b as usize)) << 2));
    let v = load<i32>(branchToPtr + (((b as usize)) << 2));
    if (u >= 0 && (u as u32) < nNodes && v >= 0 && (v as u32) < nNodes) {
      ufUnion(parentPtr, sizePtr, u, v);
    }
  }

  // Contract any transmission line whose travel delay is strictly less than dtSec
  for (let l: u32 = 0; l < nDelayLines; l++) {
    let tau = load<f64>(lineDelaySecPtr + (((l as usize)) << 3));
    if (tau + 1e-12 < dtSec) {
      let u = load<i32>(lineFromPtr + (((l as usize)) << 2));
      let v = load<i32>(lineToPtr + (((l as usize)) << 2));
      if (u >= 0 && (u as u32) < nNodes && v >= 0 && (v as u32) < nNodes) {
        ufUnion(parentPtr, sizePtr, u, v);
      }
    }
  }

  // 2. Enumerate distinct super-node clusters
  let nodeClusterPtr = atomicChunkAlloc(nNodes * sizeof<i32>());
  let rootToClusterPtr = atomicChunkAlloc(nNodes * sizeof<i32>());
  for (let i: u32 = 0; i < nNodes; i++) {
    store<i32>(rootToClusterPtr + (((i as usize)) << 2), -1);
  }

  let nClusters: i32 = 0;
  let clusterWeightPtr = atomicChunkAlloc(nNodes * sizeof<i32>());
  for (let i: u32 = 0; i < nNodes; i++) {
    let r = ufFind(parentPtr, i as i32);
    let c = load<i32>(rootToClusterPtr + (((r as usize)) << 2));
    if (c < 0) {
      c = nClusters++;
      store<i32>(rootToClusterPtr + (((r as usize)) << 2), c);
      let w = load<i32>(sizePtr + (((r as usize)) << 2));
      store<i32>(clusterWeightPtr + (((c as usize)) << 2), w);
    }
    store<i32>(nodeClusterPtr + (((i as usize)) << 2), c);
  }

  if (kParts > nClusters) {
    kParts = nClusters > 0 ? nClusters : 1;
  }

  // 3. Initial balanced assignment of clusters (contiguous topological bins + load balancing)
  let clusterPartPtr = atomicChunkAlloc((nClusters as u32) * sizeof<i32>());
  let partLoadPtr = atomicChunkAlloc((kParts as u32) * sizeof<i32>());
  for (let p: i32 = 0; p < kParts; p++) {
    store<i32>(partLoadPtr + (((p as usize)) << 2), 0);
  }

  let targetLoad: f64 = (<f64>nNodes) / (<f64>kParts);
  let currentPart: i32 = 0;
  let accumLoad: i32 = 0;
  for (let c: i32 = 0; c < nClusters; c++) {
    let w = load<i32>(clusterWeightPtr + (((c as usize)) << 2));
    let remClusters = nClusters - c;
    let remParts = kParts - currentPart - 1;
    if (
      currentPart < kParts - 1 &&
      accumLoad > 0 &&
      remClusters >= remParts &&
      (remClusters == remParts || (<f64>(accumLoad + w)) > targetLoad * 1.05)
    ) {
      currentPart++;
      accumLoad = 0;
    }
    store<i32>(clusterPartPtr + (((c as usize)) << 2), currentPart);
    let prevLoad = load<i32>(partLoadPtr + (((currentPart as usize)) << 2));
    store<i32>(partLoadPtr + (((currentPart as usize)) << 2), prevLoad + w);
    accumLoad += w;
  }

  // 4. Fiduccia-Mattheyses (FM) boundary refinement passes over delay-decoupled edges
  let maxLoadAllowed = <i32>Math.ceil(targetLoad * 1.20) + 1;
  let minLoadAllowed = <i32>Math.floor(targetLoad * 0.75);

  for (let pass: i32 = 0; pass < 6; pass++) {
    let improved: bool = false;
    for (let c: i32 = 0; c < nClusters; c++) {
      let curP = load<i32>(clusterPartPtr + (((c as usize)) << 2));
      let w = load<i32>(clusterWeightPtr + (((c as usize)) << 2));
      let curPartLoad = load<i32>(partLoadPtr + (((curP as usize)) << 2));
      if (curPartLoad - w < minLoadAllowed) continue;

      // Count incident delay lines to each partition
      let bestP = curP;
      let bestGain: i32 = 0;
      let ownEdges: i32 = 0;

      for (let l: u32 = 0; l < nDelayLines; l++) {
        let tau = load<f64>(lineDelaySecPtr + (((l as usize)) << 3));
        if (tau + 1e-12 < dtSec) continue;
        let u = load<i32>(lineFromPtr + (((l as usize)) << 2));
        let v = load<i32>(lineToPtr + (((l as usize)) << 2));
        if (u < 0 || (u as u32) >= nNodes || v < 0 || (v as u32) >= nNodes) continue;
        let cu = load<i32>(nodeClusterPtr + (((u as usize)) << 2));
        let cv = load<i32>(nodeClusterPtr + (((v as usize)) << 2));
        if (cu == cv) continue;
        if (cu == c) {
          let pv = load<i32>(clusterPartPtr + (((cv as usize)) << 2));
          if (pv == curP) ownEdges++;
        } else if (cv == c) {
          let pu = load<i32>(clusterPartPtr + (((cu as usize)) << 2));
          if (pu == curP) ownEdges++;
        }
      }

      for (let candP: i32 = 0; candP < kParts; candP++) {
        if (candP == curP) continue;
        let candLoad = load<i32>(partLoadPtr + (((candP as usize)) << 2));
        if (candLoad + w > maxLoadAllowed) continue;

        let candEdges: i32 = 0;
        for (let l: u32 = 0; l < nDelayLines; l++) {
          let tau = load<f64>(lineDelaySecPtr + (((l as usize)) << 3));
          if (tau + 1e-12 < dtSec) continue;
          let u = load<i32>(lineFromPtr + (((l as usize)) << 2));
          let v = load<i32>(lineToPtr + (((l as usize)) << 2));
          if (u < 0 || (u as u32) >= nNodes || v < 0 || (v as u32) >= nNodes) continue;
          let cu = load<i32>(nodeClusterPtr + (((u as usize)) << 2));
          let cv = load<i32>(nodeClusterPtr + (((v as usize)) << 2));
          if (cu == cv) continue;
          if (cu == c) {
            let pv = load<i32>(clusterPartPtr + (((cv as usize)) << 2));
            if (pv == candP) candEdges++;
          } else if (cv == c) {
            let pu = load<i32>(clusterPartPtr + (((cu as usize)) << 2));
            if (pu == candP) candEdges++;
          }
        }

        let gain = candEdges - ownEdges;
        if (gain > bestGain) {
          bestGain = gain;
          bestP = candP;
        }
      }

      if (bestP != curP && bestGain > 0) {
        store<i32>(clusterPartPtr + (((c as usize)) << 2), bestP);
        store<i32>(partLoadPtr + (((curP as usize)) << 2), curPartLoad - w);
        let dstLoad = load<i32>(partLoadPtr + (((bestP as usize)) << 2));
        store<i32>(partLoadPtr + (((bestP as usize)) << 2), dstLoad + w);
        improved = true;
      }
    }
    if (!improved) break;
  }

  // 5. Write node partition assignments and count cut delay lines
  for (let i: u32 = 0; i < nNodes; i++) {
    let c = load<i32>(nodeClusterPtr + (((i as usize)) << 2));
    let p = load<i32>(clusterPartPtr + (((c as usize)) << 2));
    store<i32>(outNodePartPtr + (((i as usize)) << 2), p);
  }

  let cutLines: i32 = 0;
  for (let l: u32 = 0; l < nDelayLines; l++) {
    let tau = load<f64>(lineDelaySecPtr + (((l as usize)) << 3));
    if (tau + 1e-12 < dtSec) continue;
    let u = load<i32>(lineFromPtr + (((l as usize)) << 2));
    let v = load<i32>(lineToPtr + (((l as usize)) << 2));
    if (u >= 0 && (u as u32) < nNodes && v >= 0 && (v as u32) < nNodes) {
      let pu = load<i32>(outNodePartPtr + (((u as usize)) << 2));
      let pv = load<i32>(outNodePartPtr + (((v as usize)) << 2));
      if (pu != pv) cutLines++;
    }
  }

  return cutLines;
}
