// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasTile } from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GalleryComponentItem } from "../componentGalleryCatalog.js";
import { resolveDiagramLanguageTheme } from "./diagram-language-theme.js";
import { MaterializingComponentPreview } from "./FloatingLibraryPanel3D.js";
import {
  evaluateMagneticPortSnap,
  evaluatePortCompatibility,
  makePortKey,
  makeUndirectedConnectionKey,
  type WorldPortCandidate,
} from "./magnetic-port-solver.js";
import { MatrixStockroom3D } from "./MatrixStockroom3D.js";
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
  predictTossIntoRecycleBin,
  shouldTriggerForcePull,
  type GrabOffsetRigidTransform,
  type SpatialInteractionLock,
} from "./spatial-interaction.js";
import { SpatialDiagramNode3D, type PortVisualHighlightState } from "./SpatialDiagramNode3D.js";
import { SpatialMagneticWires, type ActiveWireDragVisualState } from "./SpatialMagneticWires.js";
import type { ExtrudedWaferStyle } from "./svg-extruder.js";
import { DiagramTypeBanner3D } from "./VrWorkspacePanels3D.js";
import { evaluateMaterializeTransition } from "./wrist-palette-logic.js";
import { evaluatePinchState } from "./xr-gestures.js";
import {
  applyStickDeadzone,
  pointAlongRayPose,
  readThumbstick,
  releaseEventForBinding,
  resolveXrPointerBinding,
  sampleBindingPose,
  springFollowStep,
  type XrPointerBinding,
} from "./xr-handle.js";
import { getSharedXrStore, pulseXrHaptics, type RotundaCueKind } from "./xr-session.js";

const DELETE_RING_STAGE_POS: [number, number, number] = [0.64, -0.34, 0.14];
const SNAP_WELD_RADIUS_M = 0.068;
const TOSS_GRAVITY = -3.6;
/** Thumbstick telescoping speed for laser-held parts / plugs (m/s at full deflection). */
const RAY_TELESCOPE_SPEED = 1.1;
const RAY_MIN_DISTANCE = 0.12;
const RAY_MAX_DISTANCE = 6;

/**
 * Reads the world-space pose of the pointer that emitted an XR pointer event
 * (`@pmndrs/pointer-events` exposes `pointerPosition` / `pointerQuaternion`).
 */
function readEventPointerPose(e: unknown): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
  const ev = e as { pointerPosition?: THREE.Vector3; pointerQuaternion?: THREE.Quaternion };
  if (!ev.pointerPosition || !ev.pointerQuaternion) return null;
  return { position: ev.pointerPosition.clone(), quaternion: ev.pointerQuaternion.clone() };
}

export interface SpatialDiagramStageProps {
  visible: boolean;
  tile: CanvasTile | null;
  snapMode: SpatialDiagramSnapMode;
  waferStyle: ExtrudedWaferStyle;
  wristPaletteOpen: boolean;
  isPlaying: boolean;
  dark: boolean;
  /** Active engineering language / dialect (e.g. `"modelica"`, `"sysml2"`, `"spice"`). */
  languageId?: string | undefined;
  /** Optional diagram subtype (e.g. `"diagram"`, `"bdd"`, `"ibd"`). */
  diagramType?: string | undefined;
  /** Active workspace filename shown in the 3D diagram header banner. */
  activeFileName?: string | undefined;
  libraryCatalog?: readonly GalleryComponentItem[] | undefined;
  /** Shared ref signaling active 3D diagram grab/wiring lock so OrbitControls & CAD explode yield cleanly. */
  interactionLockRef: React.MutableRefObject<SpatialInteractionLock>;
  onInteractionLockChange?: ((locked: boolean) => void) | undefined;
  onToggleWristPalette: () => void;
  onSetWristPaletteOpen: (open: boolean) => void;
  onExitDiagramMode?: (() => void) | undefined;
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

/**
 * Session drive mode:
 *  - `"desktop"`    — mouse ray from the camera (only mode that ever reads `camera`).
 *  - `"xr-hand"`    — bare-hand direct pinch (sampled from hand joints each frame).
 *  - `"xr-pointer"` — controller / hand-laser pointer bound to its own XR input source.
 */
type SessionDriveMode = "desktop" | "xr-hand" | "xr-pointer";

interface ActiveNodeGrabSession {
  nodeId: string;
  mode: SessionDriveMode;
  handedness?: "left" | "right" | undefined;
  binding?: XrPointerBinding | undefined;
  dragPlane: THREE.Plane;
  planeOffset: THREE.Vector3;
  depthOffset: number;
  yawOffsetRad: number;
  grabOffset?: GrabOffsetRigidTransform | undefined;
  /** Mutable rigid offset (pointer-local frame) for `xr-pointer` sessions; Z is telescoped by the thumbstick. */
  xrOffsetPos?: THREE.Vector3 | undefined;
  xrOffsetQuat?: THREE.Quaternion | undefined;
  targetPos: THREE.Vector3;
  targetQuat: THREE.Quaternion;
  smoothPos: THREE.Vector3;
  smoothQuat: THREE.Quaternion;
  /** Spring velocity (stage-local m/s) giving held parts a subtle sense of weight. */
  velocity: THREE.Vector3;
  /** Smoothed stage-local release velocity (m/s) used for ballistic toss-to-delete. */
  releaseVel: THREE.Vector3;
  /** Previous frame world pointer position for Gravity-Gloves force-pull flick detection. */
  prevPointerPos: THREE.Vector3;
  hasPrevPointerPos: boolean;
  /** Active force-pull reel-in animation pulling a distant part smoothly into the hand. */
  forcePulling: boolean;
}

interface ActiveTossFlight {
  nodeId: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  elapsed: number;
  duration: number;
  handedness?: "left" | "right" | undefined;
}

interface ActiveWireSession {
  sourcePort: SpatialDiagramPort3D;
  mode: SessionDriveMode;
  handedness?: "left" | "right" | undefined;
  binding?: XrPointerBinding | undefined;
  /** Distance along the bound XR ray where the plug tip floats (telescoped by thumbstick). */
  rayDistance: number;
  dragPlane: THREE.Plane;
  depthOffset: number;
  snappedKey: string | null;
  rejectedKey: string | null;
  snappedTarget: WorldPortCandidate | null;
  rejectedTarget: { candidate: WorldPortCandidate; reason: string } | null;
}

interface ActivePalettePullSession {
  item: GalleryComponentItem;
  mode: SessionDriveMode;
  handedness?: "left" | "right" | undefined;
  binding?: XrPointerBinding | undefined;
  rayDistance: number;
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
  languageId,
  diagramType,
  activeFileName,
  libraryCatalog,
  interactionLockRef,
  onInteractionLockChange,
  onToggleWristPalette,
  onSetWristPaletteOpen,
  onExitDiagramMode,
  onCycleSnapMode: _onCycleSnapMode,
  onTogglePlaying: _onTogglePlaying,
  onDiagramEdit,
  onHudStatusChange,
  onCue,
  onExposeActions,
}: SpatialDiagramStageProps): React.ReactElement | null {
  const { camera, gl } = useThree();
  const xrOrigin = useXR((s) => s.origin);
  const xrSession = useXR((s) => s.session);
  const rightHand = useXRInputSourceState("hand", "right");
  const leftHand = useXRInputSourceState("hand", "left");
  const rightController = useXRInputSourceState("controller", "right");
  const leftController = useXRInputSourceState("controller", "left");

  const langTheme = useMemo(() => resolveDiagramLanguageTheme(languageId, diagramType), [languageId, diagramType]);

  const tileKey = tile?.id ?? "__default_schematic__";
  const [diagramState, setDiagramState] = useState<SpatialDiagramState>(() => createSpatialDiagramStateFromTile(tile));
  const diagramStateRef = useRef(diagramState);
  diagramStateRef.current = diagramState;

  // Lightweight structural signature so 2D code edits or VR file switches resync the 3D diagram live
  const externalDiagramSig = useMemo(() => {
    const dd = tile?.viewState?.["diagramData"] as { nodes?: unknown[]; edges?: unknown[] } | undefined;
    const nodeIds = Array.isArray(dd?.nodes)
      ? dd.nodes
          .map((n) => {
            const obj = n as { id?: string; label?: string; x?: number; y?: number };
            return `${obj.id ?? ""}:${obj.label ?? ""}:${Math.round(obj.x ?? 0)},${Math.round(obj.y ?? 0)}`;
          })
          .join("|")
      : "";
    const edgeIds = Array.isArray(dd?.edges)
      ? dd.edges
          .map((e) => {
            const obj = e as { id?: string; source?: unknown; target?: unknown };
            return `${obj.id ?? ""}:${JSON.stringify(obj.source ?? "")}->${JSON.stringify(obj.target ?? "")}`;
          })
          .join("|")
      : "";
    return `${tileKey}::${activeFileName ?? ""}::${nodeIds}::${edgeIds}`;
  }, [tileKey, tile?.viewState, activeFileName]);

  const lastExternalSigRef = useRef(externalDiagramSig);
  useEffect(() => {
    if (lastExternalSigRef.current === externalDiagramSig) return;
    // Defer resync if the user is mid-grab or mid-wire drag so live 90Hz motion never snaps
    if (nodeGrabRef.current || wireSessionRef.current || palettePullRef.current) return;
    lastExternalSigRef.current = externalDiagramSig;
    setDiagramState(createSpatialDiagramStateFromTile(tile));
  }, [externalDiagramSig, tile]);

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
  const leftWristQuatRef = useRef(new THREE.Quaternion());
  const rightWristQuatRef = useRef(new THREE.Quaternion());
  const pointerPosScratch = useRef(new THREE.Vector3());
  const pointerQuatScratch = useRef(new THREE.Quaternion());
  const yawQuatScratch = useRef(new THREE.Quaternion());
  const stageWorldPosScratch = useRef(new THREE.Vector3());
  const invStageMatScratch = useRef(new THREE.Matrix4());
  const invStageQuatScratch = useRef(new THREE.Quaternion());
  const stageWorldQuatScratch = useRef(new THREE.Quaternion());
  const rayHitScratch = useRef(new THREE.Vector3());
  const prevSmoothPosScratch = useRef(new THREE.Vector3());
  const tmpVecA = useRef(new THREE.Vector3());
  const tmpVecB = useRef(new THREE.Vector3());
  const tmpNormal = useRef(new THREE.Vector3());
  const lastApproachHapticMsRef = useRef(0);
  const tossingNodeRef = useRef<ActiveTossFlight | null>(null);
  const [tossingNodeId, setTossingNodeId] = useState<string | null>(null);
  const disposalOuterRingRef = useRef<THREE.Mesh | null>(null);
  const disposalInnerRingRef = useRef<THREE.Mesh | null>(null);

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

  /**
   * Resolves the input source behind a pointer event. Returns `null` for bare-hand
   * near-field grab/touch pointers: those are handled by the joint-based pinch path
   * below (more precise pinch midpoint + wrist orientation), so we avoid double sessions.
   */
  const bindPointer = useCallback((e: ThreeEvent<PointerEvent>): XrPointerBinding | null => {
    const binding = resolveXrPointerBinding(e);
    if (binding.isHand && (binding.kind === "grab" || binding.kind === "touch")) return null;
    return binding;
  }, []);

  const handleStartNodeGrab = useCallback(
    (nodeId: string, e: ThreeEvent<PointerEvent>) => {
      if (nodeGrabRef.current || wireSessionRef.current || palettePullRef.current) return;
      if (!canAcquireInteractionLock(interactionLockRef.current, "node-grab")) return;
      const binding = bindPointer(e);
      if (!binding) return;
      const group = nodeGroupRefs.current.get(nodeId);
      const stage = stageGroupRef.current;
      if (!group || !stage) return;

      stage.updateWorldMatrix(true, false);
      group.updateWorldMatrix(true, false);

      const nodeWorldPos = new THREE.Vector3();
      group.getWorldPosition(nodeWorldPos);
      const nodeWorldQuat = new THREE.Quaternion();
      group.getWorldQuaternion(nodeWorldQuat);

      const curPose = diagramStateRef.current.poses[nodeId];
      const initPos = curPose ? new THREE.Vector3(...curPose.position) : group.position.clone();
      const initQuat = curPose ? new THREE.Quaternion(...curPose.quaternion) : group.quaternion.clone();

      if (binding.kind !== "desktop") {
        // XR: rigidly attach the part to the pointer pose (grip or laser) at the exact contact offset.
        const pose = readEventPointerPose(e);
        if (!pose) return;
        const grabOffset = computeGrabOffset(pose.position, pose.quaternion, nodeWorldPos, nodeWorldQuat);
        nodeGrabRef.current = {
          nodeId,
          mode: "xr-pointer",
          handedness: binding.handedness,
          binding,
          dragPlane: new THREE.Plane(),
          planeOffset: new THREE.Vector3(),
          depthOffset: 0,
          yawOffsetRad: 0,
          grabOffset,
          xrOffsetPos: new THREE.Vector3(...grabOffset.positionOffset),
          xrOffsetQuat: new THREE.Quaternion(...grabOffset.rotationOffset),
          targetPos: initPos.clone(),
          targetQuat: initQuat.clone(),
          smoothPos: initPos.clone(),
          smoothQuat: initQuat.clone(),
          velocity: new THREE.Vector3(),
          releaseVel: new THREE.Vector3(),
          prevPointerPos: pose.position.clone(),
          hasPrevPointerPos: true,
          forcePulling: false,
        };
        setLock("node-grab");
        setGrabbedNodeId(nodeId);
        setOverDeleteRing(false);
        onCue?.("grab");
        pulseXrHaptics(getSharedXrStore(), binding.kind === "grab" ? 0.4 : 0.28, 20, binding.handedness);
        return;
      }

      // Desktop: build camera-facing drag plane passing through nodeWorldPos
      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, nodeWorldPos);
      const planeOffset = nodeWorldPos.clone().sub(e.point);

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
        velocity: new THREE.Vector3(),
        releaseVel: new THREE.Vector3(),
        prevPointerPos: new THREE.Vector3(),
        hasPrevPointerPos: false,
        forcePulling: false,
      };

      setLock("node-grab");
      setGrabbedNodeId(nodeId);
      setOverDeleteRing(false);
      onCue?.("grab");
      onHudStatusChange?.(`Moving ${nodeId} in 3D space (Shift/Wheel = Z-depth · R = Rotate 90°)`);
    },
    [camera, interactionLockRef, bindPointer, setLock, onCue, onHudStatusChange],
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

    // Job Simulator "Toss to Delete": if thrown toward the disposal chute, fly it along its parabolic arc into the bin!
    const toss = predictTossIntoRecycleBin(
      rawPos,
      [sess.releaseVel.x, sess.releaseVel.y, sess.releaseVel.z],
      DELETE_RING_STAGE_POS,
      0.19,
      0.55,
      TOSS_GRAVITY,
    );
    if (toss.willHit) {
      tossingNodeRef.current = {
        nodeId: sess.nodeId,
        pos: new THREE.Vector3(rawPos[0], rawPos[1], rawPos[2]),
        vel: sess.releaseVel.clone(),
        elapsed: 0,
        duration: Math.max(0.14, Math.min(0.65, toss.impactTimeSec)),
        handedness: sess.handedness,
      };
      setTossingNodeId(sess.nodeId);
      onCue?.("whoosh");
      pulseXrHaptics(getSharedXrStore(), 0.25, 16, sess.handedness);
      onHudStatusChange?.(`Tossing ${sess.nodeId} into disposal chute…`);
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
      if (nodeGrabRef.current || wireSessionRef.current || palettePullRef.current) return;
      if (!canAcquireInteractionLock(interactionLockRef.current, "wire-drag")) return;
      const binding = bindPointer(e);
      if (!binding) return;
      const isXr = binding.kind !== "desktop";

      const planeNormal = new THREE.Vector3();
      if (!isXr) camera.getWorldDirection(planeNormal).negate();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        isXr ? planeNormal.set(0, 0, 1) : planeNormal,
        e.point,
      );
      wireTipWorldPosRef.current.copy(e.point);

      const sess: ActiveWireSession = {
        sourcePort: port,
        mode: isXr ? "xr-pointer" : "desktop",
        handedness: binding.handedness,
        binding: isXr ? binding : undefined,
        rayDistance: Math.max(RAY_MIN_DISTANCE, binding.hitDistance),
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
      lastHighlightSizeRef.current = 1;
      setPortHighlights(initHighlights);
      setActiveWireVisual({
        sourcePort: port,
        tipWorldPosRef: wireTipWorldPosRef,
        snappedTarget: null,
        rejectedTarget: null,
      });

      onCue?.("grab");
      if (isXr) pulseXrHaptics(getSharedXrStore(), 0.32, 18, binding.handedness);
      onHudStatusChange?.(
        isXr
          ? `Wiring from ${port.nodeId}.${port.portId} — point the plug at a glowing port (thumbstick ↑/↓ = reach)`
          : `Wiring from ${port.nodeId}.${port.portId} — drag toward a compatible port to snap`,
      );
    },
    [camera, interactionLockRef, bindPointer, setLock, onCue, onHudStatusChange],
  );

  const finishWireDrag = useCallback(() => {
    const sess = wireSessionRef.current;
    if (!sess) return;
    wireSessionRef.current = null;
    lastHighlightSizeRef.current = 0;
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

  /**
   * Instant Matrix Stockroom grab: as soon as the engineer grabs any shelf item,
   * the flanking corridors immediately vanish, the component materializes directly
   * in their hand / at their pointer, and it remains in live 6DOF grabbed mode moving
   * with their hand until they release the button.
   */
  const handleGrabFromStockroom = useCallback(
    (item: GalleryComponentItem, worldPos: THREE.Vector3, e: ThreeEvent<PointerEvent>) => {
      // 1. Immediately dismiss the Matrix Stockroom shelves
      onSetWristPaletteOpen(false);

      const stage = stageGroupRef.current;
      const binding = bindPointer(e);
      const isXr = Boolean(binding && binding.kind !== "desktop");
      const xrPose = isXr ? readEventPointerPose(e) : null;

      // 2. Materialize RIGHT at the user's hand (near-field grab) or laser contact point
      const spawnWorld = isXr && xrPose && binding?.kind === "grab" ? xrPose.position.clone() : worldPos.clone();

      let localPos = new THREE.Vector3(0, 0.04, 0.08);
      const stageWorldQuat = new THREE.Quaternion();
      if (stage) {
        stage.updateWorldMatrix(true, false);
        stage.getWorldQuaternion(stageWorldQuat);
        invStageMatScratch.current.copy(stage.matrixWorld).invert();
        localPos = spawnWorld.clone().applyMatrix4(invStageMatScratch.current);
      }

      const initialPose: SpatialNodePose3D = {
        position: [localPos.x, localPos.y, localPos.z],
        quaternion: [0, 0, 0, 1],
        scale: 1,
      };

      const res = commitSpawnCatalogComponent(diagramStateRef.current, item, initialPose);
      diagramStateRef.current = res.state;
      spawnedAtMapRef.current.set(res.spawnedNodeId, performance.now());
      emitEdit(res.state, res.actions);
      onCue?.("materialize");

      // 3. Immediately attach a live grab session so the materialized component moves 1:1 with the hand until release
      if (binding && canAcquireInteractionLock(interactionLockRef.current, "node-grab")) {
        const initVec = new THREE.Vector3(localPos.x, localPos.y, localPos.z);
        const initQuat = new THREE.Quaternion();

        if (isXr && xrPose) {
          const grabOffset = computeGrabOffset(xrPose.position, xrPose.quaternion, spawnWorld, stageWorldQuat);
          nodeGrabRef.current = {
            nodeId: res.spawnedNodeId,
            mode: "xr-pointer",
            handedness: binding.handedness,
            binding,
            dragPlane: new THREE.Plane(),
            planeOffset: new THREE.Vector3(),
            depthOffset: 0,
            yawOffsetRad: 0,
            grabOffset,
            xrOffsetPos: new THREE.Vector3(...grabOffset.positionOffset),
            xrOffsetQuat: new THREE.Quaternion(...grabOffset.rotationOffset),
            targetPos: initVec.clone(),
            targetQuat: initQuat.clone(),
            smoothPos: initVec.clone(),
            smoothQuat: initQuat.clone(),
            velocity: new THREE.Vector3(),
            releaseVel: new THREE.Vector3(),
            prevPointerPos: xrPose.position.clone(),
            hasPrevPointerPos: true,
            forcePulling: false,
          };
          setLock("node-grab");
          setGrabbedNodeId(res.spawnedNodeId);
          setOverDeleteRing(false);
          pulseXrHaptics(getSharedXrStore(), 0.65, 32, binding.handedness);
        } else if (!isXr) {
          const planeNormal = new THREE.Vector3();
          camera.getWorldDirection(planeNormal).negate();
          const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, spawnWorld);
          nodeGrabRef.current = {
            nodeId: res.spawnedNodeId,
            mode: "desktop",
            dragPlane,
            planeOffset: new THREE.Vector3(),
            depthOffset: 0,
            yawOffsetRad: 0,
            targetPos: initVec.clone(),
            targetQuat: initQuat.clone(),
            smoothPos: initVec.clone(),
            smoothQuat: initQuat.clone(),
            velocity: new THREE.Vector3(),
            releaseVel: new THREE.Vector3(),
            prevPointerPos: new THREE.Vector3(),
            hasPrevPointerPos: false,
            forcePulling: false,
          };
          setLock("node-grab");
          setGrabbedNodeId(res.spawnedNodeId);
          setOverDeleteRing(false);
        }
      }

      onHudStatusChange?.(`Holding ${res.spawnedNodeId} (${item.shortName}) — release button to place in 3D`);
    },
    [camera, interactionLockRef, bindPointer, setLock, emitEdit, onSetWristPaletteOpen, onCue, onHudStatusChange],
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

  const handleUnplugEdgeToDrag = useCallback(
    (edgeId: string, keptPort: SpatialDiagramPort3D, e: ThreeEvent<PointerEvent>) => {
      if (nodeGrabRef.current || wireSessionRef.current || palettePullRef.current) return;
      const res = commitDisconnectSpatialEdge(diagramStateRef.current, edgeId);
      if (res.actions.length > 0) {
        diagramStateRef.current = res.state;
        emitEdit(res.state, res.actions);
        onCue?.("wire-pop");
        const binding = resolveXrPointerBinding(e);
        pulseXrHaptics(getSharedXrStore(), 0.45, 22, binding.handedness);
      }
      handleStartPortWireDrag(keptPort, e);
    },
    [emitEdit, onCue, handleStartPortWireDrag],
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
  /*  XR Release Binding: end sessions on the SAME input source's select /    */
  /*  squeeze end (window `pointerup` never fires inside immersive sessions). */
  /* ------------------------------------------------------------------------ */

  const finishSessionsForXrRelease = useCallback(
    (matches: (binding: XrPointerBinding) => boolean) => {
      const w = wireSessionRef.current;
      if (w?.mode === "xr-pointer" && w.binding && matches(w.binding)) finishWireDrag();
      const p = palettePullRef.current;
      if (p?.mode === "xr-pointer" && p.binding && matches(p.binding)) finishPalettePull();
      const n = nodeGrabRef.current;
      if (n?.mode === "xr-pointer" && n.binding && matches(n.binding)) finishNodeGrab();
    },
    [finishWireDrag, finishPalettePull, finishNodeGrab],
  );

  useEffect(() => {
    if (!xrSession) return;
    const onEnd = (type: "selectend" | "squeezeend") => (ev: XRInputSourceEvent) => {
      finishSessionsForXrRelease((b) => b.inputSource === ev.inputSource && releaseEventForBinding(b) === type);
    };
    const onSelectEnd = onEnd("selectend");
    const onSqueezeEnd = onEnd("squeezeend");
    const onSourcesChange = (ev: XRInputSourcesChangeEvent) => {
      // Controller put down / tracking lost mid-grab → drop cleanly instead of freezing the lock.
      if (ev.removed.length === 0) return;
      finishSessionsForXrRelease((b) => b.inputSource != null && ev.removed.includes(b.inputSource));
    };
    xrSession.addEventListener("selectend", onSelectEnd);
    xrSession.addEventListener("squeezeend", onSqueezeEnd);
    xrSession.addEventListener("inputsourceschange", onSourcesChange);
    return () => {
      xrSession.removeEventListener("selectend", onSelectEnd);
      xrSession.removeEventListener("squeezeend", onSqueezeEnd);
      xrSession.removeEventListener("inputsourceschange", onSourcesChange);
    };
  }, [xrSession, finishSessionsForXrRelease]);

  /** Pointer-up fallback (captured XR pointers bubble here); matches by pointerId. */
  const handleRootPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const b = resolveXrPointerBinding(e);
      if (b.kind === "desktop") return; // desktop handled by window listener
      finishSessionsForXrRelease((sb) => sb.pointerId === b.pointerId);
    },
    [finishSessionsForXrRelease],
  );

  /* ------------------------------------------------------------------------ */
  /*  Unified 90Hz WebXR Bare-Hand, Controller & Desktop Manipulation Loop    */
  /* ------------------------------------------------------------------------ */

  const lastHighlightSizeRef = useRef(0);

  const evaluateWireMagneticStep = useCallback(
    (sess: ActiveWireSession, tipWorld: THREE.Vector3, precollectedCandidates?: WorldPortCandidate[]) => {
      if (!Number.isFinite(tipWorld.x) || !Number.isFinite(tipWorld.y) || !Number.isFinite(tipWorld.z)) return;
      wireTipWorldPosRef.current.copy(tipWorld);
      const candidates = precollectedCandidates ?? collectWorldPortCandidates();
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
        pulseXrHaptics(getSharedXrStore(), 0.62, 30, sess.handedness);
      } else if (evalRes.justRejected) {
        onCue?.("magnet-reject");
        pulseXrHaptics(getSharedXrStore(), 0.22, 34, sess.handedness);
      } else if (!evalRes.snappedTarget && evalRes.approachCandidates.length > 0 && sess.mode !== "desktop") {
        // Magnetic attraction haptic ramp: gentle increasing ticks as the plug enters a compatible port's pull well
        let maxProximity = 0;
        for (const app of evalRes.approachCandidates) {
          if (app.proximity01 > maxProximity) maxProximity = app.proximity01;
        }
        if (maxProximity > 0.22) {
          const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
          const intervalMs = 85 - maxProximity * 42;
          if (nowMs - lastApproachHapticMsRef.current >= intervalMs) {
            lastApproachHapticMsRef.current = nowMs;
            pulseXrHaptics(getSharedXrStore(), 0.06 + maxProximity * 0.24, 9, sess.handedness);
          }
        }
      }

      const snapChanged = nextSnappedKey !== sess.snappedKey || nextRejectedKey !== sess.rejectedKey;
      sess.snappedKey = nextSnappedKey;
      sess.rejectedKey = nextRejectedKey;
      sess.snappedTarget = evalRes.snappedTarget;
      sess.rejectedTarget = evalRes.rejectedTarget;

      // Update per-port magnetic highlight halos only when snap/reject or highlighted port count changes
      const nextSize = 1 + evalRes.approachCandidates.length + (evalRes.rejectedTarget && nextRejectedKey ? 1 : 0);
      if (snapChanged || nextSize !== lastHighlightSizeRef.current) {
        lastHighlightSizeRef.current = nextSize;
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
        setPortHighlights(nextMap);
      }

      if (snapChanged) {
        setActiveWireVisual({
          sourcePort: sess.sourcePort,
          tipWorldPosRef: wireTipWorldPosRef,
          snappedTarget: evalRes.snappedTarget,
          rejectedTarget: evalRes.rejectedTarget,
        });
      }
    },
    [collectWorldPortCandidates, existingConnectionKeys, onCue],
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

  useFrame((state, rawDelta, frame) => {
    if (!visible) return;
    const delta = Math.min(rawDelta, 0.1);
    const stage = stageGroupRef.current;
    if (!stage) return;

    // 0. Animate 3D Disposal Vortex Chute iris rings while visible
    if (disposalOuterRingRef.current) {
      disposalOuterRingRef.current.rotation.z =
        state.clock.elapsedTime * (overDeleteRing || tossingNodeRef.current ? 3.2 : 1.1);
    }
    if (disposalInnerRingRef.current) {
      disposalInnerRingRef.current.rotation.z =
        -state.clock.elapsedTime * (overDeleteRing || tossingNodeRef.current ? 4.5 : 1.6);
    }

    // 0B. Step in-flight ballistic Toss-to-Delete animation (Job Simulator throw into bin)
    if (tossingNodeRef.current) {
      const toss = tossingNodeRef.current;
      toss.elapsed += delta;
      const tNorm = Math.min(1, toss.elapsed / toss.duration);
      const grp = nodeGroupRefs.current.get(toss.nodeId);
      if (grp) {
        const t = toss.elapsed;
        grp.position.set(
          toss.pos.x + toss.vel.x * t,
          toss.pos.y + toss.vel.y * t + 0.5 * TOSS_GRAVITY * t * t,
          toss.pos.z + toss.vel.z * t,
        );
        grp.rotation.z += delta * 6.5;
        grp.rotation.x += delta * 3.8;
        const shrink = tNorm > 0.65 ? Math.max(0.15, 1 - ((tNorm - 0.65) / 0.35) * 0.85) : 1;
        grp.scale.setScalar(shrink);
      }
      if (tNorm >= 1) {
        tossingNodeRef.current = null;
        setTossingNodeId(null);
        const res = commitDeleteSpatialNode(diagramStateRef.current, toss.nodeId);
        emitEdit(res.state, res.actions);
        onCue?.("wire-pop");
        pulseXrHaptics(getSharedXrStore(), 0.55, 34, toss.handedness);
        onHudStatusChange?.(`Disposed ${toss.nodeId} (Undo available)`);
      }
    }

    // 1. Bare-Hand Direct Proximity Grab & Magnetic Wiring inside active WebXR sessions (both hands supported)
    const refSpace = gl.xr.getReferenceSpace();
    if (frame && refSpace && (leftHand?.inputSource.hand || rightHand?.inputSource.hand)) {
      const samplePinch = (
        xrHand: XRHand | undefined,
        prev: boolean,
        outPos: THREE.Vector3,
        outWristQuat?: THREE.Quaternion,
      ): boolean => {
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
        if (outWristQuat) {
          const wrist = xrHand.get("wrist");
          const wp = wrist ? frame.getJointPose(wrist, refSpace) : undefined;
          if (wp) {
            const o = wp.transform.orientation;
            outWristQuat.set(o.x, o.y, o.z, o.w);
            if (xrOrigin) {
              xrOrigin.getWorldQuaternion(yawQuatScratch.current);
              outWristQuat.premultiply(yawQuatScratch.current);
            }
          }
        }
        return evaluatePinchState(dist, prev);
      };

      const leftPinched = samplePinch(
        leftHand?.inputSource.hand,
        xrPinchPrevRef.current.left,
        leftPinchWorldRef.current,
        leftWristQuatRef.current,
      );
      const rightPinched = samplePinch(
        rightHand?.inputSource.hand,
        xrPinchPrevRef.current.right,
        rightPinchWorldRef.current,
        rightWristQuatRef.current,
      );

      const tryBareHandGrab = (handedness: "left" | "right", pinchPos: THREE.Vector3, wristQuat: THREE.Quaternion) => {
        const anySessionActive = Boolean(nodeGrabRef.current || wireSessionRef.current || palettePullRef.current);
        if (anySessionActive || interactionLockRef.current !== "none") return;

        const candidates = collectWorldPortCandidates();
        let hitPort: WorldPortCandidate | null = null;
        let bestPortDist = 0.048;
        for (const c of candidates) {
          const d = Math.hypot(
            c.worldPosition[0] - pinchPos.x,
            c.worldPosition[1] - pinchPos.y,
            c.worldPosition[2] - pinchPos.z,
          );
          if (d < bestPortDist) {
            bestPortDist = d;
            hitPort = c;
          }
        }

        if (hitPort) {
          wireTipWorldPosRef.current.copy(pinchPos);
          wireSessionRef.current = {
            sourcePort: hitPort.port,
            mode: "xr-hand",
            handedness,
            rayDistance: 0,
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
          pulseXrHaptics(getSharedXrStore(), 0.32, 18, handedness);
        } else {
          // Check direct node proximity grab
          let hitNodeId: string | null = null;
          let bestNodeDist = 0.1;
          for (const [nid, grp] of nodeGroupRefs.current.entries()) {
            grp.getWorldPosition(tmpVecA.current);
            const d = tmpVecA.current.distanceTo(pinchPos);
            if (d < bestNodeDist) {
              bestNodeDist = d;
              hitNodeId = nid;
            }
          }
          if (hitNodeId) {
            const grp = nodeGroupRefs.current.get(hitNodeId)!;
            grp.getWorldPosition(tmpVecA.current);
            grp.getWorldQuaternion(handQuatScratch.current);
            const grabOffset = computeGrabOffset(pinchPos, wristQuat, tmpVecA.current, handQuatScratch.current);
            nodeGrabRef.current = {
              nodeId: hitNodeId,
              mode: "xr-hand",
              handedness,
              dragPlane: new THREE.Plane(),
              planeOffset: new THREE.Vector3(),
              depthOffset: 0,
              yawOffsetRad: 0,
              grabOffset,
              targetPos: grp.position.clone(),
              targetQuat: grp.quaternion.clone(),
              smoothPos: grp.position.clone(),
              smoothQuat: grp.quaternion.clone(),
              velocity: new THREE.Vector3(),
              releaseVel: new THREE.Vector3(),
              prevPointerPos: pinchPos.clone(),
              hasPrevPointerPos: true,
              forcePulling: false,
            };
            setLock("node-grab");
            setGrabbedNodeId(hitNodeId);
            onCue?.("grab");
          }
        }
      };

      // Rising-edge Bare-Hand Direct Pinch (right hand checked first, then left hand)
      if (rightPinched && !xrPinchPrevRef.current.right) {
        tryBareHandGrab("right", rightPinchWorldRef.current, rightWristQuatRef.current);
      }
      if (leftPinched && !xrPinchPrevRef.current.left) {
        tryBareHandGrab("left", leftPinchWorldRef.current, leftWristQuatRef.current);
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

      // Release bare-hand sessions cleanly when the owning hand's pinch releases
      const releaseBareHand = (handedness: "left" | "right") => {
        if (
          wireSessionRef.current?.mode === "xr-hand" &&
          (wireSessionRef.current.handedness ?? "right") === handedness
        ) {
          finishWireDrag();
        }
        if (nodeGrabRef.current?.mode === "xr-hand" && (nodeGrabRef.current.handedness ?? "right") === handedness) {
          finishNodeGrab();
        }
        if (
          palettePullRef.current?.mode === "xr-hand" &&
          (palettePullRef.current.handedness ?? "right") === handedness
        ) {
          finishPalettePull();
        }
      };
      if (!rightPinched && xrPinchPrevRef.current.right) releaseBareHand("right");
      if (!leftPinched && xrPinchPrevRef.current.left) releaseBareHand("left");

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

    // Shared XR pointer sampling for sessions bound to a controller / hand-laser input source.
    const sampleBound = (binding: XrPointerBinding | undefined): boolean =>
      Boolean(
        binding &&
        sampleBindingPose(binding, frame, refSpace, xrOrigin, pointerPosScratch.current, pointerQuatScratch.current),
      );
    const telescope = (binding: XrPointerBinding | undefined, distance: number): number => {
      if (!binding || binding.kind !== "ray") return distance;
      const push = -applyStickDeadzone(readThumbstick(binding).y);
      if (push === 0) return distance;
      return Math.max(RAY_MIN_DISTANCE, Math.min(RAY_MAX_DISTANCE, distance + push * RAY_TELESCOPE_SPEED * delta));
    };

    // 2. Active Wire Drag Step (plug tip follows the HAND / controller laser — never the head)
    if (wireSessionRef.current) {
      const sess = wireSessionRef.current;
      if (sess.mode === "xr-hand") {
        const handPos = sess.handedness === "left" ? leftPinchWorldRef.current : rightPinchWorldRef.current;
        evaluateWireMagneticStep(sess, handPos);
      } else if (sess.mode === "xr-pointer") {
        if (sampleBound(sess.binding)) {
          const target = tmpVecA.current;
          let precollected: WorldPortCandidate[] | undefined;
          if (sess.binding?.kind === "ray") {
            sess.rayDistance = telescope(sess.binding, sess.rayDistance);
            pointAlongRayPose(pointerPosScratch.current, pointerQuatScratch.current, sess.rayDistance, target);
            // Ray magnet assist: if the laser passes near a port, slide the plug to that port's depth
            // so far-field wiring is "just point at the target port".
            const rayDir = tmpNormal.current.set(0, 0, -1).applyQuaternion(pointerQuatScratch.current);
            let bestPerp = Infinity;
            let bestT = -1;
            precollected = collectWorldPortCandidates();
            for (const c of precollected) {
              if (c.port.nodeId === sess.sourcePort.nodeId && c.port.portId === sess.sourcePort.portId) continue;
              rayHitScratch.current
                .set(c.worldPosition[0], c.worldPosition[1], c.worldPosition[2])
                .sub(pointerPosScratch.current);
              const t = rayHitScratch.current.dot(rayDir);
              if (t <= RAY_MIN_DISTANCE) continue;
              const perp = Math.sqrt(Math.max(0, rayHitScratch.current.lengthSq() - t * t));
              const capture = 0.035 + 0.025 * t; // wider capture cone farther away
              if (perp < capture && perp < bestPerp) {
                bestPerp = perp;
                bestT = t;
              }
            }
            if (bestT > 0) {
              pointAlongRayPose(pointerPosScratch.current, pointerQuatScratch.current, bestT, target);
            }
          } else {
            // Direct grip: plug sits just in front of the grip, like holding a real connector.
            target.set(0, 0, -0.04).applyQuaternion(pointerQuatScratch.current).add(pointerPosScratch.current);
          }
          // Light smoothing kills long-lever laser jitter without perceptible lag.
          const a = computeSmoothingAlpha(delta, sess.binding?.kind === "ray" ? 0.022 : 0.01);
          tmpVecB.current.copy(wireTipWorldPosRef.current).lerp(target, a);
          evaluateWireMagneticStep(sess, tmpVecB.current, precollected);
        }
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
        const handPos = sess.handedness === "left" ? leftPinchWorldRef.current : rightPinchWorldRef.current;
        evaluatePalettePullStep(sess, handPos);
      } else if (sess.mode === "xr-pointer") {
        if (sampleBound(sess.binding)) {
          if (sess.binding?.kind === "ray") {
            sess.rayDistance = telescope(sess.binding, sess.rayDistance);
            pointAlongRayPose(pointerPosScratch.current, pointerQuatScratch.current, sess.rayDistance, tmpVecB.current);
          } else {
            tmpVecB.current.copy(pointerPosScratch.current);
          }
          evaluatePalettePullStep(sess, tmpVecB.current);
        }
      } else {
        raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
        if (raycasterRef.current.ray.intersectPlane(sess.dragPlane, rayHitScratch.current)) {
          evaluatePalettePullStep(sess, rayHitScratch.current);
        }
      }
    }

    // 4. Active 6DOF Component Grab Step (spring-damped "weight", Gravity-Gloves force pull, & release velocity)
    if (nodeGrabRef.current) {
      const sess = nodeGrabRef.current;
      const grp = nodeGroupRefs.current.get(sess.nodeId);
      if (grp) {
        stage.updateWorldMatrix(true, false);
        invStageMatScratch.current.copy(stage.matrixWorld).invert();
        stage.getWorldQuaternion(stageWorldQuatScratch.current);
        invStageQuatScratch.current.copy(stageWorldQuatScratch.current).invert();
        prevSmoothPosScratch.current.copy(sess.smoothPos);

        if (sess.mode === "xr-hand" && sess.grabOffset) {
          const handPos = sess.handedness === "left" ? leftPinchWorldRef.current : rightPinchWorldRef.current;
          const handQuat = sess.handedness === "left" ? leftWristQuatRef.current : rightWristQuatRef.current;
          applyGrabOffset(handPos, handQuat, sess.grabOffset, tmpVecA.current, sess.targetQuat);
          sess.targetPos.copy(tmpVecA.current).applyMatrix4(invStageMatScratch.current);
          sess.targetQuat.premultiply(invStageQuatScratch.current);
        } else if (sess.mode === "xr-pointer" && sess.xrOffsetPos && sess.xrOffsetQuat) {
          if (sampleBound(sess.binding)) {
            // Far-field laser grab: thumbstick telescoping + Gravity-Gloves backward wrist-flick force pull
            if (sess.binding?.kind === "ray") {
              const curReach = -sess.xrOffsetPos.z;
              const rayFwd = tmpNormal.current.set(0, 0, -1).applyQuaternion(pointerQuatScratch.current);
              if (
                !sess.forcePulling &&
                sess.hasPrevPointerPos &&
                shouldTriggerForcePull(
                  [sess.prevPointerPos.x, sess.prevPointerPos.y, sess.prevPointerPos.z],
                  [pointerPosScratch.current.x, pointerPosScratch.current.y, pointerPosScratch.current.z],
                  [rayFwd.x, rayFwd.y, rayFwd.z],
                  delta,
                  curReach,
                )
              ) {
                sess.forcePulling = true;
                onCue?.("whoosh");
                pulseXrHaptics(getSharedXrStore(), 0.35, 22, sess.handedness);
                onHudStatusChange?.(`Force-pulled ${sess.nodeId} into hand!`);
              }
              if (sess.forcePulling) {
                const nextReach = curReach + (0.2 - curReach) * computeSmoothingAlpha(delta, 0.045);
                sess.xrOffsetPos.z = -nextReach;
                sess.xrOffsetPos.x *= 1 - computeSmoothingAlpha(delta, 0.06);
                sess.xrOffsetPos.y *= 1 - computeSmoothingAlpha(delta, 0.06);
                if (Math.abs(nextReach - 0.2) < 0.015) {
                  sess.forcePulling = false;
                  pulseXrHaptics(getSharedXrStore(), 0.45, 24, sess.handedness);
                }
              } else {
                const reach = telescope(sess.binding, curReach);
                sess.xrOffsetPos.z = -reach;
              }
            }
            sess.prevPointerPos.copy(pointerPosScratch.current);
            sess.hasPrevPointerPos = true;

            tmpVecA.current
              .copy(sess.xrOffsetPos)
              .applyQuaternion(pointerQuatScratch.current)
              .add(pointerPosScratch.current);
            sess.targetQuat.copy(sess.xrOffsetQuat).premultiply(pointerQuatScratch.current).normalize();
            sess.targetPos.copy(tmpVecA.current).applyMatrix4(invStageMatScratch.current);
            sess.targetQuat.premultiply(invStageQuatScratch.current);
          }
        } else {
          // Desktop 3D mouse-ray grab
          raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
          if (raycasterRef.current.ray.intersectPlane(sess.dragPlane, rayHitScratch.current)) {
            stageWorldPosScratch.current.copy(rayHitScratch.current).add(sess.planeOffset);
            camera.getWorldDirection(tmpNormal.current);
            stageWorldPosScratch.current.addScaledVector(tmpNormal.current, sess.depthOffset);
            sess.targetPos.copy(stageWorldPosScratch.current).applyMatrix4(invStageMatScratch.current);
          }
          sess.targetQuat.setFromAxisAngle(tmpVecB.current.set(0, 0, 1), sess.yawOffsetRad);
        }

        if (
          Number.isFinite(sess.targetPos.x) &&
          Number.isFinite(sess.targetPos.y) &&
          Number.isFinite(sess.targetPos.z)
        ) {
          if (sess.mode === "desktop") {
            const alpha = computeSmoothingAlpha(delta, 0.014);
            sess.smoothPos.lerp(sess.targetPos, alpha);
            sess.smoothQuat.slerp(sess.targetQuat, alpha);
          } else {
            // Critically-damped spring: crisp in hand, a hint of mass, and lever-arm jitter removed on lasers.
            const halfLife = sess.mode === "xr-hand" ? 0.03 : sess.binding?.kind === "ray" ? 0.045 : 0.022;
            springFollowStep(sess.smoothPos, sess.velocity, sess.targetPos, delta, halfLife);
            sess.smoothQuat.slerp(sess.targetQuat, computeSmoothingAlpha(delta, halfLife * 0.8));
          }
        }

        // Track exponentially smoothed stage-local velocity for Toss-to-Delete release physics
        if (delta > 1e-4) {
          tmpVecB.current.copy(sess.smoothPos).sub(prevSmoothPosScratch.current).divideScalar(delta);
          const velAlpha = computeSmoothingAlpha(delta, 0.032);
          sess.releaseVel.lerp(tmpVecB.current, velAlpha);
        }

        grp.position.copy(sess.smoothPos);
        grp.quaternion.copy(sess.smoothQuat);

        // Live Disposal Chute proximity detection
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
    <group name="spatial-diagram-editor-root" onPointerUp={handleRootPointerUp}>
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

        {/* Prominent Language & Diagram Paradigm Banner (Modelica, SysML v2, SPICE, etc.) */}
        <DiagramTypeBanner3D
          theme={langTheme}
          fileName={activeFileName ?? tile?.title}
          nodeCount={diagramState.nodes.length}
          edgeCount={diagramState.edges.length}
          position={[0, hy + 0.14, 0.01]}
        />

        {/* Optional 5 cm Spatial Precision Grid Plane (shown in "grid-5cm" or "flat-2d" mode) */}
        {(snapMode === "grid-5cm" || snapMode === "flat-2d") && (
          <gridHelper
            args={[hx * 2, 30, langTheme.gridTint, dark ? "#1e293b" : "#94a3b8"]}
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
              isGrabbed={grabbedNodeId === nid || tossingNodeId === nid}
              isOverDeleteRing={(grabbedNodeId === nid && overDeleteRing) || tossingNodeId === nid}
              spawnedAtMs={spawnedAtMapRef.current.get(nid)}
              portHighlights={portHighlights}
              registerGroupRef={registerGroupRef}
              registerNodePorts={registerNodePorts}
              onStartNodeGrab={handleStartNodeGrab}
              onStartPortWireDrag={handleStartPortWireDrag}
            />
          );
        })}

        {/* Committed 3D Insulated Cables + Live Physical Verlet Magnetic Wire */}
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
          onUnplugEdgeToDrag={handleUnplugEdgeToDrag}
        />

        {/* Futuristic 3D Disposal Vortex Chute (pre-mounted & toggled via visible for zero mid-grab shader stalls) */}
        <group
          name="spatial-delete-ring"
          position={DELETE_RING_STAGE_POS}
          visible={Boolean(grabbedNodeId || tossingNodeId)}
        >
          {/* Outer chute rim */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.028, 0]}>
            <cylinderGeometry args={[0.105, 0.072, 0.068, 20, 1, true]} />
            <meshBasicMaterial
              color={overDeleteRing || tossingNodeId ? "#991b1b" : "#334155"}
              transparent
              opacity={0.62}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Outer counter-rotating holographic disposal iris */}
          <mesh ref={disposalOuterRingRef} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.106, overDeleteRing || tossingNodeId ? 0.011 : 0.006, 10, 24]} />
            <meshBasicMaterial
              color={overDeleteRing || tossingNodeId ? "#f87171" : "#ef4444"}
              transparent
              opacity={overDeleteRing || tossingNodeId ? 0.98 : 0.72}
              toneMapped={false}
            />
          </mesh>
          {/* Inner segmented vortex ring */}
          <mesh ref={disposalInnerRingRef} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.016, 0]}>
            <torusGeometry args={[0.072, 0.004, 8, 18]} />
            <meshBasicMaterial
              color={overDeleteRing || tossingNodeId ? "#fca5a5" : "#f87171"}
              transparent
              opacity={overDeleteRing || tossingNodeId ? 0.85 : 0.45}
              toneMapped={false}
            />
          </mesh>
          {/* Glowing vortex aperture field */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
            <circleGeometry args={[0.095, 24]} />
            <meshBasicMaterial
              color="#dc2626"
              transparent
              opacity={overDeleteRing || tossingNodeId ? 0.44 : 0.18}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>

        {/* Compact Podium-Styled Quick-Dock below the dedicated 3D Diagram Arena */}
        <DiagramStageQuickDock
          position={[0, -hy - 0.12, 0.08]}
          stockroomOpen={wristPaletteOpen}
          canUndo={diagramState.undoStack.length > 0}
          onToggleStockroom={onToggleWristPalette}
          onUndo={handleUndo}
          onReturnToPodium={onExitDiagramMode}
        />
      </group>

      {/* Matrix Stockroom Infinite-Scroll 3D Component Vault (90°-Rotated Horizontal Corridors) */}
      <MatrixStockroom3D
        visible={visible && wristPaletteOpen}
        catalog={libraryCatalog}
        onGrabComponent={handleGrabFromStockroom}
        onClose={() => onSetWristPaletteOpen(false)}
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

const DOCK_W = 768;
const DOCK_H = 112;
const DOCK_ZONES = [
  { id: "stockroom", x: 16, y: 16, w: 300, h: 80 },
  { id: "undo", x: 332, y: 16, w: 140, h: 80 },
  { id: "podium", x: 488, y: 16, w: 264, h: 80 },
] as const;

function DiagramStageQuickDock({
  position,
  stockroomOpen,
  canUndo,
  onToggleStockroom,
  onUndo,
  onReturnToPodium,
}: {
  position: [number, number, number];
  stockroomOpen: boolean;
  canUndo: boolean;
  onToggleStockroom: () => void;
  onUndo: () => void;
  onReturnToPodium?: (() => void) | undefined;
}): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const lastPressRef = useRef<{ id: string; atMs: number }>({ id: "", atMs: 0 });

  const bundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = DOCK_W;
    canvas.height = DOCK_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);

  useEffect(() => {
    return () => {
      bundle?.texture.dispose();
    };
  }, [bundle]);

  useEffect(() => {
    if (!bundle?.ctx) return;
    const ctx = bundle.ctx;
    ctx.clearRect(0, 0, DOCK_W, DOCK_H);

    // Dark recessed CNC keybed tray
    ctx.fillStyle = "#172033";
    ctx.beginPath();
    ctx.roundRect(4, 4, DOCK_W - 8, DOCK_H - 8, 22);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(203, 213, 225, 0.42)";
    ctx.stroke();

    const drawKey = (z: (typeof DOCK_ZONES)[number], label: string, active: boolean, disabled = false) => {
      const hov = hoveredId === z.id && !disabled;
      const g = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
      if (active) {
        g.addColorStop(0, "#0284c7");
        g.addColorStop(1, "#0369a1");
      } else if (disabled) {
        g.addColorStop(0, "#334155");
        g.addColorStop(1, "#1e293b");
      } else if (hov) {
        g.addColorStop(0, "#e0f2fe");
        g.addColorStop(1, "#bae6fd");
      } else {
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#f1f5f9");
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(z.x, z.y, z.w, z.h, 16);
      ctx.fill();
      ctx.lineWidth = hov ? 4 : 2;
      ctx.strokeStyle = hov ? "#38bdf8" : active ? "#e0f2fe" : "#cbd5e1";
      ctx.stroke();

      ctx.fillStyle = active ? "#ffffff" : disabled ? "#64748b" : "#0f172a";
      ctx.font = "800 24px Inter, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, z.x + z.w * 0.5, z.y + z.h * 0.52);
    };

    drawKey(DOCK_ZONES[0], stockroomOpen ? "✕ Close Stockroom" : "＋ Stockroom", stockroomOpen);
    drawKey(DOCK_ZONES[1], "↶ Undo", false, !canUndo);
    drawKey(DOCK_ZONES[2], "◈ 3D Model ↻", false, !onReturnToPodium);
    bundle.texture.needsUpdate = true;
  }, [bundle, stockroomOpen, canUndo, hoveredId, onReturnToPodium]);

  const hitZone = useCallback((e: ThreeEvent<PointerEvent>): string | null => {
    if (!e.uv) return null;
    const px = e.uv.x * DOCK_W;
    const py = (1 - e.uv.y) * DOCK_H;
    for (const z of DOCK_ZONES) {
      if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return z.id;
    }
    return null;
  }, []);

  if (!bundle) return <group />;

  return (
    <group position={position} rotation={[-0.28, 0, 0]}>
      <mesh
        onPointerMove={(e) => {
          e.stopPropagation();
          setHoveredId(hitZone(e));
        }}
        onPointerOut={() => setHoveredId(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          const id = hitZone(e);
          if (!id) return;
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (lastPressRef.current.id === id && now - lastPressRef.current.atMs < 140) return;
          lastPressRef.current = { id, atMs: now };
          if (id === "stockroom") onToggleStockroom();
          else if (id === "undo" && canUndo) onUndo();
          else if (id === "podium") onReturnToPodium?.();
        }}
      >
        <planeGeometry args={[0.74, 0.108]} />
        <meshBasicMaterial map={bundle.texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
