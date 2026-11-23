// SPDX-License-Identifier: AGPL-3.0-or-later

import { evaluateTurboColormap } from "@modelscript/canvas";
import { VtkRenderer } from "@modelscript/editor/workbench/cad-viewer/VtkRenderer";
import { OrbitControls, PerspectiveCamera, useGLTF, View } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import React, { createContext, Suspense, useContext, useMemo, useRef } from "react";
import * as THREE from "three";

interface ScissorHostContextValue {
  eventSourceRef: React.RefObject<HTMLDivElement | null>;
}

const ScissorHostContext = createContext<ScissorHostContextValue | null>(null);

function isLoadableGltfUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith("http")) {
    return false;
  }
  const pathOnly = (trimmed.split(/[?#]/)[0] ?? "").toLowerCase();
  return pathOnly.endsWith(".glb") || pathOnly.endsWith(".gltf");
}

interface Scissor3DErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface Scissor3DErrorBoundaryState {
  hasError: boolean;
}

class Scissor3DErrorBoundary extends React.Component<Scissor3DErrorBoundaryProps, Scissor3DErrorBoundaryState> {
  override state: Scissor3DErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): Scissor3DErrorBoundaryState {
    return { hasError: true };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function GltfAssetMesh({
  url,
  simulationTime = 0,
  animate = false,
}: {
  url: string;
  simulationTime?: number | undefined;
  animate?: boolean | undefined;
}): React.ReactElement {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group | null>(null);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useFrame((_, delta) => {
    if (groupRef.current && animate) {
      groupRef.current.rotation.y += delta * 0.45;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, simulationTime * 0.12, 0]}>
      <primitive object={clonedScene} />
    </group>
  );
}

/**
 * Single Shared WebGL Scissor Host (Layer 1).
 *
 * Mounts ONE single `<Canvas>` with `@react-three/drei`'s `<View.Port />` across
 * the entire spatial canvas or Modelica diagram so ANY number of embedded CAD,
 * STEP, FEA, and CFD viewports share exactly 1 WebGL context (eliminating browser
 * WebGL context eviction limits and flicker).
 */
export function SharedScissor3DHost({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctxValue = useMemo(() => ({ eventSourceRef: containerRef }), []);

  return (
    <ScissorHostContext.Provider value={ctxValue}>
      <div
        ref={containerRef}
        data-testid="shared-scissor-3d-host"
        data-webgl-contexts="1"
        style={{ position: "relative", width: "100%", height: "100%", ...style }}
      >
        {children}
        {typeof window !== "undefined" && (
          <Canvas
            eventSource={containerRef as React.RefObject<HTMLElement>}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
            style={{
              position: "fixed",
              inset: 0,
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <View.Port />
          </Canvas>
        )}
      </div>
    </ScissorHostContext.Provider>
  );
}

/**
 * Metallic PBR CAD / FEA / CFD Assembly rendered inside a shared scissor `<View>`.
 * Supports live simulation-driven rotation, FEA thermal/von Mises colormap shading,
 * and animated CFD streamlines.
 */
export function EmbeddedPhysicsMesh({
  kind = "cad",
  simulationTime = 0,
  animate = false,
}: {
  kind?: "cad" | "fea" | "cfd" | "step" | "usd" | "urdf" | "vtk" | undefined;
  simulationTime?: number | undefined;
  animate?: boolean | undefined;
}): React.ReactElement {
  const rotorRef = useRef<THREE.Mesh | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);

  const feaColor = useMemo(() => {
    const t = Math.max(0, Math.min(1, 0.25 + 0.65 * Math.abs(Math.sin(simulationTime * 0.6))));
    return evaluateTurboColormap(t);
  }, [simulationTime]);

  useFrame((_, delta) => {
    if (rotorRef.current && (animate || simulationTime > 0)) {
      rotorRef.current.rotation.y += animate ? delta * 2.4 : 0;
    }
    if (groupRef.current && animate && kind === "cfd") {
      groupRef.current.rotation.y += delta * 0.4;
    }
  });

  const bodyColor = kind === "fea" ? feaColor : kind === "cfd" ? "#0ea5e9" : "#94a3b8";

  return (
    <group ref={groupRef} rotation={[0.35, 0.55 + simulationTime * 0.12, 0]}>
      {/* Main actuator / structural body */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.85, 0.85, 1.9, 32]} />
        <meshStandardMaterial
          color={bodyColor}
          metalness={kind === "fea" ? 0.25 : 0.78}
          roughness={kind === "fea" ? 0.45 : 0.28}
          wireframe={kind === "cfd"}
        />
      </mesh>
      {/* Front mounting flange */}
      <mesh position={[0, 0.98, 0]} castShadow>
        <boxGeometry args={[2.1, 0.18, 2.1]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.22} />
      </mesh>
      {/* Output shaft (rotates with live simulation time) */}
      <mesh ref={rotorRef} position={[0, 1.38, 0]} rotation={[0, simulationTime * 1.8, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.72, 24]} />
        <meshStandardMaterial color="#38bdf8" metalness={0.9} roughness={0.18} />
      </mesh>
      {/* 4 M4 mounting bolts / CADPort anchors */}
      {(
        [
          [-0.82, 1.09, -0.82],
          [0.82, 1.09, -0.82],
          [-0.82, 1.09, 0.82],
          [0.82, 1.09, 0.82],
        ] as [number, number, number][]
      ).map((pos, idx) => (
        <mesh key={idx} position={pos}>
          <cylinderGeometry args={[0.09, 0.09, 0.14, 12]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

export interface Scissor3DViewportProps {
  kind?: "cad" | "fea" | "cfd" | "step" | "usd" | "urdf" | "vtk" | undefined;
  artifactUri?: string | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  interactive?: boolean | undefined;
  simulationTime?: number | undefined;
  animate?: boolean | undefined;
  height?: number | undefined;
  badgeLabel?: string | undefined;
}

/**
 * Individual embedded 3D CAD / FEA / CFD viewport tracked by `SharedScissor3DHost`.
 * Renders live VTK XML field buffers (`VtkRenderer`), `.glb`/`.gltf` assets via `useGLTF`
 * with `<Suspense>` and error fallback, or the procedural `EmbeddedPhysicsMesh`.
 * Falls back cleanly if mounted outside a `SharedScissor3DHost` (e.g. SSR or standalone tests).
 */
export function Scissor3DViewport({
  kind = "cad",
  artifactUri,
  vtkBuffer,
  interactive = true,
  simulationTime = 0,
  animate = false,
  height = 175,
  badgeLabel,
}: Scissor3DViewportProps): React.ReactElement {
  const host = useContext(ScissorHostContext);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const activeVtkBuffer = vtkBuffer && vtkBuffer.byteLength > 0 ? vtkBuffer : null;
  const gltfUri = !activeVtkBuffer && isLoadableGltfUri(artifactUri) ? artifactUri.trim() : null;
  const sourceKind = activeVtkBuffer ? "vtk" : gltfUri ? "gltf" : "procedural";
  const fallbackMesh = <EmbeddedPhysicsMesh kind={kind} simulationTime={simulationTime} animate={animate} />;

  return (
    <div
      ref={trackRef}
      data-testid="scissor-3d-viewport"
      data-3d-kind={kind}
      data-3d-source={sourceKind}
      data-3d-interactive={interactive ? "true" : "false"}
      onPointerDown={(e) => {
        if (interactive) {
          e.stopPropagation();
        }
      }}
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 6,
        overflow: "hidden",
        background: "#0f172a",
      }}
    >
      {host && typeof window !== "undefined" ? (
        <View track={trackRef as React.RefObject<HTMLElement>} style={{ width: "100%", height: "100%" }}>
          <PerspectiveCamera makeDefault position={[2.8, 2.2, 3.2]} fov={40} />
          <ambientLight intensity={0.65} />
          <directionalLight position={[5, 8, 5]} intensity={1.3} />
          <pointLight position={[-4, -3, -4]} intensity={0.5} color="#38bdf8" />
          {activeVtkBuffer ? (
            <Scissor3DErrorBoundary fallback={fallbackMesh}>
              <VtkRenderer vtkBuffer={activeVtkBuffer} showStreamlines={kind === "cfd"} />
            </Scissor3DErrorBoundary>
          ) : gltfUri ? (
            <Scissor3DErrorBoundary key={gltfUri} fallback={fallbackMesh}>
              <Suspense fallback={fallbackMesh}>
                <GltfAssetMesh url={gltfUri} simulationTime={simulationTime} animate={animate} />
              </Suspense>
            </Scissor3DErrorBoundary>
          ) : (
            fallbackMesh
          )}
          {interactive && <OrbitControls makeDefault enableDamping dampingFactor={0.08} />}
        </View>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#38bdf8",
            fontSize: 11,
          }}
        >
          Shared Scissor 3D ({kind.toUpperCase()})
        </div>
      )}
      {badgeLabel && (
        <span
          style={{
            position: "absolute",
            bottom: 6,
            left: 8,
            fontSize: 10,
            color: "#38bdf8",
            background: "rgba(15, 23, 42, 0.85)",
            padding: "2px 6px",
            borderRadius: 4,
            pointerEvents: "none",
          }}
        >
          {badgeLabel}
        </span>
      )}
    </div>
  );
}
