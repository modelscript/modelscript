// SPDX-License-Identifier: AGPL-3.0-or-later

import { turboColormap } from "@modelscript/diagram/telemetry";
import { OrbitControls, PerspectiveCamera, useGLTF, View } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import React, { Component, createContext, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { VtkRenderer } from "./VtkRenderer";

export type Embedded3DPortalKind = "cad" | "fea" | "cfd" | "step" | "usd" | "urdf" | "vtk";

interface ScissorHostContextValue {
  eventSourceRef: React.RefObject<HTMLDivElement | null>;
}

const ScissorHostContext = createContext<ScissorHostContextValue | null>(null);

export interface SharedScissor3DHostProps {
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}

/**
 * Single Shared WebGL Scissor Host (Layer 1).
 *
 * Mounts ONE single `@react-three/fiber` `<Canvas>` with `@react-three/drei`'s `<View.Port />`
 * across the entire schematic or spatial canvas so ANY number of embedded CAD, STEP, FEA, CFD,
 * USD, URDF, and VTK viewports share exactly 1 WebGL context (eliminating browser WebGL context
 * eviction limits and flicker).
 */
export function SharedScissor3DHost({ children, style }: SharedScissor3DHostProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctxValue = useMemo<ScissorHostContextValue>(() => ({ eventSourceRef: containerRef }), []);

  return (
    <ScissorHostContext.Provider value={ctxValue}>
      <div
        ref={containerRef}
        data-testid="shared-scissor-3d-host"
        data-webgl-contexts="1"
        style={{ position: "relative", width: "100%", height: "100%", isolation: "isolate", ...style }}
      >
        {children}
        {typeof window !== "undefined" && (
          <Canvas
            eventSource={containerRef as React.RefObject<HTMLElement>}
            gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
            onCreated={({ gl }) => {
              gl.domElement?.setAttribute("data-shared-webgl-canvas", "true");
            }}
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

function isGltfArtifactUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const clean = uri.split(/[?#]/)[0] ?? "";
  const lower = clean.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".gltf");
}

function isStepArtifactUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const clean = uri.split(/[?#]/)[0] ?? "";
  const lower = clean.toLowerCase();
  return lower.endsWith(".step") || lower.endsWith(".stp");
}

function isLoadableGltfUrl(uri: string | undefined): uri is string {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:model/gltf")) {
    return true;
  }
  return isGltfArtifactUri(trimmed);
}

function GltfArtifactModel({ uri }: { uri: string }): React.ReactElement {
  const { scene } = useGLTF(uri);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={clonedScene} />;
}

interface GltfErrorBoundaryProps {
  resetKey: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface GltfErrorBoundaryState {
  hasError: boolean;
}

class GltfErrorBoundary extends Component<GltfErrorBoundaryProps, GltfErrorBoundaryState> {
  constructor(props: GltfErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): GltfErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidUpdate(prevProps: GltfErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export interface EmbeddedPhysicsMeshProps {
  kind?: Embedded3DPortalKind | undefined;
  simulationTime?: number | undefined;
  animate?: boolean | undefined;
}

const BOLT_ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.82, 1.09, -0.82],
  [0.82, 1.09, -0.82],
  [-0.82, 1.09, 0.82],
  [0.82, 1.09, 0.82],
];

const CFD_STREAMLINE_RADII: ReadonlyArray<readonly [number, number, string]> = [
  [1.18, -0.45, "#38bdf8"],
  [1.26, 0.0, "#0ea5e9"],
  [1.18, 0.45, "#22d3ee"],
];

/**
 * Metallic PBR CAD / FEA / CFD Assembly rendered inside a shared scissor `<View>`.
 * Supports live simulation-driven shaft rotation, FEA thermal/von Mises colormap shading,
 * and wireframe streamlines aesthetics for CFD portals.
 */
export function EmbeddedPhysicsMesh({
  kind = "cad",
  simulationTime = 0,
  animate = false,
}: EmbeddedPhysicsMeshProps): React.ReactElement {
  const rotorRef = useRef<THREE.Mesh | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const streamlinesRef = useRef<THREE.Group | null>(null);

  const feaColor = useMemo(() => {
    const t = Math.max(0, Math.min(1, 0.25 + 0.65 * Math.abs(Math.sin(simulationTime * 0.6))));
    return turboColormap(t);
  }, [simulationTime]);

  const feaAccentColor = useMemo(() => {
    const t = Math.max(0, Math.min(1, 0.55 + 0.4 * Math.abs(Math.cos(simulationTime * 0.6))));
    return turboColormap(t);
  }, [simulationTime]);

  useFrame((_, delta) => {
    if (rotorRef.current && animate) {
      rotorRef.current.rotation.y += delta * 2.4;
    }
    if (groupRef.current && animate && kind === "cfd") {
      groupRef.current.rotation.y += delta * 0.4;
    }
    if (streamlinesRef.current && (animate || kind === "cfd")) {
      streamlinesRef.current.rotation.y += delta * (animate ? 1.4 : 0.35);
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
        <meshStandardMaterial
          color={kind === "fea" ? feaAccentColor : "#cbd5e1"}
          metalness={kind === "fea" ? 0.35 : 0.85}
          roughness={kind === "fea" ? 0.4 : 0.22}
          wireframe={kind === "cfd"}
        />
      </mesh>
      {/* Output shaft (rotates with live simulation time) */}
      <mesh ref={rotorRef} position={[0, 1.38, 0]} rotation={[0, simulationTime * 1.8, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.72, 24]} />
        <meshStandardMaterial color="#38bdf8" metalness={0.9} roughness={0.18} />
      </mesh>
      {/* 4 M4 mounting bolts / CADPort anchors */}
      {BOLT_ANCHORS.map((pos, idx) => (
        <mesh key={idx} position={[pos[0], pos[1], pos[2]]}>
          <cylinderGeometry args={[0.09, 0.09, 0.14, 12]} />
          <meshStandardMaterial color="#f59e0b" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      {/* CFD helical streamline rings */}
      {kind === "cfd" && (
        <group ref={streamlinesRef} rotation={[0, simulationTime * 0.9, 0]}>
          {CFD_STREAMLINE_RADII.map(([radius, yPos, color], idx) => (
            <mesh key={idx} position={[0, yPos, 0]} rotation={[Math.PI / 2 + 0.18 * (idx - 1), 0, 0]}>
              <torusGeometry args={[radius, 0.025, 8, 36]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} wireframe />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

export interface Scissor3DViewportProps {
  kind?: Embedded3DPortalKind | undefined;
  artifactUri?: string | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  tessellatedMeshUrl?: string | undefined;
  onTessellateStep?: ((artifactUri: string) => Promise<string | Uint8Array | null>) | undefined;
  simulationTime?: number | undefined;
  animate?: boolean | undefined;
  interactive?: boolean | undefined;
  width?: number | string | undefined;
  height?: number | string | undefined;
  badgeLabel?: string | undefined;
  onToggleInteract?: (() => void) | undefined;
}

/**
 * Individual embedded 3D CAD / FEA / CFD / STEP / VTK viewport tracked by `SharedScissor3DHost`.
 *
 * - Renders `<VtkRenderer>` when `vtkBuffer` is provided for `fea`/`cfd`/`vtk` portals or returned from STEP tessellation.
 * - Renders a Suspense + ErrorBoundary-wrapped GLTF/GLB model via `useGLTF` when `tessellatedMeshUrl` is provided,
 *   when `onTessellateStep` resolves a `.glb`/`.gltf` URL for `.step`/`.stp` assets, or when `artifactUri` ends with `.glb`/`.gltf`.
 * - Falls back seamlessly to the metallic PBR `<EmbeddedPhysicsMesh>` otherwise.
 * - Anti-scroll-trap: `<OrbitControls>` is mounted ONLY when `interactive` is `true`.
 */
export function Scissor3DViewport({
  kind = "cad",
  artifactUri,
  vtkBuffer,
  tessellatedMeshUrl,
  onTessellateStep,
  simulationTime = 0,
  animate = false,
  interactive = false,
  width = "100%",
  height = 175,
  badgeLabel,
  onToggleInteract,
}: Scissor3DViewportProps): React.ReactElement {
  const host = useContext(ScissorHostContext);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const isVtkKind = kind === "fea" || kind === "cfd" || kind === "vtk";
  const isStepKind = kind === "cad" || kind === "step";
  const isStepAsset = isStepKind && isStepArtifactUri(artifactUri);

  const [tessellatedStep, setTessellatedStep] = useState<{
    uri: string;
    meshUrl?: string | undefined;
    vtkBuffer?: Uint8Array | undefined;
  } | null>(null);

  const onTessellateStepRef = useRef(onTessellateStep);
  onTessellateStepRef.current = onTessellateStep;
  const hasTessellateStep = typeof onTessellateStep === "function";

  useEffect(() => {
    if (!isStepAsset || !artifactUri || tessellatedMeshUrl || !hasTessellateStep) {
      return;
    }
    let cancelled = false;
    const tessellate = onTessellateStepRef.current;
    if (!tessellate) return;
    void Promise.resolve(tessellate(artifactUri))
      .then((result) => {
        if (cancelled) return;
        if (typeof result === "string" && result.trim().length > 0) {
          setTessellatedStep({ uri: artifactUri, meshUrl: result.trim() });
        } else if (result instanceof Uint8Array && result.length > 0) {
          setTessellatedStep({ uri: artifactUri, vtkBuffer: result });
        } else {
          setTessellatedStep(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTessellatedStep(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isStepAsset, artifactUri, tessellatedMeshUrl, hasTessellateStep]);

  const activeTessellation = isStepAsset && tessellatedStep?.uri === artifactUri ? tessellatedStep : null;
  const resolvedVtkBuffer =
    isVtkKind && vtkBuffer != null && vtkBuffer.length > 0
      ? vtkBuffer
      : activeTessellation?.vtkBuffer && activeTessellation.vtkBuffer.length > 0
        ? activeTessellation.vtkBuffer
        : null;
  const candidateMeshUrl = tessellatedMeshUrl ?? activeTessellation?.meshUrl;
  const resolvedGltfUrl = !resolvedVtkBuffer
    ? isLoadableGltfUrl(candidateMeshUrl)
      ? candidateMeshUrl
      : isGltfArtifactUri(artifactUri)
        ? artifactUri
        : null
    : null;

  const fallbackMesh = <EmbeddedPhysicsMesh kind={kind} simulationTime={simulationTime} animate={animate} />;

  return (
    <div
      ref={trackRef}
      data-testid="scissor-3d-viewport"
      data-3d-kind={kind}
      data-interactive={interactive ? "true" : "false"}
      onDoubleClick={(e) => {
        if (onToggleInteract) {
          e.stopPropagation();
          onToggleInteract();
        }
      }}
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 6,
        overflow: "hidden",
        background: "#0f172a",
        boxShadow: interactive ? "0 0 0 2px #38bdf8, 0 8px 24px rgba(15, 23, 42, 0.45)" : undefined,
        cursor: interactive ? "grab" : "default",
      }}
    >
      {host && typeof window !== "undefined" ? (
        <View track={trackRef as React.RefObject<HTMLElement>} style={{ width: "100%", height: "100%" }}>
          <PerspectiveCamera makeDefault position={[2.8, 2.2, 3.2]} fov={40} />
          <ambientLight intensity={0.65} />
          <directionalLight position={[5, 8, 5]} intensity={1.3} />
          <pointLight position={[-4, -3, -4]} intensity={0.5} color="#38bdf8" />
          {resolvedVtkBuffer ? (
            <GltfErrorBoundary resetKey={`${kind}:${artifactUri ?? "vtk"}`} fallback={fallbackMesh}>
              <VtkRenderer vtkBuffer={resolvedVtkBuffer} showStreamlines={kind === "cfd"} />
            </GltfErrorBoundary>
          ) : resolvedGltfUrl ? (
            <GltfErrorBoundary resetKey={resolvedGltfUrl} fallback={fallbackMesh}>
              <Suspense fallback={fallbackMesh}>
                <GltfArtifactModel uri={resolvedGltfUrl} />
              </Suspense>
            </GltfErrorBoundary>
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
            zIndex: 6,
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
      {onToggleInteract && (
        <button
          type="button"
          data-testid="scissor-3d-orbit-toggle"
          title={interactive ? "Exit 3D orbit focus (Esc)" : "Enter 3D orbit focus (or double-click)"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleInteract();
          }}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            zIndex: 6,
            pointerEvents: "auto",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1.2,
            color: interactive ? "#0f172a" : "#e2e8f0",
            background: interactive ? "#38bdf8" : "rgba(15, 23, 42, 0.88)",
            border: "1px solid rgba(56, 189, 248, 0.55)",
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          {interactive ? "Exit 3D (Esc)" : "Orbit 3D"}
        </button>
      )}
    </div>
  );
}
