// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  DigitalTwinClearanceResult,
  DigitalTwinEnvironmentAsset,
  DigitalTwinToolpathTrace,
  UrdfVisualPose3D,
} from "@modelscript/urdf";
import { GizmoHelper, GizmoViewport, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import styled from "styled-components";
import * as THREE from "three";
import { resolveCssColor, useThemeTokens } from "../../theme-tokens";
import SafeOrbitControls from "./SafeOrbitControls";
import { DigitalTwinEnvironmentMesh, UrdfVisualMesh, urdfPoseToThree } from "./UrdfRobotCadMeshes";

export interface MultibodyNode3D {
  id: string;
  name: string;
  type: "body" | "marker" | "wheelset" | "track";
  position: [number, number, number];
  rotation?: [number, number, number] | undefined;
  rotationMatrix?: [number, number, number, number, number, number, number, number, number] | undefined;
  dimensions?: [number, number, number] | undefined;
  color?: string | undefined;
}

export interface MultibodyLink3D {
  id: string;
  name: string;
  type: "joint" | "spring_damper" | "rail";
  from: [number, number, number];
  to: [number, number, number];
  color?: string | undefined;
}

export type ViewportCameraPreset = "iso" | "front" | "side" | "top" | "focus" | "fit";

export interface MultibodyViewport3DProps {
  nodes: MultibodyNode3D[];
  links?: MultibodyLink3D[] | undefined;
  urdfVisuals?: UrdfVisualPose3D[] | undefined;
  urdfCollisions?: UrdfVisualPose3D[] | undefined;
  environment?: DigitalTwinEnvironmentAsset[] | undefined;
  toolpath?: DigitalTwinToolpathTrace | undefined;
  toolpaths?: DigitalTwinToolpathTrace[] | undefined;
  clearance?: DigitalTwinClearanceResult | undefined;
  tcpPosition?: [number, number, number] | null | undefined;
  gripperOpeningMm?: number | undefined;
  isFullScreen?: boolean | undefined;
  showPaths?: boolean | undefined;
  showColliders?: boolean | undefined;
  showFrames?: boolean | undefined;
  showGrid?: boolean | undefined;
  cameraPreset?: ViewportCameraPreset | undefined;
  cameraPresetTrigger?: number | undefined;
  height?: string | number | undefined;
}

const ViewportContainer = styled.div<{ $height: string | number }>`
  width: 100%;
  height: ${(p) => (typeof p.$height === "number" ? `${p.$height}px` : p.$height)};
  background: radial-gradient(
    circle at 50% 38%,
    var(--color-canvas-subtle, #1c232d) 0%,
    var(--color-canvas-default, #0d1117) 100%
  );
  border-radius: 6px;
  border: 1px solid var(--color-border-default, #30363d);
  overflow: hidden;
  position: relative;
`;

const FallbackContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-fg-muted, #8b949e);
  font-size: 13px;
  gap: 8px;
`;

const UP_AXIS = new THREE.Vector3(0, 1, 0);

function computeSegmentTransform(
  fromUrdf: [number, number, number],
  toUrdf: [number, number, number],
  radius: number,
): {
  position: [number, number, number];
  quaternion: THREE.Quaternion;
  scale: [number, number, number];
} | null {
  const [x1, y1, z1] = fromUrdf;
  const [x2, y2, z2] = toUrdf;
  const p1 = new THREE.Vector3(x1, z1, -y1);
  const p2 = new THREE.Vector3(x2, z2, -y2);
  const dir = p2.clone().sub(p1);
  const dist = dir.length();
  if (dist < 1e-5) return null;
  const mid = p1.add(p2).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP_AXIS, dir.divideScalar(dist));
  return {
    position: [mid.x, mid.y, mid.z],
    quaternion: quat,
    scale: [radius, dist, radius],
  };
}

const CameraPresetController: React.FC<{
  controlsRef: React.RefObject<any>;
  preset?: ViewportCameraPreset | undefined;
  trigger?: number | undefined;
  tcpPosition?: [number, number, number] | null | undefined;
  sceneScale?: number | undefined;
}> = ({ controlsRef, preset, trigger, tcpPosition, sceneScale = 1.0 }) => {
  const { camera } = useThree();

  useEffect(() => {
    if (!preset) return;
    const s = Math.max(0.25, Math.min(6.0, sceneScale));
    let targetX = 0;
    let targetY = 0.08 * s;
    let targetZ = 0;
    switch (preset) {
      case "iso":
        camera.position.set(1.28 * s, 0.92 * s, 1.48 * s);
        targetY = 0.08 * s;
        break;
      case "front":
        camera.position.set(0, 0.35 * s, 1.65 * s);
        targetY = 0.15 * s;
        break;
      case "side":
        camera.position.set(1.65 * s, 0.35 * s, 0);
        targetY = 0.15 * s;
        break;
      case "top":
        camera.position.set(0, 1.95 * s, 0.01);
        targetY = 0;
        break;
      case "focus":
        if (tcpPosition) {
          const [tx, ty, tz] = tcpPosition;
          camera.position.set(tx + 0.55 * s, tz + 0.42 * s, -ty + 0.65 * s);
          targetX = tx;
          targetY = tz;
          targetZ = -ty;
        } else {
          camera.position.set(0.75 * s, 0.65 * s, 0.85 * s);
          targetY = 0.25 * s;
        }
        break;
      case "fit":
        camera.position.set(1.42 * s, 1.02 * s, 1.62 * s);
        targetY = 0.06 * s;
        break;
    }
    camera.lookAt(targetX, targetY, targetZ);
    camera.updateProjectionMatrix();
    if (controlsRef.current) {
      controlsRef.current.target.set(targetX, targetY, targetZ);
      controlsRef.current.update();
    }
  }, [camera, controlsRef, preset, trigger, tcpPosition, sceneScale]);

  return null;
};

const SceneContent: React.FC<{
  nodes: MultibodyNode3D[];
  links: MultibodyLink3D[];
  urdfVisuals?: UrdfVisualPose3D[] | undefined;
  urdfCollisions?: UrdfVisualPose3D[] | undefined;
  environment?: DigitalTwinEnvironmentAsset[] | undefined;
  toolpath?: DigitalTwinToolpathTrace | undefined;
  toolpaths?: DigitalTwinToolpathTrace[] | undefined;
  clearance?: DigitalTwinClearanceResult | undefined;
  tcpPosition?: [number, number, number] | null | undefined;
  gripperOpeningMm?: number | undefined;
  isFullScreen?: boolean | undefined;
  showPaths: boolean;
  showColliders: boolean;
  showFrames: boolean;
  showGrid: boolean;
  cameraPreset?: ViewportCameraPreset | undefined;
  cameraPresetTrigger?: number | undefined;
}> = ({
  nodes,
  links,
  urdfVisuals,
  urdfCollisions,
  environment,
  toolpath,
  toolpaths,
  clearance,
  tcpPosition,
  gripperOpeningMm,
  isFullScreen,
  showPaths,
  showColliders,
  showFrames,
  showGrid,
  cameraPreset,
  cameraPresetTrigger,
}) => {
  const tokens = useThemeTokens();
  const controlsRef = useRef<any>(null);
  const hasRichUrdfVisuals = Boolean(urdfVisuals && urdfVisuals.length > 0);

  const linkSegments = useMemo(() => {
    if (hasRichUrdfVisuals && !showFrames) return [];
    const radius = hasRichUrdfVisuals ? 0.008 : 0.025;
    return links
      .map((link) => {
        const transform = computeSegmentTransform(link.from, link.to, radius);
        if (!transform) return null;
        return { link, ...transform };
      })
      .filter(
        (
          item,
        ): item is {
          link: MultibodyLink3D;
          position: [number, number, number];
          quaternion: THREE.Quaternion;
          scale: [number, number, number];
        } => item !== null,
      );
  }, [links, hasRichUrdfVisuals, showFrames]);

  const allToolpaths = useMemo(() => {
    const list: DigitalTwinToolpathTrace[] = [];
    if (toolpaths && toolpaths.length > 0) {
      list.push(...toolpaths);
    } else if (toolpath) {
      list.push(toolpath);
    }
    return list;
  }, [toolpath, toolpaths]);

  const toolpathCurve = useMemo(() => {
    if (!showPaths || allToolpaths.length === 0) return null;
    const primary = allToolpaths[0]!;
    if (!primary.points || primary.points.length < 2) return null;
    const vectors = primary.points.map(([x, y, z]) => new THREE.Vector3(x, z, -y));
    const curve = new THREE.CatmullRomCurve3(vectors);
    return new THREE.TubeGeometry(curve, Math.max(32, primary.points.length * 2), 0.0045, 8, false);
  }, [showPaths, allToolpaths]);

  const secondaryToolpathCurves = useMemo(() => {
    if (!showPaths || allToolpaths.length <= 1) return [];
    return allToolpaths
      .slice(1)
      .map((tp) => {
        if (!tp.points || tp.points.length < 2) return null;
        const vectors = tp.points.map(([x, y, z]) => new THREE.Vector3(x, z, -y));
        const curve = new THREE.CatmullRomCurve3(vectors);
        const geom = new THREE.TubeGeometry(curve, Math.max(24, tp.points.length * 2), 0.0038, 8, false);
        return { geom, color: tp.color || "#f43f5e" };
      })
      .filter((item): item is { geom: THREE.TubeGeometry; color: string } => item !== null);
  }, [showPaths, allToolpaths]);

  const clearanceSegment = useMemo(() => {
    if (!showColliders || !clearance) return null;
    return computeSegmentTransform(clearance.fromPoint, clearance.toPoint, 0.0035);
  }, [showColliders, clearance]);

  useEffect(() => {
    return () => {
      if (toolpathCurve) {
        toolpathCurve.dispose();
      }
      for (const sec of secondaryToolpathCurves) {
        sec.geom.dispose();
      }
    };
  }, [toolpathCurve, secondaryToolpathCurves]);

  const { sceneScale, floorY } = useMemo(() => {
    let maxExtent = 0.45;
    let minZ = 0;
    if (urdfVisuals) {
      for (const v of urdfVisuals) {
        const [x, y, z] = v.position;
        const r = Math.hypot(x, y, z) + (v.geometry.length ?? v.geometry.radius ?? 0.12);
        if (r > maxExtent) maxExtent = r;
        const bottom = z - (v.geometry.size ? v.geometry.size.z * 0.5 : (v.geometry.radius ?? 0));
        if (bottom < minZ) minZ = bottom;
      }
    }
    if (environment) {
      for (const a of environment) {
        const [x, y, z] = a.position;
        const [dx, dy, dz] = a.dimensions ?? [0.4, 0.4, 0.4];
        const r = Math.hypot(x, y, z) + Math.max(dx, dy, dz) * 0.5;
        if (r > maxExtent) maxExtent = r;
        const bottom = z - dz * 0.5;
        if (bottom < minZ) minZ = bottom;
      }
    }
    // Reference extent ~0.82m corresponds to scale 1.0
    const computedScale = Math.max(0.35, Math.min(5.0, maxExtent / 0.82));
    return {
      sceneScale: computedScale,
      floorY: minZ < -0.05 ? minZ : 0,
    };
  }, [urdfVisuals, environment]);

  return (
    <>
      <CameraPresetController
        controlsRef={controlsRef}
        preset={cameraPreset}
        trigger={cameraPresetTrigger}
        tcpPosition={tcpPosition}
        sceneScale={sceneScale}
      />

      {/* Studio 3-point lighting for realistic CAD shading */}
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 12, 8]} intensity={1.35} />
      <directionalLight position={[-8, 6, -6]} intensity={0.65} />
      <directionalLight position={[0, -5, 5]} intensity={0.25} />

      {showGrid && (
        <Grid
          infiniteGrid
          cellSize={0.25}
          sectionSize={1.0}
          cellColor={tokens.gridLine}
          sectionColor={tokens.borderStrong}
          fadeDistance={25}
          position={[0, floorY, 0]}
        />
      )}

      {/* Render Workstation / Environment Fixtures */}
      {environment?.map((asset) => (
        <DigitalTwinEnvironmentMesh key={asset.id} asset={asset} showColliders={showColliders} />
      ))}

      {/* Render Primary Toolpath 3D Ribbon */}
      {toolpathCurve && (
        <mesh geometry={toolpathCurve}>
          <meshStandardMaterial
            color={resolveCssColor(allToolpaths[0]?.color || "#38bdf8", tokens, "#38bdf8")}
            roughness={0.2}
            metalness={0.6}
            emissive={resolveCssColor(allToolpaths[0]?.color || "#38bdf8", tokens, "#38bdf8")}
            emissiveIntensity={0.35}
            transparent
            opacity={0.85}
          />
        </mesh>
      )}

      {/* Render Secondary Parallel Machine Toolpath Ribbons */}
      {secondaryToolpathCurves.map((sec, idx) => (
        <mesh key={idx} geometry={sec.geom}>
          <meshStandardMaterial
            color={sec.color}
            roughness={0.2}
            metalness={0.6}
            emissive={sec.color}
            emissiveIntensity={0.3}
            transparent
            opacity={0.78}
          />
        </mesh>
      ))}

      {/* Render Live TCP Indicator Marker */}
      {showPaths && tcpPosition && (
        <mesh position={[tcpPosition[0], tcpPosition[2], -tcpPosition[1]]}>
          <sphereGeometry args={[0.014, 20, 20]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.85} />
        </mesh>
      )}

      {/* Render High-Fidelity URDF Visual Meshes */}
      {hasRichUrdfVisuals &&
        urdfVisuals!.map((vis) => <UrdfVisualMesh key={vis.id} visual={vis} gripperOpeningMm={gripperOpeningMm} />)}

      {/* Render URDF Collision Primitives when Colliders toggle is active */}
      {showColliders &&
        urdfCollisions?.map((col) => <UrdfVisualMesh key={col.id} visual={col} gripperOpeningMm={gripperOpeningMm} />)}

      {/* Render Minimum Clearance Vector when Colliders toggle is active */}
      {showColliders && clearance && clearanceSegment && (
        <group>
          <mesh
            position={clearanceSegment.position}
            quaternion={clearanceSegment.quaternion}
            scale={clearanceSegment.scale}
          >
            <cylinderGeometry args={[1, 1, 1, 6]} />
            <meshStandardMaterial
              color={clearance.minDistanceMm < 30 ? "#ef4444" : "#f59e0b"}
              emissive={clearance.minDistanceMm < 30 ? "#ef4444" : "#f59e0b"}
              emissiveIntensity={0.7}
            />
          </mesh>
          <mesh position={[clearance.fromPoint[0], clearance.fromPoint[2], -clearance.fromPoint[1]]}>
            <sphereGeometry args={[0.011, 14, 14]} />
            <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.8} />
          </mesh>
          <mesh position={[clearance.toPoint[0], clearance.toPoint[2], -clearance.toPoint[1]]}>
            <sphereGeometry args={[0.011, 14, 14]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
          </mesh>
        </group>
      )}

      {/* Render Multibody Nodes & Coordinate Frames */}
      {nodes.map((node) => {
        const [x, y, z] = node.position;
        const [dx, dy, dz] = node.dimensions || (node.type === "body" ? [0.16, 0.16, 0.16] : [0.1, 0.1, 0.1]);
        const defaultColor =
          node.type === "body"
            ? tokens.domains.mechanics.color
            : node.type === "wheelset"
              ? tokens.status.warn.fg
              : tokens.status.pass.fg;
        const color = resolveCssColor(node.color || defaultColor, tokens, defaultColor);
        const nodeQuat = node.rotationMatrix ? urdfPoseToThree([0, 0, 0], node.rotationMatrix).quaternion : undefined;

        if (hasRichUrdfVisuals) {
          return showFrames ? (
            <group key={node.id} position={[x, z, -y]} {...(nodeQuat ? { quaternion: nodeQuat } : {})}>
              <axesHelper args={[0.085]} />
            </group>
          ) : null;
        }

        return (
          <group key={node.id} position={[x, z, -y]} {...(nodeQuat ? { quaternion: nodeQuat } : {})}>
            {node.type === "body" || node.type === "wheelset" ? (
              <mesh>
                <boxGeometry args={[dx, dz, dy]} />
                <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} transparent opacity={0.85} />
              </mesh>
            ) : (
              <mesh>
                <sphereGeometry args={[dx * 0.5, 16, 16]} />
                <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
              </mesh>
            )}
            <axesHelper args={[0.22]} />
          </group>
        );
      })}

      {/* Render Joint/Spring links */}
      {linkSegments.map(({ link, position, quaternion, scale }) => {
        const defaultLinkColor = link.type === "joint" ? tokens.status.warn.fg : tokens.brand;
        const linkColor = resolveCssColor(link.color || defaultLinkColor, tokens, defaultLinkColor);
        return (
          <mesh key={link.id} position={position} quaternion={quaternion} scale={scale}>
            <cylinderGeometry args={[1, 1, 1, 8]} />
            <meshStandardMaterial color={linkColor} roughness={0.3} />
          </mesh>
        );
      })}

      <SafeOrbitControls controlsRef={controlsRef} isFullScreen={isFullScreen} enableDamping dampingFactor={0.05} />
      <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#ffffff" />
      </GizmoHelper>
    </>
  );
};

let cachedWebGLSupport: boolean | null = null;

function checkWebGLAvailable(): boolean {
  if (cachedWebGLSupport !== null) return cachedWebGLSupport;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      cachedWebGLSupport = false;
      return false;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cachedWebGLSupport = true;
    return true;
  } catch {
    cachedWebGLSupport = false;
    return false;
  }
}

export const MultibodyViewport3D: React.FC<MultibodyViewport3DProps> = ({
  nodes,
  links = [],
  urdfVisuals,
  urdfCollisions,
  environment = [],
  toolpath,
  toolpaths,
  clearance,
  tcpPosition,
  gripperOpeningMm,
  isFullScreen,
  showPaths = true,
  showColliders = false,
  showFrames = false,
  showGrid = true,
  cameraPreset,
  cameraPresetTrigger,
  height = "320px",
}) => {
  const isWebGLAvailable = useMemo(() => checkWebGLAvailable(), []);

  return (
    <ViewportContainer $height={height}>
      {isWebGLAvailable ? (
        <Canvas camera={{ position: [1.28, 0.92, 1.48], fov: 42 }} style={{ width: "100%", height: "100%" }}>
          <SceneContent
            nodes={nodes}
            links={links}
            urdfVisuals={urdfVisuals}
            urdfCollisions={urdfCollisions}
            environment={environment}
            toolpath={toolpath}
            toolpaths={toolpaths}
            clearance={clearance}
            tcpPosition={tcpPosition}
            gripperOpeningMm={gripperOpeningMm}
            isFullScreen={isFullScreen}
            showPaths={showPaths}
            showColliders={showColliders}
            showFrames={showFrames}
            showGrid={showGrid}
            cameraPreset={cameraPreset}
            cameraPresetTrigger={cameraPresetTrigger}
          />
        </Canvas>
      ) : (
        <FallbackContainer>
          <span>3D WebGL Multibody Canvas</span>
          <span style={{ fontSize: "11px" }}>
            ({nodes.length} bodies/markers, {links.length} couplings indexed)
          </span>
        </FallbackContainer>
      )}
    </ViewportContainer>
  );
};

export default MultibodyViewport3D;
