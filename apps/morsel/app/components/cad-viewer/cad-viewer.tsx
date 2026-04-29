// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadViewer — 3D CAD viewer for Modelica components with CAD annotations.
 *
 * Renders GLTF/GLB models referenced by `annotation(CAD(uri="modelica://..."))`.
 * Supports selection sync with the 2D diagram, VR mode, and snap-to-port
 * interactions via CADPort annotations.
 */

import {
  ContactShadows,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import { AnimationTimeline } from "./animation-timeline";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CadAnnotation {
  uri: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export interface CadPortAnnotation {
  feature: string;
  offsetPosition?: [number, number, number];
  offsetRotation?: [number, number, number];
  offsetScale?: [number, number, number];
}

export interface CadComponent {
  /** Qualified Modelica variable name, e.g. "body1" */
  name: string;
  /** Parsed CAD annotation */
  cad: CadAnnotation;
  /** Parsed CADPort annotations from sub-components (connectors) */
  ports?: { name: string; port: CadPortAnnotation }[];
  /** Dynamic animation bindings (from DynamicSelect in CAD annotations) */
  dynamicBindings?: { property: string; index: number; variable: string }[];
}

interface CadViewerProps {
  /** List of components with CAD annotations to render */
  components: CadComponent[];
  /** Base URL for resolving modelica:// URIs, e.g. "/api/v1/libraries" */
  assetBaseUrl?: string;
  /** Currently selected component name (synced with the 2D diagram) */
  selectedName?: string | null;
  /** Callback when user selects a 3D object */
  onSelect?: (name: string | null) => void;
  /** Callback when user performs a snap/connect action */
  onConnect?: (sourceName: string, sourcePort: string, targetName: string, targetPort: string) => void;
  /** Dark mode toggle */
  dark?: boolean;
  /** Animation controller for simulation-driven animation */
  animationController?: AnimationController | null;
}

// ── URI resolver ─────────────────────────────────────────────────────────────

/**
 * Convert a `modelica://LibraryName/Resources/path.glb` URI into a fetch URL.
 *
 * Strategy: `modelica://Modelica/Resources/CAD/part.glb`
 *   → `{baseUrl}/Modelica/latest/resources/Resources/CAD/part.glb`
 */
function resolveModelicaUri(uri: string, baseUrl: string): string {
  const match = uri.match(/^modelica:\/\/([^/]+)\/(.+)$/);
  if (!match) return uri; // already a URL
  const [, libraryName, resourcePath] = match;
  return `${baseUrl}/${libraryName}/latest/resources/${resourcePath}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Port indicator sphere rendered at a CADPort position. */
function PortIndicator({
  position,
  name,
  highlighted,
}: {
  position: [number, number, number];
  name: string;
  highlighted?: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (ref.current && highlighted) {
      ref.current.scale.setScalar(1 + Math.sin(Date.now() * 0.005) * 0.15);
    }
  });

  return (
    <mesh ref={ref} position={position} name={`port:${name}`}>
      <sphereGeometry args={[0.03, 16, 16]} />
      <meshStandardMaterial
        color={highlighted ? "#ff6b35" : "#4fc3f7"}
        emissive={highlighted ? "#ff6b35" : "#4fc3f7"}
        emissiveIntensity={highlighted ? 0.6 : 0.3}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

/** A single GLTF-based component in the scene. */
function CadModel({
  component,
  assetBaseUrl,
  selected,
  onSelect,
  animationController,
}: {
  component: CadComponent;
  assetBaseUrl: string;
  selected: boolean;
  onSelect?: (name: string | null) => void;
  animationController?: AnimationController | null;
}) {
  const url = useMemo(() => resolveModelicaUri(component.cad.uri, assetBaseUrl), [component.cad.uri, assetBaseUrl]);
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  // Outline effect on selection
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (selected) {
          mat.emissive = new THREE.Color("#1976d2");
          mat.emissiveIntensity = 0.25;
        } else {
          mat.emissive = new THREE.Color("#000000");
          mat.emissiveIntensity = 0;
        }
      }
    });
  }, [selected]);

  const pos = component.cad.position ?? [0, 0, 0];
  const rot = component.cad.rotation ?? [0, 0, 0];
  const scl = component.cad.scale ?? [1, 1, 1];

  // Drive transforms from animation controller when animating
  useFrame(() => {
    if (!groupRef.current || !animationController) return;
    if (animationController.mode === "stopped") return;

    const tf = animationController.getTransform(component.name);
    groupRef.current.position.set(tf.position[0], tf.position[1], tf.position[2]);
    groupRef.current.rotation.set(
      (tf.rotation[0] * Math.PI) / 180,
      (tf.rotation[1] * Math.PI) / 180,
      (tf.rotation[2] * Math.PI) / 180,
    );
    groupRef.current.scale.set(tf.scale[0], tf.scale[1], tf.scale[2]);
  });

  return (
    <group
      ref={groupRef}
      name={component.name}
      position={pos}
      rotation={rot.map((r) => (r * Math.PI) / 180) as [number, number, number]}
      scale={scl}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(component.name);
      }}
    >
      <primitive object={cloned} />
      {component.ports?.map((p) => (
        <PortIndicator
          key={p.name}
          name={`${component.name}.${p.name}`}
          position={p.port.offsetPosition ?? [0, 0, 0]}
          highlighted={selected}
        />
      ))}
    </group>
  );
}

/** Scene contents: lights, grid, models. */
function SceneContents({
  components,
  assetBaseUrl,
  selectedName,
  onSelect,
  dark,
  animationController,
}: {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null;
  onSelect?: (name: string | null) => void;
  dark?: boolean;
  animationController?: AnimationController | null;
}) {
  const { gl } = useThree();

  // Drive the animation clock from the render loop
  useFrame((_, delta) => {
    animationController?.tick(delta);
  });

  // Deselect on background click
  const handlePointerMissed = useCallback(() => {
    onSelect?.(null);
  }, [onSelect]);

  useEffect(() => {
    gl.domElement.addEventListener("pointerdown", (e) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        // Will be caught by mesh onClick or pointerMissed
      }
    });
  }, [gl]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={dark ? 0.3 : 0.5} />
      <directionalLight position={[5, 10, 7]} intensity={dark ? 0.8 : 1.0} castShadow />
      <directionalLight position={[-3, 5, -5]} intensity={0.3} />

      {/* Environment map for realistic reflections */}
      <Environment preset={dark ? "night" : "studio"} />

      {/* Ground */}
      <Grid
        position={[0, -0.001, 0]}
        args={[20, 20]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor={dark ? "#333" : "#ccc"}
        sectionSize={2}
        sectionThickness={1}
        sectionColor={dark ? "#555" : "#999"}
        fadeDistance={30}
        infiniteGrid
      />
      <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={20} blur={2} far={4} />

      {/* Models */}
      <group onPointerMissed={handlePointerMissed}>
        {components.map((comp) => (
          <CadModel
            key={comp.name}
            component={comp}
            assetBaseUrl={assetBaseUrl}
            selected={selectedName === comp.name}
            onSelect={onSelect}
            animationController={animationController}
          />
        ))}
      </group>

      {/* Controls */}
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

      {/* Gizmo */}
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ dark }: { dark?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        color: dark ? "#888" : "#aaa",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        flexDirection: "column",
        gap: 8,
      }}
    >
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span>No CAD annotations found</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        Add <code>annotation(CAD(uri=&quot;...&quot;))</code> to your components
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function CadViewer({
  components,
  assetBaseUrl = "/api/v1/libraries",
  selectedName,
  onSelect,
  onConnect: _onConnect,
  dark = false,
  animationController = null,
}: CadViewerProps) {
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#1e1e1e" : "#f5f5f5",
          color: dark ? "#e57373" : "#d32f2f",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <strong>3D Viewer Error</strong>
          <br />
          {error}
        </div>
      </div>
    );
  }

  if (components.length === 0) {
    return (
      <div style={{ height: "100%", position: "relative", background: dark ? "#1e1e1e" : "#f5f5f5" }}>
        <EmptyState dark={dark} />
      </div>
    );
  }

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <Canvas
        shadows
        camera={{ position: [3, 2.5, 3], fov: 50 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
        onError={(e) => setError(String(e))}
      >
        <SceneContents
          components={components}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          onSelect={onSelect}
          dark={dark}
          animationController={animationController}
        />
      </Canvas>

      {/* Animation timeline overlay */}
      {animationController && <AnimationTimeline controller={animationController} />}
    </div>
  );
}
