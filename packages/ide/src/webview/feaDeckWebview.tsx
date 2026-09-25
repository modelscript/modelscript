// SPDX-License-Identifier: AGPL-3.0-or-later

import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { BoundaryPicker, type BoundaryActionPayload } from "./cad-viewer/boundary-picker";
import { CaeTelemetryPanel, type TelemetryDataPoint } from "./cad-viewer/cae-telemetry-panel";
import {
  CuttingPlaneVisualizer,
  useCuttingPlane,
  type CuttingPlaneAxis,
  type CuttingPlaneOptions,
} from "./cad-viewer/cutting-plane-controller";
import { FeaMeshRenderer, type FeaMeshPayload } from "./cad-viewer/fea-mesh-renderer";
import { ProbeTooltip, type ProbeData } from "./cad-viewer/probe-tooltip";
import { RequirementVerdictCard, type RequirementVerdictPayload } from "./cad-viewer/requirement-verdict-card";
import { SurrogateTrainDialog } from "./cad-viewer/surrogate-train-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

interface InpMeshPayload {
  positions: number[];
  indices: number[];
  normals: number[];
  fixedNodes: { id: number; position: [number, number, number] }[];
  loads: { id: number; position: [number, number, number]; force: [number, number, number] }[];
  stats: {
    numNodes: number;
    numElements: number;
    materials: string[];
    isQuadratic: boolean;
  };
}

interface StepMeshPayload {
  id: number;
  name: string;
  type: string;
  color?: [number, number, number];
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

function CompanionCadMesh({
  meshes,
  opacity,
  clippingPlanes,
}: {
  meshes: StepMeshPayload[];
  opacity: number;
  clippingPlanes: THREE.Plane[];
}) {
  if (opacity <= 0.01) return null;

  return (
    <group>
      {meshes.map((m, idx) => {
        const geo = new THREE.BufferGeometry();
        const verts =
          m.vertices instanceof Float32Array ? m.vertices : new Float32Array(Object.values(m.vertices || {}));
        const idxs = m.indices instanceof Uint32Array ? m.indices : new Uint32Array(Object.values(m.indices || {}));
        geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geo.setIndex(new THREE.BufferAttribute(idxs, 1));
        geo.computeVertexNormals();

        return (
          <mesh key={`cad-${idx}`} geometry={geo}>
            <meshStandardMaterial
              color="#64748b"
              roughness={0.5}
              metalness={0.1}
              transparent={true}
              opacity={opacity}
              clippingPlanes={clippingPlanes}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function BaseDeckMesh({
  payload,
  wireframe,
  clippingPlanes,
}: {
  payload: InpMeshPayload;
  wireframe: boolean;
  clippingPlanes: THREE.Plane[];
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (payload.positions.length > 0) {
      geo.setAttribute("position", new THREE.Float32BufferAttribute(payload.positions, 3));
      geo.setIndex(new THREE.Uint32BufferAttribute(payload.indices, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }
    return geo;
  }, [payload]);

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#3b82f6"
          roughness={0.4}
          metalness={0.2}
          wireframe={wireframe}
          transparent={true}
          opacity={0.85}
          side={THREE.DoubleSide}
          clippingPlanes={clippingPlanes}
        />
      </mesh>

      {/* Fixed Boundary Condition Glyphs (Cyan Cubes) */}
      {payload.fixedNodes.map((fn) => (
        <mesh key={`fix-${fn.id}`} position={fn.position}>
          <boxGeometry args={[0.015, 0.015, 0.015]} />
          <meshBasicMaterial color="#06b6d4" />
        </mesh>
      ))}

      {/* Applied Force Vectors (Red Cones) */}
      {payload.loads.map((ld) => {
        const dir = new THREE.Vector3(...ld.force).normalize();
        const pos = new THREE.Vector3(...ld.position);
        return (
          <group key={`load-${ld.id}`} position={pos}>
            <mesh>
              <sphereGeometry args={[0.01, 8, 8]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
            <arrowHelper args={[dir, new THREE.Vector3(0, 0, 0), 0.05, 0xef4444, 0.02, 0.015]} />
          </group>
        );
      })}
    </group>
  );
}

function SceneContents({
  meshData,
  feaResults,
  wireframe,
  displacementScale,
  cuttingPlane,
  companionCad,
  cadOpacity,
  onSelectBoundary,
  onHoverProbe,
}: {
  meshData: InpMeshPayload | null;
  feaResults: FeaMeshPayload | null;
  wireframe: boolean;
  displacementScale: number;
  cuttingPlane: CuttingPlaneOptions;
  companionCad: StepMeshPayload[] | null;
  cadOpacity: number;
  onSelectBoundary: (action: BoundaryActionPayload) => void;
  onHoverProbe: (probe: ProbeData | null) => void;
}) {
  const clipPlanes = useCuttingPlane(cuttingPlane);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 10, 7]} intensity={1.2} />
      <directionalLight position={[-5, -10, -7]} intensity={0.4} />

      {/* Companion CAD Ghost Layer */}
      {companionCad && companionCad.length > 0 && (
        <CompanionCadMesh meshes={companionCad} opacity={cadOpacity} clippingPlanes={clipPlanes} />
      )}

      {feaResults ? (
        <FeaMeshRenderer payload={feaResults} displacementScale={displacementScale} />
      ) : meshData ? (
        <BaseDeckMesh payload={meshData} wireframe={wireframe} clippingPlanes={clipPlanes} />
      ) : null}

      {/* 3D Raycast Boundary Condition Picker & Hover Probe Hook */}
      {meshData && (
        <BoundaryPicker
          positions={meshData.positions}
          indices={meshData.indices}
          onSelectBoundary={onSelectBoundary}
          onHoverProbe={onHoverProbe}
          probeFields={
            feaResults
              ? {
                  stress: feaResults.fields.vonMisesStress,
                  displacements: feaResults.fields.displacements,
                  safetyFactor: feaResults.stats.safetyFactor,
                }
              : undefined
          }
          clippingPlanes={clipPlanes}
        />
      )}

      {/* Visual Cutting Plane Outline */}
      <CuttingPlaneVisualizer options={cuttingPlane} />

      <ContactShadows position={[0, -0.2, 0]} opacity={0.5} scale={1.5} blur={1} />
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#ffffff" />
      </GizmoHelper>
    </>
  );
}

function App() {
  const [meshData, setMeshData] = useState<InpMeshPayload | null>(null);
  const [feaResults, setFeaResults] = useState<FeaMeshPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [displacementScale, setDisplacementScale] = useState<number>(50.0);
  const [probeData, setProbeData] = useState<ProbeData | null>(null);
  const [companionCad, setCompanionCad] = useState<StepMeshPayload[] | null>(null);
  const [cadOpacity, setCadOpacity] = useState<number>(0.35);

  const [cuttingPlane, setCuttingPlane] = useState<CuttingPlaneOptions>({
    enabled: false,
    axis: "z",
    offset: 0,
    inverted: false,
  });

  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [telemetryPoints, setTelemetryPoints] = useState<TelemetryDataPoint[]>([]);
  const [telemetryPhase, setTelemetryPhase] = useState("Idle");

  const [surrogateDialogOpen, setSurrogateDialogOpen] = useState(false);
  const [isTrainingSurrogate, setIsTrainingSurrogate] = useState(false);
  const [surrogateMetrics, setSurrogateMetrics] = useState<
    { capturedEnergy: number; numModes: number; r2: number } | undefined
  >(undefined);
  const [requirementVerdict, setRequirementVerdict] = useState<RequirementVerdictPayload | undefined>(undefined);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "inpMeshData":
          setMeshData(message.data);
          break;
        case "feaResults":
          setFeaResults(message.data);
          break;
        case "companionCad":
          setCompanionCad(message.data);
          break;
        case "setLoading":
          setIsLoading(message.data);
          break;
        case "telemetryEvent": {
          const ev = message.data;
          setTelemetryOpen(true);
          if (ev?.type === "iteration") {
            setTelemetryPoints((prev) => [
              ...prev,
              {
                iteration: ev.iteration,
                time: ev.time,
                residual: ev.residuals?.force ?? Object.values(ev.residuals || {})[0],
                metrics: ev.metrics,
                rawLog: ev.rawLog,
              },
            ]);
          } else if (ev?.type === "phase") {
            setTelemetryPhase(ev.phase);
          }
          break;
        }
        case "surrogateProgress": {
          if (message.data?.metrics) {
            setSurrogateMetrics(message.data.metrics);
          }
          if (message.data?.done) {
            setIsTrainingSurrogate(false);
          }
          break;
        }
        case "requirementVerdict": {
          setRequirementVerdict(message.data);
          break;
        }
      }
    };
    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleRunLocalFea = () => {
    vscode?.postMessage({ type: "runLocalFea" });
  };

  const handleRunCloudFea = () => {
    setTelemetryPoints([]);
    setTelemetryPhase("Submitting job...");
    setTelemetryOpen(true);
    vscode?.postMessage({ type: "runCloudFea" });
  };

  const handleMaterialize = () => {
    vscode?.postMessage({ type: "materialize" });
  };

  const handleSelectBoundary = (action: BoundaryActionPayload) => {
    vscode?.postMessage({ type: "applyConstraint", data: action });
  };

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", overflow: "hidden", background: "#111827" }}>
      {/* 3D Scene Viewport */}
      <Canvas camera={{ position: [0.3, 0.3, 0.5], fov: 45 }}>
        <SceneContents
          meshData={meshData}
          feaResults={feaResults}
          wireframe={wireframe}
          displacementScale={displacementScale}
          cuttingPlane={cuttingPlane}
          companionCad={companionCad}
          cadOpacity={cadOpacity}
          onSelectBoundary={handleSelectBoundary}
          onHoverProbe={setProbeData}
        />
      </Canvas>

      {/* Hover Numerical Inspection Tooltip */}
      <ProbeTooltip probe={probeData} />

      {/* Floating HUD Controller */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          width: "320px",
          background: "rgba(17, 24, 39, 0.88)",
          backdropFilter: "blur(14px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "10px",
          padding: "16px",
          color: "#f3f4f6",
          fontFamily: "system-ui, -apple-system, sans-serif",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
          fontSize: "12px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "#60a5fa" }}>CalculiX FEA Deck</span>
          {isLoading && <span style={{ color: "#fbbf24", animation: "pulse 1.5s infinite" }}>● Solving...</span>}
        </div>

        {meshData && (
          <div style={{ marginBottom: "12px", padding: "8px", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#9ca3af" }}>Nodes:</span>
              <span style={{ fontWeight: 600 }}>{meshData.stats.numNodes}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#9ca3af" }}>Elements:</span>
              <span style={{ fontWeight: 600 }}>
                {meshData.stats.numElements} ({meshData.stats.isQuadratic ? "C3D10 Tet10" : "C3D4 Tet4"})
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#9ca3af" }}>Constraints / Loads:</span>
              <span style={{ fontWeight: 600 }}>
                {meshData.fixedNodes.length} fix / {meshData.loads.length} loads
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <button
            onClick={handleRunLocalFea}
            disabled={isLoading || !meshData || meshData.stats.numElements === 0}
            style={{
              flex: 1,
              padding: "8px 10px",
              background: "#2563eb",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            ⚡ Local WASM
          </button>
          <button
            onClick={handleRunCloudFea}
            disabled={isLoading || !meshData || meshData.stats.numElements === 0}
            style={{
              flex: 1,
              padding: "8px 10px",
              background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            🚀 Cloud HPC
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <button
            onClick={() => setSurrogateDialogOpen(true)}
            style={{
              width: "100%",
              padding: "7px 10px",
              background: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <span>⚡</span> Train Surrogate ROM
          </button>
        </div>
        <div style={{ marginBottom: "12px" }}>
          <button
            onClick={handleMaterialize}
            style={{
              width: "100%",
              padding: "6px 12px",
              background: "#374151",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            Materialize Deck (.inp)
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <input
            type="checkbox"
            id="wf"
            checked={wireframe}
            onChange={(e) => setWireframe(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <label htmlFor="wf" style={{ cursor: "pointer", color: "#d1d5db" }}>
            Show Element Wireframe
          </label>
        </div>

        {/* Dynamic 3D Slicing Plane Controls */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontWeight: 600, color: "#38bdf8" }}>✂ 3D Cutting Plane</span>
            <input
              type="checkbox"
              checked={cuttingPlane.enabled}
              onChange={(e) => setCuttingPlane((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
          </div>

          {cuttingPlane.enabled && (
            <div style={{ background: "rgba(0,0,0,0.25)", padding: "8px", borderRadius: "6px" }}>
              <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
                {(["x", "y", "z"] as CuttingPlaneAxis[]).map((axis) => (
                  <button
                    key={axis}
                    onClick={() => setCuttingPlane((prev) => ({ ...prev, axis }))}
                    style={{
                      flex: 1,
                      padding: "4px",
                      background: cuttingPlane.axis === axis ? "#0284c7" : "#1f2937",
                      border: "none",
                      borderRadius: "4px",
                      color: "#fff",
                      cursor: "pointer",
                      textTransform: "uppercase",
                      fontWeight: 600,
                    }}
                  >
                    {axis}
                  </button>
                ))}
              </div>
              <label style={{ display: "block", color: "#9ca3af", marginBottom: "2px", fontSize: "11px" }}>
                Offset: {cuttingPlane.offset.toFixed(3)}
              </label>
              <input
                type="range"
                min="-0.5"
                max="0.5"
                step="0.01"
                value={cuttingPlane.offset}
                onChange={(e) => setCuttingPlane((prev) => ({ ...prev, offset: parseFloat(e.target.value) }))}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>

        {/* Companion CAD Ghost Opacity Controls */}
        {companionCad && companionCad.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "12px" }}>
            <span style={{ fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
              CAD Ghost Layer (STEP)
            </span>
            <label style={{ display: "block", color: "#9ca3af", marginBottom: "2px", fontSize: "11px" }}>
              Opacity: {Math.round(cadOpacity * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={cadOpacity}
              onChange={(e) => setCadOpacity(parseFloat(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        )}

        {/* Simulation Results Display */}
        {feaResults && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "12px" }}>
            <div style={{ fontWeight: 600, marginBottom: "8px", color: "#34d399" }}>Simulation Results</div>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ color: "#9ca3af" }}>Max Von Mises:</span>
                <span style={{ fontWeight: 600 }}>{(feaResults.stats.maxStress / 1e6).toFixed(1)} MPa</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ color: "#9ca3af" }}>Max Displacement:</span>
                <span style={{ fontWeight: 600 }}>{(feaResults.stats.maxDisplacement * 1000).toFixed(3)} mm</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#9ca3af" }}>Safety Factor:</span>
                <span
                  style={{ fontWeight: 600, color: (feaResults.stats.safetyFactor ?? 2) < 1.5 ? "#ef4444" : "#10b981" }}
                >
                  {feaResults.stats.safetyFactor?.toFixed(2) ?? "N/A"}
                </span>
              </div>
            </div>

            <div style={{ marginTop: "12px" }}>
              <label style={{ display: "block", color: "#9ca3af", marginBottom: "4px" }}>
                Displacement Scale: {displacementScale}×
              </label>
              <input
                type="range"
                min="0"
                max="500"
                value={displacementScale}
                onChange={(e) => setDisplacementScale(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Real-Time Cloud Solver Telemetry HUD */}
      <CaeTelemetryPanel
        isOpen={telemetryOpen}
        solverName="CalculiX (Cloud HPC)"
        onClose={() => setTelemetryOpen(false)}
        telemetryPoints={telemetryPoints}
        currentPhase={telemetryPhase}
      />

      {/* Live Requirement Contract Verdict HUD Card */}
      <RequirementVerdictCard
        verdict={requirementVerdict}
        onNavigateToRequirement={(reqId) => vscode?.postMessage({ type: "openRequirement", data: reqId })}
      />

      {/* Floating Surrogate ROM Training Drawer */}
      <SurrogateTrainDialog
        isOpen={surrogateDialogOpen}
        onClose={() => setSurrogateDialogOpen(false)}
        onTrain={(cfg) => {
          setIsTrainingSurrogate(true);
          vscode?.postMessage({ type: "trainSurrogate", data: cfg });
        }}
        isTraining={isTrainingSurrogate}
        trainingMetrics={surrogateMetrics}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
