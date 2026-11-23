// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeSnapAndGuides, type AlignmentGuideLine } from "../core/alignment-guides.js";
import type { WorldBounds, WorldPoint } from "../schema/canvas-document.js";
import { SceneNodeFlags, SoaSceneGraph, type SoaNodeSummary } from "./soa-scene.js";

export type ResizeHandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

export type PointerFsmMode =
  | "idle"
  | "panning"
  | "dragging-nodes"
  | "marquee"
  | "resizing"
  | "rotating"
  | "wiring"
  | "dragging-segment"
  | "dragging-vertex"
  | "portal-focused";

/**
 * Abstract plane pointer event consumed identically by:
 *  - Desktop 2D mouse / touch / trackpad unprojection
 *  - 3D Spatial mouse ray-plane intersection
 *  - WebXR VR controller laser / hand-pinch ray-plane intersection
 */
export interface PlanePointerEvent {
  planeId: string;
  /** Plane-local world coordinate X. */
  u: number;
  /** Plane-local world coordinate Y. */
  v: number;
  /** Optional screen-space pixels for panning deltas. */
  screenX?: number | undefined;
  screenY?: number | undefined;
  button: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  phase: "down" | "move" | "up" | "cancel" | "dblclick";
  /** Optional explicit DOM port hit (from `.x6-port` / `[magnet="true"]` target). */
  pointerPortHit?: { nodeId: string; portId: string } | null | undefined;
}

export interface SpatialPlane3D {
  id: string;
  /** World-space origin (corresponds to plane u=0, v=0). */
  origin: [number, number, number];
  /** Unit right axis (+u direction). */
  right: [number, number, number];
  /** Unit down/up axis (+v direction). */
  down: [number, number, number];
  /** Unit normal axis (right x down). */
  normal: [number, number, number];
  /** Meters per world unit (e.g. 0.002 => 500 diagram units = 1 meter in VR). */
  unitsPerMeter: number;
}

export interface RayPlaneHit {
  hit: boolean;
  planeId: string;
  u: number;
  v: number;
  distance: number;
  worldPoint: [number, number, number];
}

/**
 * Projects a 3D ray (desktop 3D mouse or WebXR VR controller laser) onto a SpatialPlane3D
 * to produce exact diagram-plane `(u, v)` coordinates for zero-duplication 2D/3D/VR editing.
 */
export function projectRayToPlane(
  rayOrigin: [number, number, number],
  rayDir: [number, number, number],
  plane: SpatialPlane3D,
): RayPlaneHit {
  const denom = rayDir[0] * plane.normal[0] + rayDir[1] * plane.normal[1] + rayDir[2] * plane.normal[2];
  if (Math.abs(denom) < 1e-7) {
    return { hit: false, planeId: plane.id, u: 0, v: 0, distance: Infinity, worldPoint: [0, 0, 0] };
  }

  const diffX = plane.origin[0] - rayOrigin[0];
  const diffY = plane.origin[1] - rayOrigin[1];
  const diffZ = plane.origin[2] - rayOrigin[2];
  const t = (diffX * plane.normal[0] + diffY * plane.normal[1] + diffZ * plane.normal[2]) / denom;
  if (t < 0) {
    return { hit: false, planeId: plane.id, u: 0, v: 0, distance: t, worldPoint: [0, 0, 0] };
  }

  const hx = rayOrigin[0] + rayDir[0] * t;
  const hy = rayOrigin[1] + rayDir[1] * t;
  const hz = rayOrigin[2] + rayDir[2] * t;

  const relX = hx - plane.origin[0];
  const relY = hy - plane.origin[1];
  const relZ = hz - plane.origin[2];

  const uMeters = relX * plane.right[0] + relY * plane.right[1] + relZ * plane.right[2];
  const vMeters = relX * plane.down[0] + relY * plane.down[1] + relZ * plane.down[2];

  return {
    hit: true,
    planeId: plane.id,
    u: uMeters * plane.unitsPerMeter,
    v: vMeters * plane.unitsPerMeter,
    distance: t,
    worldPoint: [hx, hy, hz],
  };
}

export interface WiringPreview {
  sourceNodeId: string;
  sourcePortId: string;
  sourcePoint: WorldPoint;
  currentPoint: WorldPoint;
  snappedTarget?: { nodeId: string; portId: string; x: number; y: number } | null | undefined;
}

export interface PointerFsmCallbacks {
  onSelectionChange?: ((selectedNodeIds: string[], selectedEdgeIds: string[]) => void) | undefined;
  onNodesMoved?: ((moves: Record<string, WorldPoint>, committed: boolean) => void) | undefined;
  onNodeResized?: ((nodeId: string, bounds: WorldBounds, committed: boolean) => void) | undefined;
  onNodeRotated?: ((nodeId: string, angleDeg: number, committed: boolean) => void) | undefined;
  onWireConnected?:
    | ((conn: { sourceNodeId: string; sourcePortId: string; targetNodeId: string; targetPortId: string }) => void)
    | undefined;
  onEdgeVerticesChanged?: ((edgeId: string, vertices: WorldPoint[], committed: boolean) => void) | undefined;
  onPanDelta?: ((dx: number, dy: number) => void) | undefined;
  onPortalFocusChange?: ((nodeId: string | null) => void) | undefined;
  onAlignmentGuides?: ((guides: AlignmentGuideLine[]) => void) | undefined;
  onMarqueeChange?: ((rect: WorldBounds | null) => void) | undefined;
  onWiringPreview?: ((preview: WiringPreview | null) => void) | undefined;
  onNodeInteractiveClick?: ((nodeId: string, phase: "down" | "up" | "click", u: number, v: number) => void) | undefined;
  validateConnection?:
    ((srcNodeId: string, srcPortId: string, tgtNodeId: string, tgtPortId: string) => boolean) | undefined;
  validateMagnet?: ((nodeId: string, portId: string) => boolean) | undefined;
  canInteract?:
    | ((
        cellId: string,
        kind: "node" | "edge",
      ) => boolean | { nodeMovable?: boolean | undefined; edgeMovable?: boolean | undefined })
    | undefined;
  selectionFilter?: ((cellId: string) => boolean) | undefined;
}

export interface PointerFsmOptions {
  gridSize?: number | undefined;
  portSnapRadius?: number | undefined;
  readOnly?: boolean | undefined;
  smartGuides?: boolean | undefined;
}

/**
 * 100% DOM-free Unified Interaction State Machine.
 *
 * Powers Desktop 2D schematics, `.mscanvas` spatial boards, and 3D / WebXR VR
 * editing from a single state machine with zero external graph-engine monkey-patches.
 */
export class CanvasPointerFSM {
  public mode: PointerFsmMode = "idle";
  public selectedNodeIds = new Set<string>();
  public selectedEdgeIds = new Set<string>();
  public focusedPortalId: string | null = null;
  public marqueeRect: WorldBounds | null = null;
  public wiringPreview: WiringPreview | null = null;
  public activeGuides: AlignmentGuideLine[] = [];

  private gridSize: number;
  private portSnapRadius: number;
  private readOnly: boolean;
  private smartGuides: boolean;

  private dragStart: WorldPoint = { x: 0, y: 0 };
  private panLastScreen: WorldPoint = { x: 0, y: 0 };
  private dragInitialPositions = new Map<string, WorldPoint>();
  private activeResize: {
    nodeId: string;
    handle: ResizeHandleKind;
    origBounds: WorldBounds;
    angleDeg: number;
  } | null = null;
  private activeRotate: {
    nodeId: string;
    center: WorldPoint;
    startPointerAngle: number;
    origAngle: number;
  } | null = null;
  private activeSegmentDrag: {
    edgeId: string;
    segmentIndex: number;
    orientation: "horizontal" | "vertical";
    origVertices: WorldPoint[];
    fullPolyline: WorldPoint[];
  } | null = null;
  private activeVertexDrag: {
    edgeId: string;
    vertexIndex: number;
    origVertices: WorldPoint[];
  } | null = null;

  constructor(
    private readonly scene: SoaSceneGraph,
    private readonly callbacks: PointerFsmCallbacks = {},
    options: PointerFsmOptions = {},
  ) {
    this.gridSize = Math.max(1, options.gridSize ?? 2);
    this.portSnapRadius = options.portSnapRadius ?? 18;
    this.readOnly = options.readOnly ?? false;
    this.smartGuides = options.smartGuides ?? true;
  }

  public setOptions(opts: Partial<PointerFsmOptions>): void {
    if (opts.gridSize !== undefined) this.gridSize = Math.max(1, opts.gridSize);
    if (opts.portSnapRadius !== undefined) this.portSnapRadius = opts.portSnapRadius;
    if (opts.readOnly !== undefined) this.readOnly = opts.readOnly;
    if (opts.smartGuides !== undefined) this.smartGuides = opts.smartGuides;
  }

  public snap(val: number): number {
    return this.gridSize > 1 ? Math.round(val / this.gridSize) * this.gridSize : val;
  }

  public exitPortalFocus(): void {
    if (this.focusedPortalId !== null) {
      this.focusedPortalId = null;
      if (this.mode === "portal-focused") this.mode = "idle";
      this.callbacks.onPortalFocusChange?.(null);
    }
  }

  public startResize(nodeId: string, handle: ResizeHandleKind, startU: number, startV: number): boolean {
    if (this.readOnly) return false;
    const node = this.scene.getNode(nodeId);
    if (!node || (node.flags & (SceneNodeFlags.LOCKED | SceneNodeFlags.READONLY)) !== 0) return false;

    if (handle === "rotate") {
      const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
      const startPointerAngle = (Math.atan2(startV - center.y, startU - center.x) * 180) / Math.PI;
      this.activeRotate = { nodeId, center, startPointerAngle, origAngle: node.angleDeg };
      this.mode = "rotating";
      return true;
    }

    this.dragStart = { x: startU, y: startV };
    this.activeResize = {
      nodeId,
      handle,
      origBounds: { x: node.x, y: node.y, width: node.width, height: node.height },
      angleDeg: node.angleDeg,
    };
    this.mode = "resizing";
    return true;
  }

  public startVertexDrag(edgeId: string, vertexIndex: number, startU: number, startV: number): boolean {
    if (this.readOnly) return false;
    const edge = this.scene.getEdge(edgeId);
    if (!edge || vertexIndex < 0 || vertexIndex >= edge.vertices.length) return false;
    this.dragStart = { x: startU, y: startV };
    this.activeVertexDrag = {
      edgeId,
      vertexIndex,
      origVertices: edge.vertices.map((p) => ({ ...p })),
    };
    this.mode = "dragging-vertex";
    return true;
  }

  public startSegmentDrag(edgeId: string, segmentIndex: number, startU: number, startV: number): boolean {
    if (this.readOnly) return false;
    const edge = this.scene.getEdge(edgeId);
    if (!edge) return false;
    const { source, target } = this.resolvePolyline(edgeId);
    const full = [source, ...edge.vertices.map((p) => ({ ...p })), target];
    if (segmentIndex < 0 || segmentIndex >= full.length - 1) return false;

    const p1 = full[segmentIndex]!;
    const p2 = full[segmentIndex + 1]!;
    const orientation: "horizontal" | "vertical" =
      Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? "horizontal" : "vertical";

    this.dragStart = { x: startU, y: startV };
    this.activeSegmentDrag = {
      edgeId,
      segmentIndex,
      orientation,
      origVertices: edge.vertices.map((p) => ({ ...p })),
      fullPolyline: full,
    };
    this.mode = "dragging-segment";
    return true;
  }

  private resolvePolyline(edgeId: string): { source: WorldPoint; target: WorldPoint } {
    const edge = this.scene.getEdge(edgeId)!;
    return this.scene.resolveEdgeEndpoints(edge);
  }

  public handleEvent(evt: PlanePointerEvent): void {
    if (evt.phase === "dblclick") {
      const hitNode = this.scene.hitTestNode(evt.u, evt.v);
      if (hitNode && (hitNode.flags & (SceneNodeFlags.PORTAL | SceneNodeFlags.WIDGET)) !== 0) {
        this.focusedPortalId = hitNode.id;
        this.mode = "portal-focused";
        this.callbacks.onPortalFocusChange?.(hitNode.id);
      }
      return;
    }

    if (evt.phase === "down") {
      this.handleDown(evt);
    } else if (evt.phase === "move") {
      this.handleMove(evt);
    } else if (evt.phase === "up" || evt.phase === "cancel") {
      this.handleUp(evt, evt.phase === "cancel");
    }
  }

  private segmentDragMoved = false;

  public setPortSnapRadius(radius: number): void {
    if (Number.isFinite(radius) && radius > 0) {
      this.portSnapRadius = radius;
    }
  }

  private handleDown(evt: PlanePointerEvent): void {
    this.dragStart = { x: evt.u, y: evt.v };
    this.panLastScreen = { x: evt.screenX ?? evt.u, y: evt.screenY ?? evt.v };
    this.segmentDragMoved = false;

    // Middle-click or Alt+click pans camera regardless of focused portal
    if (evt.button === 1 || (evt.button === 0 && evt.altKey)) {
      this.mode = "panning";
      return;
    }

    // Check if clicking outside a focused portal exits focus
    if (this.focusedPortalId !== null) {
      const portal = this.scene.getNode(this.focusedPortalId);
      if (!portal || !this.scene.pointInNodeOBB(portal, evt.u, evt.v)) {
        this.exitPortalFocus();
      } else {
        // Portal retains pointer events while focused
        return;
      }
    }

    // 1. Check port hit first (for starting orthogonal wire connection)
    if (!this.readOnly) {
      let portHit: { nodeId: string; portId: string; x: number; y: number } | null = null;
      if (evt.pointerPortHit) {
        const hitPos = this.scene.getPortWorldPosition(evt.pointerPortHit.nodeId, evt.pointerPortHit.portId);
        if (hitPos) {
          portHit = {
            nodeId: evt.pointerPortHit.nodeId,
            portId: evt.pointerPortHit.portId,
            x: hitPos.x,
            y: hitPos.y,
          };
        }
      }
      if (!portHit) {
        // Use a tight radius so small nodes (e.g. 20x20 Modelica components) are selectable/draggable
        // by clicking their body without ports swallowing the whole component.
        const tightRadius = Math.min(4, this.portSnapRadius * 0.25);
        const worldPortHit = this.scene.hitTestPort(evt.u, evt.v, tightRadius);
        if (worldPortHit) {
          portHit = {
            nodeId: worldPortHit.nodeId,
            portId: worldPortHit.portId,
            x: worldPortHit.x,
            y: worldPortHit.y,
          };
        }
      }
      if (portHit && (this.callbacks.validateMagnet?.(portHit.nodeId, portHit.portId) ?? true)) {
        this.mode = "wiring";
        this.wiringPreview = {
          sourceNodeId: portHit.nodeId,
          sourcePortId: portHit.portId,
          sourcePoint: { x: portHit.x, y: portHit.y },
          currentPoint: { x: evt.u, y: evt.v },
          snappedTarget: null,
        };
        this.callbacks.onWiringPreview?.(this.wiringPreview);
        return;
      }
    }

    // 2. Check node hit
    const nodeHit = this.scene.hitTestNode(evt.u, evt.v);
    if (nodeHit) {
      this.callbacks.onNodeInteractiveClick?.(nodeHit.id, "down", evt.u, evt.v);
      const selectable = this.callbacks.selectionFilter ? this.callbacks.selectionFilter(nodeHit.id) : true;
      if (selectable) {
        const multi = evt.shiftKey || evt.ctrlKey || evt.metaKey;
        if (multi) {
          if (this.selectedNodeIds.has(nodeHit.id)) {
            this.selectedNodeIds.delete(nodeHit.id);
            this.scene.setNodeFlag(nodeHit.id, SceneNodeFlags.SELECTED, false);
          } else {
            this.selectedNodeIds.add(nodeHit.id);
            this.scene.setNodeFlag(nodeHit.id, SceneNodeFlags.SELECTED, true);
          }
        } else if (!this.selectedNodeIds.has(nodeHit.id)) {
          this.clearSelectionInternal();
          this.selectedNodeIds.add(nodeHit.id);
          this.scene.setNodeFlag(nodeHit.id, SceneNodeFlags.SELECTED, true);
        }
        this.emitSelection();
      }

      const interact = this.callbacks.canInteract ? this.callbacks.canInteract(nodeHit.id, "node") : true;
      const nodeMovable = typeof interact === "boolean" ? interact : interact.nodeMovable !== false;
      if (!this.readOnly && nodeMovable && (nodeHit.flags & (SceneNodeFlags.LOCKED | SceneNodeFlags.READONLY)) === 0) {
        this.dragInitialPositions.clear();
        for (const id of this.selectedNodeIds) {
          const n = this.scene.getNode(id);
          if (n && (n.flags & (SceneNodeFlags.LOCKED | SceneNodeFlags.READONLY)) === 0) {
            this.dragInitialPositions.set(id, { x: n.x, y: n.y });
          }
        }
        if (this.dragInitialPositions.size > 0) {
          this.mode = "dragging-nodes";
        }
      }
      return;
    }

    // 3. Check edge hit (select or start orthogonal segment drag)
    const edgeHit = this.scene.hitTestEdge(evt.u, evt.v, 8);
    if (edgeHit) {
      const selectable = this.callbacks.selectionFilter ? this.callbacks.selectionFilter(edgeHit.edge.id) : true;
      if (selectable) {
        const multi = evt.shiftKey || evt.ctrlKey || evt.metaKey;
        if (!multi) this.clearSelectionInternal();
        this.selectedEdgeIds.add(edgeHit.edge.id);
        this.emitSelection();
      }
      const interact = this.callbacks.canInteract ? this.callbacks.canInteract(edgeHit.edge.id, "edge") : true;
      const edgeMovable = typeof interact === "boolean" ? interact : interact.edgeMovable !== false;
      if (!this.readOnly && edgeMovable) {
        this.startSegmentDrag(edgeHit.edge.id, edgeHit.segmentIndex, evt.u, evt.v);
      }
      return;
    }

    // 4. Blank canvas: marquee select (with Shift/Ctrl) or pan
    if (evt.shiftKey || evt.ctrlKey || evt.metaKey) {
      this.mode = "marquee";
      this.marqueeRect = { x: evt.u, y: evt.v, width: 0, height: 0 };
      this.callbacks.onMarqueeChange?.(this.marqueeRect);
    } else {
      this.clearSelectionInternal();
      this.emitSelection();
      this.mode = "panning";
    }
  }

  private handleMove(evt: PlanePointerEvent): void {
    if (this.mode === "panning") {
      const sx = evt.screenX ?? evt.u;
      const sy = evt.screenY ?? evt.v;
      const dx = sx - this.panLastScreen.x;
      const dy = sy - this.panLastScreen.y;
      this.panLastScreen = { x: sx, y: sy };
      if (dx !== 0 || dy !== 0) {
        this.callbacks.onPanDelta?.(dx, dy);
      }
      return;
    }

    if (this.mode === "dragging-nodes") {
      let dx = evt.u - this.dragStart.x;
      let dy = evt.v - this.dragStart.y;
      const moves: Record<string, WorldPoint> = {};

      // Smart alignment guide snapping on primary dragged node
      if (this.smartGuides && this.dragInitialPositions.size === 1) {
        const [[onlyId, orig]] = Array.from(this.dragInitialPositions.entries()) as [[string, WorldPoint]];
        const node = this.scene.getNode(onlyId);
        if (node) {
          const proposed = {
            x: this.snap(orig.x + dx),
            y: this.snap(orig.y + dy),
            width: node.width,
            height: node.height,
          };
          const neighbors = this.scene
            .queryVisibleNodes({
              x: proposed.x - 400,
              y: proposed.y - 400,
              width: proposed.width + 800,
              height: proposed.height + 800,
            })
            .filter((n) => n.id !== onlyId && (n.flags & SceneNodeFlags.EPHEMERAL) === 0)
            .map((n) => ({ id: n.id, bounds: { x: n.x, y: n.y, width: n.width, height: n.height } }));

          const snapRes = computeSnapAndGuides(proposed, neighbors, 6);
          dx = snapRes.x - orig.x;
          dy = snapRes.y - orig.y;
          this.activeGuides = snapRes.guides;
          this.callbacks.onAlignmentGuides?.(this.activeGuides);
        }
      }

      for (const [id, orig] of this.dragInitialPositions.entries()) {
        const nx = this.snap(orig.x + dx);
        const ny = this.snap(orig.y + dy);
        this.scene.setNodePosition(id, nx, ny);
        moves[id] = { x: nx, y: ny };
      }
      this.callbacks.onNodesMoved?.(moves, false);
      return;
    }

    if (this.mode === "marquee") {
      const x = Math.min(this.dragStart.x, evt.u);
      const y = Math.min(this.dragStart.y, evt.v);
      const width = Math.abs(evt.u - this.dragStart.x);
      const height = Math.abs(evt.v - this.dragStart.y);
      this.marqueeRect = { x, y, width, height };
      this.callbacks.onMarqueeChange?.(this.marqueeRect);
      return;
    }

    if (this.mode === "resizing" && this.activeResize) {
      const { nodeId, handle, origBounds, angleDeg } = this.activeResize;
      // Rotate delta into node's local OBB space so rotated resizing stays exact!
      const rawDx = evt.u - this.dragStart.x;
      const rawDy = evt.v - this.dragStart.y;
      const rad = (-angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const ldx = rawDx * cos - rawDy * sin;
      const ldy = rawDx * sin + rawDy * cos;

      let x = origBounds.x;
      let y = origBounds.y;
      let w = origBounds.width;
      let h = origBounds.height;

      if (handle.includes("e")) w = Math.max(16, origBounds.width + ldx);
      if (handle.includes("s")) h = Math.max(16, origBounds.height + ldy);
      if (handle.includes("w")) {
        const nextW = Math.max(16, origBounds.width - ldx);
        x = origBounds.x + (origBounds.width - nextW);
        w = nextW;
      }
      if (handle.includes("n")) {
        const nextH = Math.max(16, origBounds.height - ldy);
        y = origBounds.y + (origBounds.height - nextH);
        h = nextH;
      }

      // Shift locks aspect ratio
      if (evt.shiftKey && origBounds.height > 0 && origBounds.width > 0) {
        const aspect = origBounds.width / origBounds.height;
        if (Math.abs(w - origBounds.width) >= Math.abs(h - origBounds.height)) {
          h = Math.max(16, w / aspect);
        } else {
          w = Math.max(16, h * aspect);
        }
      }

      const nextBounds = {
        x: this.snap(x),
        y: this.snap(y),
        width: this.snap(w),
        height: this.snap(h),
      };
      this.scene.setNodePosition(nodeId, nextBounds.x, nextBounds.y);
      this.scene.setNodeSize(nodeId, nextBounds.width, nextBounds.height);
      this.callbacks.onNodeResized?.(nodeId, nextBounds, false);
      return;
    }

    if (this.mode === "rotating" && this.activeRotate) {
      const { nodeId, center, startPointerAngle, origAngle } = this.activeRotate;
      const curPointerAngle = (Math.atan2(evt.v - center.y, evt.u - center.x) * 180) / Math.PI;
      let nextAngle = origAngle + (curPointerAngle - startPointerAngle);
      if (evt.shiftKey) {
        nextAngle = Math.round(nextAngle / 15) * 15;
      }
      nextAngle = ((nextAngle % 360) + 360) % 360;
      this.scene.setNodeRotation(nodeId, nextAngle);
      this.callbacks.onNodeRotated?.(nodeId, nextAngle, false);
      return;
    }

    if (this.mode === "wiring" && this.wiringPreview) {
      const targetHit = this.scene.hitTestPort(evt.u, evt.v, this.portSnapRadius);
      let snappedTarget = targetHit
        ? { nodeId: targetHit.nodeId, portId: targetHit.portId, x: targetHit.x, y: targetHit.y }
        : null;
      if (
        snappedTarget &&
        snappedTarget.nodeId === this.wiringPreview.sourceNodeId &&
        snappedTarget.portId === this.wiringPreview.sourcePortId
      ) {
        snappedTarget = null;
      }
      if (
        snappedTarget &&
        this.callbacks.validateConnection &&
        !this.callbacks.validateConnection(
          this.wiringPreview.sourceNodeId,
          this.wiringPreview.sourcePortId,
          snappedTarget.nodeId,
          snappedTarget.portId,
        )
      ) {
        snappedTarget = null;
      }
      this.wiringPreview = {
        ...this.wiringPreview,
        currentPoint: snappedTarget ? { x: snappedTarget.x, y: snappedTarget.y } : { x: evt.u, y: evt.v },
        snappedTarget,
      };
      this.callbacks.onWiringPreview?.(this.wiringPreview);
      return;
    }

    if (this.mode === "dragging-vertex" && this.activeVertexDrag) {
      const edge = this.scene.getEdge(this.activeVertexDrag.edgeId);
      if (!edge) return;
      const nextVertices = this.activeVertexDrag.origVertices.map((p) => ({ ...p }));
      nextVertices[this.activeVertexDrag.vertexIndex] = {
        x: this.snap(evt.u),
        y: this.snap(evt.v),
      };
      edge.vertices = nextVertices;
      this.callbacks.onEdgeVerticesChanged?.(edge.id, nextVertices, false);
      return;
    }

    if (this.mode === "dragging-segment" && this.activeSegmentDrag) {
      // Native orthogonal segment dragging: moves interior segment perpendicular to its axis,
      // and inserts clean dogleg elbows if dragging a terminal segment so port anchors NEVER rip!
      const { edgeId, segmentIndex, orientation, fullPolyline } = this.activeSegmentDrag;
      const edge = this.scene.getEdge(edgeId);
      if (!edge) return;

      const delta = orientation === "horizontal" ? evt.v - this.dragStart.y : evt.u - this.dragStart.x;
      if (!this.segmentDragMoved) {
        if (Math.abs(delta) <= 2) return;
        this.segmentDragMoved = true;
      }
      const p1 = fullPolyline[segmentIndex]!;
      const p2 = fullPolyline[segmentIndex + 1]!;
      const isFirst = segmentIndex === 0;
      const isLast = segmentIndex === fullPolyline.length - 2;

      const nextPoly = fullPolyline.map((p) => ({ ...p }));
      if (orientation === "horizontal") {
        const nextY = this.snap(p1.y + delta);
        if (isFirst && isLast) {
          // Single straight segment between two ports: insert 2 interior dogleg vertices
          const midX1 = p1.x + (p2.x - p1.x) * 0.25;
          const midX2 = p1.x + (p2.x - p1.x) * 0.75;
          edge.vertices = [
            { x: this.snap(midX1), y: p1.y },
            { x: this.snap(midX1), y: nextY },
            { x: this.snap(midX2), y: nextY },
            { x: this.snap(midX2), y: p2.y },
          ];
        } else if (isFirst) {
          // Preserve source port anchor; shift elbow vertex & insert stub corner
          const stubX = this.snap(p1.x + (p2.x - p1.x) * 0.25);
          const rest = nextPoly.slice(2, -1);
          edge.vertices = [{ x: stubX, y: p1.y }, { x: stubX, y: nextY }, { x: p2.x, y: nextY }, ...rest];
        } else if (isLast) {
          // Preserve target port anchor
          const stubX = this.snap(p1.x + (p2.x - p1.x) * 0.75);
          const lead = nextPoly.slice(1, -2);
          edge.vertices = [...lead, { x: p1.x, y: nextY }, { x: stubX, y: nextY }, { x: stubX, y: p2.y }];
        } else {
          nextPoly[segmentIndex]!.y = nextY;
          nextPoly[segmentIndex + 1]!.y = nextY;
          edge.vertices = nextPoly.slice(1, -1);
        }
      } else {
        const nextX = this.snap(p1.x + delta);
        if (isFirst && isLast) {
          const midY1 = p1.y + (p2.y - p1.y) * 0.25;
          const midY2 = p1.y + (p2.y - p1.y) * 0.75;
          edge.vertices = [
            { x: p1.x, y: this.snap(midY1) },
            { x: nextX, y: this.snap(midY1) },
            { x: nextX, y: this.snap(midY2) },
            { x: p2.x, y: this.snap(midY2) },
          ];
        } else if (isFirst) {
          const stubY = this.snap(p1.y + (p2.y - p1.y) * 0.25);
          const rest = nextPoly.slice(2, -1);
          edge.vertices = [{ x: p1.x, y: stubY }, { x: nextX, y: stubY }, { x: nextX, y: p2.y }, ...rest];
        } else if (isLast) {
          const stubY = this.snap(p1.y + (p2.y - p1.y) * 0.75);
          const lead = nextPoly.slice(1, -2);
          edge.vertices = [...lead, { x: nextX, y: p1.y }, { x: nextX, y: stubY }, { x: p2.x, y: stubY }];
        } else {
          nextPoly[segmentIndex]!.x = nextX;
          nextPoly[segmentIndex + 1]!.x = nextX;
          edge.vertices = nextPoly.slice(1, -1);
        }
      }

      this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, false);
    }
  }

  private handleUp(evt: PlanePointerEvent, canceled: boolean): void {
    const prevMode = this.mode;

    if (prevMode === "dragging-nodes") {
      const moves: Record<string, WorldPoint> = {};
      let moved = false;
      for (const [id, orig] of this.dragInitialPositions.entries()) {
        const n = this.scene.getNode(id);
        if (!n) continue;
        if (canceled) {
          this.scene.setNodePosition(id, orig.x, orig.y);
        } else {
          moves[id] = { x: n.x, y: n.y };
          if (Math.hypot(n.x - orig.x, n.y - orig.y) > 0.5) moved = true;
        }
      }
      if (!canceled && moved) {
        this.callbacks.onNodesMoved?.(moves, true);
      } else if (!canceled && !moved) {
        const nodeHit = this.scene.hitTestNode(evt.u, evt.v);
        if (nodeHit) {
          this.callbacks.onNodeInteractiveClick?.(nodeHit.id, "up", evt.u, evt.v);
          this.callbacks.onNodeInteractiveClick?.(nodeHit.id, "click", evt.u, evt.v);
        }
      }
      this.activeGuides = [];
      this.callbacks.onAlignmentGuides?.([]);
    } else if (prevMode === "marquee" && this.marqueeRect) {
      if (!canceled) {
        const hits = this.scene.queryVisibleNodes(this.marqueeRect);
        for (const n of hits) {
          if ((n.flags & SceneNodeFlags.EPHEMERAL) !== 0) continue;
          this.selectedNodeIds.add(n.id);
          this.scene.setNodeFlag(n.id, SceneNodeFlags.SELECTED, true);
        }
        this.emitSelection();
      }
      this.marqueeRect = null;
      this.callbacks.onMarqueeChange?.(null);
    } else if (prevMode === "resizing" && this.activeResize) {
      const { nodeId, origBounds } = this.activeResize;
      const n = this.scene.getNode(nodeId);
      if (canceled) {
        this.scene.setNodePosition(nodeId, origBounds.x, origBounds.y);
        this.scene.setNodeSize(nodeId, origBounds.width, origBounds.height);
      } else if (n) {
        this.callbacks.onNodeResized?.(nodeId, { x: n.x, y: n.y, width: n.width, height: n.height }, true);
      }
      this.activeResize = null;
    } else if (prevMode === "rotating" && this.activeRotate) {
      const { nodeId, origAngle } = this.activeRotate;
      const n = this.scene.getNode(nodeId);
      if (canceled) {
        this.scene.setNodeRotation(nodeId, origAngle);
      } else if (n) {
        this.callbacks.onNodeRotated?.(nodeId, n.angleDeg, true);
      }
      this.activeRotate = null;
    } else if (prevMode === "wiring" && this.wiringPreview) {
      if (!canceled && this.wiringPreview.snappedTarget) {
        this.callbacks.onWireConnected?.({
          sourceNodeId: this.wiringPreview.sourceNodeId,
          sourcePortId: this.wiringPreview.sourcePortId,
          targetNodeId: this.wiringPreview.snappedTarget.nodeId,
          targetPortId: this.wiringPreview.snappedTarget.portId,
        });
      }
      this.wiringPreview = null;
      this.callbacks.onWiringPreview?.(null);
    } else if (prevMode === "dragging-vertex" && this.activeVertexDrag) {
      const edge = this.scene.getEdge(this.activeVertexDrag.edgeId);
      if (edge) {
        if (canceled) {
          edge.vertices = this.activeVertexDrag.origVertices;
        } else {
          this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, true);
        }
      }
      this.activeVertexDrag = null;
    } else if (prevMode === "dragging-segment" && this.activeSegmentDrag) {
      const edge = this.scene.getEdge(this.activeSegmentDrag.edgeId);
      if (edge) {
        if (canceled) {
          edge.vertices = this.activeSegmentDrag.origVertices;
        } else {
          this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, true);
        }
      }
      this.activeSegmentDrag = null;
    }

    if (this.mode !== "portal-focused") {
      this.mode = "idle";
    }
  }

  public selectNodes(ids: string[], replace = true): void {
    if (replace) this.clearSelectionInternal();
    for (const id of ids) {
      if (this.scene.getNode(id)) {
        this.selectedNodeIds.add(id);
        this.scene.setNodeFlag(id, SceneNodeFlags.SELECTED, true);
      }
    }
    this.emitSelection();
  }

  public clearSelection(): void {
    this.clearSelectionInternal();
    this.emitSelection();
  }

  private clearSelectionInternal(): void {
    for (const id of this.selectedNodeIds) {
      this.scene.setNodeFlag(id, SceneNodeFlags.SELECTED, false);
    }
    this.selectedNodeIds.clear();
    this.selectedEdgeIds.clear();
  }

  private emitSelection(): void {
    this.callbacks.onSelectionChange?.(Array.from(this.selectedNodeIds), Array.from(this.selectedEdgeIds));
  }
}

export type { SoaNodeSummary };
