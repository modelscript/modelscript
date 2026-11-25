// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { VrDiagramNodeLike } from "./board-painter.js";
import { makePortKey } from "./magnetic-port-solver.js";
import { RealisticComponentMesh3D, resolveRealisticComponentKind } from "./realistic-components-3d.js";
import {
  DOMAIN_COLORS,
  extractNodePorts3D,
  inferDomainFromText,
  type SpatialDiagramPort3D,
  type SpatialNodePose3D,
} from "./spatial-diagram-state.js";
import {
  buildExtrudedIconBundle,
  getSharedExtrudedIconCache,
  hashStringFnv1a,
  type ExtrudedIconBundle,
  type ExtrudedWaferStyle,
} from "./svg-extruder.js";
import { pulseEventHaptic } from "./xr-handle.js";

/**
 * Stereo-safe crisp high-DPI CanvasTexture nameplate mounted cleanly below each
 * extruded 3D diagram component (never uses DOM portals inside WebXR).
 */
function createNodeNameplateTexture(
  title: string,
  subtitle: string,
  accentColor: string,
  dark: boolean,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Pill backdrop
  const r = 16;
  ctx.fillStyle = dark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.92)";
  ctx.beginPath();
  ctx.moveTo(r, 4);
  ctx.lineTo(canvas.width - r, 4);
  ctx.quadraticCurveTo(canvas.width - 4, 4, canvas.width - 4, r);
  ctx.lineTo(canvas.width - 4, canvas.height - r);
  ctx.quadraticCurveTo(canvas.width - 4, canvas.height - 4, canvas.width - r, canvas.height - 4);
  ctx.lineTo(r, canvas.height - 4);
  ctx.quadraticCurveTo(4, canvas.height - 4, 4, canvas.height - r);
  ctx.lineTo(4, r);
  ctx.quadraticCurveTo(4, 4, r, 4);
  ctx.closePath();
  ctx.fill();

  // Left accent bar & crisp border
  ctx.fillStyle = accentColor;
  ctx.fillRect(10, 16, 7, canvas.height - 32);

  ctx.strokeStyle = dark ? "rgba(148, 163, 184, 0.42)" : "rgba(15, 23, 42, 0.16)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const cleanTitle = title.length > 18 ? `${title.slice(0, 17)}…` : title;
  const cleanSub = subtitle.length > 26 ? `${subtitle.slice(0, 25)}…` : subtitle;

  ctx.fillStyle = dark ? "#f8fafc" : "#0f172a";
  ctx.font = "700 32px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(cleanTitle, 28, cleanSub ? 34 : 48);

  if (cleanSub) {
    ctx.fillStyle = dark ? "#94a3b8" : "#475569";
    ctx.font = "600 20px monospace";
    ctx.fillText(cleanSub, 28, 68);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export interface PortVisualHighlightState {
  /** Normalized approach proximity `[0..1]` when an active compatible wire tip is near this port. */
  readonly approach01: number;
  /** True when the live wire is magnetically snapped onto this port. */
  readonly snapped: boolean;
  /** True when an incompatible wire tip is hovering this port. */
  readonly rejected: boolean;
  /** True when this port is the active wire-drag source. */
  readonly isSource: boolean;
}

export interface SpatialDiagramNode3DProps {
  node: VrDiagramNodeLike;
  pose: SpatialNodePose3D;
  waferStyle: ExtrudedWaferStyle;
  dark: boolean;
  selected: boolean;
  isGrabbed: boolean;
  isOverDeleteRing?: boolean | undefined;
  /** Optional timestamp (ms) when freshly materialized for an elastic pop-in entrance. */
  spawnedAtMs?: number | undefined;
  /** Map of `"nodeId::portId"` → live magnetic highlight state while dragging a wire. */
  portHighlights?: ReadonlyMap<string, PortVisualHighlightState> | undefined;
  /** Registers this node's live Three.js `Group` ref so 3D wires follow at 90Hz with zero React re-renders. */
  registerGroupRef?: ((nodeId: string, group: THREE.Group | null) => void) | undefined;
  /** Registers computed 3D ports so the magnetic port solver has exact local anchors & normals. */
  registerNodePorts?: ((nodeId: string, ports: readonly SpatialDiagramPort3D[]) => void) | undefined;
  onStartNodeGrab?: ((nodeId: string, e: ThreeEvent<PointerEvent>) => void) | undefined;
  onStartPortWireDrag?: ((port: SpatialDiagramPort3D, e: ThreeEvent<PointerEvent>) => void) | undefined;
  onHoverNodeChange?: ((nodeId: string | null) => void) | undefined;
  onHoverPortChange?: ((port: SpatialDiagramPort3D | null) => void) | undefined;
}

/**
 * Renders a single 2D engineering schematic node as a tactile, auto-extruded 3D
 * beveled PBR component with physical domain-coded 3D port sockets, stereo-safe
 * nameplate, magnetic approach/lock halos, and 6DOF grab interaction hooks.
 */
export function SpatialDiagramNode3D({
  node,
  pose,
  waferStyle,
  dark,
  selected,
  isGrabbed,
  isOverDeleteRing = false,
  spawnedAtMs,
  portHighlights,
  registerGroupRef,
  registerNodePorts,
  onStartNodeGrab,
  onStartPortWireDrag,
  onHoverNodeChange,
  onHoverPortChange,
}: SpatialDiagramNode3DProps): React.ReactElement {
  const nodeId = node.id ?? node.properties?.name ?? "node";
  const groupRef = useRef<THREE.Group | null>(null);
  const animRootRef = useRef<THREE.Group | null>(null);
  const [hoveredBody, setHoveredBody] = useState(false);
  const [hoveredPortId, setHoveredPortId] = useState<string | null>(null);

  const catalogItemId = typeof node.data?.["catalogItemId"] === "string" ? node.data["catalogItemId"] : "";
  const classHint = `${catalogItemId} ${node.properties?.className ?? ""} ${node.label ?? ""} ${nodeId}`;
  const domain = inferDomainFromText(classHint);
  const accentColor = DOMAIN_COLORS[domain];
  const realisticKind = useMemo(() => resolveRealisticComponentKind(classHint), [classHint]);

  const iconSvg =
    typeof node.data?.["iconSvg"] === "string" && node.data["iconSvg"].trim().startsWith("<")
      ? node.data["iconSvg"]
      : undefined;

  const cacheKey = useMemo(() => {
    const srcKey = iconSvg
      ? `svg:${iconSvg}`
      : `mk:${JSON.stringify({ m: node.markup ?? null, a: node.attrs ?? null, w: node.width ?? 80, h: node.height ?? 56 })}`;
    return `n3d_${hashStringFnv1a(`${srcKey}|${waferStyle}|${dark ? "d" : "l"}|${accentColor}`)}`;
  }, [iconSvg, node.markup, node.attrs, node.width, node.height, waferStyle, dark, accentColor]);

  // Acquire shared merged GPU geometry bundle from LRU cache
  const bundle: ExtrudedIconBundle = useMemo(() => {
    const cache = getSharedExtrudedIconCache();
    return cache.acquire(cacheKey, () =>
      buildExtrudedIconBundle(
        iconSvg
          ? { kind: "svg", svg: iconSvg, width: node.width ?? 80, height: node.height ?? 56 }
          : {
              kind: "markup",
              markup: node.markup,
              attrs: node.attrs,
              width: node.width ?? 80,
              height: node.height ?? 56,
            },
        {
          waferStyle,
          dark,
          accentColor,
          targetSpanMeters: 0.148,
        },
      ),
    );
  }, [cacheKey, iconSvg, node.markup, node.attrs, node.width, node.height, waferStyle, dark, accentColor]);

  useEffect(() => {
    return () => {
      getSharedExtrudedIconCache().release(cacheKey);
    };
  }, [cacheKey]);

  const ports = useMemo(
    () =>
      extractNodePorts3D(
        node,
        bundle.widthMeters,
        bundle.heightMeters,
        realisticKind ? 0 : waferStyle === "tactile-tile" ? 0.0048 : 0.0028,
      ),
    [node, bundle.widthMeters, bundle.heightMeters, waferStyle, realisticKind],
  );

  useEffect(() => {
    registerNodePorts?.(nodeId, ports);
  }, [nodeId, ports, registerNodePorts]);

  useEffect(() => {
    registerGroupRef?.(nodeId, groupRef.current);
    return () => {
      registerGroupRef?.(nodeId, null);
    };
  }, [nodeId, registerGroupRef]);

  // Nameplate CanvasTexture
  const displayName = node.label ?? node.properties?.name ?? nodeId;
  const shortClass = useMemo(() => {
    const raw = node.properties?.className ?? "";
    if (!raw) return "";
    const parts = raw.split(".");
    return parts[parts.length - 1] ?? raw;
  }, [node.properties?.className]);

  const nameplateTex = useMemo(
    () => createNodeNameplateTexture(displayName, shortClass === displayName ? "" : shortClass, accentColor, dark),
    [displayName, shortClass, accentColor, dark],
  );

  useEffect(() => {
    return () => {
      nameplateTex?.dispose();
    };
  }, [nameplateTex]);

  // Sync committed pose onto group when not actively grabbed (live grab updates groupRef directly at 90Hz)
  useEffect(() => {
    const g = groupRef.current;
    if (!g || isGrabbed) return;
    g.position.set(pose.position[0], pose.position[1], pose.position[2]);
    g.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    g.scale.setScalar(pose.scale);
  }, [pose, isGrabbed]);

  // Subtle hover/grab/spawn elastic polish animation (zero allocations)
  useFrame((state) => {
    const anim = animRootRef.current;
    if (!anim) return;

    let targetScale = 1.0;
    if (isOverDeleteRing) {
      targetScale = 0.52;
    } else if (isGrabbed) {
      targetScale = 1.045;
    } else if (hoveredBody) {
      targetScale = 1.028;
    }

    // Elastic materialize pop-in curve for newly spawned components
    if (spawnedAtMs !== undefined) {
      const elapsedSec = (performance.now() - spawnedAtMs) / 1000;
      if (elapsedSec >= 0 && elapsedSec < 0.24) {
        const t = elapsedSec / 0.24;
        // Overshoot bounce 0.72 -> 1.09 -> 1.0
        targetScale *= 1 + Math.sin(t * Math.PI) * 0.11 * (1 - t * 0.4);
      }
    }

    const cur = anim.scale.x;
    const next = cur + (targetScale - cur) * 0.22;
    anim.scale.setScalar(next);

    // Subtle magnetic breathing lift when selected
    anim.position.z = selected || isGrabbed ? Math.sin(state.clock.elapsedTime * 3.4) * 0.002 + 0.004 : 0;
  });

  const rimColor = isOverDeleteRing
    ? "#ef4444"
    : isGrabbed
      ? "#22d3ee"
      : selected
        ? "#38bdf8"
        : hoveredBody
          ? "#67e8f9"
          : accentColor;

  const waferColor = isOverDeleteRing ? "#450a0a" : dark ? "#111c30" : "#f8fafc";

  return (
    <group
      ref={groupRef}
      name={`spatial-diagram-node-${nodeId}`}
      position={pose.position}
      quaternion={pose.quaternion}
      scale={pose.scale}
    >
      <group ref={animRootRef}>
        {realisticKind ? (
          <>
            {/* Authentic Real-World 3D Physical Hardware Model (Battery, Resistor, Capacitor, etc.) */}
            <RealisticComponentMesh3D
              kind={realisticKind}
              emissiveColor={isOverDeleteRing ? "#991b1b" : isGrabbed ? "#0e7490" : hoveredBody ? "#0369a1" : "#000000"}
              emissiveIntensity={isOverDeleteRing ? 0.65 : isGrabbed ? 0.35 : hoveredBody ? 0.2 : 0}
              disableRaycast
            />

            {/* Subtle Tactile Selection / Hover / Delete Halo Ring behind the 3D hardware */}
            {(selected || hoveredBody || isGrabbed || isOverDeleteRing) && (
              <mesh position={[0, 0, -0.022]}>
                <ringGeometry args={[0.052, 0.061, 28]} />
                <meshBasicMaterial
                  color={rimColor}
                  transparent
                  opacity={0.68}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            )}

            {/* Forgiving Invisible 3D Grab Volume so VR grab/raycast feels effortless */}
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredBody(true);
                pulseEventHaptic(e, 0.06, 5);
                onHoverNodeChange?.(nodeId);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                setHoveredBody(false);
                onHoverNodeChange?.(null);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onStartNodeGrab?.(nodeId, e);
              }}
            >
              <boxGeometry
                args={[Math.max(0.132, bundle.widthMeters * 0.9), Math.max(0.088, bundle.heightMeters * 0.9), 0.062]}
              />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </>
        ) : (
          <>
            {/* Chamfered Ceramic/Acrylic Wafer Backing */}
            {bundle.waferGeometry && (
              <mesh
                geometry={bundle.waferGeometry}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredBody(true);
                  pulseEventHaptic(e, 0.06, 5);
                  onHoverNodeChange?.(nodeId);
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  setHoveredBody(false);
                  onHoverNodeChange?.(null);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onStartNodeGrab?.(nodeId, e);
                }}
              >
                <meshPhysicalMaterial
                  color={waferColor}
                  roughness={dark ? 0.34 : 0.28}
                  metalness={dark ? 0.24 : 0.08}
                  clearcoat={0.45}
                  clearcoatRoughness={0.22}
                  transparent
                  opacity={isOverDeleteRing ? 0.65 : dark ? 0.92 : 0.96}
                />
              </mesh>
            )}

            {/* Perimeter Domain / Selection / Grab Accent Bevel Lip */}
            {bundle.rimGeometry && (
              <mesh geometry={bundle.rimGeometry}>
                <meshStandardMaterial
                  color={rimColor}
                  emissive={rimColor}
                  emissiveIntensity={isGrabbed || isOverDeleteRing ? 0.95 : selected || hoveredBody ? 0.55 : 0.18}
                  roughness={0.28}
                  metalness={0.42}
                />
              </mesh>
            )}

            {/* Merged Extruded 3D SVG Filled Reliefs & Raised Stroke Ribs */}
            {bundle.opaqueGeometry && (
              <mesh
                geometry={bundle.opaqueGeometry}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredBody(true);
                  pulseEventHaptic(e, 0.06, 5);
                  onHoverNodeChange?.(nodeId);
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  setHoveredBody(false);
                  onHoverNodeChange?.(null);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onStartNodeGrab?.(nodeId, e);
                }}
              >
                <meshStandardMaterial
                  vertexColors
                  roughness={0.32}
                  metalness={0.22}
                  emissive={isOverDeleteRing ? "#7f1d1d" : isGrabbed ? "#083344" : "#000000"}
                  emissiveIntensity={isOverDeleteRing ? 0.6 : isGrabbed ? 0.35 : 0}
                />
              </mesh>
            )}

            {/* Merged Translucent SVG Fills (e.g. tinted glass interior of resistors / op-amps) */}
            {bundle.translucentGeometry && (
              <mesh geometry={bundle.translucentGeometry}>
                <meshStandardMaterial
                  vertexColors
                  transparent
                  opacity={0.34}
                  roughness={0.22}
                  metalness={0.08}
                  depthWrite={false}
                />
              </mesh>
            )}

            {/* Pure-Relief Invisible Forgiving Grab Hitbox (when wafer backing is hidden) */}
            {!bundle.waferGeometry && (
              <mesh
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredBody(true);
                  pulseEventHaptic(e, 0.06, 5);
                  onHoverNodeChange?.(nodeId);
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  setHoveredBody(false);
                  onHoverNodeChange?.(null);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onStartNodeGrab?.(nodeId, e);
                }}
              >
                <boxGeometry args={[bundle.widthMeters * 0.96, bundle.heightMeters * 0.96, 0.022]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
          </>
        )}

        {/* Crisp Stereo-Safe Nameplate Mounted Below Component */}
        {nameplateTex && (
          <mesh position={[0, -bundle.heightMeters * 0.5 - 0.022, 0.004]}>
            <planeGeometry args={[0.128, 0.032]} />
            <meshBasicMaterial map={nameplateTex} transparent depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* Physical 3D Port Terminal Sockets (Always Higher Grab Priority Than Component Body) */}
        {ports.map((port) => {
          const portKey = makePortKey(port.nodeId, port.portId);
          const hl = portHighlights?.get(portKey);
          const isPortHovered = hoveredPortId === port.portId;
          const isSnapped = Boolean(hl?.snapped);
          const isRejected = Boolean(hl?.rejected);
          const isSource = Boolean(hl?.isSource);
          const approach = hl?.approach01 ?? 0;

          const socketScale = isSnapped
            ? 1.52
            : isSource || isPortHovered
              ? 1.38
              : approach > 0.01
                ? 1 + approach * 0.34
                : 1.0;

          const socketColor = isSnapped
            ? "#10b981"
            : isRejected
              ? "#f59e0b"
              : isSource || isPortHovered
                ? "#22d3ee"
                : port.color;

          const isNegativeOrOutput = port.polarity === "negative" || port.polarity === "output";
          const isSignalCone = port.domain === "signal";
          const isMechanicalBoss = port.domain === "mechanical";
          const coneRotZ =
            port.localNormal[0] > 0.5
              ? -Math.PI / 2
              : port.localNormal[0] < -0.5
                ? Math.PI / 2
                : port.localNormal[1] > 0.5
                  ? 0
                  : Math.PI;

          return (
            <group
              key={port.portId}
              name={`spatial-port-${port.nodeId}-${port.portId}`}
              position={port.localPosition}
              scale={socketScale}
            >
              {/* Generous Invisible Spherical Grab Target (3.2 cm radius) for Effortless VR Wiring */}
              <mesh
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredPortId(port.portId);
                  pulseEventHaptic(e, 0.12, 8);
                  onHoverPortChange?.(port);
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  setHoveredPortId((prev) => (prev === port.portId ? null : prev));
                  onHoverPortChange?.(null);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onStartPortWireDrag?.(port, e);
                }}
              >
                <sphereGeometry args={[0.032, 12, 10]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>

              {/* Tactile Domain-Coded 3D Terminal Body */}
              {isSignalCone ? (
                <mesh rotation={[0, 0, coneRotZ]}>
                  <coneGeometry args={[0.0085, 0.016, 4]} />
                  <meshStandardMaterial
                    color={isNegativeOrOutput && !isSnapped ? "#f8fafc" : socketColor}
                    emissive={socketColor}
                    emissiveIntensity={isSnapped || isSource || isPortHovered ? 0.9 : 0.25}
                    roughness={0.26}
                    metalness={0.35}
                  />
                </mesh>
              ) : isMechanicalBoss ? (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.0088, 0.0088, 0.013, 14]} />
                  <meshStandardMaterial
                    color={isNegativeOrOutput && !isSnapped ? "#e2e8f0" : socketColor}
                    emissive={socketColor}
                    emissiveIntensity={isSnapped || isSource || isPortHovered ? 0.9 : 0.2}
                    roughness={0.24}
                    metalness={0.62}
                  />
                </mesh>
              ) : (
                <mesh>
                  <boxGeometry args={[0.0145, 0.0145, 0.0145]} />
                  <meshStandardMaterial
                    color={isNegativeOrOutput && !isSnapped ? "#ffffff" : socketColor}
                    emissive={socketColor}
                    emissiveIntensity={isSnapped || isSource || isPortHovered ? 0.95 : 0.25}
                    roughness={0.25}
                    metalness={0.38}
                  />
                </mesh>
              )}

              {/* Metallic Terminal Collar Ring */}
              <mesh position={[0, 0, 0.004]}>
                <ringGeometry args={[0.0095, 0.0128, 20]} />
                <meshBasicMaterial
                  color={socketColor}
                  transparent
                  opacity={isSnapped || isPortHovered || approach > 0.05 ? 0.95 : 0.55}
                  side={THREE.DoubleSide}
                />
              </mesh>

              {/* Hover / Magnetic Approach & Capture Field Halo Ring (pre-mounted via visible for zero XR hitch) */}
              <mesh position={[0, 0, 0.006]} visible={approach > 0.02 || isSnapped || isRejected || isPortHovered}>
                <ringGeometry args={[isSnapped ? 0.015 : 0.017, isSnapped ? 0.024 : 0.023, 24]} />
                <meshBasicMaterial
                  color={isSnapped ? "#10b981" : isRejected ? "#f59e0b" : "#22d3ee"}
                  transparent
                  opacity={isSnapped ? 0.95 : isRejected ? 0.88 : isPortHovered ? 0.82 : 0.3 + approach * 0.6}
                  toneMapped={false}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}
