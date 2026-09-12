/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview WASM In-Place DPO (Double Pushout) Graph Rewriting Kernel
 *
 * Implements algebraic in-place graph rewriting in WASM linear memory:
 *   L <-- K --> R
 * Enforces the categorical Gluing Condition (Dangling Edge Condition + Identification Condition)
 * and performs zero-allocation slot recycling via freelists.
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { atomicChunkAlloc } from "./arena";

export const DPO_NODE_STRIDE = 4;
export const DPO_NODE_TYPE = 0;          // u16 type | u16 flags
export const DPO_NODE_DEGREE = 1;        // total incident edges
export const DPO_NODE_FIRST_EDGE = 2;    // pointer to first edge in incident linked-list
export const DPO_NODE_FREELIST_NEXT = 3; // next free node slot when tombstoned

export const DPO_EDGE_STRIDE = 4;
export const DPO_EDGE_SOURCE = 0;
export const DPO_EDGE_TARGET = 1;
export const DPO_EDGE_TYPE = 2;          // u16 edgeType | u16 flags
export const DPO_EDGE_NEXT = 3;          // next edge linked in incident list

export const DPO_FLAG_ACTIVE: u16 = 0x0001;
export const DPO_FLAG_TOMBSTONE: u16 = 0x0002;
export const DPO_FLAG_PRESERVED: u16 = 0x0004;

export const DPO_STATUS_SUCCESS: u32 = 0;
export const DPO_STATUS_DANGLING_EDGE_VIOLATION: u32 = 1;
export const DPO_STATUS_IDENTIFICATION_VIOLATION: u32 = 2;
export const DPO_STATUS_MATCH_NOT_FOUND: u32 = 3;

/**
 * In-memory graph adjacency structure for zero-GC DPO rewriting.
 */
@unmanaged
export class DpoGraph {
  nodes: ChunkedUint32Array;
  edges: ChunkedUint32Array;
  nodeCount: u32;
  edgeCount: u32;
  freeNodeHead: u32; // 1-based slot index (0 = empty)

  init(initialNodes: u32 = 512, initialEdges: u32 = 1024): void {
    this.nodes = createChunkedUint32Array(initialNodes * DPO_NODE_STRIDE);
    this.edges = createChunkedUint32Array(initialEdges * DPO_EDGE_STRIDE);
    this.nodeCount = 0;
    this.edgeCount = 0;
    this.freeNodeHead = 0;
  }

  @inline
  createNode(typeHash: u16): u32 {
    let slot: u32;
    if (this.freeNodeHead != 0) {
      slot = this.freeNodeHead - 1;
      let offset = slot * DPO_NODE_STRIDE;
      this.freeNodeHead = this.nodes.get(offset + DPO_NODE_FREELIST_NEXT);
    } else {
      slot = this.nodeCount++;
    }

    let offset = slot * DPO_NODE_STRIDE;
    this.nodes.set(offset + DPO_NODE_TYPE, ((typeHash as u32) << 16) | (DPO_FLAG_ACTIVE as u32));
    this.nodes.set(offset + DPO_NODE_DEGREE, 0);
    this.nodes.set(offset + DPO_NODE_FIRST_EDGE, 0);
    this.nodes.set(offset + DPO_NODE_FREELIST_NEXT, 0);

    return slot + 1; // 1-based Node ID
  }

  @inline
  getNodeDegree(nodeId: u32): u32 {
    if (nodeId == 0 || nodeId > this.nodeCount) return 0;
    let slot = nodeId - 1;
    let offset = slot * DPO_NODE_STRIDE;
    return this.nodes.get(offset + DPO_NODE_DEGREE);
  }

  @inline
  getNodeType(nodeId: u32): u16 {
    if (nodeId == 0 || nodeId > this.nodeCount) return 0;
    let slot = nodeId - 1;
    let offset = slot * DPO_NODE_STRIDE;
    return (this.nodes.get(offset + DPO_NODE_TYPE) >>> 16) as u16;
  }

  @inline
  isNodeActive(nodeId: u32): boolean {
    if (nodeId == 0 || nodeId > this.nodeCount) return false;
    let slot = nodeId - 1;
    let flags = (this.nodes.get(slot * DPO_NODE_STRIDE + DPO_NODE_TYPE) & 0xffff) as u16;
    return (flags & DPO_FLAG_ACTIVE) != 0 && (flags & DPO_FLAG_TOMBSTONE) == 0;
  }

  @inline
  addEdge(sourceNodeId: u32, targetNodeId: u32, edgeType: u16): u32 {
    if (!this.isNodeActive(sourceNodeId) || !this.isNodeActive(targetNodeId)) return 0;

    let edgeSlot = this.edgeCount++;
    let edgeOffset = edgeSlot * DPO_EDGE_STRIDE;

    let srcSlot = sourceNodeId - 1;
    let srcOffset = srcSlot * DPO_NODE_STRIDE;
    let oldHead = this.nodes.get(srcOffset + DPO_NODE_FIRST_EDGE);

    this.edges.set(edgeOffset + DPO_EDGE_SOURCE, sourceNodeId);
    this.edges.set(edgeOffset + DPO_EDGE_TARGET, targetNodeId);
    this.edges.set(edgeOffset + DPO_EDGE_TYPE, ((edgeType as u32) << 16) | (DPO_FLAG_ACTIVE as u32));
    this.edges.set(edgeOffset + DPO_EDGE_NEXT, oldHead);

    // Update source node head and degree
    this.nodes.set(srcOffset + DPO_NODE_FIRST_EDGE, edgeSlot + 1);
    let srcDeg = this.nodes.get(srcOffset + DPO_NODE_DEGREE);
    this.nodes.set(srcOffset + DPO_NODE_DEGREE, srcDeg + 1);

    // Update target node degree
    let tgtSlot = targetNodeId - 1;
    let tgtOffset = tgtSlot * DPO_NODE_STRIDE;
    let tgtDeg = this.nodes.get(tgtOffset + DPO_NODE_DEGREE);
    this.nodes.set(tgtOffset + DPO_NODE_DEGREE, tgtDeg + 1);

    return edgeSlot + 1; // 1-based edge ID
  }

  /**
   * Dangling Edge Condition Verification:
   * A node to be deleted MUST have all its incident edges matched in the deletion set.
   * If hostDegree > matchedIncidentDegree, deleting this node would leave dangling edges.
   */
  @inline
  checkDanglingEdge(nodeId: u32, matchedIncidentDegree: u32): boolean {
    let hostDeg = this.getNodeDegree(nodeId);
    return hostDeg == matchedIncidentDegree;
  }

  /**
   * Identification Condition Verification:
   * Two distinct rule variables mapping to the same host element must both be in K (preserved).
   */
  @inline
  checkIdentification(nodeId1: u32, isPreserved1: boolean, nodeId2: u32, isPreserved2: boolean): boolean {
    if (nodeId1 == nodeId2) {
      return isPreserved1 && isPreserved2;
    }
    return true;
  }

  /**
   * Pushout Complement (D = G \ (L \ K)):
   * Deletes node and recycles slot into freelist.
   */
  @inline
  deleteNode(nodeId: u32): boolean {
    if (!this.isNodeActive(nodeId)) return false;
    let slot = nodeId - 1;
    let offset = slot * DPO_NODE_STRIDE;

    // Mark tombstoned
    let meta = this.nodes.get(offset + DPO_NODE_TYPE);
    let flags = ((meta & 0xffff) as u16) | DPO_FLAG_TOMBSTONE;
    this.nodes.set(offset + DPO_NODE_TYPE, (meta & 0xffff0000) | (flags as u32));
    this.nodes.set(offset + DPO_NODE_DEGREE, 0);
    this.nodes.set(offset + DPO_NODE_FIRST_EDGE, 0);

    // Push into freelist for zero-allocation recycling
    this.nodes.set(offset + DPO_NODE_FREELIST_NEXT, this.freeNodeHead);
    this.freeNodeHead = slot + 1;
    return true;
  }

  /**
   * Rewires an existing edge to point to a new target node (gluing preserved K to R \ K).
   */
  @inline
  rewireEdgeTarget(edgeId: u32, newTargetNodeId: u32): boolean {
    if (edgeId == 0 || edgeId > this.edgeCount) return false;
    let edgeSlot = edgeId - 1;
    let edgeOffset = edgeSlot * DPO_EDGE_STRIDE;

    let oldTargetId = this.edges.get(edgeOffset + DPO_EDGE_TARGET);
    if (oldTargetId == newTargetNodeId) return true;

    // Decrement old target degree
    if (oldTargetId != 0) {
      let oldTgtSlot = oldTargetId - 1;
      let oldOffset = oldTgtSlot * DPO_NODE_STRIDE + DPO_NODE_DEGREE;
      let deg = this.nodes.get(oldOffset);
      if (deg > 0) this.nodes.set(oldOffset, deg - 1);
    }

    // Assign new target and increment degree
    this.edges.set(edgeOffset + DPO_EDGE_TARGET, newTargetNodeId);
    let newTgtSlot = newTargetNodeId - 1;
    let newOffset = newTgtSlot * DPO_NODE_STRIDE + DPO_NODE_DEGREE;
    let newDeg = this.nodes.get(newOffset);
    this.nodes.set(newOffset, newDeg + 1);

    return true;
  }
}

export function createDpoGraph(nodes: u32 = 512, edges: u32 = 1024): usize {
  let ptr = atomicChunkAlloc(sizeof<DpoGraph>());
  let g = changetype<DpoGraph>(ptr);
  g.init(nodes, edges);
  return ptr;
}

export function dpo_create_node(graphPtr: usize, typeHash: u16): u32 {
  return changetype<DpoGraph>(graphPtr).createNode(typeHash);
}

export function dpo_add_edge(graphPtr: usize, srcId: u32, tgtId: u32, edgeType: u16): u32 {
  return changetype<DpoGraph>(graphPtr).addEdge(srcId, tgtId, edgeType);
}

export function dpo_check_dangling_edge(graphPtr: usize, nodeId: u32, matchedDegree: u32): boolean {
  return changetype<DpoGraph>(graphPtr).checkDanglingEdge(nodeId, matchedDegree);
}

export function dpo_delete_node(graphPtr: usize, nodeId: u32): boolean {
  return changetype<DpoGraph>(graphPtr).deleteNode(nodeId);
}

export function dpo_rewire_edge_target(graphPtr: usize, edgeId: u32, newTargetId: u32): boolean {
  return changetype<DpoGraph>(graphPtr).rewireEdgeTarget(edgeId, newTargetId);
}
