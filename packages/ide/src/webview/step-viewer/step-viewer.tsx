// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatFeatureControlFrameText, type GdtCallout3D, type GdtOverlayPayload } from "@modelscript/cad";
import { ContactShadows, GizmoHelper, GizmoViewport, Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SpoolKinematicsSpec, StepOverlayPayload } from "../../services/step-compilation-service.js";

export interface StepMeshPayload {
  id: number;
  name: string;
  type: string;
  color?: [number, number, number];
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

interface StepViewerProps {
  meshes: StepMeshPayload[];
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  dark?: boolean;
  isLoading?: boolean;
  overlay?: StepOverlayPayload | null;
  onGenerateFeaStudy?: () => void;
  onGenerateCfdStudy?: () => void;
  onOpenSource?: (role: "scad" | "qif", uri?: string) => void;
  onRecompile?: () => void;
}

class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[StepViewer] Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            style={{
              padding: "20px",
              color: "#ff6b6b",
              fontFamily: "system-ui, sans-serif",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "8px" }}>Failed to render 3D CAD view</div>
            <div style={{ fontSize: "12px", opacity: 0.8 }}>{this.state.error?.message}</div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

function matchSpoolSpec(meshName: string, spools: readonly SpoolKinematicsSpec[]): SpoolKinematicsSpec | undefined {
  if (!meshName || spools.length === 0) return undefined;
  const lower = meshName.toLowerCase();
  const exact = spools.find((s) => s.part.toLowerCase() === lower);
  if (exact) return exact;
  return spools.find((s) => {
    const p = s.part.toLowerCase();
    return lower.includes(p) || p.includes(lower);
  });
}

function StepModel({
  payload,
  selected,
  onSelect,
  explosionFactor = 0,
  assemblyCenter,
  showWireframe = false,
  spoolSpec,
  isPlayingSpools = false,
  spoolSpeedMultiplier = 1,
  dark = false,
}: {
  payload: StepMeshPayload;
  selected: boolean;
  onSelect?: (id: number | null) => void;
  explosionFactor?: number;
  assemblyCenter?: THREE.Vector3;
  showWireframe?: boolean;
  spoolSpec?: SpoolKinematicsSpec;
  isPlayingSpools?: boolean;
  spoolSpeedMultiplier?: number;
  dark?: boolean;
}) {
  const pivotRef = useRef<THREE.Group>(null);
  const angleRef = useRef<number>(0);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(payload.vertices, 3));
    if (payload.normals && payload.normals.length > 0) {
      geo.setAttribute("normal", new THREE.BufferAttribute(payload.normals, 3));
    }
    if (payload.indices && payload.indices.length > 0) {
      geo.setIndex(new THREE.BufferAttribute(payload.indices, 1));
    }
    if (!payload.normals || payload.normals.length === 0) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingSphere();
    return geo;
  }, [payload]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const edgesGeometry = useMemo(() => {
    if (!showWireframe) return null;
    return new THREE.EdgesGeometry(geometry, 24);
  }, [geometry, showWireframe]);

  useEffect(() => {
    return () => {
      edgesGeometry?.dispose();
    };
  }, [edgesGeometry]);

  const defaultColor = payload.color
    ? new THREE.Color(payload.color[0], payload.color[1], payload.color[2])
    : new THREE.Color("#aaaaaa");

  const explosionOffset = useMemo(() => {
    if (!assemblyCenter || !explosionFactor) return new THREE.Vector3();
    const center = geometry.boundingSphere?.center || new THREE.Vector3();
    return center.clone().sub(assemblyCenter).multiplyScalar(explosionFactor);
  }, [geometry, assemblyCenter, explosionFactor]);

  const spoolAxis = useMemo(() => {
    if (!spoolSpec) return new THREE.Vector3(1, 0, 0);
    return new THREE.Vector3(spoolSpec.axis[0], spoolSpec.axis[1], spoolSpec.axis[2]).normalize();
  }, [spoolSpec]);

  // Compute rotational pivot orthogonal to the spool axis through the assembly center
  // so rotors spin on their own shaft axis even if the STEP origin is offset.
  const pivotPos = useMemo(() => {
    if (!spoolSpec || !assemblyCenter) return new THREE.Vector3(0, 0, 0);
    const proj = spoolAxis.clone().multiplyScalar(assemblyCenter.dot(spoolAxis));
    return assemblyCenter.clone().sub(proj);
  }, [spoolSpec, assemblyCenter, spoolAxis]);

  useEffect(() => {
    if (!spoolSpec && pivotRef.current) {
      angleRef.current = 0;
      pivotRef.current.quaternion.identity();
    }
  }, [spoolSpec]);

  useFrame((_state, delta) => {
    if (!pivotRef.current || !spoolSpec || !isPlayingSpools) return;
    const baseOmega = spoolSpec.spool === "n2" ? 4.4 : 2.6;
    angleRef.current = (angleRef.current + Math.min(delta, 0.05) * baseOmega * spoolSpeedMultiplier) % (Math.PI * 2);
    pivotRef.current.quaternion.setFromAxisAngle(spoolAxis, angleRef.current);
  });

  const meshNode = (
    <mesh
      geometry={geometry}
      position={explosionOffset}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(payload.id);
      }}
      userData={{ stepId: payload.id, type: payload.type, name: payload.name }}
    >
      <meshStandardMaterial
        color={selected ? "#ffaa00" : defaultColor}
        roughness={0.38}
        metalness={0.18}
        side={THREE.DoubleSide}
      />
      {edgesGeometry && (
        <lineSegments geometry={edgesGeometry}>
          <lineBasicMaterial color={selected ? "#ffe082" : dark ? "#94a3b8" : "#1e293b"} transparent opacity={0.55} />
        </lineSegments>
      )}
    </mesh>
  );

  if (!spoolSpec) {
    return meshNode;
  }

  return (
    <group position={[pivotPos.x, pivotPos.y, pivotPos.z]}>
      <group ref={pivotRef}>
        <group position={[-pivotPos.x, -pivotPos.y, -pivotPos.z]}>{meshNode}</group>
      </group>
    </group>
  );
}

function statusAccentColor(status: GdtCallout3D["status"]): string {
  if (status === "FAIL") return "#ef4444";
  if (status === "MARGINAL") return "#f59e0b";
  return "#22c55e";
}

function GdtOverlay3D({
  overlay,
  assemblyCenter,
  assemblySize,
  selectedCalloutId,
  onSelectCallout,
  dark,
}: {
  overlay: GdtOverlayPayload;
  assemblyCenter: THREE.Vector3;
  assemblySize: number;
  selectedCalloutId?: string | null;
  onSelectCallout?: (id: string | null) => void;
  dark: boolean;
}) {
  const safeSize = Math.max(assemblySize, 0.5);
  const dotRadius = safeSize * 0.011;
  const standoffDist = safeSize * 0.16;

  const computeBadgePos = (
    anchor: readonly [number, number, number],
    idx: number,
    verticalBias: number,
  ): [number, number, number] => {
    const dir = new THREE.Vector3(
      anchor[0] - assemblyCenter.x,
      anchor[1] - assemblyCenter.y,
      anchor[2] - assemblyCenter.z,
    );
    if (dir.lengthSq() < 1e-6) {
      dir.set(0.3 * ((idx % 3) - 1), 1, 0.25 * (idx % 2 === 0 ? 1 : -1));
    }
    dir.normalize();
    return [
      anchor[0] + dir.x * standoffDist,
      anchor[1] + dir.y * standoffDist + verticalBias * safeSize * 0.06,
      anchor[2] + dir.z * standoffDist + (idx % 2 === 0 ? 1 : -1) * safeSize * 0.04,
    ];
  };

  return (
    <group>
      {overlay.datums.map((datum, idx) => {
        const badgePos = computeBadgePos(datum.anchor, idx, -0.6);
        const anchorPt: [number, number, number] = [datum.anchor[0], datum.anchor[1], datum.anchor[2]];
        return (
          <group key={`datum-${datum.label}-${idx}`}>
            <mesh position={anchorPt}>
              <sphereGeometry args={[dotRadius, 12, 12]} />
              <meshBasicMaterial color="#38bdf8" />
            </mesh>
            <Line points={[anchorPt, badgePos]} color="#38bdf8" lineWidth={1.25} transparent opacity={0.85} />
            <Html position={badgePos} center zIndexRange={[20, 0]}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  background: dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)",
                  color: dark ? "#7dd3fc" : "#0369a1",
                  border: "1px solid #38bdf8",
                  borderRadius: "4px",
                  padding: "1px 5px",
                  fontSize: "10px",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                }}
              >
                <span>[{datum.label}]</span>
                {datum.name && <span style={{ opacity: 0.78, fontWeight: 500 }}>{datum.name}</span>}
              </div>
            </Html>
          </group>
        );
      })}

      {overlay.callouts.map((callout, idx) => {
        const badgePos = computeBadgePos(callout.anchor, idx + overlay.datums.length, 0.8 + (idx % 2) * 0.4);
        const anchorPt: [number, number, number] = [callout.anchor[0], callout.anchor[1], callout.anchor[2]];
        const accent = statusAccentColor(callout.status);
        const isSelected = selectedCalloutId === callout.id;
        return (
          <group key={`fcf-${callout.id}-${idx}`}>
            <mesh position={anchorPt}>
              <sphereGeometry args={[dotRadius * 1.15, 14, 14]} />
              <meshBasicMaterial color={accent} />
            </mesh>
            <Line
              points={[anchorPt, badgePos]}
              color={accent}
              lineWidth={isSelected ? 2 : 1.25}
              transparent
              opacity={0.9}
            />
            <Html position={badgePos} center zIndexRange={[30, 0]}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCallout?.(isSelected ? null : callout.id);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  background: dark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.96)",
                  color: dark ? "#f1f5f9" : "#0f172a",
                  border: `1.5px solid ${accent}`,
                  borderRadius: "4px",
                  padding: "2px 6px",
                  fontSize: "10px",
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  boxShadow: isSelected ? `0 0 0 2px ${accent}` : "0 2px 8px rgba(0,0,0,0.35)",
                }}
                title={callout.label}
              >
                <span>{formatFeatureControlFrameText(callout)}</span>
                {callout.measured !== undefined && (
                  <span style={{ color: accent, fontWeight: 700 }}>
                    {callout.measured.toFixed(3)} {callout.status ?? ""}
                  </span>
                )}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function SceneContents({
  meshes,
  selectedId,
  onSelect,
  dark,
  explosionFactor = 0,
  showWireframe = false,
  gdtOverlay,
  showGdtOverlay = true,
  selectedCalloutId,
  onSelectCallout,
  spools = [],
  isPlayingSpools = false,
  spoolSpeedMultiplier = 1,
  n1Rpm,
  n2Rpm,
}: {
  meshes: StepMeshPayload[];
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  dark: boolean;
  explosionFactor: number;
  showWireframe: boolean;
  gdtOverlay?: GdtOverlayPayload;
  showGdtOverlay: boolean;
  selectedCalloutId?: string | null;
  onSelectCallout?: (id: string | null) => void;
  spools?: readonly SpoolKinematicsSpec[];
  isPlayingSpools: boolean;
  spoolSpeedMultiplier: number;
  n1Rpm?: number | undefined;
  n2Rpm?: number | undefined;
}) {
  const { camera } = useThree();
  const [assemblyCenter, setAssemblyCenter] = useState<THREE.Vector3>(() => new THREE.Vector3());
  const [assemblySize, setAssemblySize] = useState<number>(3);
  const fittedKeyRef = useRef<string>("");

  useEffect(() => {
    if (!meshes || meshes.length === 0) return;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    meshes.forEach((m) => {
      for (let i = 0; i < m.vertices.length; i += 3) {
        const x = m.vertices[i] ?? 0;
        const y = m.vertices[i + 1] ?? 0;
        const z = m.vertices[i + 2] ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    setAssemblyCenter(new THREE.Vector3(centerX, centerY, centerZ));

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.25);
    setAssemblySize(size);

    // Only auto-reframe camera on initial load or structural bounding change so live edits preserve OrbitControls camera!
    const structuralKey = `${meshes.length}:${Math.round(size * 100)}`;
    if (fittedKeyRef.current !== structuralKey) {
      fittedKeyRef.current = structuralKey;
      const distance = size * 1.5;
      camera.position.set(centerX + distance, centerY + distance, centerZ + distance);
      camera.lookAt(centerX, centerY, centerZ);
      camera.updateProjectionMatrix();
    }
  }, [meshes, camera]);

  return (
    <>
      <ambientLight intensity={dark ? 0.45 : 0.65} />
      <directionalLight position={[100, 100, 50]} intensity={dark ? 0.9 : 1.05} castShadow />
      <directionalLight position={[-100, -100, -50]} intensity={0.35} />

      <group rotation={[-Math.PI / 2, 0, 0]}>
        {meshes.map((m) => {
          const matchedSpool = matchSpoolSpec(m.name, spools);
          const telemetryScale =
            matchedSpool?.spool === "n1" && typeof n1Rpm === "number"
              ? n1Rpm / 3850
              : matchedSpool?.spool === "n2" && typeof n2Rpm === "number"
                ? n2Rpm / 14200
                : 1;
          return (
            <StepModel
              key={m.id}
              payload={m}
              selected={m.id === selectedId}
              onSelect={onSelect}
              explosionFactor={explosionFactor}
              assemblyCenter={assemblyCenter}
              showWireframe={showWireframe}
              spoolSpec={matchedSpool}
              isPlayingSpools={isPlayingSpools}
              spoolSpeedMultiplier={spoolSpeedMultiplier * telemetryScale}
              dark={dark}
            />
          );
        })}

        {showGdtOverlay && gdtOverlay && (gdtOverlay.datums.length > 0 || gdtOverlay.callouts.length > 0) && (
          <GdtOverlay3D
            overlay={gdtOverlay}
            assemblyCenter={assemblyCenter}
            assemblySize={assemblySize}
            selectedCalloutId={selectedCalloutId}
            onSelectCallout={onSelectCallout}
            dark={dark}
          />
        )}

        <ContactShadows position={[0, 0, 0]} opacity={dark ? 0.4 : 0.25} scale={100} blur={2} far={10} />
      </group>

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport labelColor="white" axisHeadScale={1} />
      </GizmoHelper>
    </>
  );
}

export default function StepViewer({
  meshes,
  selectedId,
  onSelect,
  dark = false,
  isLoading = false,
  overlay = null,
  onGenerateFeaStudy,
  onGenerateCfdStudy,
  onOpenSource,
  onRecompile,
}: StepViewerProps) {
  const [explosionFactor, setExplosionFactor] = useState(0);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showGdtOverlay, setShowGdtOverlay] = useState(true);
  const [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null);
  const [isPlayingSpools, setIsPlayingSpools] = useState(true);
  const [spoolSpeedMultiplier, setSpoolSpeedMultiplier] = useState(1);

  const gdtCount = (overlay?.gdtOverlay.datums.length ?? 0) + (overlay?.gdtOverlay.callouts.length ?? 0);
  const spools = overlay?.spools ?? [];
  const hasSpools = spools.length > 0;

  if (!meshes || meshes.length === 0) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: dark ? "#1e1e1e" : "#f5f5f5",
          color: dark ? "#888" : "#aaa",
          fontFamily: "system-ui, sans-serif",
          gap: "1rem",
        }}
      >
        {isLoading ? (
          <>
            <div
              className="spinner"
              style={{
                width: "30px",
                height: "30px",
                border: "3px solid rgba(136, 136, 136, 0.3)",
                borderTop: "3px solid #007acc",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            ></div>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
            <div>Loading CAD Meshes...</div>
          </>
        ) : (
          <div>No CAD Meshes Loaded</div>
        )}
      </div>
    );
  }

  const secondaryBtnStyle = (active = false): React.CSSProperties => ({
    background: active ? "#0284c7" : dark ? "rgba(30, 41, 59, 0.9)" : "rgba(255, 255, 255, 0.92)",
    color: active ? "#ffffff" : dark ? "#e2e8f0" : "#1e293b",
    border: active ? "1px solid #38bdf8" : dark ? "1px solid #475569" : "1px solid #cbd5e1",
    padding: "5px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    backdropFilter: "blur(4px)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  });

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 120,
          zIndex: 100,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {overlay?.compiledFromOptionA && (
          <span
            style={{
              background: "rgba(14, 165, 233, 0.16)",
              color: dark ? "#7dd3fc" : "#0369a1",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.02em",
            }}
          >
            Compiled AP242
          </span>
        )}
        {overlay?.scadUri && onOpenSource && (
          <button
            type="button"
            onClick={() => onOpenSource("scad", overlay.scadUri)}
            style={secondaryBtnStyle(false)}
            title="Open paired OpenSCAD geometry source"
          >
            Edit .scad
          </button>
        )}
        {overlay?.qifUri && onOpenSource && (
          <button
            type="button"
            onClick={() => onOpenSource("qif", overlay.qifUri)}
            style={secondaryBtnStyle(false)}
            title="Open paired QIF 3.0 GD&T / CMM inspection specification"
          >
            Edit .qif
          </button>
        )}
        {overlay?.scadUri && onRecompile && (
          <button
            type="button"
            onClick={onRecompile}
            style={secondaryBtnStyle(false)}
            title="Recompile AP242 STEP artifact from paired .scad and .qif sources"
          >
            Recompile
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowWireframe((w) => !w)}
          style={secondaryBtnStyle(showWireframe)}
          title="Toggle CAD surface crease edges"
        >
          Edges
        </button>
        {gdtCount > 0 && (
          <button
            type="button"
            onClick={() => setShowGdtOverlay((v) => !v)}
            style={secondaryBtnStyle(showGdtOverlay)}
            title="Toggle ASME Y14.5 GD&T and Datum 3D overlay extracted from STEP AP242 + QIF"
          >
            GD&T ({overlay?.gdtOverlay.callouts.length ?? 0})
          </button>
        )}
        {hasSpools && (
          <button
            type="button"
            onClick={() => setIsPlayingSpools((p) => !p)}
            style={secondaryBtnStyle(isPlayingSpools)}
            title="Play or pause @spool rotor kinematics"
          >
            {isPlayingSpools ? "Pause Rotors" : "Play Rotors"}
          </button>
        )}
        {hasSpools && (
          <button
            type="button"
            onClick={() => setSpoolSpeedMultiplier((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))}
            style={secondaryBtnStyle(false)}
            title="Cycle rotor speed multiplier"
          >
            {overlay?.modelicaTelemetry?.n1Rpm !== undefined || overlay?.modelicaTelemetry?.n2Rpm !== undefined
              ? `N1 ${Math.round(overlay.modelicaTelemetry?.n1Rpm ?? 3850)} · N2 ${Math.round(overlay.modelicaTelemetry?.n2Rpm ?? 14200)} RPM (${spoolSpeedMultiplier}x)`
              : `${spoolSpeedMultiplier}x RPM`}
          </button>
        )}
        {onGenerateFeaStudy && (
          <button
            type="button"
            onClick={onGenerateFeaStudy}
            title="Generate a tetrahedral FEA study (.inp) from this exact CAD geometry for boundary condition and stress probe setup"
            style={{
              background: "#007acc",
              color: "#fff",
              border: "none",
              padding: "6px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            Generate FEA Study (.inp)
          </button>
        )}
        {onGenerateCfdStudy && (
          <button
            type="button"
            onClick={onGenerateCfdStudy}
            title="Generate an SU2 CFD study (.cfg) from this exact CAD geometry"
            style={secondaryBtnStyle(false)}
          >
            Generate CFD Study (.cfg)
          </button>
        )}
      </div>

      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 100,
            background: dark ? "rgba(30, 30, 30, 0.8)" : "rgba(255, 255, 255, 0.8)",
            padding: "5px 10px",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: dark ? "#ccc" : "#333",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="spinner"
            style={{
              width: "12px",
              height: "12px",
              border: "2px solid rgba(136, 136, 136, 0.3)",
              borderTop: `2px solid ${dark ? "#4daafc" : "#007acc"}`,
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          ></div>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          Updating...
        </div>
      )}

      {showGdtOverlay && overlay && overlay.gdtOverlay.callouts.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 68,
            left: 12,
            zIndex: 90,
            maxWidth: "360px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            background: dark ? "rgba(15, 23, 42, 0.86)" : "rgba(255, 255, 255, 0.9)",
            border: dark ? "1px solid #334155" : "1px solid #cbd5e1",
            borderRadius: "8px",
            padding: "8px 10px",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: "11px",
            color: dark ? "#e2e8f0" : "#1e293b",
            backdropFilter: "blur(4px)",
          }}
        >
          {overlay.gdtOverlay.callouts.map((c) => {
            const accent = statusAccentColor(c.status);
            return (
              <div
                key={c.id}
                onClick={() => setSelectedCalloutId((prev) => (prev === c.id ? null : c.id))}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "8px",
                  padding: "2px 4px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: selectedCalloutId === c.id ? "rgba(56, 189, 248, 0.16)" : "transparent",
                }}
              >
                <span>{formatFeatureControlFrameText(c)}</span>
                {c.measured !== undefined && (
                  <span style={{ color: accent, fontWeight: 700 }}>
                    {c.measured.toFixed(3)} {c.status ?? ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Slider overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          background: dark ? "rgba(30, 30, 30, 0.8)" : "rgba(255, 255, 255, 0.8)",
          padding: "10px 20px",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          color: dark ? "#ccc" : "#333",
          backdropFilter: "blur(4px)",
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 600 }}>Explode</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={explosionFactor}
          onChange={(e) => setExplosionFactor(parseFloat(e.target.value))}
          style={{ width: "150px" }}
        />
      </div>

      <ErrorBoundary>
        <Canvas
          shadows
          camera={{ position: [100, 100, 100], fov: 50 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
          style={{ background: dark ? "#1a1a2e" : "#f0f4f8" }}
        >
          <Suspense fallback={null}>
            <SceneContents
              meshes={meshes}
              selectedId={selectedId}
              onSelect={onSelect}
              dark={dark}
              explosionFactor={explosionFactor}
              showWireframe={showWireframe}
              gdtOverlay={overlay?.gdtOverlay}
              showGdtOverlay={showGdtOverlay}
              selectedCalloutId={selectedCalloutId}
              onSelectCallout={setSelectedCalloutId}
              spools={spools}
              isPlayingSpools={isPlayingSpools}
              spoolSpeedMultiplier={spoolSpeedMultiplier}
              n1Rpm={overlay?.modelicaTelemetry?.n1Rpm}
              n2Rpm={overlay?.modelicaTelemetry?.n2Rpm}
            />
          </Suspense>
        </Canvas>
      </ErrorBoundary>
    </div>
  );
}
