// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasTile } from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GalleryComponentItem } from "../componentGalleryCatalog.js";
import { FloatingLibraryPanel3D, MaterializingComponentPreview } from "./FloatingLibraryPanel3D.js";
import {
  evaluateMagneticPortSnap,
  evaluatePortCompatibility,
  makePortKey,
  makeUndirectedConnectionKey,
  type WorldPortCandidate,
} from "./magnetic-port-solver.js";
import {
  applyAutoDomainLayerLayout,
  categoryToSpatialDomain,
  commitConnectSpatialPorts,
  commitDeleteSpatialNode,
  commitDisconnectSpatialEdge,
  commitMoveSpatialNode,
  commitSpawnCatalogComponent,
  createSpatialDiagramStateFromTile,
  DIAGRAM_STAGE_DEFAULT_CENTER,
  DIAGRAM_STAGE_HALF_EXTENTS,
  DOMAIN_COLORS,
  DOMAIN_LAYER_Z_PLANES,
  inferCatalogItemPorts,
  redoSpatialDiagram,
  resolveEdgeEndpoints,
  undoSpatialDiagram,
  type SpatialDiagramPort3D,
  type SpatialDiagramSnapMode,
  type SpatialDiagramState,
  type SpatialNodePose3D,
} from "./spatial-diagram-state.js";
import {
  applyGrabOffset,
  applySpatialSnapConstraint,
  canAcquireInteractionLock,
  computeGrabOffset,
  computeSmoothingAlpha,
  isInsideDeleteRing,
  type GrabOffsetRigidTransform,
  type SpatialInteractionLock,
} from "./spatial-interaction.js";
import { SpatialDiagramNode3D, type PortVisualHighlightState } from "./SpatialDiagramNode3D.js";
import { SpatialMagneticWires, type ActiveWireDragVisualState } from "./SpatialMagneticWires.js";
import type { ExtrudedWaferStyle } from "./svg-extruder.js";
import { evaluateMaterializeTransition } from "./wrist-palette-logic.js";
import { WristPaletteTool } from "./WristPaletteTool.js";
import { evaluatePinchState } from "./xr-gestures.js";
import { getSharedXrStore, pulseXrHaptics, type RotundaCueKind } from "./xr-session.js";

const DELETE_RING_STAGE_POS: [number, number, number] = [0.64, -0.34, 0.14];
const SNAP_WELD_RADIUS_M = 0.068;

export interface SpatialDiagramStageProps {
  visible: boolean;
  tile: CanvasTile | null;
  snapMode: SpatialDiagramSnapMode;
  waferStyle: ExtrudedWaferStyle;
  wristPaletteOpen: boolean;
  isPlaying: boolean;
  dark: boolean;
  libraryCatalog?: readonly GalleryComponentItem[] | undefined;
  /** Shared ref signaling active 3D diagram grab/wiring lock so OrbitControls & CAD explode yield cleanly. */
  interactionLockRef: React.MutableRefObject<SpatialInteractionLock>;
  onInteractionLockChange?: ((locked: boolean) => void) | undefined;
  onToggleWristPalette: () => void;
  onSetWristPaletteOpen: (open: boolean) => void;
  onCycleSnapMode: () => void;
  onTogglePlaying: () => void;
  onDiagramEdit?:
    | ((
        actions: DiagramEditAction[],
        context: {
          tileId: string;
          spatial3DLayout: Record<string, SpatialNodePose3D>;
          diagramData: { nodes: unknown[]; edges: unknown[] };
        },
      ) => void)
    | undefined;
  onHudStatusChange?: ((status: string) => void) | undefined;
  onCue?: ((kind: RotundaCueKind) => void) | undefined;
  /** Exposes imperative Undo/Redo/Auto-Layer triggers for desktop HUD buttons. */
  onExposeActions?:
    | ((api: {
        undo: () => void;
        redo: () => void;
        autoLayerByDomain: () => void;
        flattenTo2D: () => void;
        canUndo: boolean;
        canRedo: boolean;
        nodeCount: number;
        edgeCount: number;
      }) => void)
    | undefined;
}

interface ActiveNodeGrabSession {
  nodeId: string;
  mode: "desktop" | "xr-hand" | "xr-controller";
  handedness?: "left" | "right";
  dragPlane: THREE.Plane;
  planeOffset: THREE.Vector3;
  depthOffset: number;
  yawOffsetRad: number;
  grabOffset?: GrabOffsetRigidTransform | undefined;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  smoothPos: THREE.Vector3;
  smoothQuat: THREE.Quaternion;
}

interface ActiveWireSession {
  sourcePort: SpatialDiagramPort3D;
  mode: "desktop" | "xr-hand" | "xr-controller";
  handedness?: "left" | "right";
  dragPlane: THREE.Plane;
  depthOffset: number;
  snappedKey: string | null;
  rejectedKey: string | null;
  snappedTarget: WorldPortCandidate | null;
  rejectedTarget: { candidate: WorldPortCandidate; reason: string } | null;
}

interface ActivePalettePullSession {
  item: GalleryComponentItem;
  mode: "desktop" | "xr-hand" | "xr-controller";
  handedness?: "left" | "right";
  panelOriginWorld: THREE.Vector3;
  panelNormalWorld: THREE.Vector3;
  panelQuatWorld: THREE.Quaternion;
  dragPlane: THREE.Plane;
  alreadyMaterialized: boolean;
  shouldCancelOnRelease: boolean;
  /** Optional nearby open port detected for 1-step Auto-Snap-Weld upon dropping the materialized part. */
  snapWeldCandidate: {
    spawnedPortId: string;
    targetNodeId: string;
    targetPortId: string;
    targetWorldPos: [number, number, number];
    strokeColor: string;
  } | null;
}

/**
 * Full 3D WebXR & Desktop Volumetric Diagram Editing Stage.
 *
 * Hosts auto-extruded 2D SVG components with 6DOF grabbing, physical magnetic 3D ports
 * with infinite-extending elastic wires, a left-wrist micro-dock summoning a world-locked
 * floating 2D component library with pull-to-materialize spawning, undo/redo, and live
 * bidirectional `DiagramEditAction` write-back.
 */
export function SpatialDiagramStage({
  visible,
  tile,
  snapMode,
  waferStyle,
  wristPaletteOpen,
  isPlaying,
  dark,
  libraryCatalog,
  interactionLockRef,
  onInteractionLockChange,
  onToggleWristPalette,
  onSetWristPaletteOpen,
  onCycleSnapMode,
  onTogglePlaying,
  onDiagramEdit,
  onHudStatusChange,
  onCue,
  onExposeActions,
}: SpatialDiagramStageProps): React.ReactElement | null {
  const { camera, gl } = useThree();
  const xrOrigin = useXR((s) => s.origin);
  const rightHand = useXRInputSourceState("hand", "right");
  const leftHand = useXRInputSourceState("hand", "left");
  const rightController = useXRInputSourceState("controller", "right");
  const leftController = useXRInputSourceState("controller", "left");

  const tileKey = tile?.id ?? "__default_schematic__";
  const [diagramState, setDiagramState] = useState<SpatialDiagramState>(() => createSpatialDiagramStateFromTile(tile));
  const diagramStateRef = useRef(diagramState);
  diagramStateRef.current = diagramState;

  // Re-initialize only when switching to a different schematic tile ID
  const lastTileKeyRef = useRef(tileKey);
  useEffect(() => {
    if (lastTileKeyRef.current !== tileKey) {
      lastTileKeyRef.current = tileKey;
      setDiagramState(createSpatialDiagramStateFromTile(tile));
    }
  }, [tileKey, tile]);

  const stageGroupRef = useRef<THREE.Group | null>(null);
  const nodeGroupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const nodePortsRef = useRef<Map<string, readonly SpatialDiagramPort3D[]>>(new Map());
  const spawnedAtMapRef = useRef<Map<string, number>>(new Map());

  // Live interaction session refs (zero React re-renders during 90Hz frame loops!)
  const nodeGrabRef = useRef<ActiveNodeGrabSession | null>(null);
  const wireSessionRef = useRef<ActiveWireSession | null>(null);
  const palettePullRef = useRef<ActivePalettePullSession | null>(null);

  const wireTipWorldPosRef = useRef(new THREE.Vector3());
  const previewWorldPosRef = useRef(new THREE.Vector3());
  const previewWorldQuatRef = useRef(new THREE.Quaternion());
  const previewMorphProgressRef = useRef(0);
  const previewCancelRef = useRef(false);

  // React UI mirror state (updated only on discrete transitions: start, snap lock change, end)
  const [grabbedNodeId, setGrabbedNodeId] = useState<string | null>(null);
  const [overDeleteRing, setOverDeleteRing] = useState(false);
  const [activeWireVisual, setActiveWireVisual] = useState<ActiveWireDragVisualState | null>(null);
  const [portHighlights, setPortHighlights] = useState<Map<string, PortVisualHighlightState>>(() => new Map());
  const [pullingItem, setPullingItem] = useState<GalleryComponentItem | null>(null);
  const [snapWeldVisual, setSnapWeldVisual] = useState<{
    from: [number, number, number];
    to: [number, number, number];
  } | null>(null);

  // Desktop pointer tracking refs
  const pointerNdcRef = useRef(new THREE.Vector2());
  const raycasterRef = useRef(new THREE.Raycaster());
  const shiftHeldRef = useRef(false);

  // XR bare-hand pinch state & scratch vectors
  const xrPinchPrevRef = useRef({ left: false, right: false });
  const leftPinchWorldRef = useRef(new THREE.Vector3());
  const rightPinchWorldRef = useRef(new THREE.Vector3());
  const handQuatScratch = useRef(new THREE.Quaternion());
  const stageWorldPosScratch = useRef(new THREE.Vector3());
  const invStageMatScratch = useRef(new THREE.Matrix4());
  const invStageQuatScratch = useRef(new THREE.Quaternion());
  const stageWorldQuatScratch = useRef(new THREE.Quaternion());
  const rayHitScratch = useRef(new THREE.Vector3());
  const tmpVecA = useRef(new THREE.Vector3());
  const tmpVecB = useRef(new THREE.Vector3());
  const tmpNormal = useRef(new THREE.Vector3());

  // Two-hand world-frame stage navigation state
  const twoHandStageNavRef = useRef<{
    active: boolean;
    prevMidWorld: THREE.Vector3;
    prevDist: number;
    prevYaw: number;
  }>({
    active: false,
    prevMidWorld: new THREE.Vector3(),
    prevDist: 0,
    prevYaw: 0,
  });

  const setLock = useCallback(
    (lock: SpatialInteractionLock) => {
      interactionLockRef.current = lock;
      onInteractionLockChange?.(lock !== "none");
    },
    [interactionLockRef, onInteractionLockChange],
  );

  const emitEdit = useCallback(
    (nextState: SpatialDiagramState, actions: DiagramEditAction[]) => {
      setDiagramState(nextState);
      if (actions.length > 0) {
        onDiagramEdit?.(actions, {
          tileId: nextState.tileId,
          spatial3DLayout: nextState.poses,
          diagramData: {
            nodes: nextState.nodes,
            edges: nextState.edges,
          },
        });
      }
    },
    [onDiagramEdit],
  );

  const handleUndo = useCallback(() => {
    setDiagramState((prev) => {
      if (prev.undoStack.length === 0) return prev;
      const next = undoSpatialDiagram(prev);
      onHudStatusChange?.("Undid last 3D diagram edit");
      return next;
    });
  }, [onHudStatusChange]);

  const handleRedo = useCallback(() => {
    setDiagramState((prev) => {
      if (prev.redoStack.length === 0) return prev;
      const next = redoSpatialDiagram(prev);
      onHudStatusChange?.("Redid 3D diagram edit");
      return next;
    });
  }, [onHudStatusChange]);

  const handleAutoLayerByDomain = useCallback(() => {
    setDiagramState((prev) => {
      const next = applyAutoDomainLayerLayout(prev, false);
      onCue?.("env");
      onHudStatusChange?.("Organized components onto 3D domain depth layers");
      return next;
    });
  }, [onCue, onHudStatusChange]);

  const handleFlattenTo2D = useCallback(() => {
    setDiagramState((prev) => {
      const next = applyAutoDomainLayerLayout(prev, true);
      onCue?.("snap");
      onHudStatusChange?.("Flattened 3D schematic onto z = 0 plane");
      return next;
    });
  }, [onCue, onHudStatusChange]);

  useEffect(() => {
    onExposeActions?.({
      undo: handleUndo,
      redo: handleRedo,
      autoLayerByDomain: handleAutoLayerByDomain,
      flattenTo2D: handleFlattenTo2D,
      canUndo: diagramState.undoStack.length > 0,
      canRedo: diagramState.redoStack.length > 0,
      nodeCount: diagramState.nodes.length,
      edgeCount: diagramState.edges.length,
    });
  }, [
    onExposeActions,
    handleUndo,
    handleRedo,
    handleAutoLayerByDomain,
    handleFlattenTo2D,
    diagramState.undoStack.length,
    diagramState.redoStack.length,
    diagramState.nodes.length,
    diagramState.edges.length,
  ]);

  const registerGroupRef = useCallback((nodeId: string, group: THREE.Group | null) => {
    if (group) {
      nodeGroupRefs.current.set(nodeId, group);
    } else {
      nodeGroupRefs.current.delete(nodeId);
    }
  }, []);

  const registerNodePorts = useCallback((nodeId: string, ports: readonly SpatialDiagramPort3D[]) => {
    nodePortsRef.current.set(nodeId, ports);
  }, []);

  /** Collects live world-space positions & normals of every port in the 3D diagram for magnetic capture. */
  const collectWorldPortCandidates = useCallback((): WorldPortCandidate[] => {
    const out: WorldPortCandidate[] = [];
    const pos = new THREE.Vector3();
    const norm = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();

    for (const [nodeId, group] of nodeGroupRefs.current.entries()) {
      const ports = nodePortsRef.current.get(nodeId);
      if (!ports || ports.length === 0) continue;
      group.updateWorldMatrix(true, false);
      group.getWorldQuaternion(worldQuat);
      for (const port of ports) {
        pos.set(port.localPosition[0], port.localPosition[1], port.localPosition[2]).applyMatrix4(group.matrixWorld);
        norm.set(port.localNormal[0], port.localNormal[1], port.localNormal[2]).applyQuaternion(worldQuat).normalize();
        out.push({
          port,
          worldPosition: [pos.x, pos.y, pos.z],
          worldNormal: [norm.x, norm.y, norm.z],
        });
      }
    }
    return out;
  }, []);

  const existingConnectionKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const e of diagramState.edges) {
      const ep = resolveEdgeEndpoints(e);
      if (ep) {
        keys.add(makeUndirectedConnectionKey(ep.sourceNodeId, ep.sourcePortId, ep.targetNodeId, ep.targetPortId));
      }
    }
    return keys;
  }, [diagramState.edges]);

  /* ------------------------------------------------------------------------ */
  /*  Interaction Start / Finish Handlers (Desktop + XR Pointer Events)       */
  /* ------------------------------------------------------------------------ */

  const handleStartNodeGrab = useCallback(
    (nodeId: string, e: ThreeEvent<PointerEvent>) => {
      if (!canAcquireInteractionLock(interactionLockRef.current, "node-grab")) return;
      const group = nodeGroupRefs.current.get(nodeId);
      const stage = stageGroupRef.current;
      if (!group || !stage) return;

      stage.updateWorldMatrix(true, false);
      group.updateWorldMatrix(true, false);

      const nodeWorldPos = new THREE.Vector3();
      group.getWorldPosition(nodeWorldPos);

      // Build camera-facing drag plane passing through nodeWorldPos
      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, nodeWorldPos);
      const planeOffset = nodeWorldPos.clone().sub(e.point);

      const curPose = diagramStateRef.current.poses[nodeId];
      const initPos = curPose ? new THREE.Vector3(...curPose.position) : group.position.clone();
      const initQuat = curPose ? new THREE.Quaternion(...curPose.quaternion) : group.quaternion.clone();

      nodeGrabRef.current = {
        nodeId,
        mode: "desktop",
        dragPlane,
        planeOffset,
        depthOffset: 0,
        yawOffsetRad: 0,
        targetPos: initPos.clone(),
        targetQuat: initQuat.clone(),
        smoothPos: initPos.clone(),
        smoothQuat: initQuat.clone(),
      };

      setLock("node-grab");
      setGrabbedNodeId(nodeId);
      setOverDeleteRing(false);
      onCue?.("grab");
      pulseXrHaptics(getSharedXrStore(), 0.28, 18);
      onHudStatusChange?.(`Moving ${nodeId} in 3D space (Shift/Wheel = Z-depth · R = Rotate 90°)`);
    },
    [camera, interactionLockRef, setLock, onCue, onHudStatusChange],
  );

  const finishNodeGrab = useCallback(() => {
    const sess = nodeGrabRef.current;
    if (!sess) return;
    nodeGrabRef.current = null;
    setGrabbedNodeId(null);
    setOverDeleteRing(false);
    setLock("none");

    const group = nodeGroupRefs.current.get(sess.nodeId);
    const rawPos: [number, number, number] = group
      ? [group.position.x, group.position.y, group.position.z]
      : [sess.smoothPos.x, sess.smoothPos.y, sess.smoothPos.z];
    const rawQuat: [number, number, number, number] = group
      ? [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w]
      : [sess.smoothQuat.x, sess.smoothQuat.y, sess.smoothQuat.z, sess.smoothQuat.w];

    if (isInsideDeleteRing(rawPos, DELETE_RING_STAGE_POS)) {
      const res = commitDeleteSpatialNode(diagramStateRef.current, sess.nodeId);
      emitEdit(res.state, res.actions);
      onCue?.("wire-pop");
      pulseXrHaptics(getSharedXrStore(), 0.5, 32, sess.handedness);
      onHudStatusChange?.(`Deleted ${sess.nodeId} (Undo available)`);
      return;
    }

    const existing = diagramStateRef.current.poses[sess.nodeId];
    const constrained = applySpatialSnapConstraint(rawPos, rawQuat, snapMode, existing?.domainLayer ?? 1, true);
    const res = commitMoveSpatialNode(diagramStateRef.current, sess.nodeId, constrained);
    emitEdit(res.state, res.actions);
    onCue?.("release");
    pulseXrHaptics(getSharedXrStore(), 0.22, 16, sess.handedness);
  }, [snapMode, emitEdit, setLock, onCue, onHudStatusChange]);

  const handleStartPortWireDrag = useCallback(
    (port: SpatialDiagramPort3D, e: ThreeEvent<PointerEvent>) => {
      if (!canAcquireInteractionLock(interactionLockRef.current, "wire-drag")) return;

      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, e.point);
      wireTipWorldPosRef.current.copy(e.point);

      const sess: ActiveWireSession = {
        sourcePort: port,
        mode: "desktop",
        dragPlane,
        depthOffset: 0,
        snappedKey: null,
        rejectedKey: null,
        snappedTarget: null,
        rejectedTarget: null,
      };
      wireSessionRef.current = sess;
      setLock("wire-drag");

      const initHighlights = new Map<string, PortVisualHighlightState>();
      initHighlights.set(makePortKey(port.nodeId, port.portId), {
        approach01: 1,
        snapped: false,
        rejected: false,
        isSource: true,
      });
      setPortHighlights(initHighlights);
      setActiveWireVisual({
        sourcePort: port,
        tipWorldPosRef: wireTipWorldPosRef,
        snappedTarget: null,
        rejectedTarget: null,
      });

      onCue?.("grab");
      pulseXrHaptics(getSharedXrStore(), 0.3, 18);
      onHudStatusChange?.(`Wiring from ${port.nodeId}.${port.portId} — drag toward a compatible port to snap`);
    },
    [camera, interactionLockRef, setLock, onCue, onHudStatusChange],
  );

  const finishWireDrag = useCallback(() => {
    const sess = wireSessionRef.current;
    if (!sess) return;
    wireSessionRef.current = null;
    setActiveWireVisual(null);
    setPortHighlights(new Map());
    setLock("none");

    if (sess.snappedTarget) {
      const target = sess.snappedTarget.port;
      const res = commitConnectSpatialPorts(
        diagramStateRef.current,
        sess.sourcePort.nodeId,
        sess.sourcePort.portId,
        target.nodeId,
        target.portId,
        sess.sourcePort.color,
      );
      if (res.actions.length > 0) {
        emitEdit(res.state, res.actions);
        onCue?.("magnet-lock");
        pulseXrHaptics(getSharedXrStore(), 0.62, 28, sess.handedness);
        onHudStatusChange?.(
          `Connected ${sess.sourcePort.nodeId}.${sess.sourcePort.portId} ⇄ ${target.nodeId}.${target.portId}`,
        );
        return;
      }
    }
    onCue?.("release");
    onHudStatusChange?.("Wire drag cancelled");
  }, [emitEdit, setLock, onCue, onHudStatusChange]);

  const handleStartPullCatalogCard = useCallback(
    (
      item: GalleryComponentItem,
      cardWorldPos: THREE.Vector3,
      panelWorldNormal: THREE.Vector3,
      panelWorldQuat: THREE.Quaternion,
      _e: ThreeEvent<PointerEvent>,
    ) => {
      if (!canAcquireInteractionLock(interactionLockRef.current, "palette-pull")) return;

      // Drag plane faces camera through the card spawn point (desktop users pull sideways & forward into stage)
      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, cardWorldPos);

      previewWorldPosRef.current.copy(cardWorldPos);
      previewWorldQuatRef.current.copy(panelWorldQuat);
      previewMorphProgressRef.current = 0.08;
      previewCancelRef.current = false;

      palettePullRef.current = {
        item,
        mode: "desktop",
        panelOriginWorld: cardWorldPos.clone(),
        panelNormalWorld: panelWorldNormal.clone(),
        panelQuatWorld: panelWorldQuat.clone(),
        dragPlane,
        alreadyMaterialized: false,
        shouldCancelOnRelease: true,
        snapWeldCandidate: null,
      };

      setLock("palette-pull");
      setPullingItem(item);
      setSnapWeldVisual(null);
      onCue?.("grab");
      pulseXrHaptics(getSharedXrStore(), 0.3, 18);
      onHudStatusChange?.(`Pulling ${item.shortName} off library panel to materialize in 3D…`);
    },
    [camera, interactionLockRef, setLock, onCue, onHudStatusChange],
  );

  const finishPalettePull = useCallback(() => {
    const sess = palettePullRef.current;
    if (!sess) return;
    palettePullRef.current = null;
    setPullingItem(null);
    setSnapWeldVisual(null);
    setLock("none");

    if (!sess.alreadyMaterialized || sess.shouldCancelOnRelease) {
      onCue?.("release");
      onHudStatusChange?.(`Returned ${sess.item.shortName} to library panel`);
      return;
    }

    const stage = stageGroupRef.current;
    if (!stage) return;
    stage.updateWorldMatrix(true, false);
    invStageMatScratch.current.copy(stage.matrixWorld).invert();
    const localPos = previewWorldPosRef.current.clone().applyMatrix4(invStageMatScratch.current);

    const constrained = applySpatialSnapConstraint(
      [localPos.x, localPos.y, localPos.z],
      [0, 0, 0, 1],
      snapMode,
      1,
      true,
    );

    const res = commitSpawnCatalogComponent(
      diagramStateRef.current,
      sess.item,
      constrained,
      sess.snapWeldCandidate
        ? {
            spawnedPortId: sess.snapWeldCandidate.spawnedPortId,
            targetNodeId: sess.snapWeldCandidate.targetNodeId,
            targetPortId: sess.snapWeldCandidate.targetPortId,
            strokeColor: sess.snapWeldCandidate.strokeColor,
          }
        : undefined,
    );

    spawnedAtMapRef.current.set(res.spawnedNodeId, performance.now());
    emitEdit(res.state, res.actions);
    onCue?.(sess.snapWeldCandidate ? "magnet-lock" : "materialize");
    pulseXrHaptics(getSharedXrStore(), 0.65, 34, sess.handedness);
    onHudStatusChange?.(
      sess.snapWeldCandidate
        ? `Materialized ${res.spawnedNodeId} & snap-welded to ${sess.snapWeldCandidate.targetNodeId}.${sess.snapWeldCandidate.targetPortId}`
        : `Materialized ${res.spawnedNodeId} (${sess.item.shortName}) in 3D space`,
    );
  }, [snapMode, emitEdit, setLock, onCue, onHudStatusChange]);

  const handleDisconnectEdge = useCallback(
    (edgeId: string) => {
      const res = commitDisconnectSpatialEdge(diagramStateRef.current, edgeId);
      if (res.actions.length > 0) {
        emitEdit(res.state, res.actions);
        onCue?.("wire-pop");
        pulseXrHaptics(getSharedXrStore(), 0.42, 24);
        onHudStatusChange?.("Disconnected 3D wire (Undo available)");
      }
    },
    [emitEdit, onCue, onHudStatusChange],
  );

  const handleSelectEdge = useCallback((edgeId: string) => {
    setDiagramState((prev) => ({
      ...prev,
      selectedEdgeId: prev.selectedEdgeId === edgeId ? null : edgeId,
      selectedNodeIds: [],
    }));
  }, []);

  /* ------------------------------------------------------------------------ */
  /*  Desktop Mouse / Wheel / Keyboard Parity Listeners                       */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!visible || typeof window === "undefined") return;
    const domEl = gl.domElement;

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = domEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerNdcRef.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const onPointerMove = (e: PointerEvent) => {
      shiftHeldRef.current = e.shiftKey;
      updateNdc(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      if (wireSessionRef.current?.mode === "desktop") {
        finishWireDrag();
      }
      if (palettePullRef.current?.mode === "desktop") {
        finishPalettePull();
      }
      if (nodeGrabRef.current?.mode === "desktop") {
        finishNodeGrab();
      }
    };

    const onWheel = (e: WheelEvent) => {
      const deltaDepth = -Math.sign(e.deltaY) * 0.045;
      if (nodeGrabRef.current?.mode === "desktop") {
        e.preventDefault();
        nodeGrabRef.current.depthOffset = Math.max(-0.55, Math.min(0.55, nodeGrabRef.current.depthOffset + deltaDepth));
      } else if (wireSessionRef.current?.mode === "desktop") {
        e.preventDefault();
        wireSessionRef.current.depthOffset = Math.max(
          -0.55,
          Math.min(0.55, wireSessionRef.current.depthOffset + deltaDepth),
        );
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey) {
        onToggleWristPalette();
      } else if (e.key.toLowerCase() === "r" && nodeGrabRef.current) {
        e.preventDefault();
        nodeGrabRef.current.yawOffsetRad += Math.PI * 0.5;
        onCue?.("tick");
      } else if ((e.key === "Delete" || e.key === "Backspace") && !e.metaKey && !e.ctrlKey) {
        const cur = diagramStateRef.current;
        if (cur.selectedEdgeId) {
          e.preventDefault();
          handleDisconnectEdge(cur.selectedEdgeId);
        } else if (cur.selectedNodeIds[0]) {
          e.preventDefault();
          const res = commitDeleteSpatialNode(cur, cur.selectedNodeIds[0]);
          emitEdit(res.state, res.actions);
          onCue?.("wire-pop");
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    visible,
    gl.domElement,
    finishNodeGrab,
    finishWireDrag,
    finishPalettePull,
    handleUndo,
    handleRedo,
    handleDisconnectEdge,
    onToggleWristPalette,
    emitEdit,
    onCue,
  ]);

  /* ------------------------------------------------------------------------ */
  /*  Unified 90Hz WebXR Bare-Hand, Controller & Desktop Manipulation Loop    */
  /* ------------------------------------------------------------------------ */

  const evaluateWireMagneticStep = useCallback(
    (sess: ActiveWireSession, tipWorld: THREE.Vector3) => {
      wireTipWorldPosRef.current.copy(tipWorld);
      const candidates = collectWorldPortCandidates();
      const evalRes = evaluateMagneticPortSnap(sess.sourcePort, [tipWorld.x, tipWorld.y, tipWorld.z], candidates, {
        currentlySnappedKey: sess.snappedKey,
        previouslyRejectedKey: sess.rejectedKey,
        existingConnectionKeys,
      });

      const nextSnappedKey = evalRes.snappedTarget
        ? makePortKey(evalRes.snappedTarget.port.nodeId, evalRes.snappedTarget.port.portId)
        : null;
      const nextRejectedKey = evalRes.rejectedTarget
        ? makePortKey(evalRes.rejectedTarget.candidate.port.nodeId, evalRes.rejectedTarget.candidate.port.portId)
        : null;

      if (evalRes.justSnapped) {
        onCue?.("magnet-lock");
        pulseXrHaptics(getSharedXrStore(), 0.55, 22, sess.handedness);
      } else if (evalRes.justRejected) {
        onCue?.("magnet-reject");
        pulseXrHaptics(getSharedXrStore(), 0.2, 30, sess.handedness);
      }

      const snapChanged = nextSnappedKey !== sess.snappedKey || nextRejectedKey !== sess.rejectedKey;
      sess.snappedKey = nextSnappedKey;
      sess.rejectedKey = nextRejectedKey;
      sess.snappedTarget = evalRes.snappedTarget;
      sess.rejectedTarget = evalRes.rejectedTarget;

      // Update per-port magnetic highlight halos when approach/snap state updates
      const nextMap = new Map<string, PortVisualHighlightState>();
      nextMap.set(makePortKey(sess.sourcePort.nodeId, sess.sourcePort.portId), {
        approach01: 1,
        snapped: false,
        rejected: false,
        isSource: true,
      });
      for (const app of evalRes.approachCandidates) {
        const k = makePortKey(app.candidate.port.nodeId, app.candidate.port.portId);
        nextMap.set(k, {
          approach01: app.proximity01,
          snapped: k === nextSnappedKey,
          rejected: false,
          isSource: false,
        });
      }
      if (evalRes.rejectedTarget && nextRejectedKey) {
        nextMap.set(nextRejectedKey, {
          approach01: 0,
          snapped: false,
          rejected: true,
          isSource: false,
        });
      }

      if (snapChanged || nextMap.size !== portHighlights.size) {
        setPortHighlights(nextMap);
        setActiveWireVisual({
          sourcePort: sess.sourcePort,
          tipWorldPosRef: wireTipWorldPosRef,
          snappedTarget: evalRes.snappedTarget,
          rejectedTarget: evalRes.rejectedTarget,
        });
      }
    },
    [collectWorldPortCandidates, existingConnectionKeys, onCue, portHighlights.size],
  );

  const evaluatePalettePullStep = useCallback(
    (sess: ActivePalettePullSession, handWorldPos: THREE.Vector3) => {
      // Measure both perpendicular pull off panel plane AND lateral distance pulled away from card slot
      tmpVecA.current.copy(handWorldPos).sub(sess.panelOriginWorld);
      const perpDist = tmpVecA.current.dot(sess.panelNormalWorld);
      const totalDist = tmpVecA.current.length();
      // In desktop drag parallel to camera, pulling diagonally off the card onto the stage naturally materializes it too!
      const effectivePull = Math.max(perpDist, totalDist * 0.42);

      const trans = evaluateMaterializeTransition(effectivePull, sess.alreadyMaterialized);
      previewWorldPosRef.current.copy(handWorldPos);
      previewMorphProgressRef.current = trans.morphProgress;
      previewCancelRef.current = trans.shouldCancelOnRelease && sess.alreadyMaterialized;
      sess.shouldCancelOnRelease = trans.shouldCancelOnRelease;

      if (trans.justMaterialized) {
        sess.alreadyMaterialized = true;
        onCue?.("materialize");
        pulseXrHaptics(getSharedXrStore(), 0.65, 34, sess.handedness);
        onHudStatusChange?.(`Materialized ${sess.item.shortName} in 3D! Release anywhere to place.`);
      }

      // Check Auto-Snap-Weld proximity once materialized
      if (sess.alreadyMaterialized && !trans.shouldCancelOnRelease) {
        const domain = categoryToSpatialDomain(sess.item.category);
        const rawPorts = inferCatalogItemPorts(sess.item);
        const candidates = collectWorldPortCandidates();
        let bestWeld: ActivePalettePullSession["snapWeldCandidate"] = null;
        let bestDist = SNAP_WELD_RADIUS_M;

        for (const p of rawPorts) {
          const px = ((typeof p.args?.x === "number" ? p.args.x : 40) / 80 - 0.5) * 0.148;
          const py = -((typeof p.args?.y === "number" ? p.args.y : 28) / 56 - 0.5) * 0.104;
          const portWorldX = handWorldPos.x + px;
          const portWorldY = handWorldPos.y + py;
          const portWorldZ = handWorldPos.z;

          for (const c of candidates) {
            const compat = evaluatePortCompatibility(
              { nodeId: "__spawn__", portId: p.id, domain, polarity: p.id === "n" ? "negative" : "positive" },
              c.port,
            );
            if (!compat.compatible) continue;
            const d = Math.hypot(
              c.worldPosition[0] - portWorldX,
              c.worldPosition[1] - portWorldY,
              c.worldPosition[2] - portWorldZ,
            );
            if (d < bestDist) {
              bestDist = d;
              bestWeld = {
                spawnedPortId: p.id,
                targetNodeId: c.port.nodeId,
                targetPortId: c.port.portId,
                targetWorldPos: c.worldPosition,
                strokeColor: DOMAIN_COLORS[domain],
              };
            }
          }
        }

        const prevId = sess.snapWeldCandidate
          ? `${sess.snapWeldCandidate.targetNodeId}:${sess.snapWeldCandidate.targetPortId}`
          : null;
        const nextId = bestWeld ? `${bestWeld.targetNodeId}:${bestWeld.targetPortId}` : null;
        sess.snapWeldCandidate = bestWeld;
        if (nextId !== prevId) {
          if (bestWeld) {
            onCue?.("magnet-lock");
            pulseXrHaptics(getSharedXrStore(), 0.45, 18, sess.handedness);
            setSnapWeldVisual({
              from: [handWorldPos.x, handWorldPos.y, handWorldPos.z],
              to: bestWeld.targetWorldPos,
            });
          } else {
            setSnapWeldVisual(null);
          }
        } else if (bestWeld) {
          setSnapWeldVisual({
            from: [handWorldPos.x, handWorldPos.y, handWorldPos.z],
            to: bestWeld.targetWorldPos,
          });
        }
      } else if (sess.snapWeldCandidate) {
        sess.snapWeldCandidate = null;
        setSnapWeldVisual(null);
      }
    },
    [collectWorldPortCandidates, onCue, onHudStatusChange],
  );

  useFrame((_state, rawDelta, frame) => {
    if (!visible) return;
    const delta = Math.min(rawDelta, 0.1);
    const stage = stageGroupRef.current;
    if (!stage) return;

    // 1. Bare-Hand Direct Proximity Grab & Magnetic Wiring inside active WebXR sessions
    const refSpace = gl.xr.getReferenceSpace();
    if (frame && refSpace && (leftHand?.inputSource.hand || rightHand?.inputSource.hand)) {
      const samplePinch = (xrHand: XRHand | undefined, prev: boolean, outPos: THREE.Vector3): boolean => {
        if (!xrHand || typeof frame.getJointPose !== "function") return false;
        const thumb = xrHand.get("thumb-tip");
        const index = xrHand.get("index-finger-tip");
        const tp = thumb ? frame.getJointPose(thumb, refSpace) : undefined;
        const ip = index ? frame.getJointPose(index, refSpace) : undefined;
        if (!tp || !ip) return false;
        const a = tp.transform.position;
        const b = ip.transform.position;
        const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        outPos.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        if (xrOrigin) outPos.applyMatrix4(xrOrigin.matrixWorld);
        return evaluatePinchState(dist, prev);
      };

      const leftPinched = samplePinch(
        leftHand?.inputSource.hand,
        xrPinchPrevRef.current.left,
        leftPinchWorldRef.current,
      );
      const rightPinched = samplePinch(
        rightHand?.inputSource.hand,
        xrPinchPrevRef.current.right,
        rightPinchWorldRef.current,
      );

      // Rising-edge Right Bare-Hand Direct Pinch: check Ports FIRST (highest priority), then Nodes
      if (rightPinched && !xrPinchPrevRef.current.right && interactionLockRef.current === "none") {
        const candidates = collectWorldPortCandidates();
        let hitPort: WorldPortCandidate | null = null;
        let bestPortDist = 0.042;
        for (const c of candidates) {
          const d = Math.hypot(
            c.worldPosition[0] - rightPinchWorldRef.current.x,
            c.worldPosition[1] - rightPinchWorldRef.current.y,
            c.worldPosition[2] - rightPinchWorldRef.current.z,
          );
          if (d < bestPortDist) {
            bestPortDist = d;
            hitPort = c;
          }
        }

        if (hitPort) {
          wireTipWorldPosRef.current.copy(rightPinchWorldRef.current);
          wireSessionRef.current = {
            sourcePort: hitPort.port,
            mode: "xr-hand",
            handedness: "right",
            dragPlane: new THREE.Plane(),
            depthOffset: 0,
            snappedKey: null,
            rejectedKey: null,
            snappedTarget: null,
            rejectedTarget: null,
          };
          setLock("wire-drag");
          setActiveWireVisual({
            sourcePort: hitPort.port,
            tipWorldPosRef: wireTipWorldPosRef,
            snappedTarget: null,
            rejectedTarget: null,
          });
          onCue?.("grab");
        } else {
          // Check direct node proximity grab
          let hitNodeId: string | null = null;
          let bestNodeDist = 0.095;
          for (const [nid, grp] of nodeGroupRefs.current.entries()) {
            grp.getWorldPosition(tmpVecA.current);
            const d = tmpVecA.current.distanceTo(rightPinchWorldRef.current);
            if (d < bestNodeDist) {
              bestNodeDist = d;
              hitNodeId = nid;
            }
          }
          if (hitNodeId) {
            const grp = nodeGroupRefs.current.get(hitNodeId)!;
            grp.getWorldPosition(tmpVecA.current);
            grp.getWorldQuaternion(handQuatScratch.current);
            const grabOffset = computeGrabOffset(
              rightPinchWorldRef.current,
              new THREE.Quaternion(),
              tmpVecA.current,
              handQuatScratch.current,
            );
            nodeGrabRef.current = {
              nodeId: hitNodeId,
              mode: "xr-hand",
              handedness: "right",
              dragPlane: new THREE.Plane(),
              planeOffset: new THREE.Vector3(),
              depthOffset: 0,
              yawOffsetRad: 0,
              grabOffset,
              targetPos: grp.position.clone(),
              targetQuat: grp.quaternion.clone(),
              smoothPos: grp.position.clone(),
              smoothQuat: grp.quaternion.clone(),
            };
            setLock("node-grab");
            setGrabbedNodeId(hitNodeId);
            onCue?.("grab");
          }
        }
      }

      // Two-Hand Empty-Space Pinch -> World-Frame Stage Pan, Yaw & Scale!
      if (leftPinched && rightPinched && interactionLockRef.current === "none") {
        const mid = tmpVecA.current.copy(leftPinchWorldRef.current).add(rightPinchWorldRef.current).multiplyScalar(0.5);
        const dist = leftPinchWorldRef.current.distanceTo(rightPinchWorldRef.current);
        const yaw = Math.atan2(
          rightPinchWorldRef.current.z - leftPinchWorldRef.current.z,
          rightPinchWorldRef.current.x - leftPinchWorldRef.current.x,
        );
        if (!twoHandStageNavRef.current.active) {
          twoHandStageNavRef.current.active = true;
          twoHandStageNavRef.current.prevMidWorld.copy(mid);
          twoHandStageNavRef.current.prevDist = Math.max(0.05, dist);
          twoHandStageNavRef.current.prevYaw = yaw;
          setLock("stage-nav");
        }
      } else if (twoHandStageNavRef.current.active) {
        if (leftPinched && rightPinched) {
          const mid = tmpVecA.current
            .copy(leftPinchWorldRef.current)
            .add(rightPinchWorldRef.current)
            .multiplyScalar(0.5);
          const dist = Math.max(0.05, leftPinchWorldRef.current.distanceTo(rightPinchWorldRef.current));
          const yaw = Math.atan2(
            rightPinchWorldRef.current.z - leftPinchWorldRef.current.z,
            rightPinchWorldRef.current.x - leftPinchWorldRef.current.x,
          );
          stage.position.add(tmpVecB.current.copy(mid).sub(twoHandStageNavRef.current.prevMidWorld));
          const scaleRatio = dist / twoHandStageNavRef.current.prevDist;
          stage.scale.setScalar(Math.max(0.45, Math.min(2.2, stage.scale.x * scaleRatio)));
          stage.rotation.y -= yaw - twoHandStageNavRef.current.prevYaw;
          twoHandStageNavRef.current.prevMidWorld.copy(mid);
          twoHandStageNavRef.current.prevDist = dist;
          twoHandStageNavRef.current.prevYaw = yaw;
        } else {
          twoHandStageNavRef.current.active = false;
          setLock("none");
        }
      }

      // Release bare-hand sessions cleanly when pinch releases
      if (!rightPinched && xrPinchPrevRef.current.right) {
        if (wireSessionRef.current?.mode === "xr-hand") finishWireDrag();
        if (nodeGrabRef.current?.mode === "xr-hand") finishNodeGrab();
        if (palettePullRef.current?.mode === "xr-hand") finishPalettePull();
      }

      xrPinchPrevRef.current.left = leftPinched;
      xrPinchPrevRef.current.right = rightPinched;
    } else if (leftController?.object && rightController?.object) {
      const leftSqueezed = leftController.gamepad["xr-standard-squeeze"]?.state === "pressed";
      const rightSqueezed = rightController.gamepad["xr-standard-squeeze"]?.state === "pressed";
      if (
        leftSqueezed &&
        rightSqueezed &&
        (interactionLockRef.current === "none" || twoHandStageNavRef.current.active)
      ) {
        leftController.object.getWorldPosition(leftPinchWorldRef.current);
        rightController.object.getWorldPosition(rightPinchWorldRef.current);
        const mid = tmpVecA.current.copy(leftPinchWorldRef.current).add(rightPinchWorldRef.current).multiplyScalar(0.5);
        const dist = Math.max(0.05, leftPinchWorldRef.current.distanceTo(rightPinchWorldRef.current));
        const yaw = Math.atan2(
          rightPinchWorldRef.current.z - leftPinchWorldRef.current.z,
          rightPinchWorldRef.current.x - leftPinchWorldRef.current.x,
        );
        if (!twoHandStageNavRef.current.active) {
          twoHandStageNavRef.current.active = true;
          twoHandStageNavRef.current.prevMidWorld.copy(mid);
          twoHandStageNavRef.current.prevDist = dist;
          twoHandStageNavRef.current.prevYaw = yaw;
          setLock("stage-nav");
        } else {
          stage.position.add(tmpVecB.current.copy(mid).sub(twoHandStageNavRef.current.prevMidWorld));
          const scaleRatio = dist / twoHandStageNavRef.current.prevDist;
          stage.scale.setScalar(Math.max(0.45, Math.min(2.2, stage.scale.x * scaleRatio)));
          stage.rotation.y -= yaw - twoHandStageNavRef.current.prevYaw;
          twoHandStageNavRef.current.prevMidWorld.copy(mid);
          twoHandStageNavRef.current.prevDist = dist;
          twoHandStageNavRef.current.prevYaw = yaw;
        }
      } else if (twoHandStageNavRef.current.active) {
        twoHandStageNavRef.current.active = false;
        setLock("none");
      }
    }

    // 2. Active Wire Drag Step (Desktop Ray or XR Hand/Controller)
    if (wireSessionRef.current) {
      const sess = wireSessionRef.current;
      if (sess.mode === "xr-hand") {
        evaluateWireMagneticStep(sess, rightPinchWorldRef.current);
      } else if (sess.mode === "xr-controller" && rightController?.object) {
        rightController.object.getWorldPosition(tmpVecA.current);
        evaluateWireMagneticStep(sess, tmpVecA.current);
      } else {
        raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
        if (raycasterRef.current.ray.intersectPlane(sess.dragPlane, rayHitScratch.current)) {
          camera.getWorldDirection(tmpNormal.current);
          rayHitScratch.current.addScaledVector(tmpNormal.current, sess.depthOffset);
          evaluateWireMagneticStep(sess, rayHitScratch.current);
        }
      }
    }

    // 3. Active Palette Pull-to-Materialize Step
    if (palettePullRef.current) {
      const sess = palettePullRef.current;
      if (sess.mode === "xr-hand") {
        evaluatePalettePullStep(sess, rightPinchWorldRef.current);
      } else {
        raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
        if (raycasterRef.current.ray.intersectPlane(sess.dragPlane, rayHitScratch.current)) {
          evaluatePalettePullStep(sess, rayHitScratch.current);
        }
      }
    }

    // 4. Active 6DOF Component Grab Step (with smooth critically-damped anti-jitter filtering)
    if (nodeGrabRef.current) {
      const sess = nodeGrabRef.current;
      const grp = nodeGroupRefs.current.get(sess.nodeId);
      if (grp) {
        stage.updateWorldMatrix(true, false);
        invStageMatScratch.current.copy(stage.matrixWorld).invert();
        stage.getWorldQuaternion(stageWorldQuatScratch.current);
        invStageQuatScratch.current.copy(stageWorldQuatScratch.current).invert();

        if (sess.mode === "xr-hand" && sess.grabOffset) {
          applyGrabOffset(
            rightPinchWorldRef.current,
            handQuatScratch.current.identity(),
            sess.grabOffset,
            tmpVecA.current,
            sess.targetQuat,
          );
          sess.targetPos.copy(tmpVecA.current).applyMatrix4(invStageMatScratch.current);
          sess.targetQuat.premultiply(invStageQuatScratch.current);
        } else {
          // Desktop 3D ray grab (plus optional VR controller thumbstick telescoping)
          const stickY = rightController?.gamepad["xr-standard-thumbstick"]?.yAxis ?? 0;
          if (Math.abs(stickY) > 0.25) {
            sess.depthOffset = Math.max(-0.65, Math.min(0.65, sess.depthOffset - stickY * delta * 0.8));
          }
          raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
          if (raycasterRef.current.ray.intersectPlane(sess.dragPlane, rayHitScratch.current)) {
            stageWorldPosScratch.current.copy(rayHitScratch.current).add(sess.planeOffset);
            camera.getWorldDirection(tmpNormal.current);
            stageWorldPosScratch.current.addScaledVector(tmpNormal.current, sess.depthOffset);
            sess.targetPos.copy(stageWorldPosScratch.current).applyMatrix4(invStageMatScratch.current);
          }
          sess.targetQuat.setFromAxisAngle(tmpVecB.current.set(0, 0, 1), sess.yawOffsetRad);
        }

        // Smooth motion (eliminates hand-tracking jitter while keeping 90Hz responsiveness)
        const alpha = computeSmoothingAlpha(delta, sess.mode === "xr-hand" ? 0.026 : 0.014);
        sess.smoothPos.lerp(sess.targetPos, alpha);
        sess.smoothQuat.slerp(sess.targetQuat, alpha);

        grp.position.copy(sess.smoothPos);
        grp.quaternion.copy(sess.smoothQuat);

        // Live Delete Ring proximity detection
        const overDel = isInsideDeleteRing(
          [sess.smoothPos.x, sess.smoothPos.y, sess.smoothPos.z],
          DELETE_RING_STAGE_POS,
        );
        if (overDel !== overDeleteRing) {
          setOverDeleteRing(overDel);
          if (overDel) {
            onCue?.("magnet-reject");
            pulseXrHaptics(getSharedXrStore(), 0.35, 22, sess.handedness);
          }
        }
      }
    }
  });

  if (!visible) return null;

  const [hx, hy] = DIAGRAM_STAGE_HALF_EXTENTS;

  return (
    <group name="spatial-diagram-editor-root">
      {/* Main 3D Volumetric Schematic Editing Stage */}
      <group ref={stageGroupRef} name="spatial-diagram-stage" position={DIAGRAM_STAGE_DEFAULT_CENTER}>
        {/* Subtle Holographic Volumetric Stage Corner Brackets */}
        {[
          [-hx, -hy, 0],
          [hx, -hy, 0],
          [-hx, hy, 0],
          [hx, hy, 0],
        ].map(([cx, cy, cz], idx) => (
          <mesh key={idx} position={[cx!, cy!, cz!]}>
            <boxGeometry args={[0.024, 0.024, 0.004]} />
            <meshBasicMaterial color={dark ? "#22d3ee" : "#0284c7"} transparent opacity={0.42} />
          </mesh>
        ))}

        {/* Optional Translucent Domain Depth Planes (shown in "domain-layers" snap mode) */}
        {snapMode === "domain-layers" &&
          DOMAIN_LAYER_Z_PLANES.map((layer) => (
            <group key={layer.id} position={[0, 0, layer.zMeters]}>
              <mesh>
                <planeGeometry args={[hx * 1.9, hy * 1.85]} />
                <meshBasicMaterial
                  color={layer.color}
                  transparent
                  opacity={0.055}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <mesh position={[0, hy * 0.925, 0]}>
                <boxGeometry args={[hx * 1.9, 0.003, 0.003]} />
                <meshBasicMaterial color={layer.color} transparent opacity={0.48} />
              </mesh>
            </group>
          ))}

        {/* Optional 5 cm Spatial Precision Grid Plane (shown in "grid-5cm" or "flat-2d" mode) */}
        {(snapMode === "grid-5cm" || snapMode === "flat-2d") && (
          <gridHelper
            args={[hx * 2, 30, dark ? "#22d3ee" : "#0284c7", dark ? "#1e293b" : "#94a3b8"]}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0, -0.006]}
          />
        )}

        {/* Extruded 3D Component Nodes */}
        {diagramState.nodes.map((node, idx) => {
          const nid = node.id ?? `node_${idx}`;
          const pose = diagramState.poses[nid] ?? {
            position: [0, 0, 0] as [number, number, number],
            quaternion: [0, 0, 0, 1] as [number, number, number, number],
            scale: 1,
          };
          return (
            <SpatialDiagramNode3D
              key={nid}
              node={node}
              pose={pose}
              waferStyle={waferStyle}
              dark={dark}
              selected={diagramState.selectedNodeIds.includes(nid)}
              isGrabbed={grabbedNodeId === nid}
              isOverDeleteRing={grabbedNodeId === nid && overDeleteRing}
              spawnedAtMs={spawnedAtMapRef.current.get(nid)}
              portHighlights={portHighlights}
              registerGroupRef={registerGroupRef}
              registerNodePorts={registerNodePorts}
              onStartNodeGrab={handleStartNodeGrab}
              onStartPortWireDrag={handleStartPortWireDrag}
            />
          );
        })}

        {/* Committed 3D Insulated Cables + Live Infinite-Extending Magnetic Wire */}
        <SpatialMagneticWires
          edges={diagramState.edges}
          stageGroupRef={stageGroupRef}
          nodeGroupRefs={nodeGroupRefs}
          nodePortsRef={nodePortsRef}
          activeWireDrag={activeWireVisual}
          selectedEdgeId={diagramState.selectedEdgeId}
          isPlaying={isPlaying}
          onSelectEdge={handleSelectEdge}
          onDisconnectEdge={handleDisconnectEdge}
        />

        {/* Tactile Crimson Recycle Delete Ring (only visible while actively carrying a component) */}
        {grabbedNodeId && (
          <group name="spatial-delete-ring" position={DELETE_RING_STAGE_POS}>
            <mesh>
              <torusGeometry args={[0.095, overDeleteRing ? 0.011 : 0.006, 12, 32]} />
              <meshBasicMaterial
                color={overDeleteRing ? "#f87171" : "#ef4444"}
                transparent
                opacity={overDeleteRing ? 0.96 : 0.62}
                toneMapped={false}
              />
            </mesh>
            <mesh>
              <circleGeometry args={[0.09, 28]} />
              <meshBasicMaterial
                color="#dc2626"
                transparent
                opacity={overDeleteRing ? 0.38 : 0.14}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        )}
      </group>

      {/* Non-Dominant Left Wrist Micro-Dock (Summons Floating 2D Library Panel, Undo, Snap, Sim) */}
      <WristPaletteTool
        visible={visible}
        paletteOpen={wristPaletteOpen}
        canUndo={diagramState.undoStack.length > 0}
        snapMode={snapMode}
        isPlaying={isPlaying}
        dark={dark}
        onTogglePalette={onToggleWristPalette}
        onUndo={handleUndo}
        onCycleSnapMode={onCycleSnapMode}
        onTogglePlaying={onTogglePlaying}
        onCue={onCue}
      />

      {/* World-Locked Floating Curved 2D Component Library Panel */}
      <FloatingLibraryPanel3D
        visible={visible && wristPaletteOpen}
        catalog={libraryCatalog}
        dark={dark}
        pullingCardId={pullingItem?.id ?? null}
        onClose={() => onSetWristPaletteOpen(false)}
        onStartPullCatalogCard={handleStartPullCatalogCard}
        onPanelDragLockChange={(locked) => setLock(locked ? "panel-drag" : "none")}
        onCue={onCue}
      />

      {/* Live 2D → 3D Materializing Extruded Preview While Pulling a Card off the Library Panel */}
      {pullingItem && (
        <MaterializingComponentPreview
          item={pullingItem}
          worldPosRef={previewWorldPosRef}
          worldQuatRef={previewWorldQuatRef}
          morphProgressRef={previewMorphProgressRef}
          isCancelReturnRef={previewCancelRef}
          waferStyle={waferStyle}
          dark={dark}
        />
      )}

      {/* Glowing Emerald Auto-Snap-Weld Preview Bridge During Materialized Drop */}
      {snapWeldVisual && (
        <mesh
          position={[
            (snapWeldVisual.from[0] + snapWeldVisual.to[0]) * 0.5,
            (snapWeldVisual.from[1] + snapWeldVisual.to[1]) * 0.5,
            (snapWeldVisual.from[2] + snapWeldVisual.to[2]) * 0.5,
          ]}
        >
          <sphereGeometry args={[0.016, 12, 10]} />
          <meshBasicMaterial color="#10b981" transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}
