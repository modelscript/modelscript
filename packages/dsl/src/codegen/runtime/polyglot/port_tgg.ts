// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
/**
 * @fileoverview WASM Conservative Physical Port TGG Balancer
 *
 * Implements Union-Find connection set unification, Kirchhoff zero-sum flow balances,
 * and potential variable equalities across multi-domain physical connectors
 * (e.g., Modelica Pin <-> SysML v2 Port <-> Bond Graph Junctions).
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import { atomicChunkAlloc } from "../arena";

export const PORT_STRIDE = 5;
export const PORT_ACROSS_VAR = 0;   // Across / Potential variable ID (Voltage, Pressure, Temp)
export const PORT_FLOW_VAR = 1;     // Through / Flow variable ID (Current, MassFlow, HeatFlow)
export const PORT_PARENT = 2;       // Union-Find parent pointer
export const PORT_RANK = 3;         // Union-Find rank
export const PORT_NEXT_MEMBER = 4;  // Circular linked-list next slot in the same junction

export const JUNCTION_FLAG_BALANCED: u32 = 0x0001;

/**
 * Physical Connector Balancer in WASM linear memory.
 */
@unmanaged
export class TggPortBalancer {
  ports: ChunkedUint32Array;
  portCount: u32;
  junctionCount: u32;

  init(initialCapacity: u32 = 256): void {
    this.ports = createChunkedUint32Array(initialCapacity * PORT_STRIDE);
    this.portCount = 0;
    this.junctionCount = 0;
  }

  @inline
  registerPort(acrossVarId: u32, flowVarId: u32): u32 {
    let slot = this.portCount++;
    this.junctionCount++;
    let offset = slot * PORT_STRIDE;
    this.ports.set(offset + PORT_ACROSS_VAR, acrossVarId);
    this.ports.set(offset + PORT_FLOW_VAR, flowVarId);
    this.ports.set(offset + PORT_PARENT, slot); // Self-parented initially
    this.ports.set(offset + PORT_RANK, 0);
    this.ports.set(offset + PORT_NEXT_MEMBER, slot); // Singleton circular list
    return slot + 1; // 1-based Port ID
  }

  @inline
  find(portId: u32): u32 {
    if (portId == 0 || portId > this.portCount) return 0;
    let slot = portId - 1;
    let root = slot;
    let steps: u32 = 0;
    while (steps <= this.portCount) {
      let parent = this.ports.get(root * PORT_STRIDE + PORT_PARENT);
      if (parent == root || parent >= this.portCount) break;
      root = parent;
      steps++;
    }
    let curr = slot;
    steps = 0;
    while (curr != root && curr < this.portCount && steps <= this.portCount) {
      let nxt = this.ports.get(curr * PORT_STRIDE + PORT_PARENT);
      this.ports.set(curr * PORT_STRIDE + PORT_PARENT, root);
      curr = nxt;
      steps++;
    }
    return root + 1;
  }

  @inline
  union(portA: u32, portB: u32): boolean {
    let rootA = this.find(portA);
    let rootB = this.find(portB);
    if (rootA == 0 || rootB == 0 || rootA == rootB) return false;

    let slotA = rootA - 1;
    let slotB = rootB - 1;
    let rankA = this.ports.get(slotA * PORT_STRIDE + PORT_RANK);
    let rankB = this.ports.get(slotB * PORT_STRIDE + PORT_RANK);

    if (rankA < rankB) {
      this.ports.set(slotA * PORT_STRIDE + PORT_PARENT, slotB);
    } else if (rankA > rankB) {
      this.ports.set(slotB * PORT_STRIDE + PORT_PARENT, slotA);
    } else {
      this.ports.set(slotB * PORT_STRIDE + PORT_PARENT, slotA);
      this.ports.set(slotA * PORT_STRIDE + PORT_RANK, rankA + 1);
    }

    // O(1) circular list splice: swap next pointers of slotA and slotB
    let nextA = this.ports.get(slotA * PORT_STRIDE + PORT_NEXT_MEMBER);
    let nextB = this.ports.get(slotB * PORT_STRIDE + PORT_NEXT_MEMBER);
    this.ports.set(slotA * PORT_STRIDE + PORT_NEXT_MEMBER, nextB);
    this.ports.set(slotB * PORT_STRIDE + PORT_NEXT_MEMBER, nextA);

    if (this.junctionCount > 0) this.junctionCount--;
    return true;
  }

  @inline
  getAcrossVar(portId: u32): u32 {
    if (portId == 0 || portId > this.portCount) return 0;
    return this.ports.get((portId - 1) * PORT_STRIDE + PORT_ACROSS_VAR);
  }

  @inline
  getFlowVar(portId: u32): u32 {
    if (portId == 0 || portId > this.portCount) return 0;
    return this.ports.get((portId - 1) * PORT_STRIDE + PORT_FLOW_VAR);
  }

  /**
   * Evaluates Kirchhoff conservation balances across the connected set:
   * 1. Across/Potential variable compatibility across ports in the same junction
   * 2. Through/Flow variable zero-sum: |sum(flow(port_k))| <= tolerance
   */
  @inline
  isSameJunction(portA: u32, portB: u32): boolean {
    let rA = this.find(portA);
    return rA != 0 && rA == this.find(portB);
  }

  verifyAcrossCompatibility(portA: u32, portB: u32): boolean {
    if (!this.isSameJunction(portA, portB)) return false;
    let aA = this.getAcrossVar(portA);
    let aB = this.getAcrossVar(portB);
    return aA != 0 && aB != 0;
  }

  verifyJunctionFlowBalance(portId: u32, flowsPtr: usize, tolerance: f64 = 1e-6): boolean {
    let root = this.find(portId);
    if (root == 0 || flowsPtr == 0) return false;
    let startSlot = root - 1;
    let curr = startSlot;
    let netFlow: f64 = 0.0;
    let memberCount: u32 = 0;
    let guard: u32 = 0;
    while (guard < this.portCount) {
      netFlow += load<f64>(flowsPtr + ((curr as usize) << 3));
      memberCount++;
      curr = this.ports.get(curr * PORT_STRIDE + PORT_NEXT_MEMBER);
      if (curr == startSlot || curr >= this.portCount) break;
      guard++;
    }
    return memberCount > 0 && Math.abs(netFlow) <= tolerance;
  }
}

export function createPortBalancer(capacity: u32 = 256): usize {
  let ptr = atomicChunkAlloc(sizeof<TggPortBalancer>());
  let b = changetype<TggPortBalancer>(ptr);
  b.init(capacity);
  return ptr;
}

export function port_register(ptr: usize, acrossVar: u32, flowVar: u32): u32 {
  return changetype<TggPortBalancer>(ptr).registerPort(acrossVar, flowVar);
}

export function port_connect(ptr: usize, portA: u32, portB: u32): boolean {
  return changetype<TggPortBalancer>(ptr).union(portA, portB);
}

export function port_verify_junction_balance(ptr: usize, portId: u32, flowsPtr: usize, tolerance: f64 = 1e-6): boolean {
  return changetype<TggPortBalancer>(ptr).verifyJunctionFlowBalance(portId, flowsPtr, tolerance);
}

export function port_is_same_junction(ptr: usize, portA: u32, portB: u32): boolean {
  return changetype<TggPortBalancer>(ptr).isSameJunction(portA, portB);
}
