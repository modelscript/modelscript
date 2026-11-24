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
  pointerId?: number | undefined;
  isPrimary?: boolean | undefined;
  button: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  spaceKey?: boolean | undefined;
  phase: "down" | "move" | "up" | "cancel" | "dblclick";
  /** Optional explicit DOM port hit (from `.ms-port` / `[magnet="true"]` target). */
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
  snapEnabled?: boolean | undefined;
  portSnapRadius?: number | undefined;
  readOnly?: boolean | undefined;
  smartGuides?: boolean | undefined;
  zoom?: number | undefined;
}

const DRAG_THRESHOLD_PX = 3;

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
  private snapEnabled: boolean;
  private portSnapRadius: number;
  private readOnly: boolean;
  private smartGuides: boolean;
  private zoom: number;
  private panToolActive = false;

  private activePointerId: number | null = null;
  private dragStart: WorldPoint = { x: 0, y: 0 };
  private dragStartScreen: WorldPoint = { x: 0, y: 0 };
  private panLastScreen: WorldPoint = { x: 0, y: 0 };
  private dragThresholdPassed = false;
  private panMoved = false;
  private pressedNodeId: string | null = null;
  private lastUpWasCleanBlankClick = false;
  private gestureMoved = false;

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
  private segmentDragMoved = false;

  constructor(
    private readonly scene: SoaSceneGraph,
    private readonly callbacks: PointerFsmCallbacks = {},
    options: PointerFsmOptions = {},
  ) {
    this.gridSize = Math.max(1, options.gridSize ?? 2);
    this.snapEnabled = options.snapEnabled ?? true;
    this.portSnapRadius = options.portSnapRadius ?? 18;
    this.readOnly = options.readOnly ?? false;
    this.smartGuides = options.smartGuides ?? true;
    this.zoom = Math.max(0.02, options.zoom ?? 1);
  }

  public setOptions(opts: Partial<PointerFsmOptions>): void {
    if (opts.gridSize !== undefined) this.gridSize = Math.max(1, opts.gridSize);
    if (opts.snapEnabled !== undefined) this.snapEnabled = opts.snapEnabled;
    if (opts.portSnapRadius !== undefined) this.portSnapRadius = opts.portSnapRadius;
    if (opts.readOnly !== undefined) this.readOnly = opts.readOnly;
    if (opts.smartGuides !== undefined) this.smartGuides = opts.smartGuides;
    if (opts.zoom !== undefined && Number.isFinite(opts.zoom) && opts.zoom > 0) {
      this.zoom = Math.max(0.02, opts.zoom);
    }
  }

  public setZoom(zoom: number): void {
    if (Number.isFinite(zoom) && zoom > 0) {
      this.zoom = Math.max(0.02, zoom);
    }
  }

  public setPanToolActive(active: boolean): void {
    this.panToolActive = active;
  }

  public isReadOnly(): boolean {
    return this.readOnly;
  }

  public wasLastUpCleanBlankClick(): boolean {
    return this.lastUpWasCleanBlankClick;
  }

  public snap(val: number): number {
    if (!this.snapEnabled || this.gridSize <= 1) return val;
    return Math.round(val / this.gridSize) * this.gridSize;
  }

  public exitPortalFocus(): void {
    if (this.focusedPortalId !== null) {
      this.focusedPortalId = null;
      if (this.mode === "portal-focused") this.mode = "idle";
      this.callbacks.onPortalFocusChange?.(null);
    }
  }

  public cancel(): void {
    if (this.mode === "idle" && this.pressedNodeId === null && this.activePointerId === null) {
      return;
    }
    this.handleUp(
      {
        planeId: "primary",
        u: this.dragStart.x,
        v: this.dragStart.y,
        button: 0,
        buttons: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        phase: "cancel",
      },
      true,
    );
  }

  public startResize(
    nodeId: string,
    handle: ResizeHandleKind,
    startU: number,
    startV: number,
    pointerId?: number,
  ): boolean {
    if (this.readOnly) return false;
    const node = this.scene.getNode(nodeId);
    if (!node || (node.flags & (SceneNodeFlags.LOCKED | SceneNodeFlags.READONLY)) !== 0) return false;
    const interact = this.callbacks.canInteract ? this.callbacks.canInteract(nodeId, "node") : true;
    const movable = typeof interact === "boolean" ? interact : interact.nodeMovable !== false;
    if (!movable) return false;

    this.activePointerId = pointerId ?? null;
    this.gestureMoved = false;

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

  public startVertexDrag(
    edgeId: string,
    vertexIndex: number,
    startU: number,
    startV: number,
    pointerId?: number,
  ): boolean {
    if (this.readOnly) return false;
    const interact = this.callbacks.canInteract ? this.callbacks.canInteract(edgeId, "edge") : true;
    const edgeMovable = typeof interact === "boolean" ? interact : interact.edgeMovable !== false;
    if (!edgeMovable) return false;
    const edge = this.scene.getEdge(edgeId);
    if (!edge || vertexIndex < 0 || vertexIndex >= edge.vertices.length) return false;
    this.activePointerId = pointerId ?? null;
    this.gestureMoved = false;
    this.dragStart = { x: startU, y: startV };
    this.activeVertexDrag = {
      edgeId,
      vertexIndex,
      origVertices: edge.vertices.map((p) => ({ ...p })),
    };
    this.mode = "dragging-vertex";
    return true;
  }

  public startSegmentDrag(
    edgeId: string,
    segmentIndex: number,
    startU: number,
    startV: number,
    pointerId?: number,
  ): boolean {
    if (this.readOnly) return false;
    const interact = this.callbacks.canInteract ? this.callbacks.canInteract(edgeId, "edge") : true;
    const edgeMovable = typeof interact === "boolean" ? interact : interact.edgeMovable !== false;
    if (!edgeMovable) return false;
    const edge = this.scene.getEdge(edgeId);
    if (!edge) return false;
    const { source, target } = this.resolvePolyline(edgeId);
    // Align with hitTestEdge: when edge uses routed waypoints, seed working vertices from routePoints
    const seedVerts =
      edge.routePoints.length > 0 && (edge.vertices.length === 0 || segmentIndex >= edge.vertices.length + 1)
        ? edge.routePoints.map((p) => ({ ...p }))
        : edge.vertices.map((p) => ({ ...p }));
    const full = [source, ...seedVerts, target];
    if (segmentIndex < 0 || segmentIndex >= full.length - 1) return false;

    const p1 = full[segmentIndex]!;
    const p2 = full[segmentIndex + 1]!;
    const orientation: "horizontal" | "vertical" =
      Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? "horizontal" : "vertical";

    this.activePointerId = pointerId ?? null;
    this.segmentDragMoved = false;
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
      if (evt.isPrimary === false) return;
      if (this.activePointerId !== null && evt.pointerId !== undefined && evt.pointerId !== this.activePointerId) {
        return;
      }
      this.handleDown(evt);
    } else if (evt.phase === "move") {
      if (this.activePointerId !== null && evt.pointerId !== undefined && evt.pointerId !== this.activePointerId) {
        return;
      }
      this.handleMove(evt);
    } else if (evt.phase === "up" || evt.phase === "cancel") {
      if (
        evt.phase === "up" &&
        this.activePointerId !== null &&
        evt.pointerId !== undefined &&
        evt.pointerId !== this.activePointerId
      ) {
        return;
      }
      this.handleUp(evt, evt.phase === "cancel");
    }
  }

  public setPortSnapRadius(radius: number): void {
    if (Number.isFinite(radius) && radius > 0) {
      this.portSnapRadius = radius;
    }
  }

  private getEdgeHitTolerance(): number {
    return Math.max(4, Math.min(32, 8 / Math.max(0.1, this.zoom)));
  }

  private getGuideSnapTolerance(): number {
    return Math.max(3, Math.min(24, 6 / Math.max(0.1, this.zoom)));
  }

  private handleDown(evt: PlanePointerEvent): void {
    this.dragStart = { x: evt.u, y: evt.v };
    this.dragStartScreen = { x: evt.screenX ?? evt.u, y: evt.screenY ?? evt.v };
    this.panLastScreen = { x: evt.screenX ?? evt.u, y: evt.screenY ?? evt.v };
    this.dragThresholdPassed = false;
    this.panMoved = false;
    this.segmentDragMoved = false;
    this.gestureMoved = false;
    this.pressedNodeId = null;
    this.lastUpWasCleanBlankClick = false;

    // Middle-click or Space/Alt+left-click pans camera regardless of focused portal
    if (evt.button === 1 || (evt.button === 0 && (evt.altKey || evt.spaceKey || this.panToolActive))) {
      this.activePointerId = evt.pointerId ?? null;
      this.mode = "panning";
      return;
    }

    // Right-click (button 2): select hit target if not already selected, never start drag/pan
    if (evt.button === 2) {
      const nodeHit = this.scene.hitTestNode(evt.u, evt.v);
      if (nodeHit) {
        const selectable = this.callbacks.selectionFilter ? this.callbacks.selectionFilter(nodeHit.id) : true;
        if (selectable && !this.selectedNodeIds.has(nodeHit.id)) {
          this.clearSelectionInternal();
          this.selectedNodeIds.add(nodeHit.id);
          this.scene.setNodeFlag(nodeHit.id, SceneNodeFlags.SELECTED, true);
          this.emitSelection();
        }
        return;
      }
      const edgeHit = this.scene.hitTestEdge(evt.u, evt.v, this.getEdgeHitTolerance());
      if (edgeHit) {
        const selectable = this.callbacks.selectionFilter ? this.callbacks.selectionFilter(edgeHit.edge.id) : true;
        if (selectable && !this.selectedEdgeIds.has(edgeHit.edge.id)) {
          this.clearSelectionInternal();
          this.selectedEdgeIds.add(edgeHit.edge.id);
          this.emitSelection();
        }
      }
      return;
    }

    // Ignore non-primary mouse buttons (e.g. X1/X2 back/forward)
    if (evt.button !== 0) {
      return;
    }

    this.activePointerId = evt.pointerId ?? null;

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
      this.pressedNodeId = nodeHit.id;
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
        const selectedArr = Array.from(this.selectedNodeIds);
        for (const id of selectedArr) {
          // Exclude nodes whose ancestor is also selected so children aren't double-moved
          let hasSelectedAncestor = false;
          for (const otherId of selectedArr) {
            if (otherId !== id && this.scene.isDescendantOf(id, otherId)) {
              hasSelectedAncestor = true;
              break;
            }
          }
          if (hasSelectedAncestor) continue;
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
    const edgeHit = this.scene.hitTestEdge(evt.u, evt.v, this.getEdgeHitTolerance());
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
        this.startSegmentDrag(edgeHit.edge.id, edgeHit.segmentIndex, evt.u, evt.v, evt.pointerId);
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
      if (Math.hypot(sx - this.dragStartScreen.x, sy - this.dragStartScreen.y) >= DRAG_THRESHOLD_PX) {
        this.panMoved = true;
      }
      if (dx !== 0 || dy !== 0) {
        this.callbacks.onPanDelta?.(dx, dy);
      }
      return;
    }

    if (this.mode === "dragging-nodes") {
      if (!this.dragThresholdPassed) {
        const sx = evt.screenX ?? evt.u;
        const sy = evt.screenY ?? evt.v;
        const screenDist = Math.hypot(sx - this.dragStartScreen.x, sy - this.dragStartScreen.y);
        const worldDist = Math.hypot(evt.u - this.dragStart.x, evt.v - this.dragStart.y) * this.zoom;
        if (Math.max(screenDist, worldDist) < DRAG_THRESHOLD_PX) {
          return;
        }
        this.dragThresholdPassed = true;
      }

      let dx = evt.u - this.dragStart.x;
      let dy = evt.v - this.dragStart.y;
      const moves: Record<string, WorldPoint> = {};
      let snappedByGuideX = false;
      let snappedByGuideY = false;

      // Smart alignment guide snapping on primary dragged node (bypassed when Alt is held)
      if (this.smartGuides && !evt.altKey && this.dragInitialPositions.size === 1) {
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

          const snapRes = computeSnapAndGuides(proposed, neighbors, this.getGuideSnapTolerance());
          for (const g of snapRes.guides) {
            if (g.orientation === "vertical") snappedByGuideX = true;
            if (g.orientation === "horizontal") snappedByGuideY = true;
          }
          dx = snapRes.x - orig.x;
          dy = snapRes.y - orig.y;
          this.activeGuides = snapRes.guides;
          this.callbacks.onAlignmentGuides?.(this.activeGuides);
        }
      }

      for (const [id, orig] of this.dragInitialPositions.entries()) {
        // Don't let grid snap override an active smart alignment guide
        const nx = snappedByGuideX ? orig.x + dx : this.snap(orig.x + dx);
        const ny = snappedByGuideY ? orig.y + dy : this.snap(orig.y + dy);
        this.scene.setNodePosition(id, nx, ny);
        moves[id] = { x: nx, y: ny };
        // Also report moved descendants so UnifiedGraph syncs their cell & DOM positions
        for (const descId of this.scene.getDescendantIds(id)) {
          const desc = this.scene.getNode(descId);
          if (desc) {
            moves[descId] = { x: desc.x, y: desc.y };
          }
        }
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
      const rawDx = evt.u - this.dragStart.x;
      const rawDy = evt.v - this.dragStart.y;
      if (!this.gestureMoved && Math.hypot(rawDx, rawDy) * this.zoom < 1) {
        return;
      }
      this.gestureMoved = true;

      // Rotate delta into node's local OBB space
      const radNeg = (-angleDeg * Math.PI) / 180;
      const cosNeg = Math.cos(radNeg);
      const sinNeg = Math.sin(radNeg);
      const ldx = rawDx * cosNeg - rawDy * sinNeg;
      const ldy = rawDx * sinNeg + rawDy * cosNeg;

      let dLeft = 0;
      let dRight = 0;
      let dTop = 0;
      let dBottom = 0;
      let w = origBounds.width;
      let h = origBounds.height;

      if (handle.includes("e")) {
        w = Math.max(16, origBounds.width + ldx);
        dRight = w - origBounds.width;
      }
      if (handle.includes("s")) {
        h = Math.max(16, origBounds.height + ldy);
        dBottom = h - origBounds.height;
      }
      if (handle.includes("w")) {
        w = Math.max(16, origBounds.width - ldx);
        dLeft = origBounds.width - w;
      }
      if (handle.includes("n")) {
        h = Math.max(16, origBounds.height - ldy);
        dTop = origBounds.height - h;
      }

      // Shift locks aspect ratio while keeping the opposite edge/corner anchored
      if (evt.shiftKey && origBounds.height > 0 && origBounds.width > 0) {
        const aspect = origBounds.width / origBounds.height;
        if (Math.abs(w - origBounds.width) >= Math.abs(h - origBounds.height)) {
          h = Math.max(16, w / aspect);
          if (handle.includes("n")) {
            dTop = origBounds.height - h;
            dBottom = 0;
          } else {
            dBottom = h - origBounds.height;
            dTop = 0;
          }
        } else {
          w = Math.max(16, h * aspect);
          if (handle.includes("w")) {
            dLeft = origBounds.width - w;
            dRight = 0;
          } else {
            dRight = w - origBounds.width;
            dLeft = 0;
          }
        }
      }

      // Snap width/height cleanly first, then recompute anchor-preserving center shift in world space
      const snappedW = Math.max(16, this.snap(w));
      const snappedH = Math.max(16, this.snap(h));
      if (handle.includes("w")) dLeft = origBounds.width - snappedW;
      else if (handle.includes("e")) dRight = snappedW - origBounds.width;
      if (handle.includes("n")) dTop = origBounds.height - snappedH;
      else if (handle.includes("s")) dBottom = snappedH - origBounds.height;

      const localCenterShiftX = (dRight + dLeft) / 2;
      const localCenterShiftY = (dBottom + dTop) / 2;
      const radPos = (angleDeg * Math.PI) / 180;
      const cosPos = Math.cos(radPos);
      const sinPos = Math.sin(radPos);
      const worldCenterShiftX = localCenterShiftX * cosPos - localCenterShiftY * sinPos;
      const worldCenterShiftY = localCenterShiftX * sinPos + localCenterShiftY * cosPos;

      const origCx = origBounds.x + origBounds.width / 2;
      const origCy = origBounds.y + origBounds.height / 2;
      const nextX =
        angleDeg === 0
          ? this.snap(origCx + worldCenterShiftX - snappedW / 2)
          : origCx + worldCenterShiftX - snappedW / 2;
      const nextY =
        angleDeg === 0
          ? this.snap(origCy + worldCenterShiftY - snappedH / 2)
          : origCy + worldCenterShiftY - snappedH / 2;

      const nextBounds = {
        x: nextX,
        y: nextY,
        width: snappedW,
        height: snappedH,
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
      if (evt.shiftKey && !evt.altKey) {
        nextAngle = Math.round(nextAngle / 15) * 15;
      }
      nextAngle = ((nextAngle % 360) + 360) % 360;
      this.gestureMoved = true;
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
      this.gestureMoved = true;
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
        if (Math.abs(delta) * this.zoom <= DRAG_THRESHOLD_PX) return;
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
    const pressedNodeId = this.pressedNodeId;
    this.pressedNodeId = null;
    this.activePointerId = null;
    this.lastUpWasCleanBlankClick = false;

    if (prevMode === "panning") {
      if (!canceled && !this.panMoved && evt.button === 0 && !evt.altKey && !evt.spaceKey && !this.panToolActive) {
        this.lastUpWasCleanBlankClick = true;
      }
    } else if (prevMode === "dragging-nodes") {
      const moves: Record<string, WorldPoint> = {};
      let moved = false;
      for (const [id, orig] of this.dragInitialPositions.entries()) {
        const n = this.scene.getNode(id);
        if (!n) continue;
        if (canceled) {
          this.scene.setNodePosition(id, orig.x, orig.y);
          moves[id] = { x: orig.x, y: orig.y };
          for (const descId of this.scene.getDescendantIds(id)) {
            const desc = this.scene.getNode(descId);
            if (desc) moves[descId] = { x: desc.x, y: desc.y };
          }
        } else if (this.dragThresholdPassed) {
          moves[id] = { x: n.x, y: n.y };
          if (Math.hypot(n.x - orig.x, n.y - orig.y) > 0.5) moved = true;
          for (const descId of this.scene.getDescendantIds(id)) {
            const desc = this.scene.getNode(descId);
            if (desc) moves[descId] = { x: desc.x, y: desc.y };
          }
        }
      }
      if (canceled) {
        this.callbacks.onNodesMoved?.(moves, false);
      } else if (moved) {
        this.callbacks.onNodesMoved?.(moves, true);
      } else {
        const nodeHit = this.scene.hitTestNode(evt.u, evt.v);
        const clickId = nodeHit?.id ?? pressedNodeId;
        if (clickId) {
          this.callbacks.onNodeInteractiveClick?.(clickId, "up", evt.u, evt.v);
          this.callbacks.onNodeInteractiveClick?.(clickId, "click", evt.u, evt.v);
        }
      }
      this.activeGuides = [];
      this.callbacks.onAlignmentGuides?.([]);
    } else if (prevMode === "idle" && pressedNodeId && !canceled) {
      // Read-only or locked node click: pointer went down on a node without entering drag mode
      const sx = evt.screenX ?? evt.u;
      const sy = evt.screenY ?? evt.v;
      const movedDist = Math.hypot(sx - this.dragStartScreen.x, sy - this.dragStartScreen.y);
      this.callbacks.onNodeInteractiveClick?.(pressedNodeId, "up", evt.u, evt.v);
      if (movedDist < DRAG_THRESHOLD_PX) {
        this.callbacks.onNodeInteractiveClick?.(pressedNodeId, "click", evt.u, evt.v);
      }
    } else if (prevMode === "marquee" && this.marqueeRect) {
      if (!canceled) {
        const hits = this.scene.queryVisibleNodes(this.marqueeRect);
        for (const n of hits) {
          if ((n.flags & SceneNodeFlags.EPHEMERAL) !== 0) continue;
          if (this.callbacks.selectionFilter && !this.callbacks.selectionFilter(n.id)) continue;
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
        this.callbacks.onNodeResized?.(nodeId, origBounds, false);
      } else if (n && this.gestureMoved) {
        this.callbacks.onNodeResized?.(nodeId, { x: n.x, y: n.y, width: n.width, height: n.height }, true);
      }
      this.activeResize = null;
    } else if (prevMode === "rotating" && this.activeRotate) {
      const { nodeId, origAngle } = this.activeRotate;
      const n = this.scene.getNode(nodeId);
      if (canceled) {
        this.scene.setNodeRotation(nodeId, origAngle);
        this.callbacks.onNodeRotated?.(nodeId, origAngle, false);
      } else if (n && this.gestureMoved) {
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
          this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, false);
        } else if (this.gestureMoved) {
          this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, true);
        }
      }
      this.activeVertexDrag = null;
    } else if (prevMode === "dragging-segment" && this.activeSegmentDrag) {
      const edge = this.scene.getEdge(this.activeSegmentDrag.edgeId);
      if (edge) {
        if (canceled) {
          edge.vertices = this.activeSegmentDrag.origVertices;
          this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, false);
        } else if (this.segmentDragMoved) {
          this.callbacks.onEdgeVerticesChanged?.(edge.id, edge.vertices, true);
        }
      }
      this.activeSegmentDrag = null;
    }

    if (this.mode !== "portal-focused") {
      this.mode = "idle";
    }
  }

  /** Synchronizes FSM selection sets without re-emitting `onSelectionChange` (used by programmatic `graph.select`). */
  public syncSelection(nodeIds: Iterable<string>, edgeIds: Iterable<string>): void {
    for (const id of this.selectedNodeIds) {
      this.scene.setNodeFlag(id, SceneNodeFlags.SELECTED, false);
    }
    this.selectedNodeIds.clear();
    this.selectedEdgeIds.clear();
    for (const id of nodeIds) {
      this.selectedNodeIds.add(id);
      this.scene.setNodeFlag(id, SceneNodeFlags.SELECTED, true);
    }
    for (const id of edgeIds) {
      this.selectedEdgeIds.add(id);
    }
  }

  public selectNodes(ids: string[], replace = true): void {
    if (replace) this.clearSelectionInternal();
    for (const id of ids) {
      if (this.scene.getNode(id)) {
        if (this.callbacks.selectionFilter && !this.callbacks.selectionFilter(id)) continue;
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
