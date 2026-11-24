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
import { resolveEdgeEndpoints, type SpatialDiagramPort3D } from "./spatial-diagram-state.js";

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
  /** Stage group ref so world-space port coordinates transform cleanly into stage-local space. */
  stageGroupRef: React.RefObject<THREE.Group | null>;
  /** Live Three.js `Group` refs per node ID for zero-lag 90Hz wire deformation while dragging components. */
  nodeGroupRefs: React.RefObject<Map<string, THREE.Group>>;
  /** Registered 3D ports per node ID. */
  nodePortsRef: React.RefObject<Map<string, readonly SpatialDiagramPort3D[]>>;
  /** Live active infinite-extending wire drag state (null when idle). */
  activeWireDrag: ActiveWireDragVisualState | null;
  selectedEdgeId: string | null;
  isPlaying: boolean;
  onSelectEdge?: ((edgeId: string) => void) | undefined;
  onDisconnectEdge?: ((edgeId: string) => void) | undefined;
}

/** Creates a stereo-safe floating badge sprite texture showing live magnetic wire lock status. */
function createWireStatusBadgeTexture(
  text: string,
  variant: "searching" | "locked" | "rejected",
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 84;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

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

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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

interface CommittedWireMeshProps {
  edge: VrDiagramEdgeLike;
  nodeGroupRefs: React.RefObject<Map<string, THREE.Group>>;
  nodePortsRef: React.RefObject<Map<string, readonly SpatialDiagramPort3D[]>>;
  selected: boolean;
  isPlaying: boolean;
  onSelect?: ((edgeId: string) => void) | undefined;
  onDisconnect?: ((edgeId: string) => void) | undefined;
}

/** Single committed 3D PBR insulated cable with live 90Hz endpoint following & simulation energy pulse. */
function CommittedWireMesh({
  edge,
  nodeGroupRefs,
  nodePortsRef,
  selected,
  isPlaying,
  onSelect,
  onDisconnect,
}: CommittedWireMeshProps): React.ReactElement | null {
  const edgeId = edge.id ?? "wire";
  const endpoints = useMemo(() => resolveEdgeEndpoints(edge), [edge]);
  const [hovered, setHovered] = useState(false);

  const tube: DynamicWireTubeBuffer = useMemo(() => createDynamicWireTubeBuffer(26, 8), []);
  useEffect(() => () => tube.dispose(), [tube]);

  const ferruleStartRef = useRef<THREE.Mesh | null>(null);
  const ferruleEndRef = useRef<THREE.Mesh | null>(null);
  const pulseBeadRef = useRef<THREE.Mesh | null>(null);
  const midHandleRef = useRef<THREE.Group | null>(null);

  // Zero-allocation scratch vectors
  const pStart = useRef(new THREE.Vector3());
  const nStart = useRef(new THREE.Vector3());
  const pEnd = useRef(new THREE.Vector3());
  const nEnd = useRef(new THREE.Vector3());
  const pulsePos = useRef(new THREE.Vector3());
  const midPos = useRef(new THREE.Vector3());

  const lineAttrs = edge.attrs?.["line"] as { stroke?: string } | undefined;
  const baseColor = typeof lineAttrs?.stroke === "string" ? lineAttrs.stroke : "#3b82f6";

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

    tube.update(ctrl, selected || hovered ? 0.0044 : 0.0034);

    if (ferruleStartRef.current) ferruleStartRef.current.position.copy(pStart.current);
    if (ferruleEndRef.current) ferruleEndRef.current.position.copy(pEnd.current);

    sampleWireSplineAt(ctrl, 0.5, midPos.current);
    if (midHandleRef.current) {
      midHandleRef.current.position.copy(midPos.current);
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

  return (
    <group name={`spatial-wire-${edgeId}`}>
      <mesh
        geometry={tube.geometry}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
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
        <meshPhysicalMaterial
          color={wireColor}
          emissive={wireColor}
          emissiveIntensity={selected || hovered ? 0.55 : 0.16}
          roughness={0.28}
          metalness={0.18}
          clearcoat={0.65}
          clearcoatRoughness={0.18}
        />
      </mesh>

      {/* Machined Brass/Aluminum Crimp Ferrules at Both Sockets */}
      <mesh ref={ferruleStartRef}>
        <sphereGeometry args={[0.0056, 10, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.78} roughness={0.24} />
      </mesh>
      <mesh ref={ferruleEndRef}>
        <sphereGeometry args={[0.0056, 10, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.78} roughness={0.24} />
      </mesh>

      {/* Live Directional Signal / Energy Flow Pulse Bead */}
      <mesh ref={pulseBeadRef} visible={isPlaying}>
        <sphereGeometry args={[0.0062, 10, 8]} />
        <meshBasicMaterial color="#e0f2fe" toneMapped={false} />
      </mesh>

      {/* Disconnect Midpoint Pill (visible when hovered or selected) */}
      <group ref={midHandleRef} visible={selected || hovered}>
        <mesh
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
    </group>
  );
}

/**
 * Renders all committed 3D insulated diagram cables + the live infinite-extending
 * magnetic wire conduit while the user drags from a component port socket.
 */
export function SpatialMagneticWires({
  edges,
  stageGroupRef,
  nodeGroupRefs,
  nodePortsRef,
  activeWireDrag,
  selectedEdgeId,
  isPlaying,
  onSelectEdge,
  onDisconnectEdge,
}: SpatialMagneticWiresProps): React.ReactElement {
  const liveTube: DynamicWireTubeBuffer = useMemo(() => createDynamicWireTubeBuffer(32, 10), []);
  useEffect(() => () => liveTube.dispose(), [liveTube]);

  const liveTipOrbRef = useRef<THREE.Mesh | null>(null);
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

  const badgeInfo = useMemo(() => {
    if (!activeWireDrag) return null;
    const src = `${activeWireDrag.sourcePort.nodeId}.${activeWireDrag.sourcePort.portId}`;
    if (activeWireDrag.snappedTarget) {
      const tgt = `${activeWireDrag.snappedTarget.port.nodeId}.${activeWireDrag.snappedTarget.port.portId}`;
      return { text: `${src} ⇄ ${tgt} ✓`, variant: "locked" as const };
    }
    if (activeWireDrag.rejectedTarget) {
      return { text: activeWireDrag.rejectedTarget.reason, variant: "rejected" as const };
    }
    return { text: `${src} → Drag to Port`, variant: "searching" as const };
  }, [activeWireDrag]);

  const badgeTexture = useMemo(
    () => (badgeInfo ? createWireStatusBadgeTexture(badgeInfo.text, badgeInfo.variant) : null),
    [badgeInfo],
  );
  useEffect(() => () => badgeTexture?.dispose(), [badgeTexture]);

  useFrame((state) => {
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

    const ctrl = computeInfiniteWireControlPoints(
      [pStart.current.x, pStart.current.y, pStart.current.z],
      [nStart.current.x, nStart.current.y, nStart.current.z],
      [pTipLocal.current.x, pTipLocal.current.y, pTipLocal.current.z],
      hasEndNormal ? [nEndLocal.current.x, nEndLocal.current.y, nEndLocal.current.z] : null,
      0.85,
    );

    liveTube.update(ctrl, activeWireDrag.snappedTarget ? 0.0046 : 0.0038);

    if (liveTipOrbRef.current) {
      liveTipOrbRef.current.position.copy(pTipLocal.current);
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 8) * 0.14;
      liveTipOrbRef.current.scale.setScalar(activeWireDrag.snappedTarget ? 1.35 * pulse : pulse);
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

  const liveColor = activeWireDrag?.snappedTarget ? "#10b981" : activeWireDrag?.rejectedTarget ? "#f59e0b" : "#22d3ee";

  return (
    <group name="spatial-magnetic-wires">
      {edges.map((edge, idx) => (
        <CommittedWireMesh
          key={edge.id ?? `wire_${idx}`}
          edge={edge}
          nodeGroupRefs={nodeGroupRefs}
          nodePortsRef={nodePortsRef}
          selected={selectedEdgeId === edge.id}
          isPlaying={isPlaying}
          onSelect={onSelectEdge}
          onDisconnect={onDisconnectEdge}
        />
      ))}

      {/* Active Infinite-Extending Magnetic Drag Wire */}
      {activeWireDrag && (
        <group name="spatial-live-extending-wire">
          <mesh geometry={liveTube.geometry}>
            <meshStandardMaterial
              color={liveColor}
              emissive={liveColor}
              emissiveIntensity={activeWireDrag.snappedTarget ? 1.15 : 0.85}
              roughness={0.2}
              metalness={0.15}
              toneMapped={false}
            />
          </mesh>

          <mesh ref={liveTipOrbRef}>
            <sphereGeometry args={[0.0085, 14, 12]} />
            <meshBasicMaterial color={liveColor} toneMapped={false} />
          </mesh>

          <mesh ref={liveMagnetRingRef} visible={false}>
            <torusGeometry args={[0.022, 0.0024, 10, 28]} />
            <meshBasicMaterial color="#10b981" toneMapped={false} />
          </mesh>

          {badgeTexture && (
            <sprite ref={liveBadgeRef} scale={[0.21, 0.037, 1]}>
              <spriteMaterial map={badgeTexture} transparent depthTest={false} depthWrite={false} />
            </sprite>
          )}
        </group>
      )}
    </group>
  );
}
