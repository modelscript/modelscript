// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ZonotopeCadOverlay — 3D CAD Dual Ghost Tolerance Shells, Symmetry Coupling Calipers,
 * Crimson ξ* Breach Badges, and WAM Reachability Tube Overlay for CadViewer.
 */

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type React from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnsatzRelationalHypergraphRecord } from "../util/lsp-bridge";
import {
  buildCadGhostShellSpecs,
  buildSymmetryCouplingPair,
  buildWamReachabilityTubeRings,
  inferWamWaypointsFromSpecs,
  type CadGhostShellSpec,
  type WamTrajectoryWaypoint,
} from "../util/zonotope-3d-geometry";
import {
  getGeneratorColor,
  type LinearConstraintSpec,
  type ZonotopePendingOverride,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state";
import type { CadComponent } from "./CadViewer";

export interface ZonotopeCadOverlayProps {
  components: CadComponent[];
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  workbenchState: ZonotopeWorkbenchState;
  violatingComponents?: string[] | undefined;
  wamWaypoints?: WamTrajectoryWaypoint[] | undefined;
  onSelectGroup?: ((groupId: number | null) => void) | undefined;
  onAddOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  onChangeCadToleranceFraction?: ((nextFraction: number) => void) | undefined;
  onChangeWamWaypointRadius?: ((waypointIndex: number, nextRadius: number) => void) | undefined;
}

interface ActiveClearanceCaliper {
  id: string;
  partA: string;
  partB: string;
  posA: [number, number, number];
  posB: [number, number, number];
  sign: 1 | -1;
  groupId: number;
  minGap: number;
}

type ActiveDragSession =
  | {
      kind: "tolerance";
      startClientY: number;
      startFraction: number;
      componentName: string;
    }
  | {
      kind: "wam-radius";
      startClientY: number;
      startRadius: number;
      waypointIndex: number;
    };

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function ShellPrimitiveGeometry({
  shapeKind,
  dimensions,
}: {
  shapeKind: CadGhostShellSpec["shapeKind"];
  dimensions: [number, number, number];
}) {
  const [dx, dy, dz] = dimensions;
  if (shapeKind === "cylinder") {
    const radius = Math.max(0.05, Math.max(dx, dz) * 0.5);
    return <cylinderGeometry args={[radius, radius, Math.max(0.05, dy), 24]} />;
  }
  if (shapeKind === "sphere") {
    const radius = Math.max(0.05, Math.max(dx, dy, dz) * 0.5);
    return <sphereGeometry args={[radius, 24, 18]} />;
  }
  return <boxGeometry args={[Math.max(0.05, dx), Math.max(0.05, dy), Math.max(0.05, dz)]} />;
}

interface DualGhostShellProps {
  spec: CadGhostShellSpec;
  isGroupActive: boolean;
  isAnchorArmed: boolean;
  isToleranceBrush: boolean;
  draggingToleranceFraction: number | null;
  onShellClick: (spec: CadGhostShellSpec, shiftKey: boolean) => void;
  onTolerancePointerDown: (spec: CadGhostShellSpec, startClientY: number) => void;
}

const DualGhostShell: React.FC<DualGhostShellProps> = ({
  spec,
  isGroupActive,
  isAnchorArmed,
  isToleranceBrush,
  draggingToleranceFraction,
  onShellClick,
  onTolerancePointerDown,
}) => {
  const probeMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const swatch = useMemo(() => getGeneratorColor(spec.groupId), [spec.groupId]);
  const probeColor = spec.isViolating ? "#f43f5e" : swatch.solid;
  const baseProbeOpacity = spec.isViolating ? 0.34 : isGroupActive || isAnchorArmed ? 0.32 : 0.14;
  const isDraggingTolerance = draggingToleranceFraction !== null;

  useFrame((state) => {
    if (spec.isViolating && probeMatRef.current) {
      probeMatRef.current.opacity = 0.24 + 0.22 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 5.0));
    }
  });

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onShellClick(spec, Boolean(e.nativeEvent.shiftKey));
    },
    [onShellClick, spec],
  );

  const handleOuterPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isToleranceBrush) return;
      e.stopPropagation();
      onTolerancePointerDown(spec, e.nativeEvent.clientY);
    },
    [isToleranceBrush, onTolerancePointerDown, spec],
  );

  const badgeHeight =
    Math.max(spec.dimensions[1] * Math.abs(spec.baseScale[1]) * spec.outerScale[1] * 0.5, 0.25) + 0.22;

  return (
    <group
      name={`zonotope-shell:${spec.componentName}`}
      position={spec.position}
      rotation={spec.rotation}
      scale={spec.baseScale}
    >
      {/* ξ = -1 Inner Bound Shell (Cyan wireframe/translucent) */}
      <mesh scale={spec.innerScale} renderOrder={7}>
        <ShellPrimitiveGeometry shapeKind={spec.shapeKind} dimensions={spec.dimensions} />
        <meshStandardMaterial
          color="#22d3ee"
          emissive="#06b6d4"
          emissiveIntensity={0.25}
          transparent
          opacity={0.22}
          wireframe
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* ξ = +1 Outer Bound Shell (Amber translucent; push/pull drag target in tolerance-handle brush) */}
      <mesh scale={spec.outerScale} renderOrder={8} onPointerDown={handleOuterPointerDown}>
        <ShellPrimitiveGeometry shapeKind={spec.shapeKind} dimensions={spec.dimensions} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#d97706"
          emissiveIntensity={isDraggingTolerance ? 0.5 : isToleranceBrush ? 0.32 : 0.2}
          transparent
          opacity={isDraggingTolerance ? 0.34 : isToleranceBrush ? 0.26 : 0.18}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Active Probe Shell at interpolated ξ_k (interactive click target) */}
      <mesh scale={spec.probeScale} renderOrder={9} onClick={handleClick}>
        <ShellPrimitiveGeometry shapeKind={spec.shapeKind} dimensions={spec.dimensions} />
        <meshStandardMaterial
          ref={probeMatRef}
          color={probeColor}
          emissive={probeColor}
          emissiveIntensity={spec.isViolating ? 0.55 : isGroupActive || isAnchorArmed ? 0.4 : 0.18}
          transparent
          opacity={baseProbeOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Crimson Breach Tag for ξ* violations */}
      {spec.isViolating && (
        <Html position={[0, badgeHeight, 0]} center distanceFactor={14}>
          <div
            title={spec.violationReason ?? "Worst-case ξ* tolerance breach"}
            style={{
              background: "rgba(159, 18, 57, 0.92)",
              border: "1px solid #fb7185",
              borderRadius: "999px",
              padding: "2px 8px",
              color: "#fff1f2",
              fontSize: "10px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 700,
              whiteSpace: "nowrap",
              boxShadow: "0 2px 10px rgba(244, 63, 94, 0.45)",
              pointerEvents: "none",
            }}
          >
            ⚠ ξ* Breach
          </div>
        </Html>
      )}

      {/* Live readout during 3D Tolerance Push/Pull Drag */}
      {draggingToleranceFraction !== null && (
        <Html position={[0, badgeHeight + (spec.isViolating ? 0.28 : 0), 0]} center distanceFactor={14}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.94)",
              border: "1px solid #fbbf24",
              borderRadius: "999px",
              padding: "2px 8px",
              color: "#fef3c7",
              fontSize: "10px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 700,
              whiteSpace: "nowrap",
              boxShadow: "0 2px 10px rgba(251, 191, 36, 0.4)",
              pointerEvents: "none",
            }}
          >
            Drag ±ε_3d: ±{Math.round(draggingToleranceFraction * 100)}%
          </div>
        </Html>
      )}

      {/* Subtle armed-anchor badge while waiting for second component click */}
      {isAnchorArmed && !spec.isViolating && draggingToleranceFraction === null && (
        <Html position={[0, badgeHeight, 0]} center distanceFactor={14}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.9)",
              border: `1px solid ${swatch.solid}`,
              borderRadius: "999px",
              padding: "2px 7px",
              color: "#e2e8f0",
              fontSize: "10px",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            ε_{spec.groupId} anchor · Shift+click target
          </div>
        </Html>
      )}
    </group>
  );
};

const ClearanceCaliperLine: React.FC<{ caliper: ActiveClearanceCaliper }> = ({ caliper }) => {
  const color = caliper.sign > 0 ? "#38bdf8" : "#f472b6";

  const { lineObj, geometry, material, midpoint, distance } = useMemo(() => {
    const p1 = new THREE.Vector3(...caliper.posA);
    const p2 = new THREE.Vector3(...caliper.posB);
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineDashedMaterial({
      color,
      dashSize: 0.08,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    const mid: [number, number, number] = [(p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5 + 0.08, (p1.z + p2.z) * 0.5];
    return {
      lineObj: line,
      geometry: geo,
      material: mat,
      midpoint: mid,
      distance: p1.distanceTo(p2),
    };
  }, [caliper.posA, caliper.posB, color]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <group name={`zonotope-caliper:${caliper.partA}:${caliper.partB}`}>
      <primitive object={lineObj} />
      <mesh position={caliper.posA}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
      <mesh position={caliper.posB}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
      <Html position={midpoint} center distanceFactor={14}>
        <div
          style={{
            background: "rgba(15, 23, 42, 0.9)",
            border: `1px solid ${color}`,
            borderRadius: "6px",
            padding: "2px 7px",
            color: "#f8fafc",
            fontSize: "10px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontWeight: 600,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.45)",
            pointerEvents: "none",
          }}
        >
          ε_{caliper.groupId} {caliper.sign > 0 ? "+1 SYNC" : "-1 MIRROR"} · gap {distance.toFixed(2)} ≥{" "}
          {caliper.minGap.toFixed(1)}
        </div>
      </Html>
    </group>
  );
};

interface WamReachabilityTubeProps {
  waypoints: WamTrajectoryWaypoint[];
  stressScale: number;
  activeGroupId: number | null;
  draggingWaypointIndex: number | null;
  draggingWaypointRadius: number | null;
  onSelectGroup?: ((groupId: number | null) => void) | undefined;
  onRingPointerDown: (waypointIndex: number, startRadius: number, startClientY: number) => void;
}

const WamReachabilityTube: React.FC<WamReachabilityTubeProps> = ({
  waypoints,
  stressScale,
  activeGroupId,
  draggingWaypointIndex,
  draggingWaypointRadius,
  onSelectGroup,
  onRingPointerDown,
}) => {
  const tubeData = useMemo(() => buildWamReachabilityTubeRings(waypoints, stressScale, 18), [waypoints, stressScale]);

  const geometry = useMemo(() => {
    if (tubeData.vertices.length === 0 || tubeData.indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tubeData.vertices), 3));
    geo.setIndex(tubeData.indices);
    geo.computeVertexNormals();
    return geo;
  }, [tubeData]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  const ringHandles = useMemo(() => {
    const n = tubeData.centers.length;
    return tubeData.centers.map((center, i) => {
      const prev = i > 0 ? tubeData.centers[i - 1]! : center;
      const next = i < n - 1 ? tubeData.centers[i + 1]! : center;
      const tangent = new THREE.Vector3(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
      const quat = new THREE.Quaternion();
      if (tangent.lengthSq() > 1e-8) {
        quat.setFromUnitVectors(Z_AXIS, tangent.normalize());
      }
      const radius = tubeData.radii[i] ?? 0.1;
      const baseRadius = waypoints[i]?.radius ?? radius;
      const groupId = waypoints[i]?.groupId ?? i + 1;
      return { center, quat, radius, baseRadius, groupId };
    });
  }, [tubeData, waypoints]);

  if (!geometry) return null;

  return (
    <group name="zonotope-wam-reachability-tube">
      <mesh geometry={geometry} renderOrder={10}>
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#8b5cf6"
          emissiveIntensity={0.28}
          transparent
          opacity={0.24}
          roughness={0.25}
          metalness={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {ringHandles.map((handle, idx) => {
        const swatch = getGeneratorColor(handle.groupId);
        const isActive = activeGroupId === handle.groupId;
        const isDragging = draggingWaypointIndex === idx;
        const tubeThickness = Math.max(0.012, Math.min(0.06, handle.radius * 0.08));
        return (
          <Fragment key={`wam-ring-${idx}-${handle.groupId}`}>
            <mesh
              position={handle.center}
              quaternion={handle.quat}
              renderOrder={11}
              onPointerDown={(e) => {
                e.stopPropagation();
                onRingPointerDown(idx, handle.baseRadius, e.nativeEvent.clientY);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectGroup?.(handle.groupId);
              }}
            >
              <torusGeometry args={[handle.radius, tubeThickness, 10, 28]} />
              <meshStandardMaterial
                color={swatch.solid}
                emissive={swatch.solid}
                emissiveIntensity={isDragging ? 1.0 : isActive ? 0.85 : 0.4}
                transparent
                opacity={isDragging ? 1.0 : isActive ? 0.95 : 0.7}
              />
            </mesh>
            {isDragging && draggingWaypointRadius !== null && (
              <Html
                position={[handle.center[0], handle.center[1] + handle.radius + 0.16, handle.center[2]]}
                center
                distanceFactor={14}
              >
                <div
                  style={{
                    background: "rgba(15, 23, 42, 0.94)",
                    border: `1px solid ${swatch.solid}`,
                    borderRadius: "999px",
                    padding: "2px 8px",
                    color: "#f8fafc",
                    fontSize: "10px",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    boxShadow: "0 2px 10px rgba(56, 189, 248, 0.4)",
                    pointerEvents: "none",
                  }}
                >
                  r = {draggingWaypointRadius.toFixed(2)}m
                </div>
              </Html>
            )}
          </Fragment>
        );
      })}
    </group>
  );
};

export const ZonotopeCadOverlay: React.FC<ZonotopeCadOverlayProps> = ({
  components,
  hypergraphRecord = null,
  workbenchState,
  violatingComponents,
  wamWaypoints,
  onSelectGroup,
  onAddOverride,
  onAddConstraint,
  onChangeCadToleranceFraction,
  onChangeWamWaypointRadius,
}) => {
  const [anchorComponentName, setAnchorComponentName] = useState<string | null>(null);
  const [calipers, setCalipers] = useState<ActiveClearanceCaliper[]>([]);
  const [radiusOverrides, setRadiusOverrides] = useState<Record<number, number>>({});
  const [toleranceDragBadge, setToleranceDragBadge] = useState<{
    componentName: string;
    fraction: number;
  } | null>(null);
  const [wamDragBadge, setWamDragBadge] = useState<{
    waypointIndex: number;
    radius: number;
  } | null>(null);

  const dragStateRef = useRef<ActiveDragSession | null>(null);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);
  const onChangeCadToleranceFractionRef = useRef(onChangeCadToleranceFraction);
  const onChangeWamWaypointRadiusRef = useRef(onChangeWamWaypointRadius);
  onChangeCadToleranceFractionRef.current = onChangeCadToleranceFraction;
  onChangeWamWaypointRadiusRef.current = onChangeWamWaypointRadius;

  useEffect(() => {
    return () => {
      cleanupDragListenersRef.current?.();
      dragStateRef.current = null;
    };
  }, []);

  const attachWindowDragListeners = useCallback((session: ActiveDragSession) => {
    cleanupDragListenersRef.current?.();
    dragStateRef.current = session;

    if (typeof window === "undefined") {
      return;
    }

    const handlePointerMove = (ev: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current) return;
      const deltaY = ev.clientY - current.startClientY;

      if (current.kind === "tolerance") {
        const raw = clampNumber(current.startFraction + -deltaY * 0.0012, 0.01, 0.25);
        const nextFraction = Math.round(raw * 1000) / 1000;
        setToleranceDragBadge({ componentName: current.componentName, fraction: nextFraction });
        onChangeCadToleranceFractionRef.current?.(nextFraction);
        return;
      }

      const raw = clampNumber(current.startRadius + -deltaY * 0.004, 0.04, 1.5);
      const nextRadius = Math.round(raw * 1000) / 1000;
      setRadiusOverrides((prev) =>
        prev[current.waypointIndex] === nextRadius ? prev : { ...prev, [current.waypointIndex]: nextRadius },
      );
      setWamDragBadge({ waypointIndex: current.waypointIndex, radius: nextRadius });
      onChangeWamWaypointRadiusRef.current?.(current.waypointIndex, nextRadius);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      cleanupDragListenersRef.current = null;
    };

    const handlePointerUp = () => {
      cleanup();
      dragStateRef.current = null;
      setToleranceDragBadge(null);
      setWamDragBadge(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    cleanupDragListenersRef.current = cleanup;
  }, []);

  const handleTolerancePointerDown = useCallback(
    (spec: CadGhostShellSpec, startClientY: number) => {
      if (workbenchState.activeBrush !== "tolerance-handle") return;
      const startFraction = clampNumber(workbenchState.budgets.cadToleranceFraction, 0.01, 0.25);
      setWamDragBadge(null);
      setToleranceDragBadge({ componentName: spec.componentName, fraction: startFraction });
      attachWindowDragListeners({
        kind: "tolerance",
        startClientY,
        startFraction,
        componentName: spec.componentName,
      });
    },
    [attachWindowDragListeners, workbenchState.activeBrush, workbenchState.budgets.cadToleranceFraction],
  );

  const handleWamRingPointerDown = useCallback(
    (waypointIndex: number, startRadius: number, startClientY: number) => {
      const clampedStart = clampNumber(startRadius, 0.04, 1.5);
      setToleranceDragBadge(null);
      setWamDragBadge({ waypointIndex, radius: clampedStart });
      attachWindowDragListeners({
        kind: "wam-radius",
        startClientY,
        startRadius: clampedStart,
        waypointIndex,
      });
    },
    [attachWindowDragListeners],
  );

  const specs = useMemo(
    () => buildCadGhostShellSpecs(components, hypergraphRecord ?? null, workbenchState, violatingComponents),
    [components, hypergraphRecord, workbenchState, violatingComponents],
  );

  const specByName = useMemo(() => {
    const map = new Map<string, CadGhostShellSpec>();
    for (const s of specs) {
      map.set(s.componentName, s);
    }
    return map;
  }, [specs]);

  const effectiveWamWaypoints = useMemo(() => {
    if (wamWaypoints && wamWaypoints.length >= 2) {
      return wamWaypoints;
    }
    if (components.length >= 2) {
      const inferred = inferWamWaypointsFromSpecs(specs);
      if (inferred.length >= 2) return inferred;
    }
    return [];
  }, [wamWaypoints, components.length, specs]);

  const mergedWamWaypoints = useMemo(() => {
    if (effectiveWamWaypoints.length === 0) return [];
    const overrideKeys = Object.keys(radiusOverrides);
    if (overrideKeys.length === 0) return effectiveWamWaypoints;
    return effectiveWamWaypoints.map((wp, idx) => {
      const override = radiusOverrides[idx];
      return override !== undefined ? { ...wp, radius: override } : wp;
    });
  }, [effectiveWamWaypoints, radiusOverrides]);

  const handleShellClick = useCallback(
    (clickedSpec: CadGhostShellSpec, shiftKey: boolean) => {
      const brush = workbenchState.activeBrush;

      // 1. Lock-Zero brush immediately locks the component at groupId = 0
      if (brush === "lock-zero") {
        onAddOverride?.({
          id: `cad-lock-${clickedSpec.componentName}`,
          symbolName: clickedSpec.componentName,
          textSnippet: clickedSpec.componentName,
          groupId: 0,
          relTypeId: 0,
          relSign: 0,
          modality: "3d",
          note: "Locked rigid (groupId=0) via 3D CAD overlay",
        });
        onSelectGroup?.(0);
        setAnchorComponentName(null);
        return;
      }

      const anchorSpec = anchorComponentName ? specByName.get(anchorComponentName) : undefined;
      const isCouplingBrush = brush === "couple-pos" || brush === "couple-neg" || brush === "tolerance-handle";

      // 2. Second component click completes symmetry coupling + clearance caliper
      if (
        anchorSpec &&
        anchorSpec.componentName !== clickedSpec.componentName &&
        (shiftKey || brush === "couple-pos" || brush === "couple-neg")
      ) {
        const sign: 1 | -1 = brush === "couple-neg" ? -1 : 1;
        const targetGroupId = anchorSpec.groupId > 0 ? anchorSpec.groupId : Math.max(1, clickedSpec.groupId);
        const minGap = 1.0;

        const pair = buildSymmetryCouplingPair(
          anchorSpec.componentName,
          clickedSpec.componentName,
          sign,
          targetGroupId,
          { minGap },
        );

        for (const ov of pair.overrides) {
          onAddOverride?.(ov);
        }
        if (pair.clearanceConstraint) {
          onAddConstraint?.(pair.clearanceConstraint);
        }

        const caliperId = `${anchorSpec.componentName}::${clickedSpec.componentName}`;
        setCalipers((prev) => [
          ...prev.filter((c) => c.id !== caliperId),
          {
            id: caliperId,
            partA: anchorSpec.componentName,
            partB: clickedSpec.componentName,
            posA: anchorSpec.position,
            posB: clickedSpec.position,
            sign,
            groupId: targetGroupId,
            minGap,
          },
        ]);

        onSelectGroup?.(targetGroupId);
        setAnchorComponentName(null);
        return;
      }

      // 3. First component click selects its generator group & arms coupling anchor
      onSelectGroup?.(clickedSpec.groupId);
      if (isCouplingBrush || brush === "select") {
        setAnchorComponentName(clickedSpec.componentName);
      }
    },
    [anchorComponentName, onAddConstraint, onAddOverride, onSelectGroup, specByName, workbenchState.activeBrush],
  );

  const isToleranceBrush = workbenchState.activeBrush === "tolerance-handle";

  return (
    <group name="zonotope-cad-overlay">
      {/* Dual Translucent Ghost Shells + Active Probe Shells + Breach Tags */}
      {specs.map((spec) => (
        <DualGhostShell
          key={spec.componentName}
          spec={spec}
          isGroupActive={workbenchState.activeGroupId === spec.groupId && spec.groupId > 0}
          isAnchorArmed={anchorComponentName === spec.componentName}
          isToleranceBrush={isToleranceBrush}
          draggingToleranceFraction={
            toleranceDragBadge && toleranceDragBadge.componentName === spec.componentName
              ? toleranceDragBadge.fraction
              : null
          }
          onShellClick={handleShellClick}
          onTolerancePointerDown={handleTolerancePointerDown}
        />
      ))}

      {/* 3D Dashed Clearance Calipers between Symmetry-Coupled Parts */}
      {calipers.map((caliper) => (
        <ClearanceCaliperLine key={caliper.id} caliper={caliper} />
      ))}

      {/* 3D WAM Reachability Tube + Draggable Waypoint Radius Ring Handles */}
      {mergedWamWaypoints.length >= 2 && (
        <WamReachabilityTube
          waypoints={mergedWamWaypoints}
          stressScale={workbenchState.stressScale}
          activeGroupId={workbenchState.activeGroupId}
          draggingWaypointIndex={wamDragBadge ? wamDragBadge.waypointIndex : null}
          draggingWaypointRadius={wamDragBadge ? wamDragBadge.radius : null}
          onSelectGroup={onSelectGroup}
          onRingPointerDown={handleWamRingPointerDown}
        />
      )}
    </group>
  );
};
