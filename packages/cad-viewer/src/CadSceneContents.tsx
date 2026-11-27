// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 3D Canvas scene graph (lights, grid, models, overlays, controls, and WebXR bridge) for CadViewer.
 */

import type { GdtOverlayPayload, Verification3DOverlayPayload } from "@modelscript/cad";
import { ContactShadows, GizmoHelper, GizmoViewport, Grid, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { AnimationController } from "./animation-controller";
import type { AssemblyVisibilityState } from "./assembly-visibility";
import { BarrierShellOverlay } from "./BarrierShellOverlay";
import { BoundaryPicker, type BoundaryActionPayload } from "./BoundaryPicker";
import type {
  AssignedBoundaryCondition,
  CadComponent,
  CfdDomainPreviewState,
  FaceTagHit,
  GizmoCommitPayload,
  GizmoMode,
} from "./cad-viewer-helpers";
import { CadModel } from "./CadPrimitiveRenderers";
import { CfdDomainGizmo } from "./CfdDomainGizmo";
import { DynamicClearanceVector } from "./DynamicClearanceVector";
import { Gdt3dOverlay, HeroStudioEnvironment, StencilSectionCapQuad, StudioSsaoPass } from "./HeroCadMaterials";
import type { AnsatzRelationalHypergraphRecord } from "./hypergraph-types";
import { InstancedCadAssembly } from "./InstancedCadAssembly";
import { JetPlumeRenderer, type JetPlumeRendererProps } from "./JetPlumeRenderer";
import { ReachabilityTubeOverlay } from "./ReachabilityTubeOverlay";
import { VtkRenderer, type VtkColormapId, type VtkProbePoint, type VtkSlicePlane } from "./VtkRenderer";
import type { WamTrajectoryWaypoint } from "./zonotope-3d-geometry";
import type { LinearConstraintSpec, ZonotopePendingOverride, ZonotopeWorkbenchState } from "./zonotope-workbench-state";
import { ZonotopeCadOverlay } from "./ZonotopeCadOverlay";

export interface SceneContentsProps {
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
  cameraResetTick?: number | undefined;
  verificationOverlay?: Verification3DOverlayPayload | null | undefined;
  showFlowpipe?: boolean | undefined;
  showBarrier?: boolean | undefined;
  cameraSyncGroup?: string | undefined;
  cfdDomainPreview?: CfdDomainPreviewState | null | undefined;
  nakedEdgeSegments?: Float32Array | undefined;
  isoSurfaceEnabled?: boolean | undefined;
  isoThreshold?: number | undefined;
  slicePlane?: VtkSlicePlane | null | undefined;
  onProbePoint?: ((probe: VtkProbePoint | null) => void) | undefined;
  deformationScale?: number | undefined;
  animateDeformation?: boolean | undefined;
  animateFlow?: boolean | undefined;
  showCaeStreamlines?: boolean | undefined;
  showCaeVectors?: boolean | undefined;
  caeTimestepFrames?: Uint8Array[] | undefined;
  activeVtkFrame?: number | undefined;
  ghostCadUnderlay?: boolean | undefined;
  showZonotopeOverlay?: boolean | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  zonotopeViolatingComponents?: string[] | undefined;
  zonotopeWamWaypoints?: WamTrajectoryWaypoint[] | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  onChangeCadToleranceFraction?: ((nextFraction: number) => void) | undefined;
  onChangeWamWaypointRadius?: ((waypointIndex: number, nextRadius: number) => void) | undefined;
  /** Interactive 3D boundary face picker surface & assigned 3D BC glyphs */
  boundaryPickerSurface?: { positions: Float32Array; indices: Uint32Array } | null | undefined;
  isPickBoundaryMode?: boolean | undefined;
  caeDialect?: "fea" | "cfd" | undefined;
  assignedBcs?: AssignedBoundaryCondition[] | undefined;
  onSelectBoundary?: ((action: BoundaryActionPayload) => void) | undefined;
  caeColormap?: VtkColormapId | undefined;
  caeLogScale?: boolean | undefined;
}

const CAD_CAMERA_SYNC_EVENT = "ansatz:cad-camera-sync";

interface CadCameraSyncEventDetail {
  syncGroup: string;
  sourceId: string;
  position: [number, number, number];
  target: [number, number, number];
}

/** Scene contents: lights, grid, models. */
export function SceneContents({
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
  cameraResetTick = 0,
  verificationOverlay = null,
  showFlowpipe = true,
  showBarrier = true,
  cameraSyncGroup,
  cfdDomainPreview = null,
  nakedEdgeSegments,
  isoSurfaceEnabled = false,
  isoThreshold = 0.5,
  slicePlane = null,
  onProbePoint,
  deformationScale = 0,
  animateDeformation = false,
  animateFlow = false,
  showCaeStreamlines = false,
  showCaeVectors = false,
  caeTimestepFrames,
  activeVtkFrame = 0,
  ghostCadUnderlay = false,
  showZonotopeOverlay = false,
  zonotopeWorkbenchState,
  hypergraphRecord = null,
  zonotopeViolatingComponents,
  zonotopeWamWaypoints,
  onSelectZonotopeGroup,
  onAddZonotopeOverride,
  onAddZonotopeConstraint,
  onChangeCadToleranceFraction,
  onChangeWamWaypointRadius,
  boundaryPickerSurface = null,
  isPickBoundaryMode = false,
  caeDialect = "fea",
  assignedBcs,
  onSelectBoundary,
  caeColormap = "turbo",
  caeLogScale = false,
}: SceneContentsProps) {
  const { gl, scene, camera, size } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const framedSignatureRef = useRef<string>("");
  const sweepPhaseRef = useRef(0);
  const cameraSyncInstanceIdRef = useRef<string>("");
  const isApplyingRemoteSyncRef = useRef(false);
  const lastSyncDispatchMsRef = useRef(0);
  const lastAppliedRemotePoseRef = useRef<{
    position: [number, number, number];
    target: [number, number, number];
  } | null>(null);

  const dispatchCameraSync = useCallback(
    (force = false) => {
      const group = cameraSyncGroup?.trim();
      if (!group || isInXr || isApplyingRemoteSyncRef.current || typeof window === "undefined") return;
      if (!cameraSyncInstanceIdRef.current) {
        cameraSyncInstanceIdRef.current = `cad-cam-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      }
      const controls = controlsRef.current;
      if (!controls?.target) return;

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (!force && now - lastSyncDispatchMsRef.current < 16) return;

      const position: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
      const target: [number, number, number] = [controls.target.x, controls.target.y, controls.target.z];

      const lastRemote = lastAppliedRemotePoseRef.current;
      if (lastRemote) {
        const eps = 1e-4;
        const samePos =
          Math.abs(position[0] - lastRemote.position[0]) < eps &&
          Math.abs(position[1] - lastRemote.position[1]) < eps &&
          Math.abs(position[2] - lastRemote.position[2]) < eps;
        const sameTarget =
          Math.abs(target[0] - lastRemote.target[0]) < eps &&
          Math.abs(target[1] - lastRemote.target[1]) < eps &&
          Math.abs(target[2] - lastRemote.target[2]) < eps;
        if (samePos && sameTarget) return;
        lastAppliedRemotePoseRef.current = null;
      }

      lastSyncDispatchMsRef.current = now;
      window.dispatchEvent(
        new CustomEvent<CadCameraSyncEventDetail>(CAD_CAMERA_SYNC_EVENT, {
          detail: {
            syncGroup: group,
            sourceId: cameraSyncInstanceIdRef.current,
            position,
            target,
          },
        }),
      );
    },
    [camera, cameraSyncGroup, isInXr],
  );

  // Listen for cross-pane 3D orbit camera sync events belonging to the same sync group
  useEffect(() => {
    const group = cameraSyncGroup?.trim();
    if (!group || isInXr || typeof window === "undefined") return;

    const handleRemoteCameraSync = (event: Event) => {
      const detail = (event as CustomEvent<CadCameraSyncEventDetail>).detail;
      if (!detail || detail.syncGroup !== group || detail.sourceId === cameraSyncInstanceIdRef.current) return;
      const controls = controlsRef.current;
      if (!controls?.target) return;
      const [px, py, pz] = detail.position;
      const [tx, ty, tz] = detail.target;
      if (
        !Number.isFinite(px) ||
        !Number.isFinite(py) ||
        !Number.isFinite(pz) ||
        !Number.isFinite(tx) ||
        !Number.isFinite(ty) ||
        !Number.isFinite(tz)
      ) {
        return;
      }

      isApplyingRemoteSyncRef.current = true;
      try {
        camera.position.set(px, py, pz);
        controls.target.set(tx, ty, tz);
        controls.update();
        lastAppliedRemotePoseRef.current = {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        };
      } finally {
        isApplyingRemoteSyncRef.current = false;
      }
    };

    window.addEventListener(CAD_CAMERA_SYNC_EVENT, handleRemoteCameraSync);
    return () => {
      window.removeEventListener(CAD_CAMERA_SYNC_EVENT, handleRemoteCameraSync);
    };
  }, [camera, cameraSyncGroup, isInXr]);

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
    const sig = `${components.length}:${Math.round(Math.log10(Math.max(0.1, sceneBounds.radius)))}:${cameraResetTick}`;
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
      isApplyingRemoteSyncRef.current = true;
      try {
        controlsRef.current.target.set(cx, cy, cz);
        controlsRef.current.update();
      } finally {
        isApplyingRemoteSyncRef.current = false;
      }
    }
  }, [isInXr, components.length, sceneBounds, camera, size.width, size.height, fitInsets, cameraResetTick]);

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
          renderSingleton={(comp, idx) => (
            <CadModel
              key={`${comp.name}::${idx}`}
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
              ghost={Boolean(ghostCadUnderlay && vtkBuffer)}
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

      {/* 3D Formal Verification Overlays (Reachability Flowpipes, Clearance Vectors, Lyapunov Barrier Shells) */}
      {showFlowpipe &&
        verificationOverlay?.flowpipes &&
        Object.entries(verificationOverlay.flowpipes).map(([key, segments]) => (
          <ReachabilityTubeOverlay key={`flowpipe_${key}`} segments={segments} />
        ))}

      {verificationOverlay?.clearanceHistory && (
        <DynamicClearanceVector
          clearanceHistory={verificationOverlay.clearanceHistory}
          currentTime={animationController?.currentTime ?? 0}
        />
      )}

      {showBarrier && verificationOverlay?.barrierShells && (
        <BarrierShellOverlay shells={verificationOverlay.barrierShells} />
      )}

      {/* 3D Multi-Modal Zonotope Dual Ghost Tolerance Shells, Symmetry Coupling & WAM Reachability Tube */}
      {showZonotopeOverlay && zonotopeWorkbenchState && (
        <ZonotopeCadOverlay
          components={components}
          hypergraphRecord={hypergraphRecord}
          workbenchState={zonotopeWorkbenchState}
          violatingComponents={zonotopeViolatingComponents}
          wamWaypoints={zonotopeWamWaypoints}
          onSelectGroup={onSelectZonotopeGroup}
          onAddOverride={onAddZonotopeOverride}
          onAddConstraint={onAddZonotopeConstraint}
          onChangeCadToleranceFraction={onChangeCadToleranceFraction}
          onChangeWamWaypointRadius={onChangeWamWaypointRadius}
        />
      )}

      {/* CFD Wind-Tunnel Domain & 2:1 Octree AMR Refinement Gizmo */}
      {cfdDomainPreview && (
        <CfdDomainGizmo
          domainMin={cfdDomainPreview.domainMin}
          domainMax={cfdDomainPreview.domainMax}
          refinementBoxes={cfdDomainPreview.refinementBoxes}
          nakedEdgeSegments={nakedEdgeSegments}
        />
      )}

      {/* Interactive 3D Face Boundary Picker (FEA/CFD) */}
      {isPickBoundaryMode && boundaryPickerSurface && onSelectBoundary && (
        <BoundaryPicker
          positions={boundaryPickerSurface.positions}
          indices={boundaryPickerSurface.indices}
          defaultDomain={caeDialect}
          onSelectBoundary={onSelectBoundary}
          clippingPlanes={solidPlane ? [solidPlane] : undefined}
        />
      )}

      {/* 3D Boundary Condition Glyphs (Fixed Clamps, Force Arrows, Inlet Cones, Thermal Badges) */}
      {assignedBcs &&
        assignedBcs.length > 0 &&
        assignedBcs.map((bc) => {
          const isFixed = bc.kind === "fixed_support" || bc.kind === "prescribed_displacement";
          const isForce = bc.kind === "force_load" || bc.kind === "pressure_load";
          const isThermal = bc.kind === "heatflux" || bc.kind === "isothermal";
          const glyphColor = isFixed ? "#2563eb" : isForce ? "#e11d48" : isThermal ? "#d97706" : "#0891b2";
          const glyphScale = Math.max(0.03, sceneBounds.radius * 0.06);
          const dir = new THREE.Vector3(bc.normal[0], bc.normal[1], bc.normal[2]).normalize();
          const quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.lengthSq() > 0 ? dir : new THREE.Vector3(0, 1, 0),
          );
          return (
            <group key={bc.id} position={bc.worldPos} quaternion={quat}>
              {isFixed ? (
                <mesh>
                  <octahedronGeometry args={[glyphScale * 0.65, 0]} />
                  <meshStandardMaterial
                    color={glyphColor}
                    emissive={glyphColor}
                    emissiveIntensity={0.35}
                    roughness={0.3}
                  />
                </mesh>
              ) : (
                <group>
                  <mesh position={[0, glyphScale * 0.9, 0]}>
                    <cylinderGeometry args={[glyphScale * 0.16, glyphScale * 0.16, glyphScale * 1.4, 10]} />
                    <meshStandardMaterial color={glyphColor} emissive={glyphColor} emissiveIntensity={0.3} />
                  </mesh>
                  <mesh position={[0, glyphScale * 1.8, 0]}>
                    <coneGeometry args={[glyphScale * 0.42, glyphScale * 0.75, 12]} />
                    <meshStandardMaterial color={glyphColor} emissive={glyphColor} emissiveIntensity={0.35} />
                  </mesh>
                </group>
              )}
            </group>
          );
        })}

      {/* CFD & FEA Contour / Vector rendering */}
      {vtkBuffer && (
        <VtkRenderer
          vtkBuffer={vtkBuffer}
          opacity={0.85}
          activeField={activeCaeField}
          showVectors={showCaeVectors}
          showStreamlines={showCaeStreamlines}
          deformationScale={deformationScale}
          animateDeformation={animateDeformation}
          animateFlow={animateFlow}
          isoSurfaceEnabled={isoSurfaceEnabled}
          isoThreshold={isoThreshold}
          slicePlane={slicePlane}
          onProbePoint={onProbePoint}
          timestepFrames={caeTimestepFrames && caeTimestepFrames.length > 0 ? caeTimestepFrames : undefined}
          activeFrameIndex={activeVtkFrame}
          colormap={caeColormap}
          logScale={caeLogScale}
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
          onChange={() => dispatchCameraSync(false)}
          onEnd={() => dispatchCameraSync(true)}
          touches={
            touchScrollPassThrough
              ? { ONE: undefined as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_PAN }
              : undefined
          }
        />
      )}

      {/* Gizmo — unmounted during WebXR so secondary Hud pass never fights stereo framebuffer */}
      {!isInXr && (
        <GizmoHelper
          alignment="bottom-right"
          margin={[(fitInsets?.right ?? 0) + (fitInsets ? 52 : 60), (fitInsets?.bottom ?? 0) + (fitInsets ? 52 : 60)]}
        >
          <GizmoViewport labelColor="white" axisHeadScale={1} />
        </GizmoHelper>
      )}
    </>
  );
}

/** Safe wrapper subscribing to WebXR session state only when mounted inside `<XR>`. */
export function XrSceneContentsBridge(props: Omit<SceneContentsProps, "isInXr">) {
  const isInXr = useXR((s) => Boolean(s.session));
  return <SceneContents {...props} isInXr={isInXr} />;
}
