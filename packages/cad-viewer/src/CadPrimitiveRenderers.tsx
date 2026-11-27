// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-component 3D mesh, GLTF, port indicator, and transform-gizmo renderers for CadViewer.
 */

import { Html, TransformControls, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type React from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import {
  resolveModelicaUri,
  type CadComponent,
  type FaceTagHit,
  type GizmoCommitPayload,
  type GizmoMode,
  type ProceduralMeshData,
} from "./cad-viewer-helpers";
import { useRetainGltfUrl } from "./gltf-cache-guard";
import {
  buildCleanCreaseEdgeGeometry,
  CadEdgeOverlay,
  ensureGeometryBrushedUvs,
  resolveHeroAlloyConfig,
  SplitSectionGeometryPasses,
} from "./HeroCadMaterials";

/** Port indicator sphere rendered at a CADPort position. */
export function PortIndicator({
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
export function ProceduralMeshObject({
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
export function GltfMeshObject({
  url,
  solidPlane = null,
  showEdges = true,
  dark = false,
  ghost = false,
}: {
  url: string;
  solidPlane?: THREE.Plane | null | undefined;
  showEdges?: boolean | undefined;
  dark?: boolean | undefined;
  ghost?: boolean | undefined;
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
            c.userData.__origMaterialState = {
              transparent: c.transparent,
              opacity: c.opacity,
              depthWrite: c.depthWrite,
            };
            mats.push(c);
            return c;
          });
          mesh.material = next;
        } else if (mesh.material) {
          const c = mesh.material.clone();
          c.userData.__origMaterialState = {
            transparent: c.transparent,
            opacity: c.opacity,
            depthWrite: c.depthWrite,
          };
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
            const prevTransparent = m.transparent;
            const orig = m.userData.__origMaterialState as
              { transparent: boolean; opacity: number; depthWrite: boolean } | undefined;
            m.clippingPlanes = planes;
            m.clipShadows = true;
            m.polygonOffset = showEdges;
            m.polygonOffsetFactor = 1;
            m.polygonOffsetUnits = 1;
            if (ghost) {
              m.transparent = true;
              m.opacity = 0.24;
              m.depthWrite = false;
            } else if (orig) {
              m.transparent = orig.transparent;
              m.opacity = orig.opacity;
              m.depthWrite = orig.depthWrite;
            }
            if (prevHasClip !== hasClip || prevTransparent !== m.transparent) {
              m.needsUpdate = true;
            }
          }
        }
        if (showEdges && mesh.geometry) {
          const edgeGeo = buildCleanCreaseEdgeGeometry(mesh.geometry, 32);
          const edgeMat = new THREE.LineBasicMaterial({
            color: dark ? "#0f172a" : "#111827",
            transparent: true,
            opacity: ghost ? 0.35 : 0.78,
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
  }, [cloned, solidPlane, showEdges, dark, ghost]);

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
export function CadModel({
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
  ghost = false,
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
  ghost?: boolean | undefined;
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
  const trailCount = useRef(0);

  const { trailLine, trailGeo, trailPositions } = useMemo(() => {
    const positions = new Float32Array(maxTrailPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color: "#ff6b35", transparent: true, opacity: 0.6, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return { trailLine: line, trailGeo: geo, trailPositions: positions };
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
        trailPositions.copyWithin(0, 3);
        trailCount.current = maxTrailPoints - 1;
      }
      const idx = trailCount.current;
      trailPositions[idx * 3] = tf.position[0];
      trailPositions[idx * 3 + 1] = tf.position[1];
      trailPositions[idx * 3 + 2] = tf.position[2];
      trailCount.current++;

      trailGeo.setDrawRange(0, trailCount.current);
      trailGeo.attributes.position!.needsUpdate = true;
    } else if (!selected && trailCount.current > 0) {
      trailCount.current = 0;
      trailGeo.setDrawRange(0, 0);
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
            <GltfMeshObject url={url} solidPlane={solidPlane} showEdges={showEdges} dark={dark} ghost={ghost} />
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
