// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasPeerPresence, CanvasTile } from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR, useXRInputSourceState } from "@react-three/xr";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GalleryComponentItem } from "./componentGalleryCatalog.js";
import { resolveDiagramLanguageTheme } from "./diagram-language-theme.js";
import { MaterializingComponentPreview } from "./FloatingLibraryPanel3D.js";
import { QUICK_TAP_MAX_MOVE_M, QUICK_TAP_MAX_MS, type RotundaLibraryProvider } from "./glass-library-logic.js";
import { GlassLibraryNavigator3D } from "./GlassLibraryNavigator3D.js";
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
  commitAddEdgeWaypoint,
  commitAddIconPrimitive,
  commitAlignSpatialNodes,
  commitConnectSpatialPorts,
  commitDeleteIconPrimitive,
  commitDeleteSpatialNode,
  commitDeleteSpatialNodes,
  commitDisconnectSpatialEdge,
  commitDuplicateSpatialNodes,
  commitFlipSpatialNode,
  commitMoveEdgeWaypoints,
  commitMoveSpatialNode,
  commitMoveSpatialNodes,
  commitNudgeSpatialNodes,
  commitReconnectSpatialEdge,
  commitRemoveEdgeWaypoint,
  commitReorderIconPrimitive,
  commitResizeSpatialNode,
  commitRotateSpatialNode,
  commitSpawnCatalogComponent,
  computeSpatialSmartGuides,
  createSpatialDiagramStateFromTile,
  diagram2DToStage3D,
  DIAGRAM_STAGE_DEFAULT_CENTER,
  DIAGRAM_STAGE_HALF_EXTENTS,
  DOMAIN_COLORS,
  DOMAIN_LAYER_Z_PLANES,
  extractNodePorts3D,
  inferCatalogItemPorts,
  redoSpatialDiagram,
  resolveEdgeEndpoints,
  undoSpatialDiagram,
  type SpatialAlignmentGuide,
  type SpatialAlignmentMode,
  type SpatialDiagramPort3D,
  type SpatialDiagramSnapMode,
  type SpatialDiagramState,
  type SpatialNodePose3D,
  type VrIconPrimitiveKind,
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
import type { RotundaSimulationData } from "./types.js";
import { extractVrSimulationDataset, formatEngineeringValue, sampleSeriesAtTime } from "./vr-simulation-logic.js";
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
  libraryProvider?: RotundaLibraryProvider | undefined;
  /** Controlled selected component ID synced from host 2D/Inspector. */
  selectedNodeId?: string | null | undefined;
  /** Callback invoked whenever selection changes in the 3D Diagram Stage. */
  onSelectNode?: ((nodeId: string | null) => void) | undefined;
  /** Host undo handler so Ctrl+Z / Undo reverts LSP source edits atomically. */
  onUndo?: (() => void) | undefined;
  /** Host redo handler so Ctrl+Shift+Z / Redo reapplies LSP source edits atomically. */
  onRedo?: (() => void) | undefined;
  canUndo?: boolean | undefined;
  canRedo?: boolean | undefined;
  /** Callback invoked on subsystem drill-down (double-click or action pill). */
  onDrillDown?: ((nodeId: string, nodeData?: unknown) => void) | undefined;
  /** Callback invoked to reveal the selected component in source code. */
  onRevealSource?: ((nodeId: string) => void) | undefined;
  /** Callback to open/toggle the left-docked VR Inspector side wing. */
  onOpenInspectorWing?: (() => void) | undefined;
  /** Live simulation time & dataset for node value badges on the 3D diagram. */
  simulationTime?: number | undefined;
  simulationData?: RotundaSimulationData | undefined;
  /** Remote multiplayer peers for collaborative selection halos on the 3D stage. */
  peers?: readonly CanvasPeerPresence[] | undefined;
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
  /** Exposes imperative Undo/Redo/Auto-Layer/Align/Icon triggers for desktop HUD buttons. */
  onExposeActions?:
    | ((api: {
        undo: () => void;
        redo: () => void;
        autoLayerByDomain: () => void;
        flattenTo2D: () => void;
        alignSelected: (mode: SpatialAlignmentMode) => void;
        addIconPrimitive: (kind: VrIconPrimitiveKind) => void;
        deleteSelectedIconPrimitive: () => void;
        reorderSelectedIconPrimitive: (delta: -1 | 1) => void;
        canUndo: boolean;
        canRedo: boolean;
        nodeCount: number;
        edgeCount: number;
        selectedCount: number;
        selectedIconIndex: number | null;
        iconPrimitiveCount: number;
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
  /** Initial stage-local position of the primary grabbed node (used for multi-select batch translation). */
  startLocalPos?: THREE.Vector3 | undefined;
  /** Initial poses of any additional selected nodes moving together with the primary grabbed node. */
  companionStartPoses?: Record<string, SpatialNodePose3D> | undefined;
  /** When spawned from the Glass Library, a quick tap (< 175ms & < 3.5cm) arms sticky click-to-place carry! */
  allowQuickTapCarry?: boolean | undefined;
  clickToPlaceArmed?: boolean | undefined;
  startedAtMs?: number | undefined;
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
  /** Present when unplugging an existing wire ferrule for atomic `reconnect` on drop. */
  reconnectingEdge?:
    | {
        readonly edgeId: string;
        readonly pulledEnd: "start" | "end";
        readonly originalOtherNodeId: string;
        readonly originalOtherPortId: string;
      }
    | undefined;
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
  libraryProvider,
  selectedNodeId,
  onSelectNode,
  onUndo,
  onRedo,
  canUndo: hostCanUndo,
  canRedo: hostCanRedo,
  onDrillDown,
  onRevealSource,
  onOpenInspectorWing,
  simulationTime = 0,
  simulationData,
  peers,
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
  useEffect(() => {
    diagramStateRef.current = diagramState;
  }, [diagramState]);

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
  const [spawnedAtMap, setSpawnedAtMap] = useState<Map<string, number>>(() => new Map());

  // Live interaction session refs (zero React re-renders during 90Hz frame loops!)
  const nodeGrabRef = useRef<ActiveNodeGrabSession | null>(null);
  const wireSessionRef = useRef<ActiveWireSession | null>(null);
  const palettePullRef = useRef<ActivePalettePullSession | null>(null);
  const waypointDragRef = useRef<{
    edgeId: string;
    vertexIndex: number;
    dragPlane: THREE.Plane;
    pos: THREE.Vector3;
  } | null>(null);
  const [smartGuides, setSmartGuides] = useState<SpatialAlignmentGuide[]>([]);
  const lastGuideSigRef = useRef("");

  const wireTipWorldPosRef = useRef(new THREE.Vector3());
  const previewWorldPosRef = useRef(new THREE.Vector3());
  const previewWorldQuatRef = useRef(new THREE.Quaternion());
  const previewMorphProgressRef = useRef(0);
  const previewCancelRef = useRef(false);

  // React UI mirror state (updated only on discrete transitions: start, snap lock change, end)
  const [grabbedNodeId, setGrabbedNodeId] = useState<string | null>(null);
  const [overDeleteRing, setOverDeleteRing] = useState(false);
  const [activeWireVisual, setActiveWireVisual] = useState<ActiveWireDragVisualState | null>(null);
  const [reconnectingEdgeId, setReconnectingEdgeId] = useState<string | null>(null);
  const [portHighlights, setPortHighlights] = useState<Map<string, PortVisualHighlightState>>(() => new Map());

  // Sync controlled host selection (e.g. from 2D diagram or sidebar) into 3D stage selection
  useEffect(() => {
    if (selectedNodeId === undefined) return;
    setDiagramState((prev) => {
      if (selectedNodeId === null) {
        return prev.selectedNodeIds.length === 0 ? prev : { ...prev, selectedNodeIds: [] };
      }
      if (prev.selectedNodeIds.length === 1 && prev.selectedNodeIds[0] === selectedNodeId) return prev;
      return { ...prev, selectedNodeIds: [selectedNodeId], selectedEdgeId: null };
    });
  }, [selectedNodeId]);

  // Precompute live simulation readout per node when simulation data is available
  const simDataset = useMemo(
    () =>
      simulationData?.rows && simulationData.rows.length > 0
        ? extractVrSimulationDataset(
            simulationData.rows,
            simulationData.variables,
            simulationData.variables?.slice(0, 24),
          )
        : null,
    [simulationData],
  );

  const nodeSimReadouts = useMemo(() => {
    const map = new Map<string, string>();
    if (!simDataset || simDataset.series.length === 0) return map;
    for (const node of diagramState.nodes) {
      const nid = node.id ?? node.properties?.name ?? "";
      if (!nid) continue;
      const animVar = (node as unknown as { animations?: Array<{ variableName?: string }> }).animations?.[0]
        ?.variableName;
      const prefix = `${nid}.`;
      const matched =
        (animVar ? simDataset.series.find((s) => s.name === animVar) : undefined) ??
        simDataset.series.find((s) => s.name === nid || s.name.startsWith(prefix));
      if (matched) {
        const val = sampleSeriesAtTime(simDataset.times, matched.values, simulationTime);
        if (val !== null) {
          const shortVar = matched.name.startsWith(prefix) ? matched.name.slice(prefix.length) : matched.name;
          map.set(nid, `${shortVar}=${formatEngineeringValue(val)}`);
        }
      }
    }
    return map;
  }, [simDataset, diagramState.nodes, simulationTime]);

  // Remote multiplayer peer selection map (nodeId -> { name, color })
  const peerSelectionByNode = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    if (!peers || peers.length === 0) return map;
    for (const peer of peers) {
      const pRec = peer as unknown as {
        selection?: string[];
        name?: string;
        displayName?: string;
      };
      const sel = pRec.selection;
      if (Array.isArray(sel)) {
        for (const id of sel) {
          if (id && !map.has(id)) {
            map.set(id, { name: pRec.name || pRec.displayName || peer.peerId, color: peer.color || "#a855f7" });
          }
        }
      }
    }
    return map;
  }, [peers]);
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
    if (onUndo) {
      onUndo();
      onHudStatusChange?.("Undid last edit");
      return;
    }
    setDiagramState((prev) => {
      if (prev.undoStack.length === 0) return prev;
      const next = undoSpatialDiagram(prev);
      onHudStatusChange?.("Undid last 3D diagram edit");
      return next;
    });
  }, [onUndo, onHudStatusChange]);

  const handleRedo = useCallback(() => {
    if (onRedo) {
      onRedo();
      onHudStatusChange?.("Redid last edit");
      return;
    }
    setDiagramState((prev) => {
      if (prev.redoStack.length === 0) return prev;
      const next = redoSpatialDiagram(prev);
      onHudStatusChange?.("Redid 3D diagram edit");
      return next;
    });
  }, [onRedo, onHudStatusChange]);

  const effectiveCanUndo = onUndo ? (hostCanUndo ?? true) : diagramState.undoStack.length > 0;
  const effectiveCanRedo = onRedo ? (hostCanRedo ?? true) : diagramState.redoStack.length > 0;

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

  const handleAlignSelected = useCallback(
    (mode: SpatialAlignmentMode) => {
      const cur = diagramStateRef.current;
      const res = commitAlignSpatialNodes(cur, cur.selectedNodeIds, mode);
      if (res.actions.length > 0) {
        emitEdit(res.state, res.actions);
        onCue?.("snap");
        onHudStatusChange?.(`Aligned ${cur.selectedNodeIds.length} components (${mode})`);
      }
    },
    [emitEdit, onCue, onHudStatusChange],
  );

  const handleAddIconPrimitive = useCallback(
    (kind: VrIconPrimitiveKind) => {
      const res = commitAddIconPrimitive(diagramStateRef.current, kind);
      emitEdit(res.state, res.actions);
      onCue?.("materialize");
      onHudStatusChange?.(`Added Icon ${kind} primitive`);
    },
    [emitEdit, onCue, onHudStatusChange],
  );

  const selectedIconNode = useMemo(() => {
    const firstId = diagramState.selectedNodeIds[0];
    if (!firstId || !firstId.startsWith("__icon_gfx_")) return null;
    return diagramState.nodes.find((n) => n.id === firstId) ?? null;
  }, [diagramState.selectedNodeIds, diagramState.nodes]);

  const selectedIconIndex = useMemo(() => {
    if (!selectedIconNode) return null;
    const raw = (selectedIconNode.data as { primitiveIndex?: number } | undefined)?.primitiveIndex;
    return typeof raw === "number" ? raw : null;
  }, [selectedIconNode]);

  const iconPrimitiveCount = useMemo(
    () => diagramState.nodes.filter((n) => String(n.id ?? "").startsWith("__icon_gfx_")).length,
    [diagramState.nodes],
  );

  const handleDeleteSelectedIconPrimitive = useCallback(() => {
    if (selectedIconIndex === null) return;
    const res = commitDeleteIconPrimitive(diagramStateRef.current, selectedIconIndex);
    emitEdit(res.state, res.actions);
    onSelectNode?.(null);
    onCue?.("wire-pop");
  }, [selectedIconIndex, emitEdit, onSelectNode, onCue]);

  const handleReorderSelectedIconPrimitive = useCallback(
    (delta: -1 | 1) => {
      if (selectedIconIndex === null) return;
      const targetIdx = selectedIconIndex + delta;
      if (targetIdx < 0 || targetIdx >= iconPrimitiveCount) return;
      const res = commitReorderIconPrimitive(diagramStateRef.current, selectedIconIndex, targetIdx);
      if (res.actions.length > 0) {
        emitEdit(res.state, res.actions);
        onCue?.("tick");
      }
    },
    [selectedIconIndex, iconPrimitiveCount, emitEdit, onCue],
  );

  useEffect(() => {
    onExposeActions?.({
      undo: handleUndo,
      redo: handleRedo,
      autoLayerByDomain: handleAutoLayerByDomain,
      flattenTo2D: handleFlattenTo2D,
      alignSelected: handleAlignSelected,
      addIconPrimitive: handleAddIconPrimitive,
      deleteSelectedIconPrimitive: handleDeleteSelectedIconPrimitive,
      reorderSelectedIconPrimitive: handleReorderSelectedIconPrimitive,
      canUndo: effectiveCanUndo,
      canRedo: effectiveCanRedo,
      nodeCount: diagramState.nodes.length,
      edgeCount: diagramState.edges.length,
      selectedCount: diagramState.selectedNodeIds.length,
      selectedIconIndex,
      iconPrimitiveCount,
    });
  }, [
    onExposeActions,
    handleUndo,
    handleRedo,
    handleAutoLayerByDomain,
    handleFlattenTo2D,
    handleAlignSelected,
    handleAddIconPrimitive,
    handleDeleteSelectedIconPrimitive,
    handleReorderSelectedIconPrimitive,
    effectiveCanUndo,
    effectiveCanRedo,
    diagramState.nodes.length,
    diagramState.edges.length,
    diagramState.selectedNodeIds.length,
    selectedIconIndex,
    iconPrimitiveCount,
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

  // Unique domains of currently open/unconnected ports on the 3D stage (for #6 Compatible-Next highlighting)
  const openPortDomains = useMemo(() => {
    const connectedPorts = new Set<string>();
    for (const e of diagramState.edges) {
      const ep = resolveEdgeEndpoints(e);
      if (ep) {
        connectedPorts.add(makePortKey(ep.sourceNodeId, ep.sourcePortId));
        connectedPorts.add(makePortKey(ep.targetNodeId, ep.targetPortId));
      }
    }
    const domains = new Set<SpatialDiagramPort3D["domain"]>();
    for (const node of diagramState.nodes) {
      for (const p of extractNodePorts3D(node, 0.148, 0.104)) {
        if (!connectedPorts.has(makePortKey(p.nodeId, p.portId))) {
          domains.add(p.domain);
        }
      }
    }
    return Array.from(domains);
  }, [diagramState.edges, diagramState.nodes]);

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

      // Update selection (Shift+Click on desktop OR holding opposite controller grip in XR toggles multi-select)
      const oppositeGripHeld =
        binding.kind !== "desktop" &&
        ((binding.handedness === "right" && leftController?.gamepad["xr-standard-squeeze"]?.state === "pressed") ||
          (binding.handedness === "left" && rightController?.gamepad["xr-standard-squeeze"]?.state === "pressed"));
      const isMultiToggle = (binding.kind === "desktop" && (e.shiftKey || shiftHeldRef.current)) || oppositeGripHeld;
      const prevSel = diagramStateRef.current.selectedNodeIds;
      let nextSel: string[];
      if (isMultiToggle) {
        nextSel = prevSel.includes(nodeId) ? prevSel.filter((id) => id !== nodeId) : [...prevSel, nodeId];
        setDiagramState((prev) => ({ ...prev, selectedNodeIds: nextSel, selectedEdgeId: null }));
        onSelectNode?.(nextSel[nextSel.length - 1] ?? null);
        onCue?.("tick");
        return;
      }
      nextSel = prevSel.includes(nodeId) && prevSel.length > 1 ? prevSel : [nodeId];
      if (nextSel !== prevSel) {
        setDiagramState((prev) => ({ ...prev, selectedNodeIds: nextSel, selectedEdgeId: null }));
      }
      onSelectNode?.(nodeId);

      // Capture companion initial poses when dragging a multi-selection
      let companionStartPoses: Record<string, SpatialNodePose3D> | undefined;
      if (nextSel.length > 1) {
        companionStartPoses = {};
        for (const cid of nextSel) {
          if (cid === nodeId) continue;
          const cp = diagramStateRef.current.poses[cid];
          if (cp) {
            companionStartPoses[cid] = {
              position: [...cp.position],
              quaternion: [...cp.quaternion],
              scale: cp.scale,
              domainLayer: cp.domainLayer,
            };
          }
        }
      }

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
          startLocalPos: initPos.clone(),
          companionStartPoses,
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
        startLocalPos: initPos.clone(),
        companionStartPoses,
      };

      setLock("node-grab");
      setGrabbedNodeId(nodeId);
      setOverDeleteRing(false);
      onCue?.("grab");
      onHudStatusChange?.(`Moving ${nodeId} in 3D space (Shift/Wheel = Z-depth · R = Rotate 90°)`);
    },
    [
      camera,
      interactionLockRef,
      bindPointer,
      setLock,
      onCue,
      onHudStatusChange,
      leftController?.gamepad,
      rightController?.gamepad,
      onSelectNode,
    ],
  );

  const finishNodeGrab = useCallback(() => {
    const sess = nodeGrabRef.current;
    if (!sess) return;
    nodeGrabRef.current = null;
    setGrabbedNodeId(null);
    setOverDeleteRing(false);
    setSmartGuides([]);
    lastGuideSigRef.current = "";
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
    if (sess.companionStartPoses && sess.startLocalPos && Object.keys(sess.companionStartPoses).length > 0) {
      const dx = constrained.position[0] - sess.startLocalPos.x;
      const dy = constrained.position[1] - sess.startLocalPos.y;
      const dz = constrained.position[2] - sess.startLocalPos.z;
      const updates: Record<string, SpatialNodePose3D> = { [sess.nodeId]: constrained };
      for (const [cid, cp] of Object.entries(sess.companionStartPoses)) {
        updates[cid] = {
          ...cp,
          position: [cp.position[0] + dx, cp.position[1] + dy, cp.position[2] + dz],
        };
      }
      const res = commitMoveSpatialNodes(diagramStateRef.current, updates);
      emitEdit(res.state, res.actions);
    } else {
      const res = commitMoveSpatialNode(diagramStateRef.current, sess.nodeId, constrained);
      emitEdit(res.state, res.actions);
    }
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
    setReconnectingEdgeId(null);
    setPortHighlights(new Map());
    setLock("none");

    if (sess.reconnectingEdge) {
      const re = sess.reconnectingEdge;
      if (sess.snappedTarget) {
        const target = sess.snappedTarget.port;
        // If snapped back to the exact original port, treat as clean cancel (zero edits)
        if (target.nodeId === re.originalOtherNodeId && target.portId === re.originalOtherPortId) {
          onCue?.("snap");
          onHudStatusChange?.("Kept existing wire connection");
          return;
        }
        const newSrcNode = re.pulledEnd === "start" ? target.nodeId : sess.sourcePort.nodeId;
        const newSrcPort = re.pulledEnd === "start" ? target.portId : sess.sourcePort.portId;
        const newTgtNode = re.pulledEnd === "start" ? sess.sourcePort.nodeId : target.nodeId;
        const newTgtPort = re.pulledEnd === "start" ? sess.sourcePort.portId : target.portId;
        const res = commitReconnectSpatialEdge(
          diagramStateRef.current,
          re.edgeId,
          newSrcNode,
          newSrcPort,
          newTgtNode,
          newTgtPort,
          sess.sourcePort.color,
        );
        if (res.actions.length > 0) {
          emitEdit(res.state, res.actions);
          onCue?.("magnet-lock");
          pulseXrHaptics(getSharedXrStore(), 0.62, 28, sess.handedness);
          onHudStatusChange?.(`Reconnected ${newSrcNode}.${newSrcPort} ⇄ ${newTgtNode}.${newTgtPort}`);
          return;
        }
      }
      // Dropped in empty space -> disconnect the unplugged wire cleanly
      const disc = commitDisconnectSpatialEdge(diagramStateRef.current, re.edgeId);
      if (disc.actions.length > 0) {
        emitEdit(disc.state, disc.actions);
        onCue?.("wire-pop");
        pulseXrHaptics(getSharedXrStore(), 0.42, 24, sess.handedness);
        onHudStatusChange?.("Disconnected 3D wire");
        return;
      }
      onCue?.("release");
      return;
    }

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
   * Instant Glass Library / Rotunda leaf grab & select: as soon as the engineer selects (trigger)
   * OR grabs (squeeze) any leaf component, the glass library stack immediately dismisses, the
   * component materializes in 3D, and it stays in live 6DOF dragged mode until they release
   * whichever button (trigger or grab) they initiated with.
   */
  const handleGrabFromStockroom = useCallback(
    (
      item: GalleryComponentItem,
      worldPos: THREE.Vector3,
      e: ThreeEvent<PointerEvent> | null,
      overrideBinding?: XrPointerBinding,
      keepOpen = false,
    ) => {
      // 1. Immediately dismiss the Glass Library Navigator unless Pinned Multi-Drop mode is active
      if (!keepOpen) {
        onSetWristPaletteOpen(false);
      }

      const stage = stageGroupRef.current;
      const binding = overrideBinding ?? (e ? bindPointer(e) : undefined);
      const isXr = Boolean(binding && binding.kind !== "desktop");
      let xrPose = isXr && e ? readEventPointerPose(e) : null;

      // Fallback pose for far-field controller `squeezestart` (no React pointer event)
      if (isXr && !xrPose && binding) {
        const ctrlObj =
          binding.handedness === "left"
            ? leftController?.object
            : binding.handedness === "right"
              ? rightController?.object
              : (rightController?.object ?? leftController?.object);
        if (ctrlObj) {
          const p = new THREE.Vector3();
          const q = new THREE.Quaternion();
          ctrlObj.getWorldPosition(p);
          ctrlObj.getWorldQuaternion(q);
          xrPose = { position: p, quaternion: q };
        }
      }

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
      setSpawnedAtMap((prev) => new Map(prev).set(res.spawnedNodeId, performance.now()));
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
            startLocalPos: initVec.clone(),
            allowQuickTapCarry: true,
            clickToPlaceArmed: false,
            startedAtMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
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
            startLocalPos: initVec.clone(),
            allowQuickTapCarry: true,
            clickToPlaceArmed: false,
            startedAtMs: typeof performance !== "undefined" ? performance.now() : Date.now(),
          };
          setLock("node-grab");
          setGrabbedNodeId(res.spawnedNodeId);
          setOverDeleteRing(false);
        }
      }

      onHudStatusChange?.(`Holding ${res.spawnedNodeId} (${item.shortName}) — release button to place in 3D`);
    },
    [
      camera,
      leftController,
      rightController,
      interactionLockRef,
      bindPointer,
      setLock,
      emitEdit,
      onSetWristPaletteOpen,
      onCue,
      onHudStatusChange,
    ],
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

    setSpawnedAtMap((prev) => new Map(prev).set(res.spawnedNodeId, performance.now()));
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
    (edgeId: string, keptPort: SpatialDiagramPort3D, e: ThreeEvent<PointerEvent>, pulledEnd: "start" | "end") => {
      if (nodeGrabRef.current || wireSessionRef.current || palettePullRef.current) return;
      const existingEdge = diagramStateRef.current.edges.find((ed) => ed.id === edgeId);
      const ep = existingEdge ? resolveEdgeEndpoints(existingEdge) : null;
      handleStartPortWireDrag(keptPort, e);
      const startedWire = wireSessionRef.current as ActiveWireSession | null;
      if (startedWire && ep) {
        startedWire.reconnectingEdge = {
          edgeId,
          pulledEnd,
          originalOtherNodeId: pulledEnd === "start" ? ep.sourceNodeId : ep.targetNodeId,
          originalOtherPortId: pulledEnd === "start" ? ep.sourcePortId : ep.targetPortId,
        };
        setReconnectingEdgeId(edgeId);
        onCue?.("wire-pop");
        const binding = resolveXrPointerBinding(e);
        pulseXrHaptics(getSharedXrStore(), 0.45, 22, binding.handedness);
      }
    },
    [onCue, handleStartPortWireDrag],
  );

  const handleSelectEdge = useCallback((edgeId: string) => {
    setDiagramState((prev) => ({
      ...prev,
      selectedEdgeId: prev.selectedEdgeId === edgeId ? null : edgeId,
      selectedNodeIds: [],
    }));
  }, []);

  const handleAddEdgeWaypoint = useCallback(
    (edgeId: string, pos3D: [number, number, number]) => {
      const res = commitAddEdgeWaypoint(diagramStateRef.current, edgeId, pos3D);
      if (res.actions.length > 0) {
        emitEdit(res.state, res.actions);
        onCue?.("snap");
        onHudStatusChange?.("Added manual edge waypoint (drag sphere to reroute, double-click to remove)");
      }
    },
    [emitEdit, onCue, onHudStatusChange],
  );

  const handleRemoveEdgeWaypoint = useCallback(
    (edgeId: string, vertexIndex: number) => {
      const res = commitRemoveEdgeWaypoint(diagramStateRef.current, edgeId, vertexIndex);
      if (res.actions.length > 0) {
        emitEdit(res.state, res.actions);
        onCue?.("wire-pop");
        onHudStatusChange?.("Removed edge waypoint");
      }
    },
    [emitEdit, onCue, onHudStatusChange],
  );

  const handleStartWaypointDrag = useCallback(
    (edgeId: string, vertexIndex: number, e: ThreeEvent<PointerEvent>) => {
      const stage = stageGroupRef.current;
      if (!stage) return;
      stage.updateWorldMatrix(true, false);
      invStageMatScratch.current.copy(stage.matrixWorld).invert();
      const localPos = e.point.clone().applyMatrix4(invStageMatScratch.current);
      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, e.point);
      waypointDragRef.current = { edgeId, vertexIndex, dragPlane, pos: localPos };
      setLock("wire-drag");
      onCue?.("grab");
    },
    [camera, setLock, onCue],
  );

  const finishWaypointDrag = useCallback(() => {
    const wd = waypointDragRef.current;
    if (!wd) return;
    waypointDragRef.current = null;
    setLock("none");
    const cur = diagramStateRef.current;
    const edge = cur.edges.find((e) => e.id === wd.edgeId);
    if (!edge) return;
    const existing2D = Array.isArray((edge as { vertices?: { x: number; y: number }[] }).vertices)
      ? ((edge as { vertices?: { x: number; y: number }[] }).vertices ?? [])
      : [];
    const next3D: [number, number, number][] = existing2D.map((pt, i) =>
      i === wd.vertexIndex ? [wd.pos.x, wd.pos.y, wd.pos.z] : diagram2DToStage3D(pt.x, pt.y, cur.coordFrame, wd.pos.z),
    );
    const res = commitMoveEdgeWaypoints(cur, wd.edgeId, next3D);
    if (res.actions.length > 0) {
      emitEdit(res.state, res.actions);
      onCue?.("release");
    }
  }, [emitEdit, setLock, onCue]);

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
      if (waypointDragRef.current) {
        finishWaypointDrag();
      }
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
      } else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) {
        if (nodeGrabRef.current) {
          e.preventDefault();
          nodeGrabRef.current.yawOffsetRad += Math.PI * 0.5;
          onCue?.("tick");
        } else if (diagramStateRef.current.selectedNodeIds[0]) {
          e.preventDefault();
          const res = commitRotateSpatialNode(diagramStateRef.current, diagramStateRef.current.selectedNodeIds[0], 90);
          emitEdit(res.state, res.actions);
          onCue?.("tick");
        }
      } else if (
        e.key.toLowerCase() === "f" &&
        !e.metaKey &&
        !e.ctrlKey &&
        diagramStateRef.current.selectedNodeIds[0]
      ) {
        e.preventDefault();
        const res = commitFlipSpatialNode(diagramStateRef.current, diagramStateRef.current.selectedNodeIds[0], "x");
        emitEdit(res.state, res.actions);
        onCue?.("tick");
      } else if (
        (e.key === "[" || e.key === "]") &&
        !e.metaKey &&
        !e.ctrlKey &&
        diagramStateRef.current.selectedNodeIds[0]
      ) {
        e.preventDefault();
        const cur = diagramStateRef.current;
        const nid = cur.selectedNodeIds[0]!;
        const node = cur.nodes.find((n) => n.id === nid);
        const w = typeof node?.width === "number" && node.width > 0 ? node.width : 80;
        const h = typeof node?.height === "number" && node.height > 0 ? node.height : 56;
        const factor = e.key === "]" ? 1.15 : 1 / 1.15;
        const res = commitResizeSpatialNode(cur, nid, w * factor, h * factor);
        emitEdit(res.state, res.actions);
        onCue?.("tick");
      } else if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "d" &&
        diagramStateRef.current.selectedNodeIds.length > 0
      ) {
        e.preventDefault();
        const res = commitDuplicateSpatialNodes(diagramStateRef.current, diagramStateRef.current.selectedNodeIds);
        emitEdit(res.state, res.actions);
        onSelectNode?.(res.duplicatedNodeIds[0] ?? null);
        onCue?.("materialize");
      } else if (
        (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !e.metaKey &&
        !e.ctrlKey &&
        diagramStateRef.current.selectedNodeIds.length > 0
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 0.05 : 0.01;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        const cur = diagramStateRef.current;
        const res = commitNudgeSpatialNodes(cur, cur.selectedNodeIds, dx, dy);
        if (res.actions.length > 0) {
          emitEdit(res.state, res.actions);
          onCue?.("tick");
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && !e.metaKey && !e.ctrlKey) {
        const cur = diagramStateRef.current;
        if (cur.selectedEdgeId) {
          e.preventDefault();
          handleDisconnectEdge(cur.selectedEdgeId);
        } else if (cur.selectedNodeIds.length > 0) {
          e.preventDefault();
          const res =
            cur.selectedNodeIds.length > 1
              ? commitDeleteSpatialNodes(cur, cur.selectedNodeIds)
              : commitDeleteSpatialNode(cur, cur.selectedNodeIds[0]!);
          emitEdit(res.state, res.actions);
          onSelectNode?.(null);
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
    finishWaypointDrag,
    handleUndo,
    handleRedo,
    handleDisconnectEdge,
    onToggleWristPalette,
    onSelectNode,
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
      if (n?.mode === "xr-pointer" && n.binding && matches(n.binding)) {
        const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        const elapsedMs = n.startedAtMs != null ? nowMs - n.startedAtMs : 9999;
        const movedDist = n.startLocalPos ? n.smoothPos.distanceTo(n.startLocalPos) : 9999;
        if (
          n.allowQuickTapCarry &&
          !n.clickToPlaceArmed &&
          elapsedMs < QUICK_TAP_MAX_MS &&
          movedDist < QUICK_TAP_MAX_MOVE_M
        ) {
          n.clickToPlaceArmed = true;
          onHudStatusChange?.(`Carrying ${n.nodeId} — aim & tap Trigger/Grab again to place`);
          return;
        }
        finishNodeGrab();
      }
    },
    [finishWireDrag, finishPalettePull, finishNodeGrab, onHudStatusChange],
  );

  useEffect(() => {
    if (!xrSession) return;
    const onEnd = (type: "selectend" | "squeezeend") => (ev: XRInputSourceEvent) => {
      finishSessionsForXrRelease((b) => b.inputSource === ev.inputSource && releaseEventForBinding(b) === type);
    };
    const onStartConfirm = (ev: XRInputSourceEvent) => {
      const n = nodeGrabRef.current;
      if (n?.mode === "xr-pointer" && n.clickToPlaceArmed && n.binding?.inputSource === ev.inputSource) {
        finishNodeGrab();
      }
    };
    const onSelectEnd = onEnd("selectend");
    const onSqueezeEnd = onEnd("squeezeend");
    const onSourcesChange = (ev: XRInputSourcesChangeEvent) => {
      // Controller put down / tracking lost mid-grab → drop cleanly instead of freezing the lock.
      if (ev.removed.length === 0) return;
      finishSessionsForXrRelease((b) => b.inputSource != null && ev.removed.includes(b.inputSource));
    };
    xrSession.addEventListener("selectstart", onStartConfirm);
    xrSession.addEventListener("squeezestart", onStartConfirm);
    xrSession.addEventListener("selectend", onSelectEnd);
    xrSession.addEventListener("squeezeend", onSqueezeEnd);
    xrSession.addEventListener("inputsourceschange", onSourcesChange);
    return () => {
      xrSession.removeEventListener("selectstart", onStartConfirm);
      xrSession.removeEventListener("squeezestart", onStartConfirm);
      xrSession.removeEventListener("selectend", onSelectEnd);
      xrSession.removeEventListener("squeezeend", onSqueezeEnd);
      xrSession.removeEventListener("inputsourceschange", onSourcesChange);
    };
  }, [xrSession, finishSessionsForXrRelease, finishNodeGrab]);

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
        languageId,
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
    [collectWorldPortCandidates, existingConnectionKeys, onCue, languageId],
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
              false,
              languageId,
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
    [collectWorldPortCandidates, onCue, onHudStatusChange, languageId],
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

    // 1B. Live Manual Waypoint Drag Step
    if (waypointDragRef.current) {
      const wd = waypointDragRef.current;
      raycasterRef.current.setFromCamera(pointerNdcRef.current, camera);
      if (raycasterRef.current.ray.intersectPlane(wd.dragPlane, rayHitScratch.current)) {
        stage.updateWorldMatrix(true, false);
        invStageMatScratch.current.copy(stage.matrixWorld).invert();
        wd.pos.copy(rayHitScratch.current).applyMatrix4(invStageMatScratch.current);
      }
    }

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
          // Live Smart Alignment Guide snapping against sibling nodes
          const excludeSet = sess.companionStartPoses ? new Set(Object.keys(sess.companionStartPoses)) : undefined;
          const sg = computeSpatialSmartGuides(
            sess.nodeId,
            [sess.targetPos.x, sess.targetPos.y, sess.targetPos.z],
            diagramStateRef.current.poses,
            0.016,
            excludeSet,
          );
          sess.targetPos.set(sg.snappedPos[0], sg.snappedPos[1], sg.snappedPos[2]);
          const guideSig = sg.guides.map((g) => `${g.axis}:${g.coord.toFixed(3)}`).join("|");
          if (guideSig !== lastGuideSigRef.current) {
            lastGuideSigRef.current = guideSig;
            setSmartGuides(sg.guides);
          }

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

        // Live-translate companion nodes during multi-select batch drag
        if (sess.companionStartPoses && sess.startLocalPos) {
          const dx = sess.smoothPos.x - sess.startLocalPos.x;
          const dy = sess.smoothPos.y - sess.startLocalPos.y;
          const dz = sess.smoothPos.z - sess.startLocalPos.z;
          for (const [cid, cp] of Object.entries(sess.companionStartPoses)) {
            const cgrp = nodeGroupRefs.current.get(cid);
            if (cgrp) {
              cgrp.position.set(cp.position[0] + dx, cp.position[1] + dy, cp.position[2] + dz);
            }
          }
        }

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
              spawnedAtMs={spawnedAtMap.get(nid)}
              simulationValueLabel={nodeSimReadouts.get(nid)}
              peerSelection={peerSelectionByNode.get(nid)}
              portHighlights={portHighlights}
              registerGroupRef={registerGroupRef}
              registerNodePorts={registerNodePorts}
              onStartNodeGrab={handleStartNodeGrab}
              onStartPortWireDrag={handleStartPortWireDrag}
              onDoubleClickNode={(id) => onDrillDown?.(id, node)}
            />
          );
        })}

        {/* Diegetic 3D Action Pill above Selected Node (Rotate, Flip, Duplicate, Inspect, Drill-Down, Source, Delete) */}
        {diagramState.selectedNodeIds.length > 0 &&
          !grabbedNodeId &&
          !activeWireVisual &&
          (() => {
            const primaryId = diagramState.selectedNodeIds[0]!;
            const primaryPose = diagramState.poses[primaryId];
            const primaryNode = diagramState.nodes.find((n) => n.id === primaryId);
            if (!primaryPose) return null;
            return (
              <SpatialNodeActionBar3D
                position={[primaryPose.position[0], primaryPose.position[1] + 0.105, primaryPose.position[2] + 0.024]}
                canDrillDown={Boolean(onDrillDown)}
                canRevealSource={Boolean(onRevealSource)}
                canInspect={Boolean(onOpenInspectorWing)}
                onAction={(actionId) => {
                  const cur = diagramState;
                  if (actionId === "rotate") {
                    const res = commitRotateSpatialNode(cur, primaryId, 90);
                    emitEdit(res.state, res.actions);
                    onCue?.("tick");
                  } else if (actionId === "flip") {
                    const res = commitFlipSpatialNode(cur, primaryId, "x");
                    emitEdit(res.state, res.actions);
                    onCue?.("tick");
                  } else if (actionId === "grow" || actionId === "shrink") {
                    const w = typeof primaryNode?.width === "number" && primaryNode.width > 0 ? primaryNode.width : 80;
                    const h =
                      typeof primaryNode?.height === "number" && primaryNode.height > 0 ? primaryNode.height : 56;
                    const factor = actionId === "grow" ? 1.18 : 1 / 1.18;
                    const res = commitResizeSpatialNode(cur, primaryId, w * factor, h * factor);
                    emitEdit(res.state, res.actions);
                    onCue?.("tick");
                  } else if (actionId === "duplicate") {
                    const res = commitDuplicateSpatialNodes(cur, cur.selectedNodeIds);
                    emitEdit(res.state, res.actions);
                    onSelectNode?.(res.duplicatedNodeIds[0] ?? null);
                    onCue?.("materialize");
                  } else if (actionId === "inspect") {
                    onSelectNode?.(primaryId);
                    onOpenInspectorWing?.();
                    onCue?.("click");
                  } else if (actionId === "drill") {
                    onDrillDown?.(primaryId, primaryNode);
                    onCue?.("page");
                  } else if (actionId === "source") {
                    onRevealSource?.(primaryId);
                    onCue?.("snap");
                  } else if (actionId === "delete") {
                    const res =
                      cur.selectedNodeIds.length > 1
                        ? commitDeleteSpatialNodes(cur, cur.selectedNodeIds)
                        : commitDeleteSpatialNode(cur, primaryId);
                    emitEdit(res.state, res.actions);
                    onSelectNode?.(null);
                    onCue?.("wire-pop");
                  }
                }}
              />
            );
          })()}

        {/* Live 3D Smart Alignment Laser Guides during Node Drag */}
        {smartGuides.map((g, i) => {
          const span = Math.max(0.12, g.max - g.min);
          const mid = (g.min + g.max) * 0.5;
          return (
            <mesh
              key={`guide_${g.axis}_${i}`}
              position={g.axis === "x" ? [g.coord, mid, g.z + 0.008] : [mid, g.coord, g.z + 0.008]}
            >
              <boxGeometry args={g.axis === "x" ? [0.0024, span, 0.0024] : [span, 0.0024, 0.0024]} />
              <meshBasicMaterial color="#22d3ee" transparent opacity={0.85} toneMapped={false} />
            </mesh>
          );
        })}

        {/* Committed 3D Insulated Cables + Live Physical Verlet Magnetic Wire */}
        <SpatialMagneticWires
          edges={diagramState.edges}
          coordFrame={diagramState.coordFrame}
          stageGroupRef={stageGroupRef}
          nodeGroupRefs={nodeGroupRefs}
          nodePortsRef={nodePortsRef}
          activeWireDrag={activeWireVisual}
          hiddenEdgeId={reconnectingEdgeId}
          liveWaypointDragRef={waypointDragRef}
          selectedEdgeId={diagramState.selectedEdgeId}
          isPlaying={isPlaying}
          onSelectEdge={handleSelectEdge}
          onDisconnectEdge={handleDisconnectEdge}
          onUnplugEdgeToDrag={handleUnplugEdgeToDrag}
          onAddEdgeWaypoint={handleAddEdgeWaypoint}
          onStartWaypointDrag={handleStartWaypointDrag}
          onRemoveEdgeWaypoint={handleRemoveEdgeWaypoint}
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
          canUndo={effectiveCanUndo}
          onToggleStockroom={onToggleWristPalette}
          onUndo={handleUndo}
          onReturnToPodium={onExitDiagramMode}
        />
      </group>

      {/* Floating Polished Glass Library Navigator + Flanking Sibling Rotunda */}
      <GlassLibraryNavigator3D
        visible={visible && wristPaletteOpen}
        languageId={languageId}
        catalog={libraryCatalog}
        libraryProvider={libraryProvider}
        openPortDomains={openPortDomains}
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

type NodeActionId = "rotate" | "flip" | "grow" | "shrink" | "duplicate" | "inspect" | "drill" | "source" | "delete";

const NODE_ACTION_W = 860;
const NODE_ACTION_H = 84;

function SpatialNodeActionBar3D({
  position,
  canDrillDown,
  canRevealSource,
  canInspect,
  onAction,
}: {
  position: [number, number, number];
  canDrillDown: boolean;
  canRevealSource: boolean;
  canInspect: boolean;
  onAction: (id: NodeActionId) => void;
}): React.ReactElement | null {
  const [hoveredId, setHoveredId] = useState<NodeActionId | null>(null);

  const items = useMemo(() => {
    const list: { id: NodeActionId; label: string; danger?: boolean }[] = [
      { id: "rotate", label: "↻ 90°" },
      { id: "flip", label: "⇄ Flip" },
      { id: "shrink", label: "− Size" },
      { id: "grow", label: "+ Size" },
      { id: "duplicate", label: "⧉ Dup" },
    ];
    if (canInspect) list.push({ id: "inspect", label: "⚙ Insp" });
    if (canDrillDown) list.push({ id: "drill", label: "⤵ Open" });
    if (canRevealSource) list.push({ id: "source", label: "</> Src" });
    list.push({ id: "delete", label: "✕ Del", danger: true });
    return list;
  }, [canDrillDown, canRevealSource, canInspect]);

  const bundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = NODE_ACTION_W;
    canvas.height = NODE_ACTION_H;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, ctx, texture };
  }, []);

  useEffect(() => () => bundle?.texture.dispose(), [bundle]);

  useEffect(() => {
    if (!bundle?.ctx) return;
    const ctx = bundle.ctx;
    ctx.clearRect(0, 0, NODE_ACTION_W, NODE_ACTION_H);
    ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
    ctx.beginPath();
    ctx.roundRect(4, 4, NODE_ACTION_W - 8, NODE_ACTION_H - 8, 16);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
    ctx.stroke();

    const gap = 8;
    const pad = 12;
    const btnW = (NODE_ACTION_W - pad * 2 - gap * (items.length - 1)) / items.length;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const bx = pad + i * (btnW + gap);
      const hov = hoveredId === it.id;
      ctx.fillStyle = it.danger
        ? hov
          ? "#dc2626"
          : "rgba(185, 28, 28, 0.72)"
        : hov
          ? "#0284c7"
          : "rgba(30, 41, 59, 0.92)";
      ctx.beginPath();
      ctx.roundRect(bx, 12, btnW, NODE_ACTION_H - 24, 10);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 20px Inter, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.label, bx + btnW * 0.5, NODE_ACTION_H * 0.52);
    }
    bundle.texture.needsUpdate = true;
  }, [bundle, items, hoveredId]);

  const hitItem = useCallback(
    (e: ThreeEvent<PointerEvent>): NodeActionId | null => {
      if (!e.uv) return null;
      const px = e.uv.x * NODE_ACTION_W;
      const gap = 8;
      const pad = 12;
      const btnW = (NODE_ACTION_W - pad * 2 - gap * (items.length - 1)) / items.length;
      for (let i = 0; i < items.length; i++) {
        const bx = pad + i * (btnW + gap);
        if (px >= bx && px <= bx + btnW) return items[i]!.id;
      }
      return null;
    },
    [items],
  );

  if (!bundle) return null;

  return (
    <group name="spatial-node-action-bar" position={position}>
      <mesh
        onPointerMove={(e) => {
          e.stopPropagation();
          setHoveredId(hitItem(e));
        }}
        onPointerOut={() => setHoveredId(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          const id = hitItem(e);
          if (id) onAction(id);
        }}
      >
        <planeGeometry args={[0.38, 0.045]} />
        <meshBasicMaterial map={bundle.texture} transparent toneMapped={false} />
      </mesh>
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

    drawKey(DOCK_ZONES[0], stockroomOpen ? "✕ Close Libraries" : "＋ Libraries", stockroomOpen);
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
