// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadViewer — 3D CAD viewer for Modelica components with CAD annotations.
 *
 * Renders GLTF/GLB models referenced by `annotation(CAD(uri="modelica://..."))`.
 * Supports selection sync with the 2D diagram, VR mode, and snap-to-port
 * interactions via CADPort annotations.
 */

import type { DynamicBindingConfig } from "@modelscript/cad";
import {
  ContactShadows,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  OrbitControls,
  TransformControls,
  useGLTF,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import { AnimationTimeline } from "./animation-timeline";
import { CadBindingPickerModal } from "./cad-binding-picker-modal";
import { CfdMeshRenderer, type CfdMeshPayload } from "./cfd-mesh-renderer";
import { FeaMeshRenderer, type FeaMeshPayload } from "./fea-mesh-renderer";
import { InstancedCadAssembly } from "./instanced-cad-assembly";

// ── Types ────────────────────────────────────────────────────────────────────

export type GizmoMode = "translate" | "rotate" | "scale";

export interface CadAnnotation {
  uri: string;
  feature?: string | undefined;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  dynamicPosition?: string | undefined;
  dynamicRotation?: string | undefined;
  dynamicScale?: string | undefined;
  dynamicDeformation?: string | undefined;
}

export interface CadPortAnnotation {
  feature: string;
  offsetPosition?: [number, number, number] | undefined;
  offsetRotation?: [number, number, number] | undefined;
  offsetScale?: [number, number, number] | undefined;
}

export interface CadSourceMetadata {
  parameterName?: string | undefined;
  dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
  dimensions?: [number, number, number] | undefined;
  transformMethod?: string | undefined;
  argIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  primitiveStartOffset?: number | undefined;
  primitiveEndOffset?: number | undefined;
  translateRange?: { startOffset: number; endOffset: number } | undefined;
  rotateRange?: { startOffset: number; endOffset: number } | undefined;
  scaleRange?: { startOffset: number; endOffset: number } | undefined;
  translation?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  color?: [number, number, number, number] | undefined;
}

export interface ProceduralMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  color?: [number, number, number, number] | undefined;
}

export interface GizmoCommitPayload {
  componentName: string;
  mode?: GizmoMode | undefined;
  delta: [number, number, number];
  newPosition: [number, number, number];
  newRotation?: [number, number, number] | undefined;
  newScale?: [number, number, number] | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CadComponent {
  /** Qualified Modelica variable name or OpenSCAD part name, e.g. "body1" */
  name: string;
  /** Parsed CAD annotation */
  cad: CadAnnotation;
  /** Parsed CADPort annotations from sub-components (connectors) */
  ports?: { name: string; port: CadPortAnnotation }[] | undefined;
  /** Dynamic animation bindings (from DynamicSelect in CAD annotations) */
  dynamicBindings?: { property: string; index: number; variable: string }[] | undefined;
  /** Source code metadata linking to AST parameters and CST byte ranges */
  sourceMetadata?: CadSourceMetadata | undefined;
  /** Procedural triangle mesh for inline CSG/OpenSCAD solids */
  proceduralMesh?: ProceduralMeshData | undefined;
}

interface CadViewerProps {
  /** List of components with CAD annotations to render */
  components: CadComponent[];
  /** Base URL for resolving modelica:// URIs, e.g. "/api/v1/libraries" */
  assetBaseUrl?: string | undefined;
  /** Currently selected component name (synced with the 2D diagram) */
  selectedName?: string | null | undefined;
  /** Callback when user selects a 3D object */
  onSelect?: ((name: string | null) => void) | undefined;
  /** Callback when user drags and releases a 3D direct-manipulation transform/dimension gizmo */
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  /** Callback when user saves dynamic variable bindings from CadBindingPickerModal */
  onCommitCadBinding?:
    | ((payload: { componentName: string; bindings: DynamicBindingConfig[]; uri?: string | undefined }) => void)
    | undefined;
  /** Dark mode toggle */
  dark?: boolean | undefined;
  /** Animation controller for simulation-driven animation */
  animationController?: AnimationController | null | undefined;
  /** CFD mesh payload from co-simulation VTK stream */
  cfdPayload?: CfdMeshPayload | null | undefined;
  /** FEA structural mesh payload from co-simulation stream */
  feaPayload?: FeaMeshPayload | null | undefined;
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
  radius = 0.03,
}: {
  position: [number, number, number];
  name: string;
  highlighted?: boolean;
  radius?: number | undefined;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (ref.current && highlighted) {
      ref.current.scale.setScalar(1 + Math.sin(Date.now() * 0.005) * 0.15);
    }
  });

  return (
    <mesh ref={ref} position={position} name={`port:${name}`}>
      <sphereGeometry args={[radius, 16, 16]} />
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

/** Procedural triangle mesh built directly from CSG evaluation arrays. */
function ProceduralMeshObject({ mesh }: { mesh: ProceduralMeshData }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertices), 3));
    if (mesh.normals && mesh.normals.length === mesh.vertices.length) {
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
    }
    if (mesh.indices && mesh.indices.length > 0) {
      geo.setIndex(mesh.indices);
    }
    if (!mesh.normals || mesh.normals.length !== mesh.vertices.length) {
      geo.computeVertexNormals();
    }
    return geo;
  }, [mesh]);

  const rgba = mesh.color ?? [0.27, 0.51, 0.71, 1.0];
  const color = useMemo(() => new THREE.Color(rgba[0], rgba[1], rgba[2]), [rgba]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={color}
        metalness={0.25}
        roughness={0.45}
        transparent={rgba[3] < 1.0}
        opacity={rgba[3]}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** GLTF-loaded 3D mesh object. */
function GltfMeshObject({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} />;
}

/** A single GLTF or procedural CSG component in the scene. */
function CadModel({
  component,
  assetBaseUrl,
  selected,
  gizmoMode,
  onSelect,
  animationController,
  onCommitGizmoDelta,
  portRadius = 0.03,
}: {
  component: CadComponent;
  assetBaseUrl: string;
  selected: boolean;
  gizmoMode: GizmoMode;
  onSelect?: ((name: string | null) => void) | undefined;
  animationController?: AnimationController | null | undefined;
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  portRadius?: number | undefined;
}) {
  const url = useMemo(() => resolveModelicaUri(component.cad.uri, assetBaseUrl), [component.cad.uri, assetBaseUrl]);
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [inspectorValues, setInspectorValues] = useState<
    { variable: string; property: string; index: number; value: number | null }[]
  >([]);

  const effectivePos: [number, number, number] = component.cad.position ?? [0, 0, 0];
  // Procedural CSG meshes from ManifoldWorker already have rotation and scale baked into vertices
  const effectiveRot: [number, number, number] = component.proceduralMesh
    ? [0, 0, 0]
    : (component.cad.rotation ?? [0, 0, 0]);
  const effectiveScl: [number, number, number] = component.proceduralMesh
    ? [1, 1, 1]
    : (component.cad.scale ?? [1, 1, 1]);

  // Gizmo dragging & delta state
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);
  const [gizmoDelta, setGizmoDelta] = useState<[number, number, number]>([0, 0, 0]);
  const initialGizmoPosRef = useRef<[number, number, number]>(effectivePos);
  const initialGizmoRotRef = useRef<[number, number, number]>(effectiveRot);
  const initialGizmoSclRef = useRef<[number, number, number]>(effectiveScl);

  useEffect(() => {
    initialGizmoPosRef.current = component.cad.position ?? [0, 0, 0];
    initialGizmoRotRef.current = component.proceduralMesh ? [0, 0, 0] : (component.cad.rotation ?? [0, 0, 0]);
    initialGizmoSclRef.current = component.proceduralMesh ? [1, 1, 1] : (component.cad.scale ?? [1, 1, 1]);
    setGizmoDelta([0, 0, 0]);
  }, [component.cad.position, component.cad.rotation, component.cad.scale, component.proceduralMesh]);

  const handleGizmoChange = useCallback(() => {
    if (!groupRef.current) return;
    if (gizmoMode === "translate") {
      const cur = groupRef.current.position;
      const init = initialGizmoPosRef.current;
      setGizmoDelta([cur.x - init[0], cur.y - init[1], cur.z - init[2]]);
    } else if (gizmoMode === "rotate") {
      const cur = groupRef.current.rotation;
      const init = initialGizmoRotRef.current;
      const rxDeg = (cur.x * 180) / Math.PI;
      const ryDeg = (cur.y * 180) / Math.PI;
      const rzDeg = (cur.z * 180) / Math.PI;
      setGizmoDelta([rxDeg - init[0], ryDeg - init[1], rzDeg - init[2]]);
    } else if (gizmoMode === "scale") {
      const cur = groupRef.current.scale;
      const init = initialGizmoSclRef.current;
      setGizmoDelta([cur.x / (init[0] || 1), cur.y / (init[1] || 1), cur.z / (init[2] || 1)]);
    }
    setIsDraggingGizmo(true);
  }, [gizmoMode]);

  const handleGizmoMouseUp = useCallback(() => {
    if (!groupRef.current) return;
    setIsDraggingGizmo(false);
    const curPos = groupRef.current.position;
    const curRot = groupRef.current.rotation;
    const curScl = groupRef.current.scale;

    if (gizmoMode === "translate") {
      const init = initialGizmoPosRef.current;
      const dx = curPos.x - init[0];
      const dy = curPos.y - init[1];
      const dz = curPos.z - init[2];
      if (Math.hypot(dx, dy, dz) > 1e-4) {
        onCommitGizmoDelta?.({
          componentName: component.name,
          mode: "translate",
          delta: [dx, dy, dz],
          newPosition: [curPos.x, curPos.y, curPos.z],
          sourceMetadata: component.sourceMetadata,
        });
        initialGizmoPosRef.current = [curPos.x, curPos.y, curPos.z];
        setGizmoDelta([0, 0, 0]);
      }
    } else if (gizmoMode === "rotate") {
      const init = initialGizmoRotRef.current;
      const rxDeg = (curRot.x * 180) / Math.PI;
      const ryDeg = (curRot.y * 180) / Math.PI;
      const rzDeg = (curRot.z * 180) / Math.PI;
      const drx = rxDeg - init[0];
      const dry = ryDeg - init[1];
      const drz = rzDeg - init[2];
      if (Math.hypot(drx, dry, drz) > 1e-2) {
        const baseRot = component.sourceMetadata?.rotation ?? init;
        const newRot: [number, number, number] = [baseRot[0] + drx, baseRot[1] + dry, baseRot[2] + drz];
        onCommitGizmoDelta?.({
          componentName: component.name,
          mode: "rotate",
          delta: [drx, dry, drz],
          newPosition: [curPos.x, curPos.y, curPos.z],
          newRotation: newRot,
          sourceMetadata: component.sourceMetadata,
        });
        initialGizmoRotRef.current = [rxDeg, ryDeg, rzDeg];
        setGizmoDelta([0, 0, 0]);
      }
    } else if (gizmoMode === "scale") {
      const init = initialGizmoSclRef.current;
      const sx = curScl.x / (init[0] || 1);
      const sy = curScl.y / (init[1] || 1);
      const sz = curScl.z / (init[2] || 1);
      if (Math.hypot(sx - 1, sy - 1, sz - 1) > 1e-3) {
        onCommitGizmoDelta?.({
          componentName: component.name,
          mode: "scale",
          delta: [sx - 1, sy - 1, sz - 1],
          newPosition: [curPos.x, curPos.y, curPos.z],
          newScale: [sx, sy, sz],
          sourceMetadata: component.sourceMetadata,
        });
        initialGizmoSclRef.current = [curScl.x, curScl.y, curScl.z];
        setGizmoDelta([0, 0, 0]);
      }
    }
  }, [component.name, component.sourceMetadata, gizmoMode, onCommitGizmoDelta]);

  // Ghost trail state (bypass React for performance)
  const maxTrailPoints = 300;
  const trailGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const trailPositions = useRef<Float32Array>(new Float32Array(maxTrailPoints * 3));
  const trailCount = useRef(0);

  const trailLine = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(trailPositions.current, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: "#ff6b35", transparent: true, opacity: 0.6, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    trailGeoRef.current = geo;
    return line;
  }, []);

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

  const pos = effectivePos;
  const rot = effectiveRot;
  const scl = effectiveScl;

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

    // Update ghost trail if selected and animating
    if (selected && (animationController.mode === "playing" || animationController.mode === "live")) {
      if (trailCount.current >= maxTrailPoints) {
        trailPositions.current.copyWithin(0, 3);
        trailCount.current = maxTrailPoints - 1;
      }
      const idx = trailCount.current;
      trailPositions.current[idx * 3] = tf.position[0];
      trailPositions.current[idx * 3 + 1] = tf.position[1];
      trailPositions.current[idx * 3 + 2] = tf.position[2];
      trailCount.current++;

      if (trailGeoRef.current) {
        trailGeoRef.current.setDrawRange(0, trailCount.current);
        trailGeoRef.current.attributes["position"]!.needsUpdate = true;
      }
    } else if (!selected && trailCount.current > 0) {
      trailCount.current = 0;
      if (trailGeoRef.current) trailGeoRef.current.setDrawRange(0, 0);
    }

    // Update inspector values at 10Hz if hovered or selected
    if ((hovered || selected) && Math.random() < 0.2) {
      setInspectorValues(animationController.getComponentValues(component.name));
    }
  });

  const showInspector = (hovered || selected) && inspectorValues.length > 0 && animationController?.mode !== "stopped";
  const gizmoLabelPrefix = gizmoMode === "rotate" ? "Δθ°" : gizmoMode === "scale" ? "×S" : "Δ";

  return (
    <>
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
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        {component.proceduralMesh ? (
          <ProceduralMeshObject mesh={component.proceduralMesh} />
        ) : (
          <GltfMeshObject url={url} />
        )}

        {showInspector && (
          <Html position={[0, 0, 0]} center style={{ pointerEvents: "none", zIndex: 10 }}>
            <div
              style={{
                background: "rgba(22, 27, 34, 0.85)",
                backdropFilter: "blur(4px)",
                color: "#e6edf3",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                fontSize: "11px",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  paddingBottom: 4,
                  marginBottom: 4,
                  color: "#58a6ff",
                }}
              >
                {component.name}
              </div>
              {inspectorValues.map((v) => (
                <div
                  key={`${v.variable}-${v.property}-${v.index}`}
                  style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
                >
                  <span style={{ color: "#8b949e" }}>
                    {v.property}[{v.index}]
                  </span>
                  <span style={{ color: "#3fb950" }}>{v.value !== null ? v.value.toFixed(4) : "—"}</span>
                </div>
              ))}
            </div>
          </Html>
        )}

        {isDraggingGizmo && (
          <Html position={[0, 1.2, 0]} center style={{ pointerEvents: "none", zIndex: 20 }}>
            <div
              style={{
                background: "rgba(15, 23, 42, 0.9)",
                backdropFilter: "blur(6px)",
                color: "#38bdf8",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(56, 189, 248, 0.4)",
                fontSize: "11px",
                fontFamily: "monospace",
                fontWeight: 600,
                whiteSpace: "nowrap",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}
            >
              {gizmoLabelPrefix}: [{gizmoDelta[0].toFixed(2)}, {gizmoDelta[1].toFixed(2)}, {gizmoDelta[2].toFixed(2)}]
            </div>
          </Html>
        )}

        {component.ports?.map((p) => (
          <PortIndicator
            key={p.name}
            name={`${component.name}.${p.name}`}
            position={p.port.offsetPosition ?? [0, 0, 0]}
            highlighted={selected}
            radius={portRadius}
          />
        ))}
      </group>

      {/* 3D Direct Manipulation Transform Gizmo attached to selected component */}
      {selected && (!animationController || animationController.mode === "stopped") && (
        <TransformControls
          object={groupRef as React.RefObject<THREE.Object3D>}
          mode={gizmoMode}
          onObjectChange={handleGizmoChange}
          onMouseUp={handleGizmoMouseUp}
        />
      )}

      {/* Ghost trail (world space) */}
      {selected && <primitive object={trailLine} />}
    </>
  );
}

/** Scene contents: lights, grid, models. */
function SceneContents({
  components,
  assetBaseUrl,
  selectedName,
  gizmoMode,
  onSelect,
  onCommitGizmoDelta,
  dark,
  animationController,
  cfdPayload,
  feaPayload,
}: {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null | undefined;
  gizmoMode: GizmoMode;
  onSelect?: ((name: string | null) => void) | undefined;
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  dark?: boolean | undefined;
  animationController?: AnimationController | null | undefined;
  cfdPayload?: CfdMeshPayload | null | undefined;
  feaPayload?: FeaMeshPayload | null | undefined;
}) {
  const { gl, camera } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const framedSignatureRef = useRef<string>("");

  // Compute scene bounding sphere across procedural meshes and component positions
  const sceneBounds = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let hasPoints = false;

    for (const comp of components) {
      const p = comp.cad.position ?? [0, 0, 0];
      if (comp.proceduralMesh && comp.proceduralMesh.vertices.length >= 3) {
        const verts = comp.proceduralMesh.vertices;
        for (let i = 0; i < verts.length; i += 3) {
          const vx = verts[i]! + p[0];
          const vy = verts[i + 1]! + p[1];
          const vz = verts[i + 2]! + p[2];
          if (vx < minX) minX = vx;
          if (vy < minY) minY = vy;
          if (vz < minZ) minZ = vz;
          if (vx > maxX) maxX = vx;
          if (vy > maxY) maxY = vy;
          if (vz > maxZ) maxZ = vz;
          hasPoints = true;
        }
      } else {
        if (p[0] - 1 < minX) minX = p[0] - 1;
        if (p[1] - 1 < minY) minY = p[1] - 1;
        if (p[2] - 1 < minZ) minZ = p[2] - 1;
        if (p[0] + 1 > maxX) maxX = p[0] + 1;
        if (p[1] + 1 > maxY) maxY = p[1] + 1;
        if (p[2] + 1 > maxZ) maxZ = p[2] + 1;
        hasPoints = true;
      }
    }

    if (!hasPoints) {
      return { center: [0, 0, 0] as [number, number, number], radius: 2, minY: 0 };
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
    return { center: [cx, cy, cz] as [number, number, number], radius, minY };
  }, [components]);

  // Auto-frame camera when components first load or scale changes significantly
  useEffect(() => {
    if (components.length === 0) return;
    const sig = `${components.length}:${Math.round(Math.log10(Math.max(1, sceneBounds.radius)))}`;
    if (framedSignatureRef.current === sig) return;
    framedSignatureRef.current = sig;

    const [cx, cy, cz] = sceneBounds.center;
    const r = sceneBounds.radius;
    camera.near = Math.max(0.01, r * 0.002);
    camera.far = Math.max(1000, r * 30);
    camera.position.set(cx + r * 1.35, cy + r * 1.1, cz + r * 1.35);
    camera.lookAt(cx, cy, cz);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(cx, cy, cz);
      controlsRef.current.update();
    }
  }, [components.length, sceneBounds, camera]);

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

  const r = sceneBounds.radius;
  const gridScale = r > 15 ? Math.pow(10, Math.floor(Math.log10(r))) : 1;
  const portRadius = Math.max(0.03, r * 0.02);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={dark ? 0.35 : 0.55} />
      <directionalLight position={[r * 1.5, r * 2.5, r * 2]} intensity={dark ? 0.85 : 1.0} castShadow />
      <directionalLight position={[-r * 1.2, r * 1.5, -r * 1.5]} intensity={0.35} />

      {/* Environment map for realistic reflections */}
      <Environment preset={dark ? "night" : "studio"} />

      {/* Ground */}
      <Grid
        position={[0, Math.min(-0.001, sceneBounds.minY - 0.01 * gridScale), 0]}
        args={[20 * gridScale, 20 * gridScale]}
        cellSize={0.5 * gridScale}
        cellThickness={0.5}
        cellColor={dark ? "#333" : "#ccc"}
        sectionSize={2 * gridScale}
        sectionThickness={1}
        sectionColor={dark ? "#555" : "#999"}
        fadeDistance={Math.max(30, r * 4)}
        infiniteGrid
      />
      <ContactShadows
        position={[0, Math.min(-0.01, sceneBounds.minY - 0.02 * gridScale), 0]}
        opacity={0.4}
        scale={20 * gridScale}
        blur={2}
        far={4 * gridScale}
      />

      {/* Models: GPU Instanced rendering for clusters, fallback to CadModel for singletons */}
      <group onPointerMissed={handlePointerMissed}>
        <InstancedCadAssembly
          components={components}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          onSelect={onSelect}
          animationController={animationController}
          renderSingleton={(comp) => (
            <CadModel
              key={comp.name}
              component={comp}
              assetBaseUrl={assetBaseUrl}
              selected={selectedName === comp.name}
              gizmoMode={gizmoMode}
              onSelect={onSelect}
              animationController={animationController}
              onCommitGizmoDelta={onCommitGizmoDelta}
              portRadius={portRadius}
            />
          )}
        />
      </group>

      {/* CFD Mesh Visualization (co-simulation melt front) */}
      {cfdPayload && <CfdMeshRenderer payload={cfdPayload} />}

      {/* FEA Mesh Visualization (structural stress & deformation) */}
      {feaPayload && <FeaMeshRenderer payload={feaPayload} />}

      {/* Controls */}
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.1} />

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
      <span>No shape classes found</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        Add <code>shape</code> components or OpenSCAD CSG solids to your model
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
  onCommitGizmoDelta,
  onCommitCadBinding,
  dark = false,
  animationController = null,
  cfdPayload = null,
  feaPayload = null,
}: CadViewerProps) {
  const [error, setError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState<boolean>(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [isBindingPickerOpen, setIsBindingPickerOpen] = useState(false);

  const selectedComponent = useMemo(
    () => (selectedName ? (components.find((c) => c.name === selectedName) ?? null) : null),
    [components, selectedName],
  );

  // Hotkeys W (translate), E (rotate), R (scale)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "w") setGizmoMode("translate");
      else if (key === "e") setGizmoMode("rotate");
      else if (key === "r") setGizmoMode("scale");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  if (components.length === 0 && !cfdPayload && !feaPayload) {
    return (
      <div style={{ height: "100%", position: "relative", background: dark ? "#1e1e1e" : "#f5f5f5" }}>
        <EmptyState dark={dark} />
      </div>
    );
  }

  const modeBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: "6px",
    border: "none",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "#0969da" : "transparent",
    color: active ? "#ffffff" : dark ? "#c9d1d9" : "#24292f",
    transition: "background 0.15s ease",
  });

  return (
    <div style={{ height: "100%", position: "relative" }}>
      {/* Top Toolbar: Gizmo Mode Switcher + Selected Component HUD */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px",
            background: dark ? "rgba(22, 27, 34, 0.88)" : "rgba(255, 255, 255, 0.92)",
            backdropFilter: "blur(12px)",
            borderRadius: "8px",
            border: `1px solid ${dark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)"}`,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
          }}
        >
          <button
            type="button"
            onClick={() => setGizmoMode("translate")}
            style={modeBtnStyle(gizmoMode === "translate")}
            title="Translate / Move Gizmo (Hotkey: W)"
          >
            ✥ Move (W)
          </button>
          <button
            type="button"
            onClick={() => setGizmoMode("rotate")}
            style={modeBtnStyle(gizmoMode === "rotate")}
            title="Rotate Gizmo (Hotkey: E)"
          >
            ↻ Rotate (E)
          </button>
          <button
            type="button"
            onClick={() => setGizmoMode("scale")}
            style={modeBtnStyle(gizmoMode === "scale")}
            title="Scale / Dimension Gizmo (Hotkey: R)"
          >
            ⤢ Scale (R)
          </button>
        </div>

        {selectedComponent && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 12px",
              background: dark ? "rgba(22, 27, 34, 0.88)" : "rgba(255, 255, 255, 0.92)",
              backdropFilter: "blur(12px)",
              borderRadius: "8px",
              border: `1px solid ${dark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)"}`,
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
              color: dark ? "#f0f6fc" : "#1f2328",
              fontSize: "12px",
            }}
          >
            <span>🧊</span>
            <div>
              <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <span>{selectedComponent.name}</span>
                {selectedComponent.sourceMetadata?.parameterName && (
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 6px",
                      borderRadius: "8px",
                      background: "rgba(56, 189, 248, 0.18)",
                      color: "#38bdf8",
                      fontFamily: "monospace",
                    }}
                  >
                    param: {selectedComponent.sourceMetadata.parameterName}
                  </span>
                )}
              </div>
            </div>
            {!selectedComponent.proceduralMesh && (
              <button
                type="button"
                onClick={() => setIsBindingPickerOpen(true)}
                style={{
                  marginLeft: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  background: "#0969da",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Link 3D geometry to simulation variables"
              >
                <span>🧵</span>
                <span>Link Variables</span>
              </button>
            )}
          </div>
        )}
      </div>

      {contextLost && (
        <div
          style={{
            position: "absolute",
            top: 50,
            left: 16,
            right: 16,
            zIndex: 100,
            padding: "10px 16px",
            borderRadius: 6,
            background: "rgba(220, 38, 38, 0.9)",
            color: "#ffffff",
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
            backdropFilter: "blur(6px)",
          }}
        >
          <span>⚠ WebGL graphics context was suspended by host system. Waiting for GPU recovery…</span>
        </div>
      )}

      <Canvas
        shadows
        camera={{ position: [3, 2.5, 3], fov: 50 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
        onError={(e) => setError(String(e))}
        onCreated={({ gl }) => {
          const dom = gl.domElement;
          dom.addEventListener(
            "webglcontextlost",
            (e) => {
              e.preventDefault();
              console.warn("[CadViewer] WebGL context lost! Waiting for restoration...");
              setContextLost(true);
            },
            false,
          );
          dom.addEventListener(
            "webglcontextrestored",
            () => {
              console.info("[CadViewer] WebGL context restored!");
              setContextLost(false);
            },
            false,
          );
        }}
      >
        <SceneContents
          components={components}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          gizmoMode={gizmoMode}
          onSelect={onSelect}
          onCommitGizmoDelta={onCommitGizmoDelta}
          dark={dark}
          animationController={animationController}
          cfdPayload={cfdPayload}
          feaPayload={feaPayload}
        />
      </Canvas>

      {/* Animation timeline overlay */}
      {animationController && <AnimationTimeline controller={animationController} />}

      {/* Interactive Geometry-to-Variable Binding Picker Modal */}
      {selectedComponent && (
        <CadBindingPickerModal
          isOpen={isBindingPickerOpen}
          onClose={() => setIsBindingPickerOpen(false)}
          component={selectedComponent}
          animationController={animationController}
          onSave={(compName, newBindings) => {
            onCommitCadBinding?.({
              componentName: compName,
              bindings: newBindings,
              uri: selectedComponent.cad.uri,
            });
          }}
          dark={dark}
        />
      )}
    </div>
  );
}
