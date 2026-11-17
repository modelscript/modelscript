// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadViewer — 3D CAD viewer for Modelica components with CAD annotations.
 *
 * Renders GLTF/GLB models referenced by `annotation(CAD(uri="modelica://..."))`.
 * Supports selection sync with the 2D diagram, VR mode, and snap-to-port
 * interactions via CADPort annotations.
 */

import type { DynamicBindingConfig, GdtOverlayPayload, Verification3DOverlayPayload } from "@modelscript/cad";
import { ContactShadows, GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import { AnimationTimeline } from "./AnimationTimeline";
import { CadBindingPickerModal } from "./CadBindingPickerModal";
import {
  ensureGeometryBrushedUvs,
  Gdt3dOverlay,
  HeroStudioEnvironment,
  resolveHeroAlloyConfig,
  SplitSectionGeometryPasses,
  StencilSectionCapQuad,
} from "./HeroCadMaterials";
import { InstancedCadAssembly } from "./InstancedCadAssembly";
import { VtkRenderer } from "./VtkRenderer";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CadAnnotation {
  uri: string;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
}

export interface CadPortAnnotation {
  feature: string;
  offsetPosition?: [number, number, number] | undefined;
  offsetRotation?: [number, number, number] | undefined;
  offsetScale?: [number, number, number] | undefined;
}

export interface ProceduralMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  color?: [number, number, number, number] | undefined;
}

export interface CadComponent {
  /** Qualified Modelica variable name, e.g. "body1" */
  name: string;
  /** Parsed CAD annotation */
  cad: CadAnnotation;
  /** Parsed CADPort annotations from sub-components (connectors) */
  ports?: { name: string; port: CadPortAnnotation }[] | undefined;
  /** Dynamic animation bindings (from DynamicSelect in CAD annotations) */
  dynamicBindings?: { property: string; index: number; variable: string }[] | undefined;
  /** Procedural triangle mesh for inline CSG/OpenSCAD or MSL Visualizer solids */
  proceduralMesh?: ProceduralMeshData | undefined;
  /** Baseline transform defaults for MSL Visualizers and CAD components */
  defaults?: Record<string, unknown> | undefined;
  /** MSL Visualizer shapeType identifier (e.g., "box", "cylinder", "spring", "torus") */
  shapeType?: string | undefined;
}

/** Format a CAD asset URI into a concise human-readable label (hiding inline base64 data URIs). */
export function formatCadAssetLabel(uri?: string): string {
  if (!uri) return "3D Mesh";
  if (uri.startsWith("data:")) return "Embedded 3D Mesh";
  const lastSegment = uri.split("/").pop();
  return lastSegment || "3D Mesh";
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
  /** Callback when user performs a snap/connect action */
  onConnect?: ((sourceName: string, sourcePort: string, targetName: string, targetPort: string) => void) | undefined;
  /** Dark mode toggle */
  dark?: boolean | undefined;
  /** Animation controller for simulation-driven animation */
  animationController?: AnimationController | null | undefined;
  /** Extracted VTK Buffer from the CFD Orchestrator for Real-time VR rendering */
  vtkBuffer?: Uint8Array | null | undefined;
  /** Available simulation variables for dynamic binding picker */
  availableVariables?: string[] | undefined;
  /** Callback when user saves new bindings from the picker */
  onSaveBindings?: ((componentName: string, bindings: DynamicBindingConfig[]) => void) | undefined;
  /** Disambiguate mobile touch: single finger passes page scroll, two fingers dolly/pan */
  touchScrollPassThrough?: boolean | undefined;
  /** Formal verification 3D overlay payload */
  verificationOverlay?: Verification3DOverlayPayload | null | undefined;
  /** ASME Y14.5 GD&T MBD callouts and datums overlay */
  gdtOverlay?: GdtOverlayPayload | null | undefined;
  /** Insets (top/right/bottom/left in px) for floating panels/sidebars so the 3D model centers in the visible area */
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}

function computeSceneBounds(components: CadComponent[]): {
  center: [number, number, number];
  radius: number;
  minY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let hasPoints = false;

  for (const comp of components) {
    const p = comp.cad.position ?? [0, 0, 0];
    const s = comp.cad.scale ?? [1, 1, 1];
    if (comp.proceduralMesh && comp.proceduralMesh.vertices.length >= 3) {
      const verts = comp.proceduralMesh.vertices;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i]! * s[0] + p[0];
        const vy = verts[i + 1]! * s[1] + p[1];
        const vz = verts[i + 2]! * s[2] + p[2];
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
    return { center: [0, 0, 0], radius: 2, minY: 0 };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { center: [cx, cy, cz], radius, minY };
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
  highlighted?: boolean | undefined;
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

/** Procedural triangle mesh built directly from MSL Visualizer or CSG evaluation arrays. */
function ProceduralMeshObject({
  mesh,
  name,
  dark = false,
  solidPlane = null,
  wirePlane = null,
  sectionSplit = false,
}: {
  mesh: ProceduralMeshData;
  name?: string | undefined;
  dark?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
}) {
  const { gl } = useThree();
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
    ensureGeometryBrushedUvs(geo);
    return geo;
  }, [mesh]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const rgba = mesh.color ?? [0.27, 0.51, 0.71, 1.0];
  const alloyProps = useMemo(() => resolveHeroAlloyConfig(gl, name, rgba, dark), [gl, name, rgba, dark]);
  const clipPlanes = useMemo(() => (solidPlane ? [solidPlane] : []), [solidPlane]);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...alloyProps}
          transparent={rgba[3] < 1.0}
          opacity={rgba[3]}
          clearcoat={0.14}
          side={THREE.DoubleSide}
          clippingPlanes={clipPlanes}
          clipShadows={true}
        />
      </mesh>
      {sectionSplit && solidPlane && wirePlane && (
        <SplitSectionGeometryPasses
          geometry={geometry}
          solidPlane={solidPlane}
          wirePlane={wirePlane}
          dark={dark}
          showStencilMask={true}
          showWireOpposite={true}
        />
      )}
    </group>
  );
}

/** GLTF-loaded 3D mesh object. */
function GltfMeshObject({ url, solidPlane = null }: { url: string; solidPlane?: THREE.Plane | null | undefined }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    const planes = solidPlane ? [solidPlane] : [];
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m) {
            m.clippingPlanes = planes;
            m.clipShadows = true;
            m.needsUpdate = true;
          }
        }
      }
    });
  }, [cloned, solidPlane]);

  return <primitive object={cloned} />;
}

/** A single GLTF or procedural visualizer component in the scene. */
function CadModel({
  component,
  assetBaseUrl,
  selected,
  onSelect,
  animationController,
  dark = false,
  solidPlane = null,
  wirePlane = null,
  sectionSplit = false,
}: {
  component: CadComponent;
  assetBaseUrl: string;
  selected: boolean;
  onSelect?: ((name: string | null) => void) | undefined;
  animationController?: AnimationController | null | undefined;
  dark?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
}) {
  const url = useMemo(() => resolveModelicaUri(component.cad.uri, assetBaseUrl), [component.cad.uri, assetBaseUrl]);
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [inspectorValues, setInspectorValues] = useState<
    { variable: string; property: string; index: number; value: number | null }[]
  >([]);

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

  useEffect(() => {
    return () => {
      trailLine.geometry.dispose();
      if (Array.isArray(trailLine.material)) {
        trailLine.material.forEach((m) => m.dispose());
      } else {
        trailLine.material.dispose();
      }
    };
  }, [trailLine]);

  // Outline / halo effect on selection or anchor
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material && !child.name.startsWith("port:")) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
          if (selected) {
            mat.emissive.set("#06b6d4");
            mat.emissiveIntensity = 0.45;
          } else {
            mat.emissive.set("#000000");
            mat.emissiveIntensity = 0;
          }
        }
      }
    });
  }, [selected]);

  const isBakedCsgMesh = Boolean(
    component.proceduralMesh && !component.defaults && !component.cad.uri?.startsWith("procedural://msl"),
  );
  const pos: [number, number, number] = component.cad.position ?? [0, 0, 0];
  const rot: [number, number, number] = isBakedCsgMesh ? [0, 0, 0] : (component.cad.rotation ?? [0, 0, 0]);
  const scl: [number, number, number] = isBakedCsgMesh ? [1, 1, 1] : (component.cad.scale ?? [1, 1, 1]);

  // Drive transforms from animation controller when animating or when local MSL frame defaults are present
  useFrame(() => {
    if (!groupRef.current || !animationController) return;
    if (animationController.mode === "stopped" && !component.defaults) return;

    const tf = animationController.getTransform(component.name);
    groupRef.current.position.set(tf.position[0], tf.position[1], tf.position[2]);
    if (tf.quaternion) {
      groupRef.current.quaternion.set(tf.quaternion[0], tf.quaternion[1], tf.quaternion[2], tf.quaternion[3]);
    } else {
      groupRef.current.rotation.set(
        (tf.rotation[0] * Math.PI) / 180,
        (tf.rotation[1] * Math.PI) / 180,
        (tf.rotation[2] * Math.PI) / 180,
      );
    }
    groupRef.current.scale.set(tf.scale[0], tf.scale[1], tf.scale[2]);

    if (tf.color && !selected) {
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material && !child.name.startsWith("port:")) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.color.setRGB(tf.color![0], tf.color![1], tf.color![2]);
            }
          }
        }
      });
    }

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
        trailGeoRef.current.attributes.position!.needsUpdate = true;
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
          <ProceduralMeshObject
            mesh={component.proceduralMesh}
            name={component.name}
            dark={dark}
            solidPlane={solidPlane}
            wirePlane={wirePlane}
            sectionSplit={sectionSplit}
          />
        ) : !component.cad.uri.startsWith("procedural://") ? (
          <GltfMeshObject url={url} solidPlane={solidPlane} />
        ) : null}

        {showInspector && (
          <Html position={[0, 0, 0]} center style={{ pointerEvents: "none", zIndex: 10 }}>
            <div
              style={{
                background: "var(--overlay-bgColor, var(--ms-surface-glass))",
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
                  color: "var(--fgColor-accent, var(--ms-brand))",
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

        {component.ports?.map((p) => (
          <PortIndicator
            key={p.name}
            name={`${component.name}.${p.name}`}
            position={p.port.offsetPosition ?? [0, 0, 0]}
            highlighted={selected}
          />
        ))}
      </group>

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
  onSelect,
  dark,
  animationController,
  vtkBuffer,
  touchScrollPassThrough,
  solidPlane,
  wirePlane,
  sectionSplit,
  autoSweep,
  clipSpan,
  gdtOverlay,
  showGdt,
  sceneBounds,
  fitInsets,
}: {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null | undefined;
  onSelect?: ((name: string | null) => void) | undefined;
  dark?: boolean | undefined;
  animationController?: AnimationController | null | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  touchScrollPassThrough?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
  autoSweep?: boolean | undefined;
  clipSpan: number;
  gdtOverlay?: GdtOverlayPayload | null | undefined;
  showGdt?: boolean | undefined;
  sceneBounds: { center: [number, number, number]; radius: number; minY: number };
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}) {
  const { gl, camera, size } = useThree();
  const controlsRef = useRef<any>(null);
  const framedSignatureRef = useRef<string>("");
  const sweepPhaseRef = useRef(0);

  // Offset camera frustum so the model orbits and centers within the visible area (excluding floating sidebars/panels)
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (size.width <= 0 || size.height <= 0) return;

    const top = fitInsets?.top ?? 0;
    const right = fitInsets?.right ?? 0;
    const bottom = fitInsets?.bottom ?? 0;
    const left = fitInsets?.left ?? 0;

    if (top === 0 && right === 0 && bottom === 0 && left === 0) {
      camera.clearViewOffset();
    } else {
      const offsetX = (right - left) / 2;
      const offsetY = (bottom - top) / 2;
      camera.setViewOffset(size.width, size.height, offsetX, offsetY, size.width, size.height);
    }
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, fitInsets?.top, fitInsets?.right, fitInsets?.bottom, fitInsets?.left]);

  useEffect(() => {
    if (components.length === 0) return;
    const sig = `${components.length}:${Math.round(Math.log10(Math.max(0.1, sceneBounds.radius)))}`;
    if (framedSignatureRef.current === sig) return;
    framedSignatureRef.current = sig;

    const [cx, cy, cz] = sceneBounds.center;
    const r = sceneBounds.radius;
    const fovRad = ((camera instanceof THREE.PerspectiveCamera ? camera.fov : 50) * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad / 2);
    const baseDist = r * Math.hypot(1.4, 1.15, 1.4);
    let fitDist = baseDist;
    if (size.width > 0 && size.height > 0 && tanHalfFov > 0) {
      const visW = Math.max(120, size.width - (fitInsets?.left ?? 0) - (fitInsets?.right ?? 0));
      const visH = Math.max(120, size.height - (fitInsets?.top ?? 0) - (fitInsets?.bottom ?? 0));
      const minVis = Math.min(visW, visH);
      fitDist = Math.max(baseDist, (r / tanHalfFov) * (size.height / minVis) * 1.15);
    }
    const dir = new THREE.Vector3(1.4, 1.15, 1.4).normalize();

    camera.near = Math.max(0.01, r * 0.002);
    camera.far = Math.max(1000, r * 30, fitDist * 10);
    camera.position.set(cx + dir.x * fitDist, cy + dir.y * fitDist, cz + dir.z * fitDist);
    camera.lookAt(cx, cy, cz);
    camera.updateProjectionMatrix();

    if (controlsRef.current?.target) {
      controlsRef.current.target.set(cx, cy, cz);
      controlsRef.current.update();
    }
  }, [components.length, sceneBounds, camera, size.width, size.height, fitInsets]);

  useEffect(() => {
    gl.localClippingEnabled = Boolean(solidPlane || wirePlane);
    gl.clippingPlanes = [];
  }, [gl, solidPlane, wirePlane]);

  // WebGL context loss interception
  useEffect(() => {
    const dom = gl.domElement;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("[CadViewer] WebGL context loss intercepted; preventing browser crash.");
    };
    dom.addEventListener("webglcontextlost", handleContextLost, false);

    return () => {
      dom.removeEventListener("webglcontextlost", handleContextLost);
    };
  }, [gl]);

  // Smoothly orbit and focus camera on target component anchor
  useEffect(() => {
    if (!selectedName || !controlsRef.current) return;
    const targetComp = components.find((c) => c.name === selectedName);
    if (!targetComp?.cad?.position) return;
    const [tx, ty, tz] = targetComp.cad.position;
    const targetVec = new THREE.Vector3(tx, ty, tz);
    if (controlsRef.current.target) {
      controlsRef.current.target.lerp(targetVec, 0.8);
      controlsRef.current.update();
    }
  }, [selectedName, components]);

  // Drive the animation clock & optional split-section sweep from the render loop
  useFrame((_, delta) => {
    animationController?.tick(delta);
    if (autoSweep && solidPlane) {
      sweepPhaseRef.current += Math.min(delta, 0.05) * 0.72;
      const baseD = -(
        solidPlane.normal.x * sceneBounds.center[0] +
        solidPlane.normal.y * sceneBounds.center[1] +
        solidPlane.normal.z * sceneBounds.center[2]
      );
      const d = baseD + Math.sin(sweepPhaseRef.current) * clipSpan * 0.85;
      solidPlane.constant = d;
      if (wirePlane) {
        wirePlane.constant = -d;
      }
    }
  });

  // Deselect on background click
  const handlePointerMissed = useCallback(() => {
    onSelect?.(null);
  }, [onSelect]);

  return (
    <>
      <HeroStudioEnvironment dark={Boolean(dark)} />

      {/* Ground */}
      <Grid
        position={[0, sceneBounds.minY - 0.002, 0]}
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
      <ContactShadows position={[0, sceneBounds.minY - 0.01, 0]} opacity={0.4} scale={20} blur={2} far={4} />

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
              onSelect={onSelect}
              animationController={animationController}
              dark={Boolean(dark)}
              solidPlane={solidPlane}
              wirePlane={wirePlane}
              sectionSplit={Boolean(sectionSplit)}
            />
          )}
        />
      </group>

      {sectionSplit && solidPlane && (
        <StencilSectionCapQuad
          plane={solidPlane}
          center={sceneBounds.center}
          size={Math.max(12, sceneBounds.radius * 3.2)}
          dark={Boolean(dark)}
        />
      )}

      {showGdt && gdtOverlay && (
        <Gdt3dOverlay payload={gdtOverlay} lift={Math.max(0.45, sceneBounds.radius * 0.35)} dark={Boolean(dark)} />
      )}

      {/* CFD Isosurface rendering */}
      {vtkBuffer && <VtkRenderer vtkBuffer={vtkBuffer} opacity={0.8} />}

      {/* Controls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        touches={touchScrollPassThrough ? { ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_PAN } : undefined}
      />

      {/* Gizmo */}
      <GizmoHelper
        alignment="bottom-right"
        margin={[(fitInsets?.right ?? 0) + (fitInsets ? 44 : 60), (fitInsets?.bottom ?? 0) + (fitInsets ? 44 : 60)]}
      >
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  dark,
  fitInsets,
}: {
  dark?: boolean | undefined;
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: fitInsets?.top ?? 0,
        paddingRight: fitInsets?.right ?? 0,
        paddingBottom: fitInsets?.bottom ?? 0,
        paddingLeft: fitInsets?.left ?? 0,
        boxSizing: "border-box",
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
        Add <code>shape</code> components to your model
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
  vtkBuffer = null,
  availableVariables = [],
  onSaveBindings,
  touchScrollPassThrough = false,
  verificationOverlay = null,
  gdtOverlay = null,
  fitInsets,
}: CadViewerProps) {
  const [error, setError] = useState<string | null>(null);
  const [isBindingPickerOpen, setIsBindingPickerOpen] = useState(false);
  const [clipAxis, setClipAxis] = useState<"none" | "x" | "y" | "z">("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [sectionSplit, setSectionSplit] = useState<boolean>(true);
  const [autoSweep, setAutoSweep] = useState<boolean>(false);
  const [showGdt, setShowGdt] = useState<boolean>(true);
  const [explosionFactor, setExplosionFactor] = useState<number>(0);

  const breachMarkers = useMemo(() => {
    if (!verificationOverlay) return undefined;
    const markers: Array<{ time: number; label: string; contractId?: string }> = [];
    if (verificationOverlay.counterexamples) {
      for (const ce of verificationOverlay.counterexamples) {
        markers.push({
          time: ce.time,
          label: `${ce.metricName} violated`,
          contractId: ce.contractId,
        });
      }
    }
    return markers;
  }, [verificationOverlay]);

  const effectiveComponents = useMemo(() => {
    if (explosionFactor <= 0 || components.length <= 1) return components;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const c of components) {
      const p = c.cad?.position ?? [0, 0, 0];
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    cx /= components.length;
    cy /= components.length;
    cz /= components.length;
    return components.map((c, idx) => {
      const p = c.cad?.position ?? [0, 0, 0];
      let dx = p[0] - cx;
      let dy = p[1] - cy;
      let dz = p[2] - cz;
      if (Math.hypot(dx, dy, dz) < 1e-4) {
        const angle = (idx / components.length) * Math.PI * 2;
        dx = Math.cos(angle);
        dz = Math.sin(angle);
      }
      return {
        ...c,
        cad: {
          ...c.cad,
          position: [p[0] + dx * explosionFactor, p[1] + dy * explosionFactor, p[2] + dz * explosionFactor] as [
            number,
            number,
            number,
          ],
        },
      };
    });
  }, [components, explosionFactor]);

  const sceneBounds = useMemo(() => computeSceneBounds(effectiveComponents), [effectiveComponents]);
  const clipSpan = Math.max(1.5, sceneBounds.radius * 1.15);

  const clipNormalTuple = useMemo<[number, number, number] | null>(() => {
    if (clipAxis === "x") return [-1, 0, 0];
    if (clipAxis === "y") return [0, -1, 0];
    if (clipAxis === "z") return [0, 0, -1];
    return null;
  }, [clipAxis]);

  const { solidPlane, wirePlane } = useMemo(() => {
    if (!clipNormalTuple) {
      return { solidPlane: null as THREE.Plane | null, wirePlane: null as THREE.Plane | null };
    }
    const [nx, ny, nz] = clipNormalTuple;
    const baseD = -(nx * sceneBounds.center[0] + ny * sceneBounds.center[1] + nz * sceneBounds.center[2]);
    const d = baseD + clipOffset * clipSpan;
    return {
      solidPlane: new THREE.Plane(new THREE.Vector3(nx, ny, nz), d),
      wirePlane: new THREE.Plane(new THREE.Vector3(-nx, -ny, -nz), -d),
    };
  }, [clipNormalTuple]);

  useEffect(() => {
    if (!solidPlane || !wirePlane || !clipNormalTuple) return;
    const [nx, ny, nz] = clipNormalTuple;
    const baseD = -(nx * sceneBounds.center[0] + ny * sceneBounds.center[1] + nz * sceneBounds.center[2]);
    const d = baseD + clipOffset * clipSpan;
    solidPlane.normal.set(nx, ny, nz);
    solidPlane.constant = d;
    wirePlane.normal.set(-nx, -ny, -nz);
    wirePlane.constant = -d;
  }, [solidPlane, wirePlane, clipNormalTuple, clipOffset, clipSpan, sceneBounds.center]);

  const selectedComponent = useMemo(
    () => components.find((c) => c.name === selectedName) || null,
    [components, selectedName],
  );

  // Synchronized time scrubber: seek 3D animation when user scrubs simulation results chart
  useEffect(() => {
    if (typeof window === "undefined" || !animationController) return;
    const handleTimeScrub = (e: Event) => {
      const detail = (e as CustomEvent<{ time?: number | null; values?: Record<string, number> | null }>).detail;
      if (detail?.time != null && Number.isFinite(detail.time)) {
        animationController.seek(detail.time);
      }
    };
    window.addEventListener("morsel:time-scrub", handleTimeScrub);
    return () => window.removeEventListener("morsel:time-scrub", handleTimeScrub);
  }, [animationController]);

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

  if (components.length === 0 && !vtkBuffer) {
    return (
      <div style={{ height: "100%", position: "relative", background: dark ? "#1e1e1e" : "#f5f5f5" }}>
        <EmptyState dark={dark} fitInsets={fitInsets} />
      </div>
    );
  }

  return (
    <div style={{ height: "100%", position: "relative" }}>
      {/* Floating 3D Section Plane & Explode Controls Pill */}
      <div
        style={{
          position: "absolute",
          top: fitInsets ? fitInsets.top : 14,
          right: fitInsets ? fitInsets.right : 14,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          background: dark ? "rgba(15, 23, 42, 0.82)" : "rgba(255, 255, 255, 0.9)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderRadius: 20,
          border: `1px solid ${dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)"}`,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          color: dark ? "#e2e8f0" : "#1f2328",
        }}
      >
        {(["x", "y", "z"] as const).map((axis) => {
          const active = clipAxis === axis;
          return (
            <button
              key={axis}
              type="button"
              onClick={() => {
                const next = active ? "none" : axis;
                setClipAxis(next);
                if (next === "none") setAutoSweep(false);
              }}
              title={`Toggle ${axis.toUpperCase()}-axis section cutting plane`}
              style={{
                background: active ? "rgba(6, 182, 212, 0.22)" : "transparent",
                color: active ? "#06b6d4" : "inherit",
                border: active ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
                borderRadius: 12,
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              CUT {axis.toUpperCase()}
            </button>
          );
        })}
        {clipAxis !== "none" && (
          <>
            <button
              type="button"
              onClick={() => setSectionSplit((s) => !s)}
              title="Toggle Split Solid + Edge Wireframe + Cross-Hatch Cap"
              style={{
                background: sectionSplit ? "rgba(6, 182, 212, 0.22)" : "transparent",
                color: sectionSplit ? "#06b6d4" : "inherit",
                border: sectionSplit ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
                borderRadius: 12,
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              SPLIT
            </button>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.02"
              value={clipOffset}
              onChange={(e) => {
                setAutoSweep(false);
                setClipOffset(parseFloat(e.target.value));
              }}
              aria-label="Section cutting plane offset"
              style={{ width: 64, accentColor: "#06b6d4", cursor: "pointer" }}
            />
            <button
              type="button"
              onClick={() => setAutoSweep((s) => !s)}
              title="Toggle continuous section sweep"
              style={{
                background: autoSweep ? "rgba(6, 182, 212, 0.22)" : "transparent",
                color: autoSweep ? "#06b6d4" : "inherit",
                border: autoSweep ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
                borderRadius: 12,
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              AUTO
            </button>
          </>
        )}
        {gdtOverlay && (
          <button
            type="button"
            onClick={() => setShowGdt((s) => !s)}
            title="Toggle ASME Y14.5 GD&T callouts"
            style={{
              background: showGdt ? "rgba(6, 182, 212, 0.22)" : "transparent",
              color: showGdt ? "#06b6d4" : "inherit",
              border: showGdt ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
              borderRadius: 12,
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            GD&amp;T
          </button>
        )}
        {components.length > 1 && (
          <>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ fontWeight: 600 }}>Explode</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={explosionFactor}
              onChange={(e) => setExplosionFactor(parseFloat(e.target.value))}
              aria-label="Assembly explode factor"
              style={{ width: 64, accentColor: "#06b6d4", cursor: "pointer" }}
            />
          </>
        )}
      </div>

      {/* Floating Selected Component HUD */}
      {selectedComponent && (
        <div
          style={{
            position: "absolute",
            top: fitInsets ? fitInsets.top : 14,
            left: fitInsets ? fitInsets.left : 14,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            background: dark ? "var(--overlay-bgColor, var(--ms-surface-glass))" : "rgba(255, 255, 255, 0.92)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: "10px",
            border: `1px solid ${dark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.12)"}`,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
            color: dark ? "#f0f6fc" : "#1f2328",
            fontSize: "13px",
          }}
        >
          <span style={{ fontSize: 16 }}>🧊</span>
          <div>
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <span>{selectedComponent.name}</span>
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  background:
                    selectedComponent.dynamicBindings && selectedComponent.dynamicBindings.length > 0
                      ? "rgba(63, 185, 80, 0.2)"
                      : "rgba(139, 148, 158, 0.2)",
                  color:
                    selectedComponent.dynamicBindings && selectedComponent.dynamicBindings.length > 0
                      ? "#3fb950"
                      : "#8b949e",
                  fontWeight: 600,
                }}
              >
                {selectedComponent.dynamicBindings && selectedComponent.dynamicBindings.length > 0
                  ? `${selectedComponent.dynamicBindings.length} bound`
                  : "unbound"}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: dark ? "#8b949e" : "#656d76" }}>
              {formatCadAssetLabel(selectedComponent.cad.uri)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsBindingPickerOpen(true)}
            style={{
              marginLeft: 6,
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              background: "var(--ms-brand)",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            title="Link 3D geometry to simulation states"
          >
            <span>🧵</span>
            <span>Link Variables</span>
          </button>
        </div>
      )}

      <Canvas
        shadows
        camera={{ position: [3, 2.5, 3], fov: 50 }}
        gl={{ antialias: true, stencil: true, toneMapping: THREE.ACESFilmicToneMapping, localClippingEnabled: true }}
        style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
        onError={(e) => setError(String(e))}
      >
        <SceneContents
          components={effectiveComponents}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          onSelect={onSelect}
          dark={dark}
          animationController={animationController}
          vtkBuffer={vtkBuffer}
          touchScrollPassThrough={touchScrollPassThrough}
          solidPlane={solidPlane}
          wirePlane={wirePlane}
          sectionSplit={sectionSplit && clipAxis !== "none"}
          autoSweep={autoSweep}
          clipSpan={clipSpan}
          gdtOverlay={gdtOverlay}
          showGdt={showGdt}
          sceneBounds={sceneBounds}
          fitInsets={fitInsets}
        />
      </Canvas>

      {/* Animation timeline overlay */}
      {animationController && (
        <AnimationTimeline controller={animationController} breachMarkers={breachMarkers} fitInsets={fitInsets} />
      )}

      {/* Interactive Geometry-to-Variable Binding Picker Modal */}
      {selectedComponent && (
        <CadBindingPickerModal
          isOpen={isBindingPickerOpen}
          onClose={() => setIsBindingPickerOpen(false)}
          component={selectedComponent}
          availableVariables={availableVariables}
          animationController={animationController}
          onSave={(compName, newBindings) => {
            onSaveBindings?.(compName, newBindings);
          }}
          dark={dark}
        />
      )}
    </div>
  );
}
