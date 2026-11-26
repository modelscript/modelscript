// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanvasSpatialIndex } from "../core/spatial-index.js";
import type { WorldBounds, WorldPoint } from "../schema/canvas-document.js";

/** Bitflags packed into SoaSceneGraph.nodeFlags (Uint32Array). */
export const SceneNodeFlags = {
  NONE: 0,
  VISIBLE: 1 << 0,
  SELECTED: 1 << 1,
  HOVERED: 1 << 2,
  LOCKED: 1 << 3,
  READONLY: 1 << 4,
  EPHEMERAL: 1 << 5,
  PORTAL: 1 << 6,
  WIDGET: 1 << 7,
  CONTAINER: 1 << 8,
  DIRTY: 1 << 9,
} as const;

export interface SoaPortRecord {
  id: string;
  nodeId: string;
  group: string;
  localX: number;
  localY: number;
  angleDeg: number;
  direction?: string | undefined;
  /** Offset into SoaSceneGraph.portWorldCoords (stride 4: wx, wy, nx, ny). */
  slot: number;
}

export interface SoaEdgeRecord {
  id: string;
  sourceNodeId: string;
  sourcePortId?: string | undefined;
  sourcePoint?: WorldPoint | undefined;
  targetNodeId: string;
  targetPortId?: string | undefined;
  targetPoint?: WorldPoint | undefined;
  vertices: WorldPoint[];
  routePoints: WorldPoint[];
  zIndex: number;
  flags: number;
}

export interface SoaNodeSummary {
  handle: number;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  zIndex: number;
  flags: number;
  parentHandle: number;
}

interface SpatialNodeItem {
  id: string;
  handle: number;
  bounds: WorldBounds;
  zIndex: number;
}

const TRANSFORM_STRIDE = 8; // x, y, width, height, angleDeg, flipX, flipY, opacity
const PORT_STRIDE = 4; // wx, wy, nx, ny

/**
 * 100% DOM-free Data-Oriented Struct-of-Arrays (SoA) Scene Graph.
 *
 * Designed to scale to 50,000+ schematic nodes & edges at 60-120 FPS, share flat
 * Float32Array coordinate buffers with WASM layout/routing kernels, and power
 * Desktop 2D, 3D Spatial, WebXR VR, and headless export from one source of truth.
 */
export class SoaSceneGraph {
  private capacity: number;
  private count = 0;

  /** Packed [x, y, width, height, angleDeg, flipX(0|1), flipY(0|1), opacity] per handle. */
  public nodeTransforms: Float64Array;
  public nodeFlags: Uint32Array;
  public nodeZIndex: Int32Array;
  public nodeParent: Int32Array;

  /** Packed [worldX, worldY, normalX, normalY] per port slot. */
  private portCapacity: number;
  private portCount = 0;
  private freePortSlots: number[] = [];
  public portWorldCoords: Float64Array;

  private idToHandle = new Map<string, number>();
  private handleToId: (string | null)[] = [];
  private freeHandles: number[] = [];
  private childrenOf = new Map<number, Set<number>>();
  private nodePorts = new Map<string, SoaPortRecord[]>();
  private edges = new Map<string, SoaEdgeRecord>();
  private nodeConnectedEdges = new Map<string, Set<string>>();

  private readonly spatialIndex: CanvasSpatialIndex<SpatialNodeItem>;
  private spatialDirty = true;

  constructor(initialCapacity = 1024, gridCellSize = 256) {
    this.capacity = Math.max(64, initialCapacity);
    this.nodeTransforms = new Float64Array(this.capacity * TRANSFORM_STRIDE);
    this.nodeFlags = new Uint32Array(this.capacity);
    this.nodeZIndex = new Int32Array(this.capacity);
    this.nodeParent = new Int32Array(this.capacity);
    this.nodeParent.fill(-1);

    this.portCapacity = Math.max(128, initialCapacity * 2);
    this.portWorldCoords = new Float64Array(this.portCapacity * PORT_STRIDE);

    this.spatialIndex = new CanvasSpatialIndex<SpatialNodeItem>(gridCellSize);
  }

  public get nodeCount(): number {
    return this.idToHandle.size;
  }

  public get edgeCount(): number {
    return this.edges.size;
  }

  private ensureNodeCapacity(neededHandle: number): void {
    if (neededHandle < this.capacity) return;
    let nextCap = this.capacity;
    while (nextCap <= neededHandle) nextCap *= 2;

    const nextTransforms = new Float64Array(nextCap * TRANSFORM_STRIDE);
    nextTransforms.set(this.nodeTransforms);
    this.nodeTransforms = nextTransforms;

    const nextFlags = new Uint32Array(nextCap);
    nextFlags.set(this.nodeFlags);
    this.nodeFlags = nextFlags;

    const nextZ = new Int32Array(nextCap);
    nextZ.set(this.nodeZIndex);
    this.nodeZIndex = nextZ;

    const nextParent = new Int32Array(nextCap);
    nextParent.fill(-1);
    nextParent.set(this.nodeParent);
    this.nodeParent = nextParent;

    this.capacity = nextCap;
  }

  private ensurePortCapacity(neededSlot: number): void {
    if (neededSlot < this.portCapacity) return;
    let nextCap = this.portCapacity;
    while (nextCap <= neededSlot) nextCap *= 2;
    const nextCoords = new Float64Array(nextCap * PORT_STRIDE);
    nextCoords.set(this.portWorldCoords);
    this.portWorldCoords = nextCoords;
    this.portCapacity = nextCap;
  }

  private syncSpatialNode(id: string, handle: number): void {
    if (this.spatialDirty) return;
    if (((this.nodeFlags[handle] ?? 0) & SceneNodeFlags.VISIBLE) === 0) {
      this.spatialIndex.remove(id);
      return;
    }
    this.spatialIndex.upsert({
      id,
      handle,
      bounds: this.getNodeWorldAABB(handle),
      zIndex: this.nodeZIndex[handle] ?? 0,
    });
  }

  public upsertNode(spec: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    angleDeg?: number | undefined;
    flipX?: boolean | undefined;
    flipY?: boolean | undefined;
    opacity?: number | undefined;
    zIndex?: number | undefined;
    flags?: number | undefined;
    parentId?: string | null | undefined;
  }): number {
    let handle = this.idToHandle.get(spec.id);
    let preservedSelected = 0;
    if (handle === undefined) {
      handle = this.freeHandles.length > 0 ? this.freeHandles.pop()! : this.count++;
      this.ensureNodeCapacity(handle);
      this.idToHandle.set(spec.id, handle);
      this.handleToId[handle] = spec.id;
    } else {
      preservedSelected = (this.nodeFlags[handle] ?? 0) & SceneNodeFlags.SELECTED;
    }

    const base = handle * TRANSFORM_STRIDE;
    this.nodeTransforms[base] = spec.x;
    this.nodeTransforms[base + 1] = spec.y;
    this.nodeTransforms[base + 2] = Math.max(0, spec.width);
    this.nodeTransforms[base + 3] = Math.max(0, spec.height);
    this.nodeTransforms[base + 4] = spec.angleDeg ?? 0;
    this.nodeTransforms[base + 5] = spec.flipX ? 1 : 0;
    this.nodeTransforms[base + 6] = spec.flipY ? 1 : 0;
    this.nodeTransforms[base + 7] = spec.opacity ?? 1;

    this.nodeFlags[handle] = (spec.flags ?? SceneNodeFlags.VISIBLE) | preservedSelected | SceneNodeFlags.DIRTY;
    this.nodeZIndex[handle] = spec.zIndex ?? 0;

    if (spec.parentId !== undefined) {
      this.setParent(spec.id, spec.parentId);
    }

    this.recomputePortsForNode(spec.id);
    this.syncSpatialNode(spec.id, handle);
    return handle;
  }

  public removeNode(id: string): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;

    const oldParent = this.nodeParent[handle] ?? -1;
    if (oldParent >= 0) {
      this.childrenOf.get(oldParent)?.delete(handle);
    }
    const kids = this.childrenOf.get(handle);
    if (kids) {
      for (const childHandle of kids) {
        this.nodeParent[childHandle] = -1;
      }
      this.childrenOf.delete(handle);
    }

    const oldPorts = this.nodePorts.get(id);
    if (oldPorts) {
      for (const p of oldPorts) {
        this.freePortSlots.push(p.slot);
      }
      this.nodePorts.delete(id);
    }

    this.idToHandle.delete(id);
    this.handleToId[handle] = null;
    this.nodeFlags[handle] = 0;
    this.nodeParent[handle] = -1;
    this.freeHandles.push(handle);
    this.nodeConnectedEdges.delete(id);
    if (!this.spatialDirty) {
      this.spatialIndex.remove(id);
    }
    return true;
  }

  public getHandle(id: string): number | undefined {
    return this.idToHandle.get(id);
  }

  public getNodeId(handle: number): string | null {
    return this.handleToId[handle] ?? null;
  }

  public getNode(id: string): SoaNodeSummary | null {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return null;
    return this.getNodeByHandle(handle);
  }

  public getNodeByHandle(handle: number): SoaNodeSummary | null {
    const id = this.handleToId[handle];
    if (!id) return null;
    const base = handle * TRANSFORM_STRIDE;
    return {
      handle,
      id,
      x: this.nodeTransforms[base] ?? 0,
      y: this.nodeTransforms[base + 1] ?? 0,
      width: this.nodeTransforms[base + 2] ?? 0,
      height: this.nodeTransforms[base + 3] ?? 0,
      angleDeg: this.nodeTransforms[base + 4] ?? 0,
      flipX: (this.nodeTransforms[base + 5] ?? 0) !== 0,
      flipY: (this.nodeTransforms[base + 6] ?? 0) !== 0,
      opacity: this.nodeTransforms[base + 7] ?? 1,
      zIndex: this.nodeZIndex[handle] ?? 0,
      flags: this.nodeFlags[handle] ?? 0,
      parentHandle: this.nodeParent[handle] ?? -1,
    };
  }

  public setNodePosition(id: string, x: number, y: number): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;
    const base = handle * TRANSFORM_STRIDE;
    const oldX = this.nodeTransforms[base] ?? 0;
    const oldY = this.nodeTransforms[base + 1] ?? 0;
    const dx = x - oldX;
    const dy = y - oldY;
    this.nodeTransforms[base] = x;
    this.nodeTransforms[base + 1] = y;
    this.nodeFlags[handle] = (this.nodeFlags[handle] ?? 0) | SceneNodeFlags.DIRTY;
    this.recomputePortsForNode(id);
    this.syncSpatialNode(id, handle);

    // Move children rigidly when parent moves
    const kids = this.childrenOf.get(handle);
    if (kids && (dx !== 0 || dy !== 0)) {
      for (const childHandle of kids) {
        const childId = this.handleToId[childHandle];
        if (!childId) continue;
        const cBase = childHandle * TRANSFORM_STRIDE;
        this.setNodePosition(
          childId,
          (this.nodeTransforms[cBase] ?? 0) + dx,
          (this.nodeTransforms[cBase + 1] ?? 0) + dy,
        );
      }
    }

    return true;
  }

  public setNodeSize(id: string, width: number, height: number): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;
    const base = handle * TRANSFORM_STRIDE;
    this.nodeTransforms[base + 2] = Math.max(0, width);
    this.nodeTransforms[base + 3] = Math.max(0, height);
    this.nodeFlags[handle] = (this.nodeFlags[handle] ?? 0) | SceneNodeFlags.DIRTY;
    this.recomputePortsForNode(id);
    this.syncSpatialNode(id, handle);
    return true;
  }

  public setNodeRotation(id: string, angleDeg: number): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;
    const base = handle * TRANSFORM_STRIDE;
    this.nodeTransforms[base + 4] = ((angleDeg % 360) + 360) % 360;
    this.nodeFlags[handle] = (this.nodeFlags[handle] ?? 0) | SceneNodeFlags.DIRTY;
    this.recomputePortsForNode(id);
    this.syncSpatialNode(id, handle);
    return true;
  }

  public setNodeZIndex(id: string, zIndex: number): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;
    this.nodeZIndex[handle] = zIndex;
    this.nodeFlags[handle] = (this.nodeFlags[handle] ?? 0) | SceneNodeFlags.DIRTY;
    this.syncSpatialNode(id, handle);
    return true;
  }

  public setNodeFlip(id: string, flipX: boolean, flipY: boolean): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;
    const base = handle * TRANSFORM_STRIDE;
    this.nodeTransforms[base + 5] = flipX ? 1 : 0;
    this.nodeTransforms[base + 6] = flipY ? 1 : 0;
    this.nodeFlags[handle] = (this.nodeFlags[handle] ?? 0) | SceneNodeFlags.DIRTY;
    this.recomputePortsForNode(id);
    return true;
  }

  public setNodeFlag(id: string, flag: number, enabled: boolean): void {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return;
    const cur = this.nodeFlags[handle] ?? 0;
    this.nodeFlags[handle] = enabled ? cur | flag : cur & ~flag;
    if (flag === SceneNodeFlags.VISIBLE) {
      this.syncSpatialNode(id, handle);
    }
  }

  public hasNodeFlag(id: string, flag: number): boolean {
    const handle = this.idToHandle.get(id);
    if (handle === undefined) return false;
    return ((this.nodeFlags[handle] ?? 0) & flag) !== 0;
  }

  public setParent(childId: string, parentId: string | null): void {
    const childHandle = this.idToHandle.get(childId);
    if (childHandle === undefined) return;

    if (parentId !== null) {
      const candidateParent = this.idToHandle.get(parentId);
      if (candidateParent === undefined || candidateParent === childHandle) {
        const oldParent = this.nodeParent[childHandle] ?? -1;
        if (oldParent >= 0) this.childrenOf.get(oldParent)?.delete(childHandle);
        this.nodeParent[childHandle] = -1;
        return;
      }
      // Prevent cycles: walk up from candidateParent to ensure childHandle is not an ancestor
      let anc = candidateParent;
      while (anc >= 0) {
        if (anc === childHandle) return;
        anc = this.nodeParent[anc] ?? -1;
      }
    }

    const oldParent = this.nodeParent[childHandle] ?? -1;
    if (oldParent >= 0) {
      this.childrenOf.get(oldParent)?.delete(childHandle);
    }

    if (parentId === null) {
      this.nodeParent[childHandle] = -1;
      return;
    }

    const parentHandle = this.idToHandle.get(parentId)!;
    this.nodeParent[childHandle] = parentHandle;
    let kids = this.childrenOf.get(parentHandle);
    if (!kids) {
      kids = new Set();
      this.childrenOf.set(parentHandle, kids);
    }
    kids.add(childHandle);
  }

  public getChildIds(parentId: string): string[] {
    const parentHandle = this.idToHandle.get(parentId);
    if (parentHandle === undefined) return [];
    const kids = this.childrenOf.get(parentHandle);
    if (!kids) return [];
    const out: string[] = [];
    for (const h of kids) {
      const id = this.handleToId[h];
      if (id) out.push(id);
    }
    return out;
  }

  /** Returns true if `ancestorId` is an ancestor of `nodeId` in the parent hierarchy. */
  public isDescendantOf(nodeId: string, ancestorId: string): boolean {
    const startHandle = this.idToHandle.get(nodeId);
    const ancHandle = this.idToHandle.get(ancestorId);
    if (startHandle === undefined || ancHandle === undefined) return false;
    let cur = this.nodeParent[startHandle] ?? -1;
    while (cur >= 0) {
      if (cur === ancHandle) return true;
      cur = this.nodeParent[cur] ?? -1;
    }
    return false;
  }

  /** Collects all descendant IDs of `parentId` recursively. */
  public getDescendantIds(parentId: string): string[] {
    const out: string[] = [];
    const stack = this.getChildIds(parentId);
    while (stack.length > 0) {
      const cid = stack.pop()!;
      out.push(cid);
      for (const grand of this.getChildIds(cid)) {
        stack.push(grand);
      }
    }
    return out;
  }

  /** Registers/replaces ports on a node and computes their world coords & outward normals. */
  public setNodePorts(
    nodeId: string,
    ports: {
      id: string;
      group?: string | undefined;
      x: number;
      y: number;
      angle?: number | undefined;
      direction?: string | undefined;
    }[],
  ): SoaPortRecord[] {
    const existing = this.nodePorts.get(nodeId);
    if (existing) {
      for (const old of existing) {
        this.freePortSlots.push(old.slot);
      }
    }
    const records: SoaPortRecord[] = [];
    for (const p of ports) {
      const slot = this.freePortSlots.length > 0 ? this.freePortSlots.pop()! : this.portCount++;
      this.ensurePortCapacity(slot);
      records.push({
        id: p.id,
        nodeId,
        group: p.group ?? "default",
        localX: p.x,
        localY: p.y,
        angleDeg: p.angle ?? 0,
        direction: p.direction,
        slot,
      });
    }
    this.nodePorts.set(nodeId, records);
    this.recomputePortsForNode(nodeId);
    return records;
  }

  public getNodePorts(nodeId: string): SoaPortRecord[] {
    return this.nodePorts.get(nodeId) ?? [];
  }

  public getPortWorldPosition(nodeId: string, portId: string): { x: number; y: number; nx: number; ny: number } | null {
    const ports = this.nodePorts.get(nodeId);
    if (!ports) return null;
    const p = ports.find((item) => item.id === portId);
    if (!p) return null;
    const off = p.slot * PORT_STRIDE;
    return {
      x: this.portWorldCoords[off] ?? 0,
      y: this.portWorldCoords[off + 1] ?? 0,
      nx: this.portWorldCoords[off + 2] ?? 1,
      ny: this.portWorldCoords[off + 3] ?? 0,
    };
  }

  /** Recomputes world-space coordinates and outward normals for all ports of a node. */
  public recomputePortsForNode(nodeId: string): void {
    const node = this.getNode(nodeId);
    const ports = this.nodePorts.get(nodeId);
    if (!node || !ports || ports.length === 0) return;

    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const rad = (node.angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (const p of ports) {
      // Local position relative to node top-left; apply flip around node center
      let lx = p.localX;
      let ly = p.localY;
      if (node.flipX) lx = node.width - lx;
      if (node.flipY) ly = node.height - ly;

      const relX = lx - node.width / 2;
      const relY = ly - node.height / 2;
      const wx = cx + relX * cos - relY * sin;
      const wy = cy + relX * sin + relY * cos;

      // Compute outward normal from nearest node edge (or radial if interior)
      let nlx = 0;
      let nly = 0;
      const dLeft = Math.abs(lx);
      const dRight = Math.abs(node.width - lx);
      const dTop = Math.abs(ly);
      const dBottom = Math.abs(node.height - ly);
      const minD = Math.min(dLeft, dRight, dTop, dBottom);
      if (minD === dLeft) nlx = -1;
      else if (minD === dRight) nlx = 1;
      else if (minD === dTop) nly = -1;
      else nly = 1;

      const nx = nlx * cos - nly * sin;
      const ny = nlx * sin + nly * cos;

      const off = p.slot * PORT_STRIDE;
      this.portWorldCoords[off] = wx;
      this.portWorldCoords[off + 1] = wy;
      this.portWorldCoords[off + 2] = nx;
      this.portWorldCoords[off + 3] = ny;
    }
  }

  /** Computes axis-aligned world bounding box (accounting for rotation). */
  public getNodeWorldAABB(handle: number): WorldBounds {
    const base = handle * TRANSFORM_STRIDE;
    const x = this.nodeTransforms[base] ?? 0;
    const y = this.nodeTransforms[base + 1] ?? 0;
    const w = this.nodeTransforms[base + 2] ?? 0;
    const h = this.nodeTransforms[base + 3] ?? 0;
    const angleDeg = this.nodeTransforms[base + 4] ?? 0;
    if (angleDeg === 0 || angleDeg % 360 === 0) {
      return { x, y, width: w, height: h };
    }
    const rad = (angleDeg * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    const rotW = w * absCos + h * absSin;
    const rotH = w * absSin + h * absCos;
    const cx = x + w / 2;
    const cy = y + h / 2;
    return {
      x: cx - rotW / 2,
      y: cy - rotH / 2,
      width: rotW,
      height: rotH,
    };
  }

  /** Upserts an edge and tracks node-to-edge incidence for O(degree) rerouting. */
  public upsertEdge(edge: SoaEdgeRecord): void {
    const prev = this.edges.get(edge.id);
    if (prev) {
      this.nodeConnectedEdges.get(prev.sourceNodeId)?.delete(edge.id);
      this.nodeConnectedEdges.get(prev.targetNodeId)?.delete(edge.id);
    }
    this.edges.set(edge.id, edge);
    if (edge.sourceNodeId) {
      let s = this.nodeConnectedEdges.get(edge.sourceNodeId);
      if (!s) {
        s = new Set();
        this.nodeConnectedEdges.set(edge.sourceNodeId, s);
      }
      s.add(edge.id);
    }
    if (edge.targetNodeId) {
      let t = this.nodeConnectedEdges.get(edge.targetNodeId);
      if (!t) {
        t = new Set();
        this.nodeConnectedEdges.set(edge.targetNodeId, t);
      }
      t.add(edge.id);
    }
  }

  public removeEdge(id: string): boolean {
    const prev = this.edges.get(id);
    if (!prev) return false;
    this.nodeConnectedEdges.get(prev.sourceNodeId)?.delete(id);
    this.nodeConnectedEdges.get(prev.targetNodeId)?.delete(id);
    this.edges.delete(id);
    return true;
  }

  public getEdge(id: string): SoaEdgeRecord | undefined {
    return this.edges.get(id);
  }

  public getAllEdges(): SoaEdgeRecord[] {
    return Array.from(this.edges.values());
  }

  public getConnectedEdgeIds(nodeId: string): string[] {
    return Array.from(this.nodeConnectedEdges.get(nodeId) ?? []);
  }

  public resolveEdgeEndpoints(edge: SoaEdgeRecord): { source: WorldPoint; target: WorldPoint } {
    const resolveOne = (nodeId: string, portId: string | undefined, fallbackPt: WorldPoint | undefined): WorldPoint => {
      if (nodeId && portId) {
        const pt = this.getPortWorldPosition(nodeId, portId);
        if (pt) return { x: pt.x, y: pt.y };
      }
      if (nodeId) {
        const node = this.getNode(nodeId);
        if (node) {
          return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
        }
      }
      return fallbackPt ?? { x: 0, y: 0 };
    };

    return {
      source: resolveOne(edge.sourceNodeId, edge.sourcePortId, edge.sourcePoint),
      target: resolveOne(edge.targetNodeId, edge.targetPortId, edge.targetPoint),
    };
  }

  private ensureSpatialIndex(): void {
    if (!this.spatialDirty) return;
    const items: SpatialNodeItem[] = [];
    for (const [id, handle] of this.idToHandle.entries()) {
      if (((this.nodeFlags[handle] ?? 0) & SceneNodeFlags.VISIBLE) === 0) continue;
      items.push({
        id,
        handle,
        bounds: this.getNodeWorldAABB(handle),
        zIndex: this.nodeZIndex[handle] ?? 0,
      });
    }
    this.spatialIndex.rebuild(items);
    this.spatialDirty = false;
  }

  /** Fast O(K_visible) frustum query returning visible node IDs sorted by zIndex. */
  public queryVisibleNodes(worldRect: WorldBounds): SoaNodeSummary[] {
    this.ensureSpatialIndex();
    const hits = this.spatialIndex.queryRect(worldRect);
    const out: SoaNodeSummary[] = [];
    for (const item of hits) {
      const summary = this.getNodeByHandle(item.handle);
      if (summary) out.push(summary);
    }
    out.sort((a, b) => a.zIndex - b.zIndex || a.handle - b.handle);
    return out;
  }

  /** Exact rotated-OBB point hit test, returning topmost non-ephemeral node at (u, v). */
  public hitTestNode(u: number, v: number, includeEphemeral = false): SoaNodeSummary | null {
    const candidates = this.queryVisibleNodes({ x: u - 1, y: v - 1, width: 2, height: 2 });
    // Traverse top-most zIndex first
    for (let i = candidates.length - 1; i >= 0; i--) {
      const node = candidates[i]!;
      if (!includeEphemeral && (node.flags & SceneNodeFlags.EPHEMERAL) !== 0) continue;
      if (this.pointInNodeOBB(node, u, v)) {
        return node;
      }
    }
    return null;
  }

  /** Tests whether world point (u, v) falls inside a possibly rotated node OBB. */
  public pointInNodeOBB(node: SoaNodeSummary, u: number, v: number, padding = 0): boolean {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const dx = u - cx;
    const dy = v - cy;
    const rad = (-node.angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    return Math.abs(lx) <= node.width / 2 + padding && Math.abs(ly) <= node.height / 2 + padding;
  }

  /** Finds nearest port within `radius` world units of (u, v). */
  public hitTestPort(
    u: number,
    v: number,
    radius = 12,
    excludeNodeId?: string,
    filter?: (nodeId: string, portId: string) => boolean,
  ): { nodeId: string; portId: string; x: number; y: number; dist: number } | null {
    const candidates = this.queryVisibleNodes({
      x: u - radius - 20,
      y: v - radius - 20,
      width: (radius + 20) * 2,
      height: (radius + 20) * 2,
    });
    let best: { nodeId: string; portId: string; x: number; y: number; dist: number } | null = null;
    for (const node of candidates) {
      if (excludeNodeId && node.id === excludeNodeId) continue;
      if ((node.flags & SceneNodeFlags.EPHEMERAL) !== 0) continue;
      const ports = this.nodePorts.get(node.id);
      if (!ports) continue;
      for (const p of ports) {
        if (filter && !filter(node.id, p.id)) continue;
        const off = p.slot * PORT_STRIDE;
        const wx = this.portWorldCoords[off] ?? 0;
        const wy = this.portWorldCoords[off + 1] ?? 0;
        const dist = Math.hypot(wx - u, wy - v);
        if (dist <= radius && (!best || dist < best.dist)) {
          best = { nodeId: node.id, portId: p.id, x: wx, y: wy, dist };
        }
      }
    }
    return best;
  }

  /** Hit-tests edges by polyline segment distance within `tolerance` world units. */
  public hitTestEdge(
    u: number,
    v: number,
    tolerance = 8,
  ): { edge: SoaEdgeRecord; segmentIndex: number; dist: number } | null {
    let best: { edge: SoaEdgeRecord; segmentIndex: number; dist: number } | null = null;
    for (const edge of this.edges.values()) {
      const { source, target } = this.resolveEdgeEndpoints(edge);
      const pts =
        edge.routePoints.length > 0 ? [source, ...edge.routePoints, target] : [source, ...edge.vertices, target];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const dist = pointToSegmentDistance(u, v, a.x, a.y, b.x, b.y);
        if (dist <= tolerance && (!best || dist < best.dist)) {
          best = { edge, segmentIndex: i, dist };
        }
      }
    }
    return best;
  }

  /** Computes overall scene content bounds (excluding ephemeral overlays). */
  public getContentBounds(): WorldBounds | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const handle of this.idToHandle.values()) {
      const flags = this.nodeFlags[handle] ?? 0;
      if ((flags & SceneNodeFlags.VISIBLE) === 0) continue;
      if ((flags & SceneNodeFlags.EPHEMERAL) !== 0) continue;
      const bb = this.getNodeWorldAABB(handle);
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
      if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  /** Exports flat packed [x, y, w, h] buffer for zero-copy transfer to WASM layout/router kernels. */
  public packNodeRectsForWasm(): { ids: string[]; rects: Float32Array } {
    const ids: string[] = [];
    const rects = new Float32Array(this.idToHandle.size * 4);
    let idx = 0;
    for (const [id, handle] of this.idToHandle.entries()) {
      const base = handle * TRANSFORM_STRIDE;
      ids.push(id);
      rects[idx * 4] = this.nodeTransforms[base] ?? 0;
      rects[idx * 4 + 1] = this.nodeTransforms[base + 1] ?? 0;
      rects[idx * 4 + 2] = this.nodeTransforms[base + 2] ?? 0;
      rects[idx * 4 + 3] = this.nodeTransforms[base + 3] ?? 0;
      idx++;
    }
    return { ids, rects };
  }

  public clear(): void {
    this.idToHandle.clear();
    this.handleToId = [];
    this.freeHandles = [];
    this.freePortSlots = [];
    this.childrenOf.clear();
    this.nodePorts.clear();
    this.edges.clear();
    this.nodeConnectedEdges.clear();
    this.count = 0;
    this.portCount = 0;
    this.nodeFlags.fill(0);
    this.nodeParent.fill(-1);
    this.spatialIndex.clear();
    this.spatialDirty = true;
  }
}

export function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
