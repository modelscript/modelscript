// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { VrDiagramEdgeLike } from "./board-painter.js";
import {
  computeInfiniteWireControlPoints,
  createDynamicWireTubeBuffer,
  sampleWireSplineAt,
  type DynamicWireTubeBuffer,
  type WorldPortCandidate,
} from "./magnetic-port-solver.js";
import {
  computePortJunctionCounts,
  diagram2DToStage3D,
  resolveEdgeEndpoints,
  type SpatialCoordFrame2DTo3D,
  type SpatialDiagramPort3D,
  type SpatialPortDomain,
} from "./spatial-diagram-state.js";
import { VerletCableSim } from "./verlet-cable.js";
import { pulseEventHaptic } from "./xr-handle.js";

export interface ActiveWireDragVisualState {
  readonly sourcePort: SpatialDiagramPort3D;
  /** Mutable live world-space tip position ref updated at 90Hz during wire dragging. */
  readonly tipWorldPosRef: React.RefObject<THREE.Vector3>;
  /** Currently magnetically locked compatible target (or null when free-extending). */
  readonly snappedTarget: WorldPortCandidate | null;
  /** Currently rejected incompatible target inside snap well (or null). */
  readonly rejectedTarget: { readonly candidate: WorldPortCandidate; readonly reason: string } | null;
}

export interface SpatialMagneticWiresProps {
  edges: readonly VrDiagramEdgeLike[];
  /** 2D↔3D coordinate frame for projecting manual edge waypoints into stage meters. */
  coordFrame?: SpatialCoordFrame2DTo3D | undefined;
  /** Stage group ref so world-space port coordinates transform cleanly into stage-local space. */
  stageGroupRef: React.RefObject<THREE.Group | null>;
  /** Live Three.js `Group` refs per node ID for zero-lag 90Hz wire deformation while dragging components. */
  nodeGroupRefs: React.RefObject<Map<string, THREE.Group>>;
  /** Registered 3D ports per node ID. */
  nodePortsRef: React.RefObject<Map<string, readonly SpatialDiagramPort3D[]>>;
  /** Live active infinite-extending wire drag state (null when idle). */
  activeWireDrag: ActiveWireDragVisualState | null;
  /** Optional edge ID hidden while being atomically reconnected in hand. */
  hiddenEdgeId?: string | null | undefined;
  /** Optional live waypoint override ref while dragging a manual waypoint in 3D. */
  liveWaypointDragRef?: React.RefObject<{ edgeId: string; vertexIndex: number; pos: THREE.Vector3 } | null> | undefined;
  selectedEdgeId: string | null;
  isPlaying: boolean;
  onSelectEdge?: ((edgeId: string) => void) | undefined;
  onDisconnectEdge?: ((edgeId: string) => void) | undefined;
  /** Called when the user grabs a plugged-in socket ferrule to unplug & re-route the cable live in their hand. */
  onUnplugEdgeToDrag?:
    | ((
        edgeId: string,
        keptPort: SpatialDiagramPort3D,
        e: ThreeEvent<PointerEvent>,
        pulledEnd: "start" | "end",
      ) => void)
    | undefined;
  /** Called when the user clicks the `+` handle on a selected edge to insert a manual waypoint. */
  onAddEdgeWaypoint?: ((edgeId: string, pos3D: [number, number, number]) => void) | undefined;
  /** Called when the user grabs an existing waypoint sphere to drag it in 3D space. */
  onStartWaypointDrag?: ((edgeId: string, vertexIndex: number, e: ThreeEvent<PointerEvent>) => void) | undefined;
  /** Called when the user double-clicks an existing waypoint sphere to remove it. */
  onRemoveEdgeWaypoint?: ((edgeId: string, vertexIndex: number) => void) | undefined;
}

/** Local axis of the live connector plug mesh that points into the target port. */
const PLUG_AXIS = new THREE.Vector3(0, 1, 0);

/** No-op raycaster so non-interactive live wire visuals never intercept controller lasers. */
const NOOP_RAYCAST: THREE.Object3D["raycast"] = () => {
  /* intentionally empty */
};

/** Paints a stereo-safe floating badge canvas showing live magnetic wire lock status. */
function paintWireStatusBadge(
  canvas: HTMLCanvasElement,
  text: string,
  variant: "searching" | "locked" | "rejected",
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const bg =
    variant === "locked"
      ? "rgba(6, 78, 59, 0.94)"
      : variant === "rejected"
        ? "rgba(120, 53, 15, 0.94)"
        : "rgba(15, 23, 42, 0.90)";
  const border = variant === "locked" ? "#10b981" : variant === "rejected" ? "#f59e0b" : "#38bdf8";

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const r = 18;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(r, 6);
  ctx.lineTo(canvas.width - r, 6);
  ctx.quadraticCurveTo(canvas.width - 6, 6, canvas.width - 6, r);
  ctx.lineTo(canvas.width - 6, canvas.height - r);
  ctx.quadraticCurveTo(canvas.width - 6, canvas.height - 6, canvas.width - r, canvas.height - 6);
  ctx.lineTo(r, canvas.height - 6);
  ctx.quadraticCurveTo(6, canvas.height - 6, 6, canvas.height - r);
  ctx.lineTo(6, r);
  ctx.quadraticCurveTo(6, 6, r, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const clipped = text.length > 34 ? `${text.slice(0, 33)}…` : text;
  ctx.fillText(clipped, canvas.width * 0.5, canvas.height * 0.5);
}

/** Resolves a port's live stage-local position and outward normal from its node's live `THREE.Group`. */
function resolvePortInStageSpace(
  nodeId: string,
  portId: string,
  nodeGroupRefs: Map<string, THREE.Group>,
  nodePortsRef: Map<string, readonly SpatialDiagramPort3D[]>,
  outPos: THREE.Vector3,
  outNormal: THREE.Vector3,
): boolean {
  const group = nodeGroupRefs.get(nodeId);
  if (!group) return false;
  const ports = nodePortsRef.get(nodeId);
  const port = ports?.find((p) => p.portId === portId) ?? ports?.[0];

  if (port) {
    outPos.set(port.localPosition[0], port.localPosition[1], port.localPosition[2]);
    outNormal.set(port.localNormal[0], port.localNormal[1], port.localNormal[2]);
  } else {
    outPos.set(0, 0, 0.005);
    outNormal.set(1, 0, 0);
  }

  // Transform from node-local to stage-local space using node's live position, quaternion & scale
  outPos.multiply(group.scale).applyQuaternion(group.quaternion).add(group.position);
  outNormal.applyQuaternion(group.quaternion).normalize();
  return true;
}

interface DomainCableStyle {
  readonly radiusScale: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly defaultColor: string;
}

function getDomainCableStyle(domain: SpatialPortDomain): DomainCableStyle {
  switch (domain) {
    case "electrical":
    case "power":
      return {
        radiusScale: domain === "power" ? 1.18 : 1.0,
        roughness: 0.24,
        metalness: 0.55,
        clearcoat: 0.7,
        opacity: 1,
        transparent: false,
        defaultColor: domain === "power" ? "#f59e0b" : "#38bdf8",
      };
    case "fluid":
      return {
        radiusScale: 1.32,
        roughness: 0.14,
        metalness: 0.06,
        clearcoat: 0.9,
        opacity: 0.74,
        transparent: true,
        defaultColor: "#0ea5e9",
      };
    case "signal":
    case "systems":
      return {
        radiusScale: 0.74,
        roughness: 0.16,
        metalness: 0.12,
        clearcoat: 0.95,
        opacity: 1,
        transparent: false,
        defaultColor: domain === "systems" ? "#22d3ee" : "#a855f7",
      };
    case "thermal":
      return {
        radiusScale: 1.15,
        roughness: 0.28,
        metalness: 0.65,
        clearcoat: 0.45,
        opacity: 1,
        transparent: false,
        defaultColor: "#e38c5a",
      };
    case "mechanical":
      return {
        radiusScale: 1.2,
        roughness: 0.3,
        metalness: 0.82,
        clearcoat: 0.3,
        opacity: 1,
        transparent: false,
        defaultColor: "#b9c4cf",
      };
    default:
      return {
        radiusScale: 1.0,
        roughness: 0.28,
        metalness: 0.22,
        clearcoat: 0.65,
        opacity: 1,
        transparent: false,
        defaultColor: "#3b82f6",
      };
  }
}

interface CommittedWireMeshProps {
  edge: VrDiagramEdgeLike;
  coordFrame?: SpatialCoordFrame2DTo3D | undefined;
  nodeGroupRefs: React.RefObject<Map<string, THREE.Group>>;
  nodePortsRef: React.RefObject<Map<string, readonly SpatialDiagramPort3D[]>>;
  liveWaypointDragRef?: React.RefObject<{ edgeId: string; vertexIndex: number; pos: THREE.Vector3 } | null> | undefined;
  selected: boolean;
  isPlaying: boolean;
  onSelect?: ((edgeId: string) => void) | undefined;
  onDisconnect?: ((edgeId: string) => void) | undefined;
  onUnplugToDrag?:
    | ((
        edgeId: string,
        keptPort: SpatialDiagramPort3D,
        e: ThreeEvent<PointerEvent>,
        pulledEnd: "start" | "end",
      ) => void)
    | undefined;
  onAddWaypoint?: ((edgeId: string, pos3D: [number, number, number]) => void) | undefined;
  onStartWaypointDrag?: ((edgeId: string, vertexIndex: number, e: ThreeEvent<PointerEvent>) => void) | undefined;
  onRemoveWaypoint?: ((edgeId: string, vertexIndex: number) => void) | undefined;
}

/** Single committed 3D PBR insulated cable with domain styling, manual waypoints, live 90Hz endpoint following, & unplug collars. */
function CommittedWireMesh({
  edge,
  coordFrame,
  nodeGroupRefs,
  nodePortsRef,
  liveWaypointDragRef,
  selected,
  isPlaying,
  onSelect,
  onDisconnect,
  onUnplugToDrag,
  onAddWaypoint,
  onStartWaypointDrag,
  onRemoveWaypoint,
}: CommittedWireMeshProps): React.ReactElement | null {
  const edgeId = edge.id ?? "wire";
  const endpoints = useMemo(() => resolveEdgeEndpoints(edge), [edge]);
  const [hovered, setHovered] = useState(false);
  const [hoveredEnd, setHoveredEnd] = useState<"start" | "end" | null>(null);

  const tube: DynamicWireTubeBuffer = useMemo(() => createDynamicWireTubeBuffer(26, 8), []);
  useEffect(() => () => tube.dispose(), [tube]);

  const ferruleStartRef = useRef<THREE.Group | null>(null);
  const ferruleEndRef = useRef<THREE.Group | null>(null);
  const pulseBeadRef = useRef<THREE.Mesh | null>(null);
  const midHandleRef = useRef<THREE.Group | null>(null);

  // Zero-allocation scratch vectors
  const pStart = useRef(new THREE.Vector3());
  const nStart = useRef(new THREE.Vector3());
  const pEnd = useRef(new THREE.Vector3());
  const nEnd = useRef(new THREE.Vector3());
  const pulsePos = useRef(new THREE.Vector3());
  const midPos = useRef(new THREE.Vector3());
  const collarPos = useRef(new THREE.Vector3());
  const collarTan = useRef(new THREE.Vector3());

  const [srcDomain, setSrcDomain] = useState<SpatialPortDomain>("generic");
  useEffect(() => {
    if (!endpoints) {
      setSrcDomain("generic");
      return;
    }
    const ports = nodePortsRef.current?.get(endpoints.sourceNodeId);
    const port = ports?.find((p) => p.portId === endpoints.sourcePortId) ?? ports?.[0];
    setSrcDomain(port?.domain ?? "generic");
  }, [endpoints, nodePortsRef]);

  const style = useMemo(() => getDomainCableStyle(srcDomain), [srcDomain]);

  const lineAttrs = edge.attrs?.["line"] as
    | {
        stroke?: string | undefined;
        strokeDasharray?: string | undefined;
        sourceMarker?: unknown;
        targetMarker?: unknown;
      }
    | undefined;
  const baseColor = typeof lineAttrs?.stroke === "string" ? lineAttrs.stroke : style.defaultColor;
  const isDashed = Boolean(lineAttrs?.strokeDasharray);
  const hasSourceArrow = Boolean(lineAttrs?.sourceMarker);
  const hasTargetArrow = Boolean(lineAttrs?.targetMarker);

  const edgeLabelText = useMemo(() => {
    const rawLabels = (
      edge as unknown as { labels?: Array<{ attrs?: { text?: { text?: string }; label?: { text?: string } } }> }
    ).labels;
    if (!Array.isArray(rawLabels) || rawLabels.length === 0) return "";
    const first = rawLabels[0];
    const txt = first?.attrs?.text?.text ?? first?.attrs?.label?.text ?? "";
    return typeof txt === "string" ? txt.trim() : "";
  }, [edge]);

  const edgeLabelTex = useMemo(() => {
    if (!edgeLabelText || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 56;
    paintWireStatusBadge(canvas, edgeLabelText.slice(0, 24), "searching");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }, [edgeLabelText]);

  useEffect(() => () => edgeLabelTex?.dispose(), [edgeLabelTex]);

  const labelSpriteRef = useRef<THREE.Sprite | null>(null);
  const addWaypointBtnRef = useRef<THREE.Group | null>(null);
  const waypointMeshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const polylineScratch = useRef(new Float32Array(27 * 3));

  const manualVertices3D = useMemo<[number, number, number][]>(() => {
    const rawVerts = (edge as { vertices?: { x: number; y: number }[] }).vertices;
    if (!coordFrame || !Array.isArray(rawVerts) || rawVerts.length === 0) return [];
    return rawVerts.map((v) => diagram2DToStage3D(v.x, v.y, coordFrame, 0.006));
  }, [edge, coordFrame]);

  useFrame((state) => {
    if (!endpoints) return;
    const gMap = nodeGroupRefs.current;
    const pMap = nodePortsRef.current;
    if (!gMap || !pMap) return;

    const okA = resolvePortInStageSpace(
      endpoints.sourceNodeId,
      endpoints.sourcePortId,
      gMap,
      pMap,
      pStart.current,
      nStart.current,
    );
    const okB = resolvePortInStageSpace(
      endpoints.targetNodeId,
      endpoints.targetPortId,
      gMap,
      pMap,
      pEnd.current,
      nEnd.current,
    );
    if (!okA || !okB) return;

    const ctrl = computeInfiniteWireControlPoints(
      [pStart.current.x, pStart.current.y, pStart.current.z],
      [nStart.current.x, nStart.current.y, nStart.current.z],
      [pEnd.current.x, pEnd.current.y, pEnd.current.z],
      [nEnd.current.x, nEnd.current.y, nEnd.current.z],
      1.0,
    );

    const baseRadius = (selected || hovered ? 0.0044 : 0.0034) * style.radiusScale;
    const hasWaypoints = manualVertices3D.length > 0;
    if (hasWaypoints) {
      // Sample polyline [pStart, ...manualVertices3D (with live drag override), pEnd] onto 27 uniform points
      const activeDrag = liveWaypointDragRef?.current;
      const wpCount = manualVertices3D.length;
      const totalPts = wpCount + 2;
      const pts: [number, number, number][] = [[pStart.current.x, pStart.current.y, pStart.current.z]];
      for (let wi = 0; wi < wpCount; wi++) {
        if (activeDrag && activeDrag.edgeId === edgeId && activeDrag.vertexIndex === wi) {
          pts.push([activeDrag.pos.x, activeDrag.pos.y, activeDrag.pos.z]);
          const wm = waypointMeshRefs.current[wi];
          if (wm) wm.position.copy(activeDrag.pos);
        } else {
          const v = manualVertices3D[wi]!;
          pts.push([v[0], v[1], (pStart.current.z + pEnd.current.z) * 0.5]);
        }
      }
      pts.push([pEnd.current.x, pEnd.current.y, pEnd.current.z]);

      const buf = polylineScratch.current;
      const samples = 27;
      for (let i = 0; i < samples; i++) {
        const u = (i / (samples - 1)) * (totalPts - 1);
        const seg = Math.min(totalPts - 2, Math.floor(u));
        const frac = u - seg;
        const a = pts[seg]!;
        const b = pts[seg + 1]!;
        buf[i * 3] = a[0] + (b[0] - a[0]) * frac;
        buf[i * 3 + 1] = a[1] + (b[1] - a[1]) * frac;
        buf[i * 3 + 2] = a[2] + (b[2] - a[2]) * frac;
      }
      tube.updateFromPolyline(buf, samples, baseRadius);
    } else {
      tube.update(ctrl, baseRadius);
    }

    // Position strain-relief plug collars just outside the port grab spheres so users can grab them to unplug/re-route.
    const collarT = Math.min(0.18, Math.max(0.05, 0.036 / Math.max(0.08, ctrl.chordLength)));
    if (ferruleStartRef.current) {
      sampleWireSplineAt(ctrl, collarT, collarPos.current, collarTan.current);
      ferruleStartRef.current.position.copy(collarPos.current);
      if (collarTan.current.lengthSq() > 1e-8) {
        ferruleStartRef.current.quaternion.setFromUnitVectors(PLUG_AXIS, collarTan.current);
      }
    }
    if (ferruleEndRef.current) {
      sampleWireSplineAt(ctrl, 1 - collarT, collarPos.current, collarTan.current);
      ferruleEndRef.current.position.copy(collarPos.current);
      if (collarTan.current.lengthSq() > 1e-8) {
        ferruleEndRef.current.quaternion.setFromUnitVectors(PLUG_AXIS, collarTan.current);
      }
    }

    sampleWireSplineAt(ctrl, 0.5, midPos.current);
    if (midHandleRef.current) {
      midHandleRef.current.position.copy(midPos.current);
    }
    if (addWaypointBtnRef.current) {
      addWaypointBtnRef.current.position.set(midPos.current.x + 0.026, midPos.current.y, midPos.current.z + 0.004);
    }
    if (labelSpriteRef.current) {
      labelSpriteRef.current.position.set(midPos.current.x, midPos.current.y + 0.024, midPos.current.z + 0.008);
    }

    if (pulseBeadRef.current) {
      if (isPlaying) {
        const phase = (state.clock.elapsedTime * 0.55 + (edgeId.length % 7) * 0.14) % 1;
        sampleWireSplineAt(ctrl, phase, pulsePos.current);
        pulseBeadRef.current.position.copy(pulsePos.current);
        pulseBeadRef.current.visible = true;
      } else {
        pulseBeadRef.current.visible = false;
      }
    }
  });

  if (!endpoints) return null;

  const wireColor = selected ? "#22d3ee" : hovered ? "#67e8f9" : baseColor;

  const triggerUnplug = (pulledEnd: "start" | "end", e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const keptNodeId = pulledEnd === "start" ? endpoints.targetNodeId : endpoints.sourceNodeId;
    const keptPortId = pulledEnd === "start" ? endpoints.targetPortId : endpoints.sourcePortId;
    const ports = nodePortsRef.current?.get(keptNodeId);
    const keptPort = ports?.find((p) => p.portId === keptPortId) ?? ports?.[0];
    if (keptPort && onUnplugToDrag) {
      onUnplugToDrag(edgeId, keptPort, e, pulledEnd);
    } else {
      onDisconnect?.(edgeId);
    }
  };

  return (
    <group name={`spatial-wire-${edgeId}`}>
      <mesh
        geometry={tube.geometry}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
          pulseEventHaptic(e, 0.06, 5);
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(false);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect?.(edgeId);
        }}
        onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onDisconnect?.(edgeId);
        }}
      >
        <meshStandardMaterial
          color={wireColor}
          emissive={wireColor}
          emissiveIntensity={selected || hovered ? 0.55 : style.defaultColor === "#a855f7" ? 0.28 : 0.14}
          roughness={style.roughness}
          metalness={style.metalness}
          transparent={style.transparent || isDashed}
          opacity={isDashed ? 0.62 : style.opacity}
          wireframe={isDashed}
        />
      </mesh>

      {/* Grabbable Machined Plug Collars Near Both Sockets (pull to unplug & re-route live in hand) */}
      {(["start", "end"] as const).map((endKey) => {
        const isEndHovered = hoveredEnd === endKey;
        const showArrow = endKey === "start" ? hasSourceArrow : hasTargetArrow;
        return (
          <group key={endKey} ref={endKey === "start" ? ferruleStartRef : ferruleEndRef}>
            <mesh
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHoveredEnd(endKey);
                pulseEventHaptic(e, 0.1, 7);
              }}
              onPointerOut={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHoveredEnd((prev) => (prev === endKey ? null : prev));
              }}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => triggerUnplug(endKey, e)}
            >
              {showArrow ? (
                <coneGeometry args={[0.0095, 0.022, 12]} />
              ) : (
                <cylinderGeometry args={[0.0068, 0.0068, 0.014, 14]} />
              )}
              <meshStandardMaterial
                color={isEndHovered ? "#f59e0b" : showArrow ? wireColor : "#cbd5e1"}
                emissive={isEndHovered ? "#f59e0b" : showArrow ? wireColor : "#000000"}
                emissiveIntensity={isEndHovered ? 0.7 : showArrow ? 0.35 : 0}
                metalness={0.82}
                roughness={0.24}
              />
            </mesh>
          </group>
        );
      })}

      {/* Optional Stereo-Safe Midpoint Edge Label Sprite */}
      {edgeLabelTex && (
        <sprite ref={labelSpriteRef} scale={[0.13, 0.028, 1]} raycast={NOOP_RAYCAST}>
          <spriteMaterial map={edgeLabelTex} transparent depthWrite={false} />
        </sprite>
      )}

      {/* Live Directional Signal / Energy Flow Pulse Bead */}
      <mesh ref={pulseBeadRef} visible={isPlaying}>
        <sphereGeometry args={[0.0062 * style.radiusScale, 10, 8]} />
        <meshBasicMaterial color="#e0f2fe" toneMapped={false} />
      </mesh>

      {/* Disconnect Midpoint Pill (visible when hovered or selected) */}
      <group ref={midHandleRef} visible={selected || hovered}>
        <mesh
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            pulseEventHaptic(e, 0.08, 6);
          }}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onDisconnect?.(edgeId);
          }}
        >
          <sphereGeometry args={[0.012, 12, 10]} />
          <meshStandardMaterial
            color="#ef4444"
            emissive="#ef4444"
            emissiveIntensity={0.65}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>
      </group>

      {/* Insert Manual Waypoint Pill (visible when edge is selected) */}
      <group ref={addWaypointBtnRef} visible={selected && Boolean(onAddWaypoint)}>
        <mesh
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            pulseEventHaptic(e, 0.08, 6);
          }}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onAddWaypoint?.(edgeId, [midPos.current.x, midPos.current.y, midPos.current.z]);
          }}
        >
          <octahedronGeometry args={[0.011, 0]} />
          <meshStandardMaterial
            color="#10b981"
            emissive="#10b981"
            emissiveIntensity={0.75}
            roughness={0.25}
            metalness={0.3}
          />
        </mesh>
      </group>

      {/* Interactive 3D Manual Waypoint Handles (drag to reroute, double-click to remove) */}
      {selected &&
        manualVertices3D.map((v, wi) => (
          <mesh
            key={`wp_${wi}`}
            ref={(el) => {
              waypointMeshRefs.current[wi] = el;
            }}
            position={v}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              pulseEventHaptic(e, 0.1, 7);
            }}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onStartWaypointDrag?.(edgeId, wi, e);
            }}
            onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onRemoveWaypoint?.(edgeId, wi);
            }}
          >
            <sphereGeometry args={[0.013, 14, 12]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#22d3ee"
              emissiveIntensity={0.8}
              roughness={0.2}
              metalness={0.5}
            />
          </mesh>
        ))}
    </group>
  );
}

/** Renders metallic 3D solder dots at any port with >= 3 incident wires (follows moving nodes at 90Hz). */
function SpatialSolderDots({
  edges,
  nodeGroupRefs,
  nodePortsRef,
}: {
  edges: readonly VrDiagramEdgeLike[];
  nodeGroupRefs: React.RefObject<Map<string, THREE.Group>>;
  nodePortsRef: React.RefObject<Map<string, readonly SpatialDiagramPort3D[]>>;
}): React.ReactElement | null {
  const junctions = useMemo(() => {
    const counts = computePortJunctionCounts(edges);
    const out: { key: string; nodeId: string; portId: string }[] = [];
    for (const [key, count] of counts.entries()) {
      if (count >= 3) {
        const sep = key.indexOf("::");
        if (sep > 0) {
          out.push({ key, nodeId: key.slice(0, sep), portId: key.slice(sep + 2) });
        }
      }
    }
    return out;
  }, [edges]);

  const dotRefs = useRef<(THREE.Mesh | null)[]>([]);
  const posScratch = useRef(new THREE.Vector3());
  const normScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    const gMap = nodeGroupRefs.current;
    const pMap = nodePortsRef.current;
    if (!gMap || !pMap) return;
    for (let i = 0; i < junctions.length; i++) {
      const j = junctions[i]!;
      const mesh = dotRefs.current[i];
      if (!mesh) continue;
      if (resolvePortInStageSpace(j.nodeId, j.portId, gMap, pMap, posScratch.current, normScratch.current)) {
        mesh.position.copy(posScratch.current);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  });

  if (junctions.length === 0) return null;
  return (
    <group name="spatial-solder-dots">
      {junctions.map((j, i) => (
        <mesh
          key={j.key}
          ref={(el) => {
            dotRefs.current[i] = el;
          }}
          raycast={NOOP_RAYCAST}
        >
          <sphereGeometry args={[0.0105, 14, 12]} />
          <meshStandardMaterial
            color="#e2e8f0"
            emissive="#38bdf8"
            emissiveIntensity={0.35}
            metalness={0.92}
            roughness={0.14}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Renders all committed 3D insulated diagram cables + the live physical Verlet-simulated
 * magnetic wire conduit while the user drags a plug from a component port socket.
 */
export function SpatialMagneticWires({
  edges,
  coordFrame,
  stageGroupRef,
  nodeGroupRefs,
  nodePortsRef,
  activeWireDrag,
  hiddenEdgeId,
  liveWaypointDragRef,
  selectedEdgeId,
  isPlaying,
  onSelectEdge,
  onDisconnectEdge,
  onUnplugEdgeToDrag,
  onAddEdgeWaypoint,
  onStartWaypointDrag,
  onRemoveEdgeWaypoint,
}: SpatialMagneticWiresProps): React.ReactElement {
  const VERLET_NODES = 25;
  const liveTube: DynamicWireTubeBuffer = useMemo(() => createDynamicWireTubeBuffer(VERLET_NODES - 1, 10), []);
  useEffect(() => () => liveTube.dispose(), [liveTube]);
  const liveVerlet = useMemo(() => new VerletCableSim(VERLET_NODES), []);

  // Re-seed rope whenever a new wire drag starts
  const activeSourceKey = activeWireDrag
    ? `${activeWireDrag.sourcePort.nodeId}:${activeWireDrag.sourcePort.portId}`
    : null;
  useEffect(() => {
    liveVerlet.invalidate();
  }, [activeSourceKey, liveVerlet]);

  const liveTipOrbRef = useRef<THREE.Group | null>(null);
  const liveMagnetRingRef = useRef<THREE.Mesh | null>(null);
  const liveBadgeRef = useRef<THREE.Sprite | null>(null);

  // Zero-alloc scratch objects for 90Hz active wire deformation
  const pStart = useRef(new THREE.Vector3());
  const nStart = useRef(new THREE.Vector3());
  const pTipLocal = useRef(new THREE.Vector3());
  const nEndLocal = useRef(new THREE.Vector3());
  const invStageMat = useRef(new THREE.Matrix4());
  const invStageQuat = useRef(new THREE.Quaternion());
  const stageWorldQuat = useRef(new THREE.Quaternion());
  const plugDir = useRef(new THREE.Vector3());
  const tipTanScratch = useRef<[number, number, number]>([0, 1, 0]);

  const badgeText = activeWireDrag
    ? activeWireDrag.snappedTarget
      ? `${activeWireDrag.sourcePort.nodeId}.${activeWireDrag.sourcePort.portId} ⇄ ${activeWireDrag.snappedTarget.port.nodeId}.${activeWireDrag.snappedTarget.port.portId} ✓`
      : activeWireDrag.rejectedTarget
        ? activeWireDrag.rejectedTarget.reason
        : `${activeWireDrag.sourcePort.nodeId}.${activeWireDrag.sourcePort.portId} → Drag to Port`
    : null;
  const badgeVariant: "searching" | "locked" | "rejected" = activeWireDrag?.snappedTarget
    ? "locked"
    : activeWireDrag?.rejectedTarget
      ? "rejected"
      : "searching";

  // Allocate ONE persistent offscreen badge canvas & texture on mount (zero mid-XR-drag texture creation/disposal)
  const badgeBundle = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 84;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, []);
  useEffect(() => () => badgeBundle?.tex.dispose(), [badgeBundle]);

  useEffect(() => {
    if (!badgeBundle || !badgeText) return;
    paintWireStatusBadge(badgeBundle.canvas, badgeText, badgeVariant);
    badgeBundle.tex.needsUpdate = true;
  }, [badgeBundle, badgeText, badgeVariant]);

  useFrame((state, rawDelta) => {
    if (!activeWireDrag) return;
    const gMap = nodeGroupRefs.current;
    const pMap = nodePortsRef.current;
    const stageGroup = stageGroupRef.current;
    if (!gMap || !pMap || !stageGroup) return;

    const okStart = resolvePortInStageSpace(
      activeWireDrag.sourcePort.nodeId,
      activeWireDrag.sourcePort.portId,
      gMap,
      pMap,
      pStart.current,
      nStart.current,
    );
    if (!okStart) return;

    stageGroup.updateWorldMatrix(true, false);
    invStageMat.current.copy(stageGroup.matrixWorld).invert();
    stageGroup.getWorldQuaternion(stageWorldQuat.current);
    invStageQuat.current.copy(stageWorldQuat.current).invert();

    let hasEndNormal = false;
    if (activeWireDrag.snappedTarget) {
      const wp = activeWireDrag.snappedTarget.worldPosition;
      const wn = activeWireDrag.snappedTarget.worldNormal;
      pTipLocal.current.set(wp[0], wp[1], wp[2]).applyMatrix4(invStageMat.current);
      nEndLocal.current.set(wn[0], wn[1], wn[2]).applyQuaternion(invStageQuat.current).normalize();
      hasEndNormal = true;
    } else if (activeWireDrag.tipWorldPosRef.current) {
      pTipLocal.current.copy(activeWireDrag.tipWorldPosRef.current).applyMatrix4(invStageMat.current);
    }

    if (
      !Number.isFinite(pStart.current.x) ||
      !Number.isFinite(pTipLocal.current.x) ||
      !Number.isFinite(pTipLocal.current.y) ||
      !Number.isFinite(pTipLocal.current.z)
    ) {
      return;
    }

    // Step physical Verlet rope with gravity sag, hand inertia, and socket strain-relief
    const ropePositions = liveVerlet.step(
      [pStart.current.x, pStart.current.y, pStart.current.z],
      [nStart.current.x, nStart.current.y, nStart.current.z],
      [pTipLocal.current.x, pTipLocal.current.y, pTipLocal.current.z],
      hasEndNormal ? [nEndLocal.current.x, nEndLocal.current.y, nEndLocal.current.z] : null,
      Math.max(1 / 240, Math.min(rawDelta, 0.05)),
    );

    const liveStyle = getDomainCableStyle(activeWireDrag.sourcePort.domain);
    const radius = (activeWireDrag.snappedTarget ? 0.0046 : 0.0038) * liveStyle.radiusScale;
    liveTube.updateFromPolyline(ropePositions, VERLET_NODES, radius);

    if (liveTipOrbRef.current) {
      liveTipOrbRef.current.position.copy(pTipLocal.current);
      // When locked onto a socket, aim the contact pin straight INTO the socket (-nEndLocal);
      // otherwise align along the live Verlet rope's incoming tangent.
      if (hasEndNormal) {
        plugDir.current.copy(nEndLocal.current).negate();
      } else {
        const t = liveVerlet.getTipTangent(tipTanScratch.current);
        plugDir.current.set(t[0], t[1], t[2]);
      }
      if (plugDir.current.lengthSq() > 1e-8) {
        liveTipOrbRef.current.quaternion.setFromUnitVectors(PLUG_AXIS, plugDir.current);
      }
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 8) * 0.06;
      liveTipOrbRef.current.scale.setScalar(activeWireDrag.snappedTarget ? 1.15 : pulse);
    }

    if (liveMagnetRingRef.current) {
      liveMagnetRingRef.current.visible = Boolean(activeWireDrag.snappedTarget);
      if (activeWireDrag.snappedTarget) {
        liveMagnetRingRef.current.position.copy(pTipLocal.current);
        liveMagnetRingRef.current.rotation.z = state.clock.elapsedTime * 2.4;
      }
    }

    if (liveBadgeRef.current) {
      liveBadgeRef.current.position.set(pTipLocal.current.x, pTipLocal.current.y + 0.048, pTipLocal.current.z + 0.018);
    }
  });

  const liveColor = activeWireDrag?.snappedTarget
    ? "#10b981"
    : activeWireDrag?.rejectedTarget
      ? "#f59e0b"
      : (activeWireDrag?.sourcePort.color ?? "#22d3ee");

  return (
    <group name="spatial-magnetic-wires">
      {edges
        .filter((edge) => !hiddenEdgeId || edge.id !== hiddenEdgeId)
        .map((edge, idx) => (
          <CommittedWireMesh
            key={edge.id ?? `wire_${idx}`}
            edge={edge}
            coordFrame={coordFrame}
            nodeGroupRefs={nodeGroupRefs}
            nodePortsRef={nodePortsRef}
            liveWaypointDragRef={liveWaypointDragRef}
            selected={selectedEdgeId === edge.id}
            isPlaying={isPlaying}
            onSelect={onSelectEdge}
            onDisconnect={onDisconnectEdge}
            onUnplugToDrag={onUnplugEdgeToDrag}
            onAddWaypoint={onAddEdgeWaypoint}
            onStartWaypointDrag={onStartWaypointDrag}
            onRemoveWaypoint={onRemoveEdgeWaypoint}
          />
        ))}

      {/* Metallic 3D Solder Dots at Multi-Wire Port Junctions (>= 3 wires) */}
      <SpatialSolderDots edges={edges} nodeGroupRefs={nodeGroupRefs} nodePortsRef={nodePortsRef} />

      {/* Active Physical Verlet-Simulated Magnetic Drag Wire (pre-mounted & toggled via visible for zero Quest 2 mid-grab shader stalls) */}
      <group name="spatial-live-extending-wire" visible={Boolean(activeWireDrag)}>
        <mesh geometry={liveTube.geometry} raycast={NOOP_RAYCAST} frustumCulled={false}>
          <meshBasicMaterial color={liveColor} toneMapped={false} />
        </mesh>

        <group ref={liveTipOrbRef}>
          {/* Strain-relief boot */}
          <mesh position={[0, -0.016, 0]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.0042, 0.006, 0.012, 12]} />
            <meshBasicMaterial color="#1e293b" />
          </mesh>
          {/* Machined connector body */}
          <mesh position={[0, -0.004, 0]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.0072, 0.0072, 0.014, 14]} />
            <meshBasicMaterial color="#cbd5e1" />
          </mesh>
          {/* Domain-colored collar */}
          <mesh position={[0, 0.0045, 0]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.0078, 0.0078, 0.0028, 14]} />
            <meshBasicMaterial color={liveColor} toneMapped={false} />
          </mesh>
          {/* Contact pin */}
          <mesh position={[0, 0.0095, 0]} raycast={NOOP_RAYCAST}>
            <cylinderGeometry args={[0.0022, 0.0026, 0.008, 10]} />
            <meshBasicMaterial color={liveColor} toneMapped={false} />
          </mesh>
        </group>

        <mesh ref={liveMagnetRingRef} visible={false} raycast={NOOP_RAYCAST}>
          <torusGeometry args={[0.022, 0.0024, 10, 24]} />
          <meshBasicMaterial color="#10b981" toneMapped={false} />
        </mesh>

        {badgeBundle && (
          <sprite ref={liveBadgeRef} scale={[0.21, 0.037, 1]} visible={Boolean(badgeText)} raycast={NOOP_RAYCAST}>
            <spriteMaterial map={badgeBundle.tex} transparent depthTest={false} depthWrite={false} />
          </sprite>
        )}
      </group>
    </group>
  );
}
