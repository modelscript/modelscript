// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadViewer — 3D CAD viewer for Modelica components with CAD annotations.
 *
 * Renders GLTF/GLB models referenced by `annotation(CAD(uri="modelica://..."))`.
 * Supports selection sync with the 2D diagram, VR mode, and snap-to-port
 * interactions via CADPort annotations.
 */

import type {
  DynamicBindingConfig,
  GdtOverlayPayload,
  MissionPhaseBand,
  OperationLogEvent,
  Verification3DOverlayPayload,
} from "@modelscript/cad";
import {
  ContactShadows,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  OrbitControls,
  TransformControls,
  useGLTF,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useXR, XR } from "@react-three/xr";
import type React from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { generateLocalTetMeshAsync, runLocalCfdStudyAsync, runLocalFeaStudyAsync } from "../util/cae-local-runner";
import { enterXrSession, getSharedXrStore, useXrCapabilities } from "../vr-rotunda/xr-session";
import type { AnimationController } from "./animation-controller";
import { AnimationTimeline } from "./AnimationTimeline";
import {
  createDefaultAssemblyVisibility,
  inferSubsystemsFromPartNames,
  resolvePartPresentation,
  type AssemblyVisibilityState,
} from "./assembly-visibility";
import { AssemblyInspectorPanel } from "./AssemblyInspectorPanel";
import { CadBindingPickerModal } from "./CadBindingPickerModal";
import {
  buildCaeSimulationModel,
  CaePostProcessDrawer,
  CaeSimulationTree,
  ScalarColorbarLegend,
  type CaeSimulationRunEntry,
} from "./CaeSimulationTree";
import { useRetainGltfUrl } from "./gltf-cache-guard";
import {
  CadEdgeOverlay,
  ensureGeometryBrushedUvs,
  Gdt3dOverlay,
  HeroStudioEnvironment,
  resolveHeroAlloyConfig,
  SplitSectionGeometryPasses,
  StencilSectionCapQuad,
  StudioSsaoPass,
} from "./HeroCadMaterials";
import { InstancedCadAssembly } from "./InstancedCadAssembly";
import { JetPlumeRenderer, type JetPlumeRendererProps } from "./JetPlumeRenderer";
import { sampleVtkCutLine, VtkRenderer } from "./VtkRenderer";

// ── Types ────────────────────────────────────────────────────────────────────

export type GizmoMode = "select" | "translate" | "rotate" | "scale" | "tag_face" | "mate";

export interface CommitAssemblyJointPayload {
  jointName: string;
  jointType: "Revolute" | "Prismatic" | "Cylindrical" | "Spherical" | "Fixed";
  partA: string;
  partB: string;
  axis?: [number, number, number] | undefined;
}

export interface CadSourceMetadata {
  uri?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  primitiveStartOffset?: number | undefined;
  primitiveEndOffset?: number | undefined;
  parameterName?: string | undefined;
  transformMethod?: string | undefined;
  argIndex?: number | undefined;
  translateRange?: { startOffset: number; endOffset: number } | undefined;
  rotateRange?: { startOffset: number; endOffset: number } | undefined;
  scaleRange?: { startOffset: number; endOffset: number } | undefined;
  dimensions?: [number, number, number] | undefined;
  dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
  position?: [number, number, number] | undefined;
  translation?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  primitiveType?: string | undefined;
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

export interface CommitDimensionPayload {
  componentName: string;
  dimensionIndex: number;
  newValue: number;
  primitiveType?: string | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CommitFaceTagPayload {
  componentName: string;
  portName: string;
  portType: string;
  normal?: [number, number, number] | undefined;
  worldPos: [number, number, number];
  sourceMetadata?: CadSourceMetadata | undefined;
}

interface FaceTagHit {
  componentName: string;
  normal?: [number, number, number] | undefined;
  worldPos: [number, number, number];
  sourceMetadata?: CadSourceMetadata | undefined;
}

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
  material?: string | undefined;
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
  /** Source code metadata linking to AST parameters and CST byte ranges */
  sourceMetadata?: CadSourceMetadata | undefined;
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
  /** Callback when user drags and releases a 3D direct-manipulation transform gizmo */
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  /** Callback when user commits a parametric dimension edit */
  onCommitDimensionDelta?: ((payload: CommitDimensionPayload) => void) | undefined;
  /** Callback when user tags a 3D face as a physical port or boundary condition */
  onCommitFaceTag?: ((payload: CommitFaceTagPayload) => void) | undefined;
  /** Callback when user mates two 3D parts with an assembly joint */
  onCommitAssemblyJoint?: ((payload: CommitAssemblyJointPayload) => void) | undefined;
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
  /** Optional live source code (used to map byte offsets to line numbers for Go to Source) */
  sourceCode?: string | undefined;
  /** Optional CAE deck / CFD config source for SimScale-style simulation tree */
  caeSourceCode?: string | undefined;
  /** Reveal a line in the code editor when a CAE tree item or CAD source link is clicked */
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  /** Insert a CAE keyword snippet into the live code editor */
  onInsertCaeSnippet?: ((snippet: string) => void) | undefined;
  /** Launch the full Engineering VR Rotunda workstation from the 3D CAD viewer */
  onOpenVrRotunda?: (() => void) | undefined;
  /** Optional mission phase bands displayed along the AnimationTimeline scrubber */
  missionPhases?: readonly MissionPhaseBand[] | undefined;
  /** Optional operator-action / autonomy keyframe events for click-to-seek Operation Log */
  operationLog?: readonly OperationLogEvent[] | undefined;
  /** Optional real-time GPU particle jet plume configuration bound to a fluid outlet */
  jetPlume?: Omit<JetPlumeRendererProps, "isInXr"> | null | undefined;
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

const DEFAULT_MESH_COLOR: [number, number, number, number] = [0.27, 0.51, 0.71, 1.0];
const EMPTY_CLIP_PLANES: THREE.Plane[] = [];

/** Procedural triangle mesh built directly from MSL Visualizer or CSG evaluation arrays. */
function ProceduralMeshObject({
  mesh,
  name,
  dark = false,
  solidPlane = null,
  wirePlane = null,
  sectionSplit = false,
  showEdges = true,
}: {
  mesh: ProceduralMeshData;
  name?: string | undefined;
  dark?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
  showEdges?: boolean | undefined;
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

  const rgba = mesh.color ?? DEFAULT_MESH_COLOR;
  const alloyProps = useMemo(
    () => resolveHeroAlloyConfig(gl, name, rgba, dark, mesh.material),
    [gl, name, rgba, dark, mesh.material],
  );
  const clipPlanes = useMemo(() => (solidPlane ? [solidPlane] : EMPTY_CLIP_PLANES), [solidPlane]);
  const isTranslucent = rgba[3] < 1.0;

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          {...alloyProps}
          transparent={isTranslucent}
          opacity={rgba[3]}
          depthWrite={!isTranslucent}
          polygonOffset={showEdges}
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          side={THREE.DoubleSide}
          clippingPlanes={clipPlanes}
          clipShadows={true}
        />
      </mesh>
      {showEdges && !sectionSplit && (
        <CadEdgeOverlay
          geometry={geometry}
          dark={dark}
          opacity={isTranslucent ? 0.45 : 0.8}
          clippingPlanes={clipPlanes}
        />
      )}
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
function GltfMeshObject({
  url,
  solidPlane = null,
  showEdges = true,
  dark = false,
}: {
  url: string;
  solidPlane?: THREE.Plane | null | undefined;
  showEdges?: boolean | undefined;
  dark?: boolean | undefined;
}) {
  useRetainGltfUrl(url);
  const { scene } = useGLTF(url);

  // Clone scene graph AND materials so clipping/polygonOffset edits never mutate the shared cached scene
  const { cloned, clonedMaterials } = useMemo(() => {
    const root = scene.clone(true);
    const mats: THREE.Material[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          const next = mesh.material.map((m) => {
            const c = m.clone();
            mats.push(c);
            return c;
          });
          mesh.material = next;
        } else if (mesh.material) {
          const c = mesh.material.clone();
          mats.push(c);
          mesh.material = c;
        }
      }
    });
    return { cloned: root, clonedMaterials: mats };
  }, [scene]);

  useEffect(() => {
    const planes = solidPlane ? [solidPlane] : EMPTY_CLIP_PLANES;
    const hasClip = planes.length > 0;
    const createdEdges: THREE.LineSegments[] = [];
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m) {
            const prevHasClip = Array.isArray(m.clippingPlanes) && m.clippingPlanes.length > 0;
            m.clippingPlanes = planes;
            m.clipShadows = true;
            m.polygonOffset = showEdges;
            m.polygonOffsetFactor = 1;
            m.polygonOffsetUnits = 1;
            if (prevHasClip !== hasClip) {
              m.needsUpdate = true;
            }
          }
        }
        if (showEdges && mesh.geometry) {
          const edgeGeo = new THREE.EdgesGeometry(mesh.geometry, 20);
          const edgeMat = new THREE.LineBasicMaterial({
            color: dark ? "#0f172a" : "#111827",
            transparent: true,
            opacity: 0.78,
            clippingPlanes: planes,
          });
          const lines = new THREE.LineSegments(edgeGeo, edgeMat);
          lines.userData.__cadEdgeOverlay = true;
          lines.renderOrder = 1;
          mesh.add(lines);
          createdEdges.push(lines);
        }
      }
    });

    return () => {
      for (const lines of createdEdges) {
        lines.parent?.remove(lines);
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
      }
    };
  }, [cloned, solidPlane, showEdges, dark]);

  // Only dispose cloned materials created by this instance; never dispose shared
  // cached scene geometries/textures or synchronously call useGLTF.clear(url).
  useEffect(() => {
    return () => {
      for (const mat of clonedMaterials) {
        mat.dispose();
      }
    };
  }, [clonedMaterials]);

  return <primitive object={cloned} />;
}

/** A single GLTF or procedural visualizer component in the scene. */
function CadModel({
  component,
  assetBaseUrl,
  selected,
  gizmoMode = "select",
  onSelect,
  onDraggingGizmoChange,
  onCommitGizmoDelta,
  onFaceTagClick,
  animationController,
  dark = false,
  solidPlane = null,
  wirePlane = null,
  sectionSplit = false,
  showEdges = true,
  onPickFace,
}: {
  component: CadComponent;
  assetBaseUrl: string;
  selected: boolean;
  gizmoMode?: GizmoMode | undefined;
  onSelect?: ((name: string | null) => void) | undefined;
  onDraggingGizmoChange?: ((dragging: boolean) => void) | undefined;
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  onFaceTagClick?: ((hit: FaceTagHit) => void) | undefined;
  animationController?: AnimationController | null | undefined;
  dark?: boolean | undefined;
  solidPlane?: THREE.Plane | null | undefined;
  wirePlane?: THREE.Plane | null | undefined;
  sectionSplit?: boolean | undefined;
  showEdges?: boolean | undefined;
  onPickFace?: ((label: string) => void) | undefined;
}) {
  const url = useMemo(() => resolveModelicaUri(component.cad.uri, assetBaseUrl), [component.cad.uri, assetBaseUrl]);
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const [inspectorValues, setInspectorValues] = useState<
    { variable: string; property: string; index: number; value: number | null }[]
  >([]);
  const lastInspectorUpdateRef = useRef<number>(0);

  const isBakedCsgMesh = Boolean(
    component.proceduralMesh && !component.defaults && !component.cad.uri?.startsWith("procedural://msl"),
  );
  const pos: [number, number, number] = component.cad.position ?? [0, 0, 0];
  const rot: [number, number, number] = isBakedCsgMesh ? [0, 0, 0] : (component.cad.rotation ?? [0, 0, 0]);
  const scl: [number, number, number] = isBakedCsgMesh ? [1, 1, 1] : (component.cad.scale ?? [1, 1, 1]);

  // Gizmo dragging & delta state
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);
  const [gizmoDelta, setGizmoDelta] = useState<[number, number, number]>([0, 0, 0]);
  const initialGizmoPosRef = useRef<[number, number, number]>(pos);
  const initialGizmoRotRef = useRef<[number, number, number]>(rot);
  const initialGizmoSclRef = useRef<[number, number, number]>(scl);

  useEffect(() => {
    initialGizmoPosRef.current = component.cad.position ?? [0, 0, 0];
    initialGizmoRotRef.current = isBakedCsgMesh ? [0, 0, 0] : (component.cad.rotation ?? [0, 0, 0]);
    initialGizmoSclRef.current = isBakedCsgMesh ? [1, 1, 1] : (component.cad.scale ?? [1, 1, 1]);
    setGizmoDelta([0, 0, 0]);
  }, [component.cad.position, component.cad.rotation, component.cad.scale, isBakedCsgMesh]);

  useEffect(() => {
    if (!selected && isDraggingGizmo) {
      setIsDraggingGizmo(false);
      onDraggingGizmoChange?.(false);
    }
  }, [selected, isDraggingGizmo, onDraggingGizmoChange]);

  useEffect(() => {
    return () => {
      onDraggingGizmoChange?.(false);
    };
  }, [onDraggingGizmoChange]);

  const handleGizmoMouseDown = useCallback(() => {
    setIsDraggingGizmo(true);
    onDraggingGizmoChange?.(true);
  }, [onDraggingGizmoChange]);

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
    onDraggingGizmoChange?.(true);
  }, [gizmoMode, onDraggingGizmoChange]);

  const handleGizmoMouseUp = useCallback(() => {
    setIsDraggingGizmo(false);
    onDraggingGizmoChange?.(false);
    if (!groupRef.current) return;
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
  }, [component.name, component.sourceMetadata, gizmoMode, onCommitGizmoDelta, onDraggingGizmoChange]);

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

  // Drive transforms from animation controller when animating or when local MSL frame defaults are present
  useFrame(() => {
    if (!groupRef.current || !animationController || isDraggingGizmo) return;
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

    // Update inspector values at most ~4Hz if hovered or selected
    if (hovered || selected) {
      const now = performance.now();
      if (now - lastInspectorUpdateRef.current >= 250) {
        lastInspectorUpdateRef.current = now;
        setInspectorValues(animationController.getComponentValues(component.name));
      }
    }
  });

  const showInspector = (hovered || selected) && inspectorValues.length > 0 && animationController?.mode !== "stopped";
  const gizmoLabelPrefix = gizmoMode === "rotate" ? "Δθ°" : gizmoMode === "scale" ? "×S" : "Δ";
  const showTransformGizmo = Boolean(
    selected &&
    (gizmoMode === "translate" || gizmoMode === "rotate" || gizmoMode === "scale") &&
    (!animationController || animationController.mode === "stopped") &&
    onCommitGizmoDelta,
  );

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
          if (selected && gizmoMode === "tag_face" && onFaceTagClick) {
            const n = e.face?.normal;
            onFaceTagClick({
              componentName: component.name,
              normal: n ? [n.x, n.y, n.z] : undefined,
              worldPos: [e.point.x, e.point.y, e.point.z],
              sourceMetadata: component.sourceMetadata,
            });
            return;
          }
          if (onPickFace && e.face?.normal) {
            const meshObj = e.object as THREE.Mesh | undefined;
            const faceIds = meshObj?.geometry?.userData?.faceIds as ArrayLike<number> | undefined;
            const brepFaceId =
              faceIds && typeof e.faceIndex === "number" && e.faceIndex >= 0 && e.faceIndex < faceIds.length
                ? faceIds[e.faceIndex]
                : undefined;
            if (brepFaceId !== undefined) {
              onPickFace(`${component.name}_Face${brepFaceId}`);
              return;
            }
            const n = e.face.normal;
            const ax = Math.abs(n.x);
            const ay = Math.abs(n.y);
            const az = Math.abs(n.z);
            const dir =
              ax >= ay && ax >= az
                ? n.x >= 0
                  ? "PosX"
                  : "NegX"
                : ay >= ax && ay >= az
                  ? n.y >= 0
                    ? "PosY"
                    : "NegY"
                  : n.z >= 0
                    ? "PosZ"
                    : "NegZ";
            onPickFace(`${component.name}_${dir}`);
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (animationController && animationController.mode !== "stopped") {
            setHovered(true);
          }
        }}
        onPointerOut={() => {
          if (hovered) {
            setHovered(false);
          }
        }}
      >
        {component.proceduralMesh ? (
          <ProceduralMeshObject
            mesh={component.proceduralMesh}
            name={component.name}
            dark={dark}
            solidPlane={solidPlane}
            wirePlane={wirePlane}
            sectionSplit={sectionSplit}
            showEdges={showEdges}
          />
        ) : !component.cad.uri.startsWith("procedural://") ? (
          <Suspense fallback={null}>
            <GltfMeshObject url={url} solidPlane={solidPlane} showEdges={showEdges} dark={dark} />
          </Suspense>
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

        {isDraggingGizmo && (
          <Html position={[0, 1.2, 0]} center style={{ pointerEvents: "none", zIndex: 20 }}>
            <div
              style={{
                background: "rgba(15, 23, 42, 0.92)",
                backdropFilter: "blur(6px)",
                color: "#38bdf8",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid rgba(56, 189, 248, 0.45)",
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
          />
        ))}
      </group>

      {showTransformGizmo && (
        <TransformControls
          object={groupRef as React.RefObject<THREE.Object3D>}
          mode={gizmoMode as "translate" | "rotate" | "scale"}
          onMouseDown={handleGizmoMouseDown}
          onObjectChange={handleGizmoChange}
          onMouseUp={handleGizmoMouseUp}
        />
      )}

      {/* Ghost trail (world space) */}
      {selected && <primitive object={trailLine} />}
    </>
  );
}

interface SceneContentsProps {
  components: CadComponent[];
  assetBaseUrl: string;
  selectedName?: string | null | undefined;
  gizmoMode?: GizmoMode | undefined;
  isDraggingGizmo?: boolean | undefined;
  onDraggingGizmoChange?: ((dragging: boolean) => void) | undefined;
  onCommitGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  onFaceTagClick?: ((hit: FaceTagHit) => void) | undefined;
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
  showEdges?: boolean | undefined;
  enableSsao?: boolean | undefined;
  activeCaeField?: string | undefined;
  onPickFace?: ((label: string) => void) | undefined;
  sceneBounds: { center: [number, number, number]; radius: number; minY: number };
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
  isInXr?: boolean | undefined;
  autoTurntable?: boolean | undefined;
  jetPlume?: Omit<JetPlumeRendererProps, "isInXr"> | null | undefined;
  assemblyVisibility?: AssemblyVisibilityState | null | undefined;
}

/** Scene contents: lights, grid, models. */
function SceneContents({
  components,
  assetBaseUrl,
  selectedName,
  gizmoMode = "select",
  isDraggingGizmo = false,
  onDraggingGizmoChange,
  onCommitGizmoDelta,
  onFaceTagClick,
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
  showEdges = true,
  enableSsao = false,
  activeCaeField,
  onPickFace,
  sceneBounds,
  fitInsets,
  isInXr = false,
  autoTurntable = false,
  jetPlume = null,
  assemblyVisibility = null,
}: SceneContentsProps) {
  const { gl, scene, camera, size } = useThree();
  const controlsRef = useRef<any>(null);
  const framedSignatureRef = useRef<string>("");
  const sweepPhaseRef = useRef(0);

  // Set opaque scene background in WebXR so Quest 2 renders solid studio backdrop instead of passthrough transparency
  useEffect(() => {
    if (!isInXr) return;
    const prevBackground = scene.background;
    const prevClearAlpha = gl.getClearAlpha();
    scene.background = new THREE.Color(dark ? "#111827" : "#e2e8f0");
    gl.setClearAlpha(1);
    return () => {
      scene.background = prevBackground;
      gl.setClearAlpha(prevClearAlpha);
    };
  }, [isInXr, scene, gl, dark]);

  // Offset camera frustum so the model orbits and centers within the visible area (excluding floating sidebars/panels)
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (isInXr) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      return;
    }
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
  }, [camera, isInXr, size.width, size.height, fitInsets?.top, fitInsets?.right, fitInsets?.bottom, fitInsets?.left]);

  useEffect(() => {
    if (isInXr) return;
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
  }, [isInXr, components.length, sceneBounds, camera, size.width, size.height, fitInsets]);

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
    if (isInXr || !selectedName || !controlsRef.current) return;
    const targetComp = components.find((c) => c.name === selectedName);
    if (!targetComp?.cad?.position) return;
    const [tx, ty, tz] = targetComp.cad.position;
    const targetVec = new THREE.Vector3(tx, ty, tz);
    if (controlsRef.current.target) {
      controlsRef.current.target.lerp(targetVec, 0.8);
      controlsRef.current.update();
    }
  }, [isInXr, selectedName, components]);

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

  const gridUnit = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, sceneBounds.radius / 3))));
  const gridSpan = Math.max(20, sceneBounds.radius * 8);
  const gridFade = Math.max(30, sceneBounds.radius * 6);
  const shadowScale = Math.max(20, sceneBounds.radius * 3.5);
  const shadowFar = Math.max(4, sceneBounds.radius * 2);
  const groundY = sceneBounds.minY - Math.max(0.002, sceneBounds.radius * 0.001);

  return (
    <>
      <HeroStudioEnvironment dark={Boolean(dark)} />

      {/* Ground */}
      <Grid
        position={[sceneBounds.center[0], groundY, sceneBounds.center[2]]}
        args={[gridSpan, gridSpan]}
        cellSize={gridUnit}
        cellThickness={0.5}
        cellColor={dark ? "#333" : "#ccc"}
        sectionSize={gridUnit * 5}
        sectionThickness={1}
        sectionColor={dark ? "#555" : "#999"}
        fadeDistance={gridFade}
        infiniteGrid
      />
      <ContactShadows
        position={[sceneBounds.center[0], groundY - Math.max(0.01, sceneBounds.radius * 0.002), sceneBounds.center[2]]}
        frames={1}
        opacity={0.4}
        scale={shadowScale}
        blur={2}
        far={shadowFar}
      />

      {/* Models: GPU Instanced rendering for clusters, fallback to CadModel for singletons */}
      <group onPointerMissed={handlePointerMissed}>
        <InstancedCadAssembly
          components={components}
          assetBaseUrl={assetBaseUrl}
          selectedName={selectedName}
          onSelect={onSelect}
          animationController={animationController}
          visibility={assemblyVisibility}
          renderSingleton={(comp) => (
            <CadModel
              key={comp.name}
              component={comp}
              assetBaseUrl={assetBaseUrl}
              selected={selectedName === comp.name}
              gizmoMode={gizmoMode}
              onSelect={onSelect}
              onDraggingGizmoChange={onDraggingGizmoChange}
              onCommitGizmoDelta={onCommitGizmoDelta}
              onFaceTagClick={onFaceTagClick}
              animationController={animationController}
              dark={Boolean(dark)}
              solidPlane={solidPlane}
              wirePlane={wirePlane}
              sectionSplit={Boolean(sectionSplit)}
              showEdges={showEdges}
              onPickFace={onPickFace}
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

      {/* CFD & FEA Contour / Vector rendering */}
      {vtkBuffer && (
        <VtkRenderer
          vtkBuffer={vtkBuffer}
          opacity={0.85}
          activeField={activeCaeField}
          showVectors={Boolean(activeCaeField?.toLowerCase().includes("velocity"))}
          showStreamlines={Boolean(activeCaeField?.toLowerCase().includes("velocity"))}
          deformationScale={activeCaeField === "Displacement" ? 12 : 0}
        />
      )}

      {/* GPU Fluid Jet / Siphon Plume (single draw call, XR particle-budgeted) */}
      {jetPlume && <JetPlumeRenderer {...jetPlume} isInXr={isInXr} />}

      {/* Cavity Ambient Occlusion (SSAO) — disabled during WebXR stereo rendering */}
      {!isInXr && <StudioSsaoPass enabled={Boolean(enableSsao)} />}

      {/* Controls — unmounted during WebXR so OrbitControls never fights headset pose */}
      {!isInXr && (
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={!isDraggingGizmo}
          enableDamping
          dampingFactor={0.1}
          autoRotate={Boolean(autoTurntable)}
          autoRotateSpeed={1.6}
          touches={touchScrollPassThrough ? { ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_PAN } : undefined}
        />
      )}

      {/* Gizmo — unmounted during WebXR so secondary Hud pass never fights stereo framebuffer */}
      {!isInXr && (
        <GizmoHelper
          alignment="bottom-right"
          margin={[(fitInsets?.right ?? 0) + (fitInsets ? 44 : 60), (fitInsets?.bottom ?? 0) + (fitInsets ? 44 : 60)]}
        >
          <GizmoViewport labelColor="white" axisHeadScale={1} />
        </GizmoHelper>
      )}
    </>
  );
}

/** Safe wrapper subscribing to WebXR session state only when mounted inside `<XR>`. */
function XrSceneContentsBridge(props: Omit<SceneContentsProps, "isInXr">) {
  const isInXr = useXR((s) => Boolean(s.session));
  return <SceneContents {...props} isInXr={isInXr} />;
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
  onCommitGizmoDelta,
  onCommitDimensionDelta,
  onCommitFaceTag,
  onCommitAssemblyJoint,
  dark = false,
  animationController = null,
  vtkBuffer = null,
  availableVariables = [],
  onSaveBindings,
  touchScrollPassThrough = false,
  verificationOverlay = null,
  gdtOverlay = null,
  fitInsets,
  sourceCode,
  caeSourceCode,
  onRevealLine,
  onInsertCaeSnippet,
  onOpenVrRotunda,
  missionPhases,
  operationLog,
  jetPlume = null,
}: CadViewerProps) {
  const xrStore = useMemo(() => (onOpenVrRotunda ? null : getSharedXrStore()), [onOpenVrRotunda]);
  const xrCaps = useXrCapabilities();
  const [error, setError] = useState<string | null>(null);
  const [isBindingPickerOpen, setIsBindingPickerOpen] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>(() => (onCommitGizmoDelta ? "translate" : "select"));
  const [isDraggingGizmo, setIsDraggingGizmo] = useState(false);
  const [faceTagDraft, setFaceTagDraft] = useState<{
    hit: FaceTagHit;
    portName: string;
    portType: string;
  } | null>(null);
  const [matePartA, setMatePartA] = useState<string | null>(null);
  const [mateDraft, setMateDraft] = useState<{
    partA: string;
    partB: string;
    jointName: string;
    jointType: CommitAssemblyJointPayload["jointType"];
    axisKey: "z" | "y" | "x";
  } | null>(null);
  const [dimDrafts, setDimDrafts] = useState<Record<number, string>>({});
  const [clipAxis, setClipAxis] = useState<"none" | "x" | "y" | "z">("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [sectionSplit, setSectionSplit] = useState<boolean>(true);
  const [autoSweep, setAutoSweep] = useState<boolean>(false);
  const [showGdt, setShowGdt] = useState<boolean>(true);
  const [showEdges, setShowEdges] = useState<boolean>(true);
  const [enableSsao, setEnableSsao] = useState<boolean>(false);
  const [autoTurntable, setAutoTurntable] = useState<boolean>(false);
  const [showSubsystems, setShowSubsystems] = useState<boolean>(false);
  const [assemblyVisibility, setAssemblyVisibility] = useState<AssemblyVisibilityState>(() =>
    createDefaultAssemblyVisibility(),
  );
  const [showInstances, setShowInstances] = useState<boolean>(false);
  const [showSimTree, setShowSimTree] = useState<boolean>(Boolean(caeSourceCode || vtkBuffer));
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [caePostView, setCaePostView] = useState<{ mode: "convergence" | "log"; runId: string } | null>(null);
  const [activeCaeField, setActiveCaeField] = useState<string | undefined>(undefined);
  const [caeRuns, setCaeRuns] = useState<CaeSimulationRunEntry[]>([
    {
      id: "run-1",
      name: "Run 1",
      status: "finished",
    },
  ]);
  const [liveVtkBuffer, setLiveVtkBuffer] = useState<Uint8Array | null>(null);
  const [caeJobStatus, setCaeJobStatus] = useState<{
    state: "idle" | "meshing" | "solving" | "finished" | "error";
    label: string;
    progress?: number;
  }>({ state: "idle", label: "Ready" });
  const [caeFieldBounds, setCaeFieldBounds] = useState<{ min: number; max: number }>({ min: 0, max: 180 });
  const [pickedFaceSet, setPickedFaceSet] = useState<string | null>(null);
  const [partOverrides, setPartOverrides] = useState<
    Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }>
  >({});
  const [explosionFactor, setExplosionFactor] = useState<number>(0);

  const effectiveVtkBuffer = vtkBuffer ?? liveVtkBuffer;
  const hasCaeContext = Boolean(caeSourceCode || effectiveVtkBuffer);
  const cutLineSamples = useMemo(
    () => (caePostView ? sampleVtkCutLine(effectiveVtkBuffer, activeCaeField) : []),
    [caePostView, effectiveVtkBuffer, activeCaeField],
  );
  const caeModel = useMemo(
    () =>
      hasCaeContext
        ? buildCaeSimulationModel(
            caeSourceCode ?? "",
            components.map((c) => ({ name: c.name, watertight: true })),
          )
        : null,
    [hasCaeContext, caeSourceCode, components],
  );

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
    const visibleComponents = components.filter((c) => partOverrides[c.name]?.visible !== false);

    const applyAppearance = (c: CadComponent): CadComponent => {
      const ov = partOverrides[c.name];
      if (!ov || !c.proceduralMesh) return c;
      const baseRgba = c.proceduralMesh.color ?? [0.55, 0.6, 0.68, 1.0];
      let nextRgba: [number, number, number, number] = [...baseRgba];
      if (ov.color) {
        const col = new THREE.Color(ov.color);
        nextRgba = [col.r, col.g, col.b, nextRgba[3]];
      }
      if (ov.ghost) {
        nextRgba = [nextRgba[0], nextRgba[1], nextRgba[2], 0.28];
      }
      return {
        ...c,
        proceduralMesh: {
          ...c.proceduralMesh,
          color: nextRgba,
          material: ov.material || c.proceduralMesh.material,
        },
      };
    };

    if (explosionFactor <= 0 || visibleComponents.length <= 1) {
      return visibleComponents.map(applyAppearance);
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const c of visibleComponents) {
      const p = c.cad?.position ?? [0, 0, 0];
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    cx /= visibleComponents.length;
    cy /= visibleComponents.length;
    cz /= visibleComponents.length;
    return visibleComponents.map((c, idx) => {
      const p = c.cad?.position ?? [0, 0, 0];
      let dx = p[0] - cx;
      let dy = p[1] - cy;
      let dz = p[2] - cz;
      if (Math.hypot(dx, dy, dz) < 1e-4) {
        const angle = (idx / visibleComponents.length) * Math.PI * 2;
        dx = Math.cos(angle);
        dz = Math.sin(angle);
      }
      return applyAppearance({
        ...c,
        cad: {
          ...c.cad,
          position: [p[0] + dx * explosionFactor, p[1] + dy * explosionFactor, p[2] + dz * explosionFactor] as [
            number,
            number,
            number,
          ],
        },
      });
    });
  }, [components, explosionFactor, partOverrides]);

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

  // Reset inline dimension drafts when selected component or its dimensions change
  useEffect(() => {
    setDimDrafts({});
  }, [
    selectedComponent?.name,
    selectedComponent?.sourceMetadata?.dimensions?.[0],
    selectedComponent?.sourceMetadata?.dimensions?.[1],
    selectedComponent?.sourceMetadata?.dimensions?.[2],
  ]);

  // Clear face tag draft or mate state if mode changes
  useEffect(() => {
    if (gizmoMode !== "tag_face") {
      setFaceTagDraft(null);
    }
    if (gizmoMode !== "mate") {
      setMatePartA(null);
      setMateDraft(null);
    }
  }, [gizmoMode, selectedName]);

  // Direct-manipulation gizmo keyboard shortcuts (W/E/R/T/M/Escape)
  useEffect(() => {
    if ((!onCommitGizmoDelta && !onCommitAssemblyJoint) || typeof window === "undefined") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;
      const isEditable = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return true;
        if (el.closest?.(".monaco-editor")) return true;
        return false;
      };
      if (isEditable(target) || isEditable(activeEl)) return;

      const key = e.key.toLowerCase();
      if (key === "escape") {
        if (mateDraft || matePartA) {
          setMateDraft(null);
          setMatePartA(null);
          return;
        }
        setFaceTagDraft((prev) => {
          if (prev) return null;
          setGizmoMode("select");
          return null;
        });
      } else if (key === "w" && onCommitGizmoDelta) {
        setGizmoMode("translate");
      } else if (key === "e" && onCommitGizmoDelta) {
        setGizmoMode("rotate");
      } else if (key === "r" && onCommitGizmoDelta) {
        setGizmoMode("scale");
      } else if (key === "t" && onCommitFaceTag) {
        setGizmoMode("tag_face");
      } else if (key === "m") {
        setGizmoMode("mate");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCommitGizmoDelta, onCommitFaceTag, onCommitAssemblyJoint, mateDraft, matePartA]);

  const handleFaceTagClick = useCallback(
    (hit: FaceTagHit) => {
      if (!onCommitFaceTag) return;
      setFaceTagDraft({
        hit,
        portName: "port_1",
        portType: "fixed_support",
      });
    },
    [onCommitFaceTag],
  );

  const handleSceneSelect = useCallback(
    (name: string | null) => {
      onSelect?.(name);
      if (gizmoMode !== "mate") return;
      if (!name) {
        setMatePartA(null);
        setMateDraft(null);
        return;
      }
      if (!matePartA) {
        setMatePartA(name);
        setMateDraft(null);
      } else if (name !== matePartA) {
        setMateDraft({
          partA: matePartA,
          partB: name,
          jointName: `joint_${matePartA}_${name}`,
          jointType: "Revolute",
          axisKey: "z",
        });
      }
    },
    [onSelect, gizmoMode, matePartA],
  );

  const selectedDimensionFields = useMemo(() => {
    const dims = selectedComponent?.sourceMetadata?.dimensions;
    if (!dims || dims.length < 2) return [];
    const prim = (
      selectedComponent.sourceMetadata?.primitiveType ??
      selectedComponent.shapeType ??
      selectedComponent.name
    ).toLowerCase();
    if (prim.includes("sphere")) {
      return [{ index: 0, label: "R", value: dims[0]!, primitiveType: "sphere" }];
    }
    if (prim.includes("cylinder") || prim.includes("cone")) {
      return [
        { index: 0, label: "R", value: dims[0]!, primitiveType: "cylinder" },
        { index: 1, label: "H", value: dims[1]!, primitiveType: "cylinder" },
      ];
    }
    return [
      { index: 0, label: "X", value: dims[0]!, primitiveType: "cube" },
      { index: 1, label: "Y", value: dims[1]!, primitiveType: "cube" },
      ...(dims.length >= 3 ? [{ index: 2, label: "Z", value: dims[2]!, primitiveType: "cube" }] : []),
    ];
  }, [selectedComponent]);

  const clearDimDraft = useCallback((dimIndex: number) => {
    setDimDrafts((prev) => {
      const next: Record<number, string> = {};
      for (const [key, val] of Object.entries(prev)) {
        const numKey = Number(key);
        if (numKey !== dimIndex) {
          next[numKey] = val;
        }
      }
      return next;
    });
  }, []);

  const commitDimensionInput = useCallback(
    (dimIndex: number, rawValue: string, currentValue: number, primitiveType: string) => {
      if (!selectedComponent || !onCommitDimensionDelta) return;
      const parsed = parseFloat(rawValue);
      if (!Number.isFinite(parsed) || parsed <= 0 || Math.abs(parsed - currentValue) < 1e-6) {
        clearDimDraft(dimIndex);
        return;
      }
      onCommitDimensionDelta({
        componentName: selectedComponent.name,
        dimensionIndex: dimIndex,
        newValue: parsed,
        primitiveType,
        sourceMetadata: selectedComponent.sourceMetadata,
      });
      clearDimDraft(dimIndex);
    },
    [selectedComponent, onCommitDimensionDelta, clearDimDraft],
  );

  const handleRevealComponentSource = useCallback(() => {
    if (!selectedComponent || !onRevealLine) return;
    const offset = selectedComponent.sourceMetadata?.startOffset;
    if (offset === undefined) return;
    const text = sourceCode ?? caeSourceCode;
    const line =
      typeof text === "string" && text.length > 0
        ? text.slice(0, Math.max(0, Math.min(offset, text.length))).split("\n").length
        : 1;
    onRevealLine(line, selectedComponent.sourceMetadata?.parameterName ?? selectedComponent.name);
  }, [selectedComponent, onRevealLine, sourceCode, caeSourceCode]);

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
          background: dark ? "#121214" : "#f8fafc",
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
      <div style={{ height: "100%", position: "relative", background: dark ? "#121214" : "#f8fafc" }}>
        {onOpenVrRotunda && (
          <div
            style={{
              position: "absolute",
              top: fitInsets ? fitInsets.top : 14,
              right: fitInsets ? fitInsets.right : 14,
              zIndex: 10,
            }}
          >
            <button
              type="button"
              data-testid="cad-viewer-open-vr-rotunda"
              onClick={onOpenVrRotunda}
              title="Launch full Engineering VR Rotunda (45° Drafting Podium, 5 Environments, CAE Overlays & WebXR)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 12px",
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
                color: "#ffffff",
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
              }}
            >
              <span aria-hidden="true">🥽</span>
              <span>VR Rotunda</span>
            </button>
          </div>
        )}
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
          maxWidth: fitInsets ? `calc(100% - ${fitInsets.left + fitInsets.right}px)` : "calc(100% - 28px)",
          boxSizing: "border-box",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          padding: "5px 10px",
          background: dark ? "rgba(15, 23, 42, 0.82)" : "rgba(255, 255, 255, 0.9)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderRadius: 18,
          border: `1px solid ${dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)"}`,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          color: dark ? "#e2e8f0" : "#1f2328",
          flexWrap: "wrap",
        }}
      >
        {(onCommitGizmoDelta || onCommitAssemblyJoint) && (
          <>
            {(
              [
                { mode: "select", label: "Select", title: "Select mode (Esc)" },
                ...(onCommitGizmoDelta
                  ? [
                      { mode: "translate" as const, label: "Move (W)", title: "Translate gizmo (W)" },
                      { mode: "rotate" as const, label: "Rotate (E)", title: "Rotate gizmo (E)" },
                      { mode: "scale" as const, label: "Scale (R)", title: "Scale gizmo (R)" },
                    ]
                  : []),
                ...(onCommitFaceTag
                  ? [
                      {
                        mode: "tag_face" as const,
                        label: "Tag Face (T)",
                        title: "Tag a 3D face as a port/boundary (T)",
                      },
                    ]
                  : []),
                { mode: "mate" as const, label: "Mate (M)", title: "Mate two 3D parts with an assembly joint (M)" },
              ] as Array<{ mode: GizmoMode; label: string; title: string }>
            ).map((btn) => {
              const active = gizmoMode === btn.mode;
              return (
                <button
                  key={btn.mode}
                  type="button"
                  onClick={() => setGizmoMode(btn.mode)}
                  title={btn.title}
                  style={{
                    background: active ? "rgba(6, 182, 212, 0.24)" : "transparent",
                    color: active ? "#06b6d4" : "inherit",
                    border: active ? "1px solid rgba(6, 182, 212, 0.5)" : "1px solid transparent",
                    borderRadius: 12,
                    padding: "2px 7px",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {btn.label}
                </button>
              );
            })}
            <span style={{ opacity: 0.4 }}>|</span>
          </>
        )}
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
        <span style={{ opacity: 0.4 }}>|</span>
        <button
          type="button"
          onClick={() => setShowEdges((s) => !s)}
          title="Toggle Onshape-style shaded crease edges"
          style={{
            background: showEdges ? "rgba(6, 182, 212, 0.22)" : "transparent",
            color: showEdges ? "#06b6d4" : "inherit",
            border: showEdges ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
            borderRadius: 12,
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          EDGES
        </button>
        <button
          type="button"
          onClick={() => setEnableSsao((s) => !s)}
          title="Toggle cavity Ambient Occlusion (SSAO)"
          style={{
            background: enableSsao ? "rgba(6, 182, 212, 0.22)" : "transparent",
            color: enableSsao ? "#06b6d4" : "inherit",
            border: enableSsao ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
            borderRadius: 12,
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          AO
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !autoTurntable;
            setAutoTurntable(next);
            setAssemblyVisibility((v) => ({ ...v, autoTurntable: next }));
          }}
          title="Toggle Turntable Auto-Rotate"
          style={{
            background: autoTurntable ? "rgba(34, 197, 94, 0.22)" : "transparent",
            color: autoTurntable ? "#22c55e" : "inherit",
            border: autoTurntable ? "1px solid rgba(34, 197, 94, 0.45)" : "1px solid transparent",
            borderRadius: 12,
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          TURNTABLE
        </button>
        {components.length > 1 && (
          <button
            type="button"
            onClick={() => setShowSubsystems((s) => !s)}
            title="Toggle Assembly Subsystem Isolation Inspector"
            style={{
              background: showSubsystems ? "rgba(249, 115, 22, 0.22)" : "transparent",
              color: showSubsystems ? "#f97316" : "inherit",
              border: showSubsystems ? "1px solid rgba(249, 115, 22, 0.45)" : "1px solid transparent",
              borderRadius: 12,
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            SUBSYSTEMS
          </button>
        )}
        {hasCaeContext && (
          <button
            type="button"
            onClick={() => setShowSimTree((s) => !s)}
            title="Toggle SimScale-style Simulation Tree"
            style={{
              background: showSimTree ? "rgba(6, 182, 212, 0.22)" : "transparent",
              color: showSimTree ? "#06b6d4" : "inherit",
              border: showSimTree ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
              borderRadius: 12,
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            SIM TREE
          </button>
        )}
        {components.length > 0 && (
          <button
            type="button"
            onClick={() => setShowInstances((s) => !s)}
            title="Toggle Assembly Instances & Appearances"
            style={{
              background: showInstances ? "rgba(6, 182, 212, 0.22)" : "transparent",
              color: showInstances ? "#06b6d4" : "inherit",
              border: showInstances ? "1px solid rgba(6, 182, 212, 0.45)" : "1px solid transparent",
              borderRadius: 12,
              padding: "2px 7px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            PARTS ({components.length})
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
        {(onOpenVrRotunda || (xrCaps.vrSupported && xrStore)) && (
          <>
            <span style={{ opacity: 0.4 }}>|</span>
            {onOpenVrRotunda ? (
              <button
                type="button"
                data-testid="cad-viewer-open-vr-rotunda"
                onClick={onOpenVrRotunda}
                title="Launch full Engineering VR Rotunda (45° Drafting Podium, 5 Environments, CAE Overlays & WebXR)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 10px",
                  borderRadius: 999,
                  border: "none",
                  background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
                  color: "#ffffff",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: "0 2px 10px rgba(99, 102, 241, 0.35)",
                }}
              >
                <span aria-hidden="true">🥽</span>
                <span>VR Rotunda</span>
              </button>
            ) : (
              xrCaps.vrSupported &&
              xrStore && (
                <button
                  type="button"
                  data-testid="cad-viewer-enter-vr"
                  onClick={() => {
                    void enterXrSession(xrStore, "vr").then((result) => {
                      if (!result.ok && result.error) {
                        setError(result.error);
                      }
                    });
                  }}
                  title="Enter immersive WebXR VR headset session"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 9px",
                    borderRadius: 999,
                    border: "1px solid rgba(139, 92, 246, 0.65)",
                    background: "rgba(99, 102, 241, 0.25)",
                    color: dark ? "#e0e7ff" : "#3730a3",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Enter VR
                </button>
              )
            )}
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
            flexDirection: "column",
            gap: 8,
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🧊</span>
            <div>
              <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span>{selectedComponent.name}</span>
                {selectedComponent.sourceMetadata?.parameterName && (
                  <span
                    style={{
                      fontSize: "10px",
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "1px 6px",
                      borderRadius: "10px",
                      background: "rgba(6, 182, 212, 0.18)",
                      color: "#06b6d4",
                      border: "1px solid rgba(6, 182, 212, 0.35)",
                      fontWeight: 600,
                    }}
                    title="Parametric source identifier"
                  >
                    {selectedComponent.sourceMetadata.parameterName}
                  </span>
                )}
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
            {selectedComponent.sourceMetadata?.startOffset !== undefined && onRevealLine && (
              <button
                type="button"
                onClick={handleRevealComponentSource}
                style={{
                  padding: "4px 8px",
                  background: dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
                  color: dark ? "#e2e8f0" : "#1f2328",
                  border: `1px solid ${dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)"}`,
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title="Jump to component definition in source code"
              >
                Go to Source
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsBindingPickerOpen(true)}
              style={{
                marginLeft: 2,
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

          {onCommitDimensionDelta && selectedDimensionFields.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 6,
                borderTop: `1px solid ${dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)"}`,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
            >
              {selectedDimensionFields.map((field) => {
                const draftVal = dimDrafts[field.index] ?? String(Number(field.value.toFixed(4)));
                const paramHint = selectedComponent.sourceMetadata?.dimensionParams?.[field.index];
                return (
                  <label
                    key={field.index}
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                    title={paramHint ? `${field.label} (${paramHint})` : `${field.label} dimension`}
                  >
                    <span style={{ color: dark ? "#94a3b8" : "#64748b", fontWeight: 700 }}>{field.label}</span>
                    <input
                      type="number"
                      step="any"
                      value={draftVal}
                      onChange={(e) =>
                        setDimDrafts((prev) => ({
                          ...prev,
                          [field.index]: e.target.value,
                        }))
                      }
                      onBlur={(e) =>
                        commitDimensionInput(field.index, e.target.value, field.value, field.primitiveType)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        } else if (e.key === "Escape") {
                          clearDimDraft(field.index);
                          e.currentTarget.blur();
                        }
                      }}
                      aria-label={`${field.label} dimension for ${selectedComponent.name}`}
                      style={{
                        width: 58,
                        padding: "2px 5px",
                        borderRadius: 5,
                        border: `1px solid ${dark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.16)"}`,
                        background: dark ? "rgba(15, 23, 42, 0.85)" : "#ffffff",
                        color: "inherit",
                        fontFamily: "inherit",
                        fontSize: 11,
                      }}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating Face Tagging Popover */}
      {faceTagDraft && onCommitFaceTag && (
        <div
          style={{
            position: "absolute",
            top: (fitInsets ? fitInsets.top : 14) + 52,
            right: fitInsets ? fitInsets.right : 14,
            zIndex: 20,
            width: 248,
            padding: "10px 12px",
            background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: 10,
            border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
            color: dark ? "#f0f6fc" : "#1f2328",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 12, color: "#06b6d4" }}>Tag Face · {faceTagDraft.hit.componentName}</strong>
            <button
              type="button"
              onClick={() => setFaceTagDraft(null)}
              aria-label="Close face tag popover"
              style={{
                background: "transparent",
                border: "none",
                color: dark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
          {faceTagDraft.hit.normal && (
            <div style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", opacity: 0.75 }}>
              n = [{faceTagDraft.hit.normal.map((v) => v.toFixed(2)).join(", ")}]
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Port Name</span>
            <input
              type="text"
              value={faceTagDraft.portName}
              onChange={(e) => setFaceTagDraft((prev) => (prev ? { ...prev, portName: e.target.value } : null))}
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Port / Boundary Type</span>
            <select
              value={faceTagDraft.portType}
              onChange={(e) => setFaceTagDraft((prev) => (prev ? { ...prev, portType: e.target.value } : null))}
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontSize: 11,
              }}
            >
              <option value="fixed_support">fixed_support</option>
              <option value="force_load">force_load</option>
              <option value="thermal_boundary">thermal_boundary</option>
              <option value="fluid_inlet">fluid_inlet</option>
              <option value="mechanical_frame">mechanical_frame</option>
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
            <button
              type="button"
              onClick={() => setFaceTagDraft(null)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
                background: "transparent",
                color: "inherit",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const portName = faceTagDraft.portName.trim() || "port_1";
                onCommitFaceTag({
                  componentName: faceTagDraft.hit.componentName,
                  portName,
                  portType: faceTagDraft.portType,
                  normal: faceTagDraft.hit.normal,
                  worldPos: faceTagDraft.hit.worldPos,
                  sourceMetadata: faceTagDraft.hit.sourceMetadata,
                });
                setFaceTagDraft(null);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                background: "#06b6d4",
                color: "#0f172a",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Tag Face
            </button>
          </div>
        </div>
      )}

      {/* Floating Mate Mode Status Hint (waiting for Part B) */}
      {gizmoMode === "mate" && matePartA && !mateDraft && (
        <div
          style={{
            position: "absolute",
            top: (fitInsets ? fitInsets.top : 14) + 52,
            right: fitInsets ? fitInsets.right : 14,
            zIndex: 20,
            padding: "6px 10px",
            background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderRadius: 10,
            border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.25)",
            color: dark ? "#f0f6fc" : "#1f2328",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>
            <strong style={{ color: "#06b6d4" }}>Mate:</strong> {matePartA} → click second part
          </span>
          <button
            type="button"
            onClick={() => setMatePartA(null)}
            aria-label="Clear first mate part"
            style={{
              background: "transparent",
              border: "none",
              color: dark ? "#94a3b8" : "#64748b",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating Assembly Joint (Mate) Popover */}
      {mateDraft && (
        <div
          style={{
            position: "absolute",
            top: (fitInsets ? fitInsets.top : 14) + 52,
            right: fitInsets ? fitInsets.right : 14,
            zIndex: 20,
            width: 256,
            padding: "10px 12px",
            background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: 10,
            border: `1px solid ${dark ? "rgba(6, 182, 212, 0.45)" : "rgba(6, 182, 212, 0.35)"}`,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
            color: dark ? "#f0f6fc" : "#1f2328",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 12, color: "#06b6d4" }}>
              Mate · {mateDraft.partA} ↔ {mateDraft.partB}
            </strong>
            <button
              type="button"
              onClick={() => {
                setMateDraft(null);
                setMatePartA(null);
              }}
              aria-label="Close assembly joint popover"
              style={{
                background: "transparent",
                border: "none",
                color: dark ? "#94a3b8" : "#64748b",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Joint Name</span>
            <input
              type="text"
              value={mateDraft.jointName}
              onChange={(e) => setMateDraft((prev) => (prev ? { ...prev, jointName: e.target.value } : null))}
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Joint Type</span>
            <select
              value={mateDraft.jointType}
              onChange={(e) =>
                setMateDraft((prev) =>
                  prev ? { ...prev, jointType: e.target.value as CommitAssemblyJointPayload["jointType"] } : null,
                )
              }
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontSize: 11,
              }}
            >
              <option value="Revolute">Revolute</option>
              <option value="Prismatic">Prismatic</option>
              <option value="Cylindrical">Cylindrical</option>
              <option value="Spherical">Spherical</option>
              <option value="Fixed">Fixed</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>Axis</span>
            <select
              value={mateDraft.axisKey}
              onChange={(e) =>
                setMateDraft((prev) => (prev ? { ...prev, axisKey: e.target.value as "z" | "y" | "x" } : null))
              }
              style={{
                padding: "4px 7px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)"}`,
                background: dark ? "#0f172a" : "#ffffff",
                color: "inherit",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
            >
              <option value="z">Z [0, 0, 1]</option>
              <option value="y">Y [0, 1, 0]</option>
              <option value="x">X [1, 0, 0]</option>
            </select>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 2 }}>
            <button
              type="button"
              onClick={() => {
                setMateDraft(null);
                setMatePartA(null);
              }}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"}`,
                background: "transparent",
                color: "inherit",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const axisMap: Record<"z" | "y" | "x", [number, number, number]> = {
                  z: [0, 0, 1],
                  y: [0, 1, 0],
                  x: [1, 0, 0],
                };
                const jointName = mateDraft.jointName.trim() || `joint_${mateDraft.partA}_${mateDraft.partB}`;
                onCommitAssemblyJoint?.({
                  jointName,
                  jointType: mateDraft.jointType,
                  partA: mateDraft.partA,
                  partB: mateDraft.partB,
                  axis: axisMap[mateDraft.axisKey],
                });
                setMateDraft(null);
                setMatePartA(null);
                onSelect?.(null);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                background: "#06b6d4",
                color: "#0f172a",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Create Joint
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Assembly Instances & Appearances Panel */}
      {showInstances && components.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: (fitInsets ? fitInsets.top : 14) + (selectedComponent ? 64 : 0),
            left: fitInsets ? fitInsets.left : 14,
            zIndex: 10,
            width: 268,
            maxHeight: "min(62vh, 460px)",
            overflowY: "auto",
            padding: "10px 12px",
            background: dark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.94)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: 12,
            border: `1px solid ${dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)"}`,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
            color: dark ? "#e2e8f0" : "#1f2328",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 12 }}>Instances ({components.length})</strong>
            <button
              type="button"
              onClick={() => setPartOverrides({})}
              style={{
                background: "transparent",
                border: "none",
                color: "#06b6d4",
                fontSize: 11,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Reset
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {components.map((comp) => {
              const ov = partOverrides[comp.name] ?? {};
              const isHidden = ov.visible === false;
              const isGhost = Boolean(ov.ghost);
              const isSel = selectedName === comp.name;
              const rgba = comp.proceduralMesh?.color;
              const defaultHex =
                rgba && rgba.length >= 3 ? `#${new THREE.Color(rgba[0], rgba[1], rgba[2]).getHexString()}` : "#4782b5";
              return (
                <div
                  key={comp.name}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: isSel
                      ? dark
                        ? "rgba(6, 182, 212, 0.16)"
                        : "rgba(6, 182, 212, 0.12)"
                      : dark
                        ? "rgba(255, 255, 255, 0.04)"
                        : "rgba(0, 0, 0, 0.03)",
                    border: `1px solid ${isSel ? "rgba(6, 182, 212, 0.5)" : "transparent"}`,
                    opacity: isHidden ? 0.48 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(comp.name)}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        fontWeight: isSel ? 700 : 500,
                        fontSize: 11,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                        padding: 0,
                      }}
                      title={comp.name}
                    >
                      {comp.name}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPartOverrides((prev) => ({
                          ...prev,
                          [comp.name]: { ...prev[comp.name], visible: isHidden },
                        }))
                      }
                      title={isHidden ? "Show part" : "Hide part"}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: isHidden ? "#94a3b8" : "inherit",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: "0 2px",
                      }}
                    >
                      {isHidden ? "🚫" : "👁"}
                    </button>
                    {comp.proceduralMesh && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setPartOverrides((prev) => ({
                              ...prev,
                              [comp.name]: { ...prev[comp.name], ghost: !isGhost },
                            }))
                          }
                          title="Toggle translucent housing (ghost)"
                          style={{
                            background: isGhost ? "rgba(6, 182, 212, 0.2)" : "transparent",
                            border: "none",
                            borderRadius: 4,
                            color: isGhost ? "#06b6d4" : "inherit",
                            cursor: "pointer",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 4px",
                          }}
                        >
                          α
                        </button>
                        <input
                          type="color"
                          value={ov.color ?? defaultHex}
                          onChange={(e) =>
                            setPartOverrides((prev) => ({
                              ...prev,
                              [comp.name]: { ...prev[comp.name], color: e.target.value },
                            }))
                          }
                          aria-label={`Color for ${comp.name}`}
                          style={{
                            width: 18,
                            height: 18,
                            border: "none",
                            padding: 0,
                            background: "transparent",
                            cursor: "pointer",
                          }}
                        />
                      </>
                    )}
                  </div>
                  {comp.proceduralMesh && (
                    <select
                      value={ov.material ?? ""}
                      onChange={(e) =>
                        setPartOverrides((prev) => ({
                          ...prev,
                          [comp.name]: { ...prev[comp.name], material: e.target.value || undefined },
                        }))
                      }
                      aria-label={`Material for ${comp.name}`}
                      style={{
                        marginTop: 4,
                        width: "100%",
                        fontSize: 10,
                        padding: "2px 4px",
                        borderRadius: 4,
                        background: dark ? "#0f172a" : "#ffffff",
                        color: "inherit",
                        border: `1px solid ${dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.14)"}`,
                      }}
                    >
                      <option value="">Auto Material</option>
                      <option value="ABS Plastic">Molded ABS Plastic</option>
                      <option value="Matte Polymer">Matte Polymer</option>
                      <option value="Rubber">Elastomer Rubber</option>
                      <option value="Gloss Paint">Gloss Paint</option>
                      <option value="Clear Polycarbonate">Clear Polycarbonate</option>
                      <option value="Anodized Aluminum">Anodized Aluminum</option>
                      <option value="Cast Aluminum">Cast Aluminum</option>
                      <option value="Stainless Steel">Stainless Steel</option>
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SimScale-style CAE Simulation Tree */}
      {hasCaeContext && showSimTree && caeModel && (
        <div
          style={{
            position: "absolute",
            top: (fitInsets ? fitInsets.top : 14) + (selectedComponent ? 64 : 0),
            left: fitInsets ? fitInsets.left : 14,
            bottom: fitInsets ? fitInsets.bottom : 14,
            zIndex: 11,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            pointerEvents: "none",
          }}
        >
          <CaeSimulationTree
            model={caeModel}
            runs={caeRuns}
            dark={dark}
            selectedItemId={selectedTreeId}
            activeField={activeCaeField}
            jobStatus={caeJobStatus}
            pickedTargetSet={pickedFaceSet ?? selectedName ?? undefined}
            onGenerateMesh={(fineness) => {
              const span = Math.max(0.5, sceneBounds.radius);
              const firstSurf = effectiveComponents.find(
                (c) => c.proceduralMesh && c.proceduralMesh.vertices.length >= 12,
              )?.proceduralMesh;
              const surfaceMesh = firstSurf ? { vertices: firstSurf.vertices, indices: firstSurf.indices } : undefined;
              setCaeJobStatus({
                state: "meshing",
                label: caeModel.dialect === "cfd" ? "Meshing fluid enclosure..." : "Generating Tet4 mesh...",
                progress: 0.35,
              });
              void generateLocalTetMeshAsync(
                fineness,
                [span, span * 0.6, span * 0.6],
                surfaceMesh,
                caeModel.dialect === "cfd" ? 1.5 : undefined,
              ).then((meshRes) => {
                setLiveVtkBuffer(meshRes.vtkBuffer);
                setCaeFieldBounds({ min: 0, max: meshRes.maxAspectRatio });
                setActiveCaeField("Element Quality");
                setCaeJobStatus({
                  state: "finished",
                  label: `Meshed (${meshRes.elementCount} tets)`,
                  progress: 1,
                });
              });
            }}
            onSelectItem={(item) => {
              setSelectedTreeId(item.id);
              if (item.line) onRevealLine?.(item.line, item.targetSet);
            }}
            onInsertSnippet={onInsertCaeSnippet ? (_section, snippet) => onInsertCaeSnippet(snippet) : undefined}
            onTriggerRun={() => {
              const nextNum = caeRuns.length + 1;
              const runId = `run-${nextNum}`;
              const runName = `Run ${nextNum}`;
              void (async () => {
                try {
                  if (caeModel.dialect === "cfd") {
                    const res = await runLocalCfdStudyAsync(caeSourceCode ?? "", runId, runName, (ev) =>
                      setCaeJobStatus(ev),
                    );
                    setLiveVtkBuffer(res.vtkBuffer);
                    setCaeFieldBounds({ min: res.minVelocity, max: res.maxVelocity });
                    setActiveCaeField("Velocity Magnitude");
                    setCaeRuns((prev) => [...prev, res.runEntry]);
                  } else {
                    const res = await runLocalFeaStudyAsync(caeSourceCode ?? "", runId, runName, (ev) =>
                      setCaeJobStatus(ev),
                    );
                    setLiveVtkBuffer(res.vtkBuffer);
                    setCaeFieldBounds({ min: res.minStressMpa, max: res.maxStressMpa });
                    setActiveCaeField("Von Mises Stress");
                    setCaeRuns((prev) => [...prev, res.runEntry]);
                  }
                  setCaePostView({ mode: "convergence", runId });
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  setCaeJobStatus({ state: "error", label: "Error" });
                  setCaeRuns((prev) => [
                    ...prev,
                    { id: runId, name: runName, status: "failed", logLines: [`[error] ${msg}`] },
                  ]);
                  setCaePostView({ mode: "log", runId });
                }
              })();
            }}
            onSelectField={(field) => setActiveCaeField(field)}
            onOpenPostView={(view, runId) => {
              if (view === "fields") {
                setActiveCaeField(caeModel.dialect === "cfd" ? "Velocity Magnitude" : "Von Mises Stress");
              } else {
                setCaePostView((prev) =>
                  prev && prev.mode === view && prev.runId === runId ? null : { mode: view, runId },
                );
              }
            }}
          />
          {caePostView && (
            <CaePostProcessDrawer
              mode={caePostView.mode}
              run={caeRuns.find((r) => r.id === caePostView.runId) ?? caeRuns[0]!}
              allRuns={caeRuns}
              cutLineSamples={cutLineSamples}
              dark={dark}
              onClose={() => setCaePostView(null)}
            />
          )}
        </div>
      )}

      {hasCaeContext && activeCaeField && (
        <div
          style={{
            position: "absolute",
            bottom: (fitInsets ? fitInsets.bottom : 14) + 12,
            right: (fitInsets ? fitInsets.right : 14) + 110,
            zIndex: 10,
          }}
        >
          <ScalarColorbarLegend
            title={activeCaeField}
            unit={activeCaeField.includes("Stress") ? "MPa" : activeCaeField.includes("Velocity") ? "m/s" : undefined}
            minLabel={caeFieldBounds.min.toFixed(2)}
            maxLabel={caeFieldBounds.max.toFixed(2)}
            dark={dark}
          />
        </div>
      )}

      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [3, 2.5, 3], fov: 50 }}
        gl={{ antialias: true, stencil: true, toneMapping: THREE.ACESFilmicToneMapping, localClippingEnabled: true }}
        style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
        onError={(e) => setError(String(e))}
      >
        {(() => {
          const sceneProps: Omit<SceneContentsProps, "isInXr"> = {
            components: effectiveComponents,
            assetBaseUrl,
            selectedName,
            gizmoMode,
            isDraggingGizmo,
            onDraggingGizmoChange: setIsDraggingGizmo,
            onCommitGizmoDelta,
            onFaceTagClick: onCommitFaceTag ? handleFaceTagClick : undefined,
            onSelect: handleSceneSelect,
            dark,
            animationController,
            vtkBuffer: effectiveVtkBuffer,
            touchScrollPassThrough,
            solidPlane,
            wirePlane,
            sectionSplit: sectionSplit && clipAxis !== "none",
            autoSweep,
            clipSpan,
            gdtOverlay,
            showGdt,
            showEdges,
            enableSsao,
            activeCaeField,
            onPickFace: hasCaeContext ? (label) => setPickedFaceSet(label) : undefined,
            sceneBounds,
            fitInsets,
            autoTurntable: autoTurntable || assemblyVisibility.autoTurntable,
            jetPlume,
            assemblyVisibility,
          };
          return (
            <Suspense fallback={null}>
              {xrStore ? (
                <XR store={xrStore}>
                  <Suspense fallback={null}>
                    <XrSceneContentsBridge {...sceneProps} />
                  </Suspense>
                </XR>
              ) : (
                <SceneContents {...sceneProps} isInXr={false} />
              )}
            </Suspense>
          );
        })()}
      </Canvas>

      {/* Floating Assembly Subsystem Isolation & Display Inspector */}
      {showSubsystems && components.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: (fitInsets?.top ?? 0) + 52,
            right: (fitInsets?.right ?? 0) + 12,
            zIndex: 25,
          }}
        >
          <AssemblyInspectorPanel
            subsystems={inferSubsystemsFromPartNames(components.map((c) => ({ name: c.name })))}
            visibility={assemblyVisibility}
            dark={dark}
            onChangeVisibility={(next) => {
              setAssemblyVisibility(next);
              setAutoTurntable(next.autoTurntable);
              setPartOverrides((prev) => {
                const updated = { ...prev };
                for (const c of components) {
                  const subId = inferSubsystemsFromPartNames([{ name: c.name }])[0]?.id ?? "general";
                  const pres = resolvePartPresentation(subId, next, {
                    isDefaultGhostable: subId === "shell" || subId === "mantle",
                    ghostNonIsolated: true,
                  });
                  updated[c.name] = {
                    ...updated[c.name],
                    visible: pres.visible,
                    ghost: pres.ghosted,
                  };
                }
                return updated;
              });
            }}
          />
        </div>
      )}

      {/* Animation timeline overlay */}
      {animationController && (
        <AnimationTimeline
          controller={animationController}
          breachMarkers={breachMarkers}
          missionPhases={missionPhases}
          operationLog={operationLog}
          fitInsets={fitInsets}
        />
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
