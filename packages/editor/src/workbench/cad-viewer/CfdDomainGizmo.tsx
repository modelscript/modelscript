// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CfdDomainGizmo
 *
 * React Three Fiber 3D scene overlay rendering:
 * 1. External CFD wind-tunnel computational domain wireframe box with
 *    translucent inlet (cyan) and outlet (amber) face quads and 3D flow arrows.
 * 2. Optional 2:1 Octree / AMR local refinement region wireframe boxes.
 * 3. Optional non-manifold / naked-edge diagnostic line segments for CAD healing inspection.
 */

import { Html } from "@react-three/drei";
import React, { useEffect, useMemo } from "react";
import * as THREE from "three";

export interface CfdRefinementBox {
  id: string;
  label?: string | undefined;
  level: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface CfdDomainGizmoProps {
  /** Minimum corner [x, y, z] of the external CFD wind-tunnel domain. */
  domainMin: [number, number, number];
  /** Maximum corner [x, y, z] of the external CFD wind-tunnel domain. */
  domainMax: [number, number, number];
  /** Optional 2:1 Octree / AMR local refinement regions. */
  refinementBoxes?: CfdRefinementBox[] | undefined;
  /** Optional interleaved line-segment vertices [x1,y1,z1, x2,y2,z2, ...] for naked / non-manifold CAD edges. */
  nakedEdgeSegments?: Float32Array | undefined;
  /** Toggle visibility of the entire gizmo overlay. Defaults to true. */
  visible?: boolean | undefined;
  /** Toggle 3D billboarded Inlet/Outlet and AMR level labels. Defaults to true. */
  showLabels?: boolean | undefined;
  /** Opacity of the translucent inlet and outlet face quads. Defaults to 0.16. */
  faceOpacity?: number | undefined;
  /** Primary freestream flow axis. Defaults to "x" (-X inlet -> +X outlet). */
  flowAxis?: "x" | "y" | "z" | undefined;
}

const REFINEMENT_LEVEL_COLORS: readonly string[] = [
  "#10b981", // Level 1 — emerald
  "#8b5cf6", // Level 2 — violet
  "#ec4899", // Level 3 — pink
  "#f43f5e", // Level 4+ — rose
];

const INLET_COLOR = "#06b6d4"; // cyan-500
const OUTLET_COLOR = "#f59e0b"; // amber-500
const DOMAIN_WIRE_COLOR = "#64748b"; // slate-500
const NAKED_EDGE_COLOR = "#ef4444"; // red-500

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function getRefinementColor(level: number): string {
  const idx = Math.max(0, Math.min(REFINEMENT_LEVEL_COLORS.length - 1, Math.floor(level) - 1));
  return REFINEMENT_LEVEL_COLORS[idx] ?? "#8b5cf6";
}

function computeBoxMetrics(min: [number, number, number], max: [number, number, number]) {
  const sx = Math.max(1e-5, Math.abs(max[0] - min[0]));
  const sy = Math.max(1e-5, Math.abs(max[1] - min[1]));
  const sz = Math.max(1e-5, Math.abs(max[2] - min[2]));
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;
  return {
    size: [sx, sy, sz] as [number, number, number],
    center: [cx, cy, cz] as [number, number, number],
  };
}

/**
 * Renders a single 3D flow direction arrow (shaft cylinder + cone head)
 * oriented along a unit direction vector.
 */
const FlowArrow3D: React.FC<{
  position: [number, number, number];
  direction: [number, number, number];
  length: number;
  color: string;
}> = ({ position, direction, length, color }) => {
  const { quaternion, shaftLen, headLen, shaftRadius, headRadius } = useMemo(() => {
    const dir = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(UP_AXIS, dir);
    const sLen = length * 0.68;
    const hLen = length * 0.32;
    const sRad = Math.max(length * 0.045, 1e-4);
    const hRad = Math.max(length * 0.13, 3e-4);
    return {
      quaternion: quat,
      shaftLen: sLen,
      headLen: hLen,
      shaftRadius: sRad,
      headRadius: hRad,
    };
  }, [direction, length]);

  return (
    <group position={position} quaternion={quaternion}>
      <mesh position={[0, -headLen * 0.5, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftLen, 10]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.45}
          roughness={0.3}
          metalness={0.1}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh position={[0, shaftLen * 0.5, 0]}>
        <coneGeometry args={[headRadius, headLen, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.55}
          roughness={0.25}
          metalness={0.1}
          transparent
          opacity={0.95}
        />
      </mesh>
    </group>
  );
};

/**
 * Renders a single 2:1 Octree / AMR local refinement wireframe region.
 */
const RefinementRegionBox: React.FC<{
  box: CfdRefinementBox;
  showLabels: boolean;
}> = ({ box, showLabels }) => {
  const { size, center } = useMemo(() => computeBoxMetrics(box.min, box.max), [box.min, box.max]);

  const edgesGeometry = useMemo(() => {
    const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const edges = new THREE.EdgesGeometry(boxGeo);
    boxGeo.dispose();
    return edges;
  }, [size]);

  useEffect(() => {
    return () => {
      edgesGeometry.dispose();
    };
  }, [edgesGeometry]);

  const color = getRefinementColor(box.level);
  const tagText = box.label ? `${box.label} (L${box.level})` : `AMR L${box.level}`;

  return (
    <group name={`cfd-refinement-box-${box.id}`} position={center}>
      <lineSegments geometry={edgesGeometry} renderOrder={6}>
        <lineBasicMaterial color={color} transparent opacity={0.9} />
      </lineSegments>
      <mesh renderOrder={4}>
        <boxGeometry args={size} />
        <meshBasicMaterial color={color} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {showLabels && (
        <Html position={[0, size[1] * 0.5, 0]} center distanceFactor={18}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.85)",
              backdropFilter: "blur(4px)",
              border: `1px solid ${color}`,
              borderRadius: "4px",
              padding: "1px 6px",
              color: "#f8fafc",
              fontSize: "10px",
              fontFamily: "monospace",
              fontWeight: 600,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {tagText}
          </div>
        </Html>
      )}
    </group>
  );
};

/**
 * Renders non-manifold / naked-edge diagnostic line segments in bright red.
 */
const NakedEdgesOverlay: React.FC<{
  segments: Float32Array;
}> = ({ segments }) => {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(segments, 3));
    return geo;
  }, [segments]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  if (segments.length < 6) return null;

  return (
    <lineSegments name="cfd-naked-edge-diagnostics" geometry={geometry} renderOrder={20}>
      <lineBasicMaterial color={NAKED_EDGE_COLOR} transparent opacity={0.95} depthTest={false} />
    </lineSegments>
  );
};

/**
 * CfdDomainGizmo — 3D overlay for CFD wind-tunnel domain bounds,
 * Octree/AMR refinement regions, and CAD naked-edge diagnostics.
 */
export const CfdDomainGizmo: React.FC<CfdDomainGizmoProps> = ({
  domainMin,
  domainMax,
  refinementBoxes,
  nakedEdgeSegments,
  visible = true,
  showLabels = true,
  faceOpacity = 0.16,
  flowAxis = "x",
}) => {
  const { size, center } = useMemo(() => computeBoxMetrics(domainMin, domainMax), [domainMin, domainMax]);

  const domainEdgesGeometry = useMemo(() => {
    const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const edges = new THREE.EdgesGeometry(boxGeo);
    boxGeo.dispose();
    return edges;
  }, [size]);

  useEffect(() => {
    return () => {
      domainEdgesGeometry.dispose();
    };
  }, [domainEdgesGeometry]);

  const faceConfig = useMemo(() => {
    const [sx, sy, sz] = size;
    const [cx, cy, cz] = center;
    const charLen = Math.max(sx, sy, sz);
    const arrowLength = Math.max(charLen * 0.12, 0.05);

    if (flowAxis === "y") {
      return {
        inletPos: [cx, domainMin[1], cz] as [number, number, number],
        outletPos: [cx, domainMax[1], cz] as [number, number, number],
        planeRotation: [-Math.PI / 2, 0, 0] as [number, number, number],
        planeSize: [sx, sz] as [number, number],
        flowDir: [0, 1, 0] as [number, number, number],
        inletArrows: [
          [cx - sx * 0.22, domainMin[1] + arrowLength * 0.65, cz] as [number, number, number],
          [cx, domainMin[1] + arrowLength * 0.65, cz] as [number, number, number],
          [cx + sx * 0.22, domainMin[1] + arrowLength * 0.65, cz] as [number, number, number],
        ],
        outletArrows: [[cx, domainMax[1] - arrowLength * 0.65, cz] as [number, number, number]],
        inletLabelPos: [cx, domainMin[1], cz + sz * 0.5] as [number, number, number],
        outletLabelPos: [cx, domainMax[1], cz + sz * 0.5] as [number, number, number],
        arrowLength,
      };
    }

    if (flowAxis === "z") {
      return {
        inletPos: [cx, cy, domainMin[2]] as [number, number, number],
        outletPos: [cx, cy, domainMax[2]] as [number, number, number],
        planeRotation: [0, 0, 0] as [number, number, number],
        planeSize: [sx, sy] as [number, number],
        flowDir: [0, 0, 1] as [number, number, number],
        inletArrows: [
          [cx - sx * 0.22, cy, domainMin[2] + arrowLength * 0.65] as [number, number, number],
          [cx, cy, domainMin[2] + arrowLength * 0.65] as [number, number, number],
          [cx + sx * 0.22, cy, domainMin[2] + arrowLength * 0.65] as [number, number, number],
        ],
        outletArrows: [[cx, cy, domainMax[2] - arrowLength * 0.65] as [number, number, number]],
        inletLabelPos: [cx, cy + sy * 0.5, domainMin[2]] as [number, number, number],
        outletLabelPos: [cx, cy + sy * 0.5, domainMax[2]] as [number, number, number],
        arrowLength,
      };
    }

    // Default: "x" axis (-X inlet -> +X outlet)
    return {
      inletPos: [domainMin[0], cy, cz] as [number, number, number],
      outletPos: [domainMax[0], cy, cz] as [number, number, number],
      planeRotation: [0, Math.PI / 2, 0] as [number, number, number],
      planeSize: [sz, sy] as [number, number],
      flowDir: [1, 0, 0] as [number, number, number],
      inletArrows: [
        [domainMin[0] + arrowLength * 0.65, cy + sy * 0.22, cz] as [number, number, number],
        [domainMin[0] + arrowLength * 0.65, cy, cz] as [number, number, number],
        [domainMin[0] + arrowLength * 0.65, cy - sy * 0.22, cz] as [number, number, number],
      ],
      outletArrows: [[domainMax[0] - arrowLength * 0.65, cy, cz] as [number, number, number]],
      inletLabelPos: [domainMin[0], cy + sy * 0.5, cz] as [number, number, number],
      outletLabelPos: [domainMax[0], cy + sy * 0.5, cz] as [number, number, number],
      arrowLength,
    };
  }, [size, center, domainMin, domainMax, flowAxis]);

  if (!visible) return null;

  return (
    <group name="cfd-domain-gizmo">
      {/* External Wind-Tunnel Wireframe Box */}
      <lineSegments position={center} geometry={domainEdgesGeometry} renderOrder={5}>
        <lineBasicMaterial color={DOMAIN_WIRE_COLOR} transparent opacity={0.85} />
      </lineSegments>

      {/* Translucent Inlet Face Quad (Cyan) */}
      <mesh position={faceConfig.inletPos} rotation={faceConfig.planeRotation} renderOrder={3}>
        <planeGeometry args={faceConfig.planeSize} />
        <meshBasicMaterial
          color={INLET_COLOR}
          transparent
          opacity={faceOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Translucent Outlet Face Quad (Amber) */}
      <mesh position={faceConfig.outletPos} rotation={faceConfig.planeRotation} renderOrder={3}>
        <planeGeometry args={faceConfig.planeSize} />
        <meshBasicMaterial
          color={OUTLET_COLOR}
          transparent
          opacity={faceOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* 3D Flow Direction Arrows — Inlet */}
      {faceConfig.inletArrows.map((pos, idx) => (
        <FlowArrow3D
          key={`inlet-arrow-${idx}`}
          position={pos}
          direction={faceConfig.flowDir}
          length={faceConfig.arrowLength}
          color={INLET_COLOR}
        />
      ))}

      {/* 3D Flow Direction Arrows — Outlet */}
      {faceConfig.outletArrows.map((pos, idx) => (
        <FlowArrow3D
          key={`outlet-arrow-${idx}`}
          position={pos}
          direction={faceConfig.flowDir}
          length={faceConfig.arrowLength}
          color={OUTLET_COLOR}
        />
      ))}

      {/* Optional 3D Labels for Inlet / Outlet */}
      {showLabels && (
        <>
          <Html position={faceConfig.inletLabelPos} center distanceFactor={20}>
            <div
              style={{
                background: "rgba(6, 78, 99, 0.88)",
                backdropFilter: "blur(4px)",
                border: `1px solid ${INLET_COLOR}`,
                borderRadius: "4px",
                padding: "2px 6px",
                color: "#ecfeff",
                fontSize: "10px",
                fontFamily: "monospace",
                fontWeight: 700,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              INLET
            </div>
          </Html>
          <Html position={faceConfig.outletLabelPos} center distanceFactor={20}>
            <div
              style={{
                background: "rgba(120, 53, 15, 0.88)",
                backdropFilter: "blur(4px)",
                border: `1px solid ${OUTLET_COLOR}`,
                borderRadius: "4px",
                padding: "2px 6px",
                color: "#fffbeb",
                fontSize: "10px",
                fontFamily: "monospace",
                fontWeight: 700,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              OUTLET
            </div>
          </Html>
        </>
      )}

      {/* Optional 2:1 Octree / AMR Local Refinement Regions */}
      {refinementBoxes &&
        refinementBoxes.map((box) => <RefinementRegionBox key={box.id} box={box} showLabels={showLabels} />)}

      {/* Optional Non-Manifold / Naked-Edge Diagnostic Segments */}
      {nakedEdgeSegments && nakedEdgeSegments.length >= 6 && <NakedEdgesOverlay segments={nakedEdgeSegments} />}
    </group>
  );
};
