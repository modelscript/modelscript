// SPDX-License-Identifier: AGPL-3.0-or-later

import { ContactShadows, GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { CaeTelemetryPanel, type TelemetryDataPoint } from "./cad-viewer/cae-telemetry-panel";
import { CfdMeshRenderer, type CfdMeshPayload } from "./cad-viewer/cfd-mesh-renderer";
import {
  CuttingPlaneVisualizer,
  useCuttingPlane,
  type CuttingPlaneAxis,
  type CuttingPlaneOptions,
} from "./cad-viewer/cutting-plane-controller";
import { ProbeTooltip, type ProbeData } from "./cad-viewer/probe-tooltip";
import { RequirementVerdictCard, type RequirementVerdictPayload } from "./cad-viewer/requirement-verdict-card";
import { StreamlineRenderer } from "./cad-viewer/streamline-renderer";
import { SurrogateLiveExplorer, type PodSurrogateDataPayload } from "./cad-viewer/surrogate-live-explorer";
import { SurrogateTrainDialog } from "./cad-viewer/surrogate-train-dialog";
import { SweepConfigDrawer, type ActiveSweepState } from "./cad-viewer/sweep-config-drawer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscode = (window as any).acquireVsCodeApi?.();

interface CfgPayload {
  directives: Record<string, unknown>;
  markers: { name: string; type: string; options: (string | number)[] }[];
  meshFilename?: string;
  stats: {
    machNumber?: number;
    aoa?: number;
    reynoldsNumber?: number;
    freestreamVelocity?: number;
  };
}

function BaseFlowDomain({ payload, clippingPlanes }: { payload?: CfgPayload; clippingPlanes: THREE.Plane[] }) {
  if (!payload) return null;
  return (
    <group>
      {/* Proxy Aerodynamic Domain Bounding Box */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1.2, 0.6, 0.4]} />
        <meshStandardMaterial
          color="#0284c7"
          wireframe={true}
          transparent={true}
          opacity={0.3}
          clippingPlanes={clippingPlanes}
        />
      </mesh>

      {/* Central Airfoil/Body Proxy */}
      <mesh position={[0, 0, 0]}>
        <coneGeometry args={[0.08, 0.4, 16]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.8} clippingPlanes={clippingPlanes} />
      </mesh>

      {/* Inlet Marker Arrows (Green) */}
      <group position={[-0.6, 0, 0]}>
        <arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.1, 0), 0.15, 0x22c55e, 0.05, 0.03]} />
        <arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -0.1, 0), 0.15, 0x22c55e, 0.05, 0.03]} />
      </group>

      {/* Outlet Marker Arrows (Red) */}
      <group position={[0.6, 0, 0]}>
        <arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.1, 0), 0.15, 0xef4444, 0.05, 0.03]} />
        <arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -0.1, 0), 0.15, 0xef4444, 0.05, 0.03]} />
      </group>
    </group>
  );
}

function SceneContents({
  cfgData,
  cfdResults,
  cuttingPlane,
  showStreamlines,
  flowSpeed,
}: {
  cfgData: CfgPayload | null;
  cfdResults: CfdMeshPayload | null;
  cuttingPlane: CuttingPlaneOptions;
  showStreamlines: boolean;
  flowSpeed: number;
}) {
  const clipPlanes = useCuttingPlane(cuttingPlane);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 7]} intensity={1.2} />
      <directionalLight position={[-5, -10, -7]} intensity={0.3} />

      {cfdResults ? (
        <CfdMeshRenderer payload={cfdResults} />
      ) : cfgData ? (
        <BaseFlowDomain payload={cfgData} clippingPlanes={clipPlanes} />
      ) : null}

      {/* GPU Streamline Ribbon Renderer */}
      <StreamlineRenderer enabled={showStreamlines} flowVelocity={flowSpeed} clippingPlanes={clipPlanes} />

      {/* 3D Cutting Plane Wireframe */}
      <CuttingPlaneVisualizer options={cuttingPlane} />

      <ContactShadows position={[0, -0.3, 0]} opacity={0.4} scale={2} blur={1.5} />
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#ffffff" />
      </GizmoHelper>
    </>
  );
}

function App() {
  const [cfgData, setCfgData] = useState<CfgPayload | null>(null);
  const [cfdResults, setCfdResults] = useState<CfdMeshPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showStreamlines, setShowStreamlines] = useState<boolean>(true);
  const [probeData] = useState<ProbeData | null>(null);

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
  const [activeSurrogateData, setActiveSurrogateData] = useState<PodSurrogateDataPayload | null>(null);
  const [surrogateModelName, setSurrogateModelName] = useState<string>("AerodynamicModel_Surrogate");
  const [requirementVerdict, setRequirementVerdict] = useState<RequirementVerdictPayload | undefined>(undefined);
  const [sweepDrawerOpen, setSweepDrawerOpen] = useState(false);
  const [activeSweepState, setActiveSweepState] = useState<ActiveSweepState | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "cfgData":
          setCfgData(message.data);
          break;
        case "cfdResults":
          setCfdResults(message.data);
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
                residual: ev.residuals ? (Object.values(ev.residuals)[0] as number | undefined) : undefined,
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
          if (message.data?.surrogateData) {
            setActiveSurrogateData(message.data.surrogateData);
          }
          if (message.data?.modelName) {
            setSurrogateModelName(message.data.modelName);
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
        case "sweepProgress": {
          setActiveSweepState(message.data);
          break;
        }
      }
    };
    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleSurrogateReconstruct = (
    field: Float32Array,
    scalars: Record<string, number>,
    params: Record<string, number>,
  ) => {
    setCfdResults((prev) => {
      const positions = prev?.geometry.positions ?? [-1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0];
      const indices = prev?.geometry.indices ?? [0, 1, 2, 0, 2, 3];
      const normals = prev?.geometry.normals;
      const numNodes = positions.length / 3;

      const fieldValues = Array.from(field);
      const vel = params.velocity ?? scalars.velocity ?? 50;
      const lift = scalars.lift ?? scalars.liftForce ?? 20;
      const drag = scalars.drag ?? scalars.dragForce ?? 5;

      return {
        type: "cfd-mesh",
        time: 0,
        geometry: {
          positions,
          indices,
          normals,
        },
        fields: {
          velocityMagnitude: prev?.fields?.velocityMagnitude ?? new Array(numNodes).fill(vel),
          pressure:
            fieldValues.length === numNodes
              ? fieldValues
              : (prev?.fields?.pressure ?? new Array(numNodes).fill(101325)),
        },
        metadata: {
          maxVelocity: vel * 1.2,
          pressureDrop: scalars.pressureDrop ?? 1500,
          dragForce: [drag, 0, 0] as [number, number, number],
          liftForce: [0, lift, 0] as [number, number, number],
        },
      };
    });
  };

  const handleRunLocalCfd = () => {
    vscode?.postMessage({ type: "runLocalCfd" });
  };

  const handleRunCloudCfd = () => {
    setTelemetryPoints([]);
    setTelemetryPhase("Submitting SU2 CFD job...");
    setTelemetryOpen(true);
    vscode?.postMessage({ type: "runCloudCfd" });
  };

  const handleMaterialize = () => {
    vscode?.postMessage({ type: "materialize" });
  };

  const flowSpeed =
    cfdResults?.metadata?.maxVelocity ??
    (typeof cfgData?.stats?.freestreamVelocity === "number" ? cfgData.stats.freestreamVelocity : 100);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", overflow: "hidden", background: "#0b1120" }}>
      <Canvas camera={{ position: [1.0, 0.8, 1.2], fov: 45 }}>
        <SceneContents
          cfgData={cfgData}
          cfdResults={cfdResults}
          cuttingPlane={cuttingPlane}
          showStreamlines={showStreamlines}
          flowSpeed={flowSpeed}
        />
      </Canvas>

      {/* Hover Numerical Tooltip */}
      <ProbeTooltip probe={probeData} />

      {/* Floating HUD Controller */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          width: "320px",
          background: "rgba(15, 23, 42, 0.88)",
          backdropFilter: "blur(14px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "10px",
          padding: "16px",
          color: "#f8fafc",
          fontFamily: "system-ui, -apple-system, sans-serif",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
          fontSize: "12px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <span style={{ fontWeight: 700, fontSize: "14px", color: "#38bdf8" }}>SU2 CFD Configuration</span>
          {isLoading && <span style={{ color: "#38bdf8", animation: "pulse 1.5s infinite" }}>● Computing...</span>}
        </div>

        {cfgData && (
          <div style={{ marginBottom: "12px", padding: "8px", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#94a3b8" }}>Mach Number:</span>
              <span style={{ fontWeight: 600 }}>{cfgData.stats.machNumber ?? "Incompressible"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#94a3b8" }}>Angle of Attack:</span>
              <span style={{ fontWeight: 600 }}>
                {cfgData.stats.aoa !== undefined ? `${cfgData.stats.aoa}°` : "0.0°"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#94a3b8" }}>Reynolds Number:</span>
              <span style={{ fontWeight: 600 }}>
                {cfgData.stats.reynoldsNumber ? cfgData.stats.reynoldsNumber.toExponential(2) : "N/A"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#94a3b8" }}>Mesh Target:</span>
              <span style={{ fontWeight: 600, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                {cfgData.meshFilename ?? "default.su2"}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <button
            onClick={handleRunLocalCfd}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "8px 10px",
              background: "#0284c7",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            ⚡ Local LBM
          </button>
          <button
            onClick={handleRunCloudCfd}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "8px 10px",
              background: "linear-gradient(135deg, #0284c7 0%, #6366f1 100%)",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            🚀 Cloud SU2
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <button
            onClick={() => setSurrogateDialogOpen(true)}
            style={{
              flex: 1,
              padding: "7px 10px",
              background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
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
            <span>⚡</span> Train ROM
          </button>
          <button
            onClick={() => setSweepDrawerOpen(true)}
            style={{
              flex: 1,
              padding: "7px 10px",
              background: "linear-gradient(135deg, #0284c7 0%, #6366f1 100%)",
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
            <span>📊</span> DoE Sweep
          </button>
        </div>
        <div style={{ marginBottom: "12px" }}>
          <button
            onClick={handleMaterialize}
            style={{
              width: "100%",
              padding: "6px 12px",
              background: "#334155",
              border: "none",
              borderRadius: "6px",
              color: "#ffffff",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            Materialize Config (.cfg)
          </button>
        </div>

        {/* 3D Ergonomics: Streamline & Slicing Toggles */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <input
              type="checkbox"
              id="streamlines"
              checked={showStreamlines}
              onChange={(e) => setShowStreamlines(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor="streamlines" style={{ cursor: "pointer", color: "#38bdf8", fontWeight: 600 }}>
              Show Streamline Ribbons
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontWeight: 600, color: "#94a3b8" }}>✂ Cutting Plane</span>
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
                      background: cuttingPlane.axis === axis ? "#0284c7" : "#1e293b",
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

        {cfgData && cfgData.markers.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "8px" }}>
            <span style={{ color: "#94a3b8", display: "block", marginBottom: "6px", fontWeight: 600 }}>
              Boundary Markers ({cfgData.markers.length})
            </span>
            <div style={{ maxHeight: "100px", overflowY: "auto" }}>
              {cfgData.markers.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "3px 6px",
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                    marginBottom: "3px",
                  }}
                >
                  <span style={{ color: "#e2e8f0" }}>{m.name}</span>
                  <span style={{ color: "#38bdf8", fontSize: "11px" }}>{m.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cfdResults && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "12px", marginTop: "12px" }}>
            <div style={{ fontWeight: 600, marginBottom: "8px", color: "#38bdf8" }}>Aerodynamic Output</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#94a3b8" }}>Max Velocity:</span>
              <span style={{ fontWeight: 600 }}>{cfdResults.metadata?.maxVelocity?.toFixed(1) ?? "0"} m/s</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#94a3b8" }}>Total Drag Force:</span>
              <span style={{ fontWeight: 600 }}>{cfdResults.metadata?.dragForce?.[0]?.toFixed(2) ?? "0"} N</span>
            </div>
          </div>
        )}
      </div>

      {/* Real-Time Cloud Solver Telemetry HUD */}
      <CaeTelemetryPanel
        isOpen={telemetryOpen}
        solverName="SU2 CFD (Cloud HPC)"
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

      {/* Real-Time Interactive 3D Digital Twin ROM Explorer (60 FPS) */}
      {activeSurrogateData && (
        <SurrogateLiveExplorer
          surrogateData={activeSurrogateData}
          modelName={surrogateModelName}
          onReconstruct={handleSurrogateReconstruct}
          onOpenModelica={(mName) => vscode?.postMessage({ type: "openModelica", data: { modelName: mName } })}
          onExportFmu={(mName) => vscode?.postMessage({ type: "exportFmu", data: { modelName: mName } })}
          onClose={() => setActiveSurrogateData(null)}
        />
      )}

      {/* Floating Parametric DoE Sweep Orchestrator Drawer */}
      <SweepConfigDrawer
        isOpen={sweepDrawerOpen}
        onClose={() => setSweepDrawerOpen(false)}
        solver="su2"
        onLaunchSweep={(cfg) => {
          vscode?.postMessage({ type: "launchSweep", data: cfg });
        }}
        onTrainSurrogate={(sweepId) => {
          vscode?.postMessage({ type: "trainSurrogateFromSweep", data: { sweepId } });
        }}
        activeSweepState={activeSweepState}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
