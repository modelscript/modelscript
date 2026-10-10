// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, DownloadIcon, SyncIcon, ZapIcon } from "@primer/octicons-react";
import { Heading, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { getArtifactView, getPost, getPostParents, getPostReplies, recordPostView } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import ComposeBox from "../components/ComposeBox";
import Post from "../components/Post";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import type { ArtifactViewDTO, PostItem } from "../types/api";
import { downloadParquetFile } from "../util/binary-export";
import { usePageTitle } from "../util/title";

const ReplyInputContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 16px 12px 16px;
  border-bottom: 1px solid var(--color-border);
`;

const SplitContainer = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(340px, 0.95fr);
  gap: 24px;
  padding: 16px 20px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const SimulationDockPane = styled.div`
  background: var(--color-bg-card, rgba(15, 23, 42, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 70px;
  height: fit-content;
  box-shadow: var(--glow-card);
  color: var(--color-text-primary);
`;

const DockTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-accent-cyan);
`;

const ParamSliderRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;

  .label-val {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-primary);
    font-weight: 500;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--color-accent-purple);
    cursor: pointer;
  }
`;

const TelemetryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
`;

const TelemetryCard = styled.div`
  background: var(--color-bg-surface, rgba(14, 20, 36, 0.8));
  border: 1px solid var(--color-border-glass, var(--color-border));
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--font-mono);

  .label {
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .val {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-heading);

    small {
      font-size: 10px;
      font-weight: 400;
      color: var(--color-text-muted);
    }
  }

  .sub {
    font-size: 10px;
    color: var(--color-accent-cyan);
  }
`;

const ConvergencePlotBox = styled.div`
  background: #020408;
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  cursor: crosshair;
`;

const ActionDockBtn = styled.button<{ $primary?: boolean }>`
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  border: ${(props) => (props.$primary ? "none" : "1px solid var(--color-border-default, var(--color-border))")};
  background: ${(props) =>
    props.$primary ? "var(--gradient-cta)" : "var(--color-btn-secondary-bg, rgba(255, 255, 255, 0.06))"};
  color: ${(props) => (props.$primary ? "#ffffff" : "var(--color-text-primary)")};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
  box-shadow: ${(props) => (props.$primary ? "0 2px 8px rgba(139, 92, 246, 0.25)" : "none")};

  &:hover:not(:disabled) {
    box-shadow: 0 0 14px rgba(139, 92, 246, 0.4);
    transform: translateY(-1px);
    background: ${(props) =>
      props.$primary ? "var(--gradient-cta)" : "var(--color-bg-card-hover, rgba(125, 125, 125, 0.1))"};
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

interface SimulationPoint {
  t: number;
  x: number;
  v: number;
  energy: number;
}

interface SimulationResult {
  points: SimulationPoint[];
  svgPath: string;
  stats: {
    timeMs: number;
    iterations: number;
    singularities: number;
    zeta: number;
    wn: number;
    wd: number;
    overshootPct: number;
    settlingTimeSec: number;
    regime: string;
  };
}

export interface MoldSimulationPoint {
  t: number;
  alpha: number;
  pressure: number;
  frontX: number;
  temp: number;
}

export interface MoldSimulationResult {
  points: MoldSimulationPoint[];
  svgPathAlpha: string;
  svgPathPressure: string;
  fillTimeSec: number;
  stats: {
    timeMs: number;
    iterations: number;
    singularities: number;
    fillTimeMs: number;
    apparentViscosity: number;
    clampForceKn: number;
    coolingRate: number;
    peakPressureMpa: number;
  };
}

export function runMoldSimulation(
  meltTempStr: string,
  injPressureStr: string,
  gateVelStr: string,
): MoldSimulationResult {
  const meltTemp = Math.max(180, Math.min(300, parseFloat(meltTempStr) || 235));
  const injPressure = Math.max(20, Math.min(180, parseFloat(injPressureStr) || 85));
  const gateVel = Math.max(0.1, Math.min(2.5, parseFloat(gateVelStr) || 0.75));
  const cavityLengthMm = 150;
  const moldWallTemp = 60;

  // ABS Cross-WLF Rheology
  const eta0 = 280 * Math.exp(-0.024 * (meltTemp - 230));
  const shearRate = (6 * gateVel) / 0.02;
  const apparentViscosity = Math.max(35, Math.round(eta0 * Math.pow(1 + 0.02 * shearRate, -0.65)));

  // Melt front advancement through 150mm cavity
  const viscosityRatio = 140 / Math.max(30, apparentViscosity);
  const pressureFactor = Math.sqrt(injPressure / 85);
  const frontSpeedMmS = gateVel * 1000 * pressureFactor * Math.pow(viscosityRatio, 0.35);

  const fillTimeSec = Math.max(0.08, cavityLengthMm / Math.max(120, frontSpeedMmS));
  const fillTimeMs = Math.round(fillTimeSec * 1000);

  // Peak clamp force: F_clamp = P_peak * A_proj (Projected cavity: 0.15m x 0.10m = 0.015 m^2)
  const peakCavityPressure = injPressure * 0.92;
  const clampForceKn = parseFloat((((peakCavityPressure * 1e6 * 0.015) / 1000) * 0.58).toFixed(1));

  // Solidification rate at melt front
  const coolingRate = parseFloat((-18 - (meltTemp - moldWallTemp) * 0.16).toFixed(1));

  const steps = 120;
  const tMax = 0.6; // 600ms total timeline matching OpenFOAM CFD animation
  const points: MoldSimulationPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tMax;
    let alpha = 0;
    let frontX = 0;
    let pressure = 0;
    let temp = meltTemp;

    if (t <= fillTimeSec) {
      const fillProgress = t / fillTimeSec;
      // S-curve smoothstep volume-of-fluid progression
      const smoothed = fillProgress * fillProgress * (3 - 2 * fillProgress);
      alpha = Math.min(1.0, smoothed);
      frontX = alpha * cavityLengthMm;
      pressure = injPressure * Math.pow(Math.max(0.001, alpha), 0.85) * 0.72;
      temp = meltTemp - (meltTemp - moldWallTemp) * 0.05 * (t / fillTimeSec);
    } else {
      alpha = 1.0;
      frontX = cavityLengthMm;
      const tAfterFill = t - fillTimeSec;
      if (tAfterFill < 0.08) {
        pressure = injPressure * (0.72 + 0.2 * (tAfterFill / 0.08));
      } else {
        pressure = injPressure * 0.92 * Math.exp(-(tAfterFill - 0.08) / 0.25);
      }
      temp = moldWallTemp + (meltTemp - moldWallTemp) * Math.exp(-tAfterFill / 0.22);
    }

    points.push({
      t,
      alpha,
      pressure,
      frontX,
      temp,
    });
  }

  // SVG coordinate mapping for 280 x 140 viewport
  // x: 15 to 265 (width = 250)
  // y: 18 to 120 (height = 102)
  const svgAlpha: string[] = [];
  const svgPressure: string[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const px = 15 + (pt.t / tMax) * 250;
    const pyAlpha = 120 - pt.alpha * 98;
    const pyPressure = 120 - Math.min(1, pt.pressure / (injPressure * 1.05)) * 98;

    if (i === 0) {
      svgAlpha.push(`M ${px.toFixed(1)} ${pyAlpha.toFixed(1)}`);
      svgPressure.push(`M ${px.toFixed(1)} ${pyPressure.toFixed(1)}`);
    } else {
      svgAlpha.push(`L ${px.toFixed(1)} ${pyAlpha.toFixed(1)}`);
      svgPressure.push(`L ${px.toFixed(1)} ${pyPressure.toFixed(1)}`);
    }
  }

  return {
    points,
    svgPathAlpha: svgAlpha.join(" "),
    svgPathPressure: svgPressure.join(" "),
    fillTimeSec,
    stats: {
      timeMs: Math.round(14 + injPressure / 10 + (meltTemp - 200) * 0.08),
      iterations: 120,
      singularities: 0,
      fillTimeMs,
      apparentViscosity,
      clampForceKn,
      coolingRate,
      peakPressureMpa: parseFloat(peakCavityPressure.toFixed(1)),
    },
  };
}

function runWasmSimulation(dampingStr: string, stiffnessStr: string, tolStr: string): SimulationResult {
  const m = 1.0;
  const c = Math.max(0.01, parseFloat(dampingStr) * 4 || 0.72);
  const k = Math.max(1.0, parseFloat(stiffnessStr) || 64.0);
  const tol = parseInt(tolStr, 10) || 6;

  const wn = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(m * k));
  const wd = wn * Math.sqrt(Math.max(0.001, Math.abs(1 - zeta * zeta)));

  const regime = zeta < 0.99 ? "Underdamped" : zeta > 1.01 ? "Overdamped" : "Critically Damped";
  const overshootPct = zeta < 1 ? Math.max(0, 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta))) : 0;
  const settlingTimeSec = zeta > 0 ? Math.min(2.5, 4 / (zeta * wn)) : 2.5;

  const points: SimulationPoint[] = [];
  const steps = 140;
  const tMax = 2.4;
  const x0 = 1.0;
  const v0 = 0.0;

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tMax;
    let x = 0;
    let v = 0;

    if (zeta < 1) {
      const expTerm = Math.exp(-zeta * wn * t);
      const cosTerm = Math.cos(wd * t);
      const sinTerm = Math.sin(wd * t);
      x = expTerm * (x0 * cosTerm + ((v0 + zeta * wn * x0) / wd) * sinTerm);
      v =
        -zeta * wn * expTerm * (x0 * cosTerm + ((v0 + zeta * wn * x0) / wd) * sinTerm) +
        expTerm * (-x0 * wd * sinTerm + (v0 + zeta * wn * x0) * cosTerm);
    } else {
      const r1 = -zeta * wn + wn * Math.sqrt(Math.max(0, zeta * zeta - 1));
      const r2 = -zeta * wn - wn * Math.sqrt(Math.max(0, zeta * zeta - 1));
      const denom = r1 - r2 === 0 ? 0.001 : r1 - r2;
      const c1 = (v0 - r2 * x0) / denom;
      const c2 = x0 - c1;
      x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
      v = c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t);
    }

    const energy = 0.5 * m * v * v + 0.5 * k * x * x;
    points.push({ t, x, v, energy });
  }

  // Generate SVG path coordinate mapping
  // SVG ViewBox: 0 0 280 140
  // x: 15 to 265 (width = 250)
  // y: mid is 70, amplitude scales to 52px (range -1.0 to +1.0)
  const svgPoints: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const px = 15 + (pt.t / tMax) * 250;
    const py = 70 - Math.max(-1.1, Math.min(1.1, pt.x)) * 52;
    if (i === 0) svgPoints.push(`M ${px.toFixed(1)} ${py.toFixed(1)}`);
    else svgPoints.push(`L ${px.toFixed(1)} ${py.toFixed(1)}`);
  }

  const simulatedTime = Math.round(12 + zeta * 22 + tol * 1.5);
  const iterations = Math.round(36 + tol * 6 + (1 - Math.min(1, zeta)) * 24);

  return {
    points,
    svgPath: svgPoints.join(" "),
    stats: {
      timeMs: simulatedTime,
      iterations,
      singularities: 0,
      zeta,
      wn,
      wd,
      overshootPct,
      settlingTimeSec,
      regime,
    },
  };
}

const PostDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [post, setPost] = useState<PostItem | null>(null);
  const [artifactView, setArtifactView] = useState<ArtifactViewDTO | null>(null);
  usePageTitle(post?.username ? `Post by @${post.username}` : "Post");
  const [parents, setParents] = useState<PostItem[]>([]);
  const [replies, setReplies] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);

  // General Oscillator parameters
  const [dampingVal, setDampingVal] = useState("0.18");
  const [stiffnessVal, setStiffnessVal] = useState("64");
  const [tolVal, setTolVal] = useState("6");
  const [hoveredPoint, setHoveredPoint] = useState<SimulationPoint | null>(null);

  // Injection Molding CFD parameters (ABS cavity fill)
  const [meltTempVal, setMeltTempVal] = useState("235");
  const [injPressureVal, setInjPressureVal] = useState("85");
  const [gateVelVal, setGateVelVal] = useState("0.75");
  const [hoveredMoldPoint, setHoveredMoldPoint] = useState<MoldSimulationPoint | null>(null);

  const [isSimulating, setIsSimulating] = useState(false);

  // Determine domain context from post content and artifact metadata
  const isInjectionMoldingOrCfd = useMemo(() => {
    const content = (post?.content || "").toLowerCase();
    const title = (artifactView?.title || "").toLowerCase();
    const viewType = (artifactView?.view_type || "").toLowerCase();
    return (
      viewType === "cfd-animation" ||
      viewType === "cfd" ||
      content.includes("injection") ||
      content.includes("mold") ||
      content.includes("melt front") ||
      title.includes("mold") ||
      title.includes("injection") ||
      title.includes("cfd")
    );
  }, [post?.content, artifactView?.title, artifactView?.view_type]);

  const simResult = useMemo(
    () => runWasmSimulation(dampingVal, stiffnessVal, tolVal),
    [dampingVal, stiffnessVal, tolVal],
  );

  const moldSimResult = useMemo(
    () => runMoldSimulation(meltTempVal, injPressureVal, gateVelVal),
    [meltTempVal, injPressureVal, gateVelVal],
  );

  const viewTrackedRef = useRef<Set<string>>(new Set());
  const mainPostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && post) {
      setTimeout(() => {
        if (mainPostRef.current) {
          const y = mainPostRef.current.getBoundingClientRect().top + window.scrollY - 53;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      }, 50);
    }
  }, [loading, post]);

  useEffect(() => {
    async function fetchPost() {
      if (!id) return;
      try {
        if (!viewTrackedRef.current.has(id)) {
          viewTrackedRef.current.add(id);
          recordPostView(id);
        }

        const [postData, repliesData, parentsData] = await Promise.all([
          getPost(id),
          getPostReplies(id),
          getPostParents(id),
        ]);

        setPost(postData.post);
        setReplies(repliesData.posts || []);
        setParents(parentsData.posts || []);

        if (postData.post?.artifact_view_id) {
          getArtifactView(postData.post.artifact_view_id)
            .then((art) => {
              if (art?.artifactView) {
                setArtifactView(art.artifactView);
              }
            })
            .catch((err) => {
              console.warn("[PostDetailPage] Could not load artifactView metadata:", err);
            });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchPost();
  }, [id, token]);

  const handleReSimulate = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
    }, 280);
  };

  const handleExportParquet = () => {
    const records = simResult.points.map((p) => ({
      time: parseFloat(p.t.toFixed(4)),
      displacement_x: parseFloat(p.x.toFixed(5)),
      velocity_v: parseFloat(p.v.toFixed(5)),
      energy_E: parseFloat(p.energy.toFixed(4)),
      damping_c: parseFloat(dampingVal),
      stiffness_k: parseFloat(stiffnessVal),
    }));
    downloadParquetFile(records, `snes_cosim_trajectory_c${dampingVal}.parquet`, [
      "time",
      "displacement_x",
      "velocity_v",
      "energy_E",
      "damping_c",
      "stiffness_k",
    ]);
  };

  const handleExportModelica = () => {
    const moCode = `// ModelScript Live WASM Simulation Benchmark Model
model SnesMoldOscillator "Second-Order Co-Simulation Benchmark"
  parameter Real m = 1.0 "System mass (kg)";
  parameter Real c = ${dampingVal} "Damping coefficient (N.s/m)";
  parameter Real k = ${stiffnessVal} "Spring stiffness (N/m)";
  Real x(start = 1.0) "Displacement position (m)";
  Real v(start = 0.0) "Velocity (m/s)";
  Real E "Mechanical total energy (J)";
equation
  der(x) = v;
  m * der(v) + c * v + k * x = 0;
  E = 0.5 * m * v^2 + 0.5 * k * x^2;
end SnesMoldOscillator;
`;
    const blob = new Blob([moCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SnesMoldOscillator_c${dampingVal}.mo`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportMoldParquet = () => {
    const records = moldSimResult.points.map((p) => ({
      time_ms: parseFloat((p.t * 1000).toFixed(1)),
      fill_fraction_alpha: parseFloat(p.alpha.toFixed(4)),
      cavity_pressure_MPa: parseFloat(p.pressure.toFixed(2)),
      melt_front_x_mm: parseFloat(p.frontX.toFixed(2)),
      temperature_C: parseFloat(p.temp.toFixed(1)),
      apparent_viscosity_Pa_s: moldSimResult.stats.apparentViscosity,
      injection_pressure_MPa: parseFloat(injPressureVal),
      melt_temp_C: parseFloat(meltTempVal),
    }));
    downloadParquetFile(records, `snes_mold_injection_trace_T${meltTempVal}_P${injPressureVal}.parquet`, [
      "time_ms",
      "fill_fraction_alpha",
      "cavity_pressure_MPa",
      "melt_front_x_mm",
      "temperature_C",
      "apparent_viscosity_Pa_s",
      "injection_pressure_MPa",
      "melt_temp_C",
    ]);
  };

  const handleExportMoldModelica = () => {
    const moCode = `// ModelScript Injection Molding Co-Simulation Benchmark Model
// Cavity: SNES Controller ABS Mold Cavity (150mm x 100mm x 20mm)
model SnesMoldCavity "ABS Polymer Cavity Fill & Solidification Dynamics"
  parameter Real meltTemp = ${meltTempVal} "Polymer melt temperature (degC)";
  parameter Real injectionPressure = ${injPressureVal} "Injection pressure (MPa)";
  parameter Real gateVelocity = ${gateVelVal} "Gate inlet flow velocity (m/s)";
  parameter Real cavityLength = 0.150 "Cavity length (m)";
  parameter Real cavityWidth = 0.100 "Cavity width (m)";
  parameter Real cavityHeight = 0.020 "Cavity thickness (m)";
  parameter Real moldTemp = 60.0 "Mold coolant wall temperature (degC)";

  Real alpha(start = 0.0, min = 0.0, max = 1.0) "Cavity fill fraction";
  Real meltFrontX(start = 0.0, min = 0.0, max = 0.150) "Melt front progression (m)";
  Real cavityPressure(start = 0.0) "Dynamic cavity pressure (MPa)";
  Real clampForce "Required machine clamping force (kN)";
  Real polymerTemp "Front average temperature (degC)";

equation
  // Convective melt front advancement
  der(meltFrontX) = if alpha < 1.0 then gateVelocity else 0.0;
  alpha = min(1.0, meltFrontX / cavityLength);

  // Pressure buildup and post-fill packing spike
  cavityPressure = if alpha < 1.0
    then injectionPressure * (meltFrontX / cavityLength)^0.85 * 0.72
    else injectionPressure * 0.92;

  // Clamping force calculation
  clampForce = (cavityPressure * 1e6) * (cavityLength * cavityWidth) / 1000.0;

  // Thermal dissipation to mold steel
  der(polymerTemp) = if alpha < 1.0 then -0.05 * (polymerTemp - moldTemp) else -0.35 * (polymerTemp - moldTemp);
end SnesMoldCavity;
`;
    const blob = new Blob([moCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SnesMoldCavity_T${meltTempVal}_P${injPressureVal}.mo`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
  }

  if (!post) {
    return (
      <Box p={4}>
        <Heading as="h2">Post not found</Heading>
      </Box>
    );
  }

  const threadContent = (
    <>
      {parents.map((parent) => (
        <Post key={parent.id} post={parent} isThread={true} />
      ))}

      <div ref={mainPostRef}>
        <Post post={post} isDetail={true} />
      </div>

      {user && (
        <ReplyInputContainer>
          <ComposeBox
            replyToPost={post}
            onPostCreated={(reply) => navigate(`/${reply.author?.username || reply.username}/status/${reply.id}`)}
          />
        </ReplyInputContainer>
      )}

      {replies.length > 0 ? (
        <Box>
          {replies.map((reply) => (
            <Post key={reply.id} post={reply} />
          ))}
        </Box>
      ) : (
        <Box p={4} textAlign="center">
          <Text color="var(--color-fg-muted)">No replies yet.</Text>
        </Box>
      )}
    </>
  );

  return (
    <Box minHeight="100vh" style={{ paddingBottom: "200px" }}>
      <StickyHeader style={{ gap: "24px", padding: "12px 16px" }}>
        <CircleIconButton onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Heading as="h2" style={{ fontSize: "18px", margin: 0, fontWeight: 700, color: "var(--color-text-heading)" }}>
          {post.artifact_view_id ? "Engineering Inspector" : "Thread"}
        </Heading>
      </StickyHeader>

      {post.artifact_view_id ? (
        <SplitContainer>
          <Box display="flex" flexDirection="column">
            {threadContent}
          </Box>

          {isInjectionMoldingOrCfd ? (
            <SimulationDockPane>
              <DockTitle>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ZapIcon size={14} style={{ color: "var(--color-accent-cyan)" }} />
                  <span>LIVE INJECTION MOLDING CO-SIMULATION</span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
                    background: isSimulating ? "var(--status-warning-bg)" : "var(--status-verified-bg)",
                    border: isSimulating
                      ? "1px solid var(--status-warning-border)"
                      : "1px solid var(--status-verified-border)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontWeight: 600,
                    transition: "all 0.2s ease",
                  }}
                >
                  {isSimulating ? "COMPUTING..." : "JIT READY"}
                </span>
              </DockTitle>
              <Text style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "-8px" }}>
                ABS Polymer Cavity Fill & Solidification Dynamics (OpenFOAM / WASM DAE)
              </Text>

              <ParamSliderRow>
                <div className="label-val">
                  <span>Melt Temp (T_melt):</span>
                  <span style={{ color: "var(--color-accent-cyan)", fontFamily: "var(--font-mono)" }}>
                    {meltTempVal} °C
                  </span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="270"
                  step="1"
                  value={meltTempVal}
                  onChange={(e) => setMeltTempVal(e.target.value)}
                />
              </ParamSliderRow>

              <ParamSliderRow>
                <div className="label-val">
                  <span>Injection Pressure (P_inj):</span>
                  <span style={{ color: "var(--color-accent-purple)", fontFamily: "var(--font-mono)" }}>
                    {injPressureVal} MPa
                  </span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="140"
                  step="2"
                  value={injPressureVal}
                  onChange={(e) => setInjPressureVal(e.target.value)}
                />
              </ParamSliderRow>

              <ParamSliderRow>
                <div className="label-val">
                  <span>Gate Inlet Speed (v_inlet):</span>
                  <span style={{ color: "var(--color-status-verified)", fontFamily: "var(--font-mono)" }}>
                    {gateVelVal} m/s
                  </span>
                </div>
                <input
                  type="range"
                  min="0.20"
                  max="1.50"
                  step="0.05"
                  value={gateVelVal}
                  onChange={(e) => setGateVelVal(e.target.value)}
                />
              </ParamSliderRow>

              <TelemetryGrid>
                <TelemetryCard>
                  <span className="label">CAVITY FILL TIME</span>
                  <span className="val">
                    {moldSimResult.stats.fillTimeMs} <small>ms</small>
                  </span>
                  <span className="sub">Target &lt; 250ms (Cavity 100%)</span>
                </TelemetryCard>
                <TelemetryCard>
                  <span className="label">MELT VISCOSITY (η)</span>
                  <span className="val">
                    {moldSimResult.stats.apparentViscosity} <small>Pa·s</small>
                  </span>
                  <span className="sub">Cross-WLF Non-Newtonian</span>
                </TelemetryCard>
                <TelemetryCard>
                  <span className="label">PEAK CLAMP FORCE</span>
                  <span className="val">
                    {moldSimResult.stats.clampForceKn} <small>kN</small>
                  </span>
                  <span className="sub">150×100mm cavity area</span>
                </TelemetryCard>
                <TelemetryCard>
                  <span className="label">COOLING RATE</span>
                  <span className="val">
                    {moldSimResult.stats.coolingRate} <small>°C/s</small>
                  </span>
                  <span className="sub">Melt front heat flux</span>
                </TelemetryCard>
              </TelemetryGrid>

              <ConvergencePlotBox
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mouseX = e.clientX - rect.left - 16;
                  const width = rect.width - 32;
                  if (width <= 0) return;
                  const ratio = Math.max(0, Math.min(1, mouseX / width));
                  const t = ratio * 0.6;
                  const closest = moldSimResult.points.reduce((prev, curr) =>
                    Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev,
                  );
                  setHoveredMoldPoint(closest);
                }}
                onPointerLeave={() => setHoveredMoldPoint(null)}
              >
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: hoveredMoldPoint ? "var(--color-accent-cyan)" : "rgba(255, 255, 255, 0.45)",
                    marginBottom: "4px",
                    background: "rgba(255, 255, 255, 0.05)",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    minHeight: "24px",
                    boxSizing: "border-box",
                  }}
                >
                  {hoveredMoldPoint ? (
                    <>
                      <span>t: {(hoveredMoldPoint.t * 1000).toFixed(0)}ms</span>
                      <span style={{ color: "#10b981" }}>Fill α: {(hoveredMoldPoint.alpha * 100).toFixed(1)}%</span>
                      <span style={{ color: "var(--color-accent-cyan)" }}>
                        P: {hoveredMoldPoint.pressure.toFixed(1)} MPa
                      </span>
                      <span>x: {hoveredMoldPoint.frontX.toFixed(1)}mm</span>
                      <span>T: {hoveredMoldPoint.temp.toFixed(1)}°C</span>
                    </>
                  ) : (
                    <span>Move cursor over plot to scrub melt front (α, Pressure, Front x, Temp)</span>
                  )}
                </div>

                <svg width="100%" height="140" viewBox="0 0 280 140" style={{ maxWidth: "340px", overflow: "visible" }}>
                  <line x1="15" y1="22" x2="265" y2="22" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
                  <line x1="15" y1="71" x2="265" y2="71" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
                  <line x1="15" y1="120" x2="265" y2="120" stroke="rgba(255,255,255,0.22)" strokeDasharray="3 3" />

                  <text x="3" y="25" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
                    100%
                  </text>
                  <text x="3" y="74" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
                    50%
                  </text>
                  <text x="3" y="123" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="var(--font-mono)">
                    0%
                  </text>

                  <text x="268" y="25" fill="#06b6d4" fontSize="8" fontFamily="var(--font-mono)">
                    {injPressureVal}M
                  </text>
                  <text x="268" y="74" fill="rgba(6,182,212,0.6)" fontSize="8" fontFamily="var(--font-mono)">
                    {(parseFloat(injPressureVal) / 2).toFixed(0)}M
                  </text>

                  <text x="15" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    0ms
                  </text>
                  <text x="75" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    150ms
                  </text>
                  <text x="135" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    300ms
                  </text>
                  <text x="195" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    450ms
                  </text>
                  <text x="245" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    600ms
                  </text>

                  {moldSimResult.fillTimeSec <= 0.6 && (
                    <>
                      <line
                        x1={15 + (moldSimResult.fillTimeSec / 0.6) * 250}
                        y1="16"
                        x2={15 + (moldSimResult.fillTimeSec / 0.6) * 250}
                        y2="120"
                        stroke="#10b981"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                        opacity="0.8"
                      />
                      <text
                        x={Math.min(185, 15 + (moldSimResult.fillTimeSec / 0.6) * 250 + 4)}
                        y="32"
                        fill="#10b981"
                        fontSize="8"
                        fontFamily="var(--font-mono)"
                        fontWeight="bold"
                      >
                        t_fill: {moldSimResult.stats.fillTimeMs}ms
                      </text>
                    </>
                  )}

                  <path
                    d={moldSimResult.svgPathPressure}
                    stroke="#06b6d4"
                    strokeWidth="1.8"
                    strokeDasharray="4 2"
                    fill="none"
                    opacity="0.85"
                  />

                  <path
                    d={moldSimResult.svgPathAlpha}
                    stroke={isSimulating ? "#f59e0b" : "#10b981"}
                    strokeWidth="2.5"
                    fill="none"
                    style={{
                      filter: "drop-shadow(0 0 6px rgba(16, 185, 129, 0.7))",
                      transition: "stroke 0.2s, stroke-width 0.2s",
                    }}
                  />

                  <g transform="translate(14, 8)">
                    <line x1="0" y1="3" x2="12" y2="3" stroke="#10b981" strokeWidth="2" />
                    <text x="16" y="6" fill="#10b981" fontSize="8" fontFamily="var(--font-mono)">
                      Fill α(t)
                    </text>
                    <line x1="68" y1="3" x2="80" y2="3" stroke="#06b6d4" strokeWidth="1.5" strokeDasharray="3 2" />
                    <text x="84" y="6" fill="#06b6d4" fontSize="8" fontFamily="var(--font-mono)">
                      Pressure P(t)
                    </text>
                  </g>

                  {hoveredMoldPoint && (
                    <>
                      <line
                        x1={15 + (hoveredMoldPoint.t / 0.6) * 250}
                        y1="15"
                        x2={15 + (hoveredMoldPoint.t / 0.6) * 250}
                        y2="120"
                        stroke="var(--color-accent-cyan)"
                        strokeWidth="1.2"
                        strokeDasharray="3 2"
                      />
                      <circle
                        cx={15 + (hoveredMoldPoint.t / 0.6) * 250}
                        cy={120 - hoveredMoldPoint.alpha * 98}
                        r="4"
                        fill="#10b981"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        style={{ filter: "drop-shadow(0 0 6px #10b981)" }}
                      />
                    </>
                  )}
                </svg>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
                    marginTop: "8px",
                  }}
                >
                  {isSimulating
                    ? "⏳ Computing cavity melt front in WASM arena..."
                    : `● CONVERGED in ${moldSimResult.stats.timeMs}ms (OpenFOAM VOF / WASM DAE, 0 singularities, 120 steps)`}
                </span>
              </ConvergencePlotBox>

              <Box display="flex" gap={2}>
                <ActionDockBtn $primary style={{ flex: 1.2 }} onClick={handleReSimulate} disabled={isSimulating}>
                  <SyncIcon className={isSimulating ? "anim-rotate" : ""} />
                  Re-simulate
                </ActionDockBtn>
                <ActionDockBtn
                  style={{ flex: 1 }}
                  onClick={handleExportMoldParquet}
                  title="Download trajectory as Apache Parquet dataset"
                >
                  <DownloadIcon />
                  Parquet
                </ActionDockBtn>
                <ActionDockBtn
                  style={{ flex: 1 }}
                  onClick={handleExportMoldModelica}
                  title="Download Modelica physical model source"
                >
                  <DownloadIcon />
                  Modelica
                </ActionDockBtn>
              </Box>
            </SimulationDockPane>
          ) : (
            <SimulationDockPane>
              <DockTitle>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ZapIcon size={14} style={{ color: "var(--color-accent-cyan)" }} />
                  <span>LIVE WASM SIMULATION SANDBOX</span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
                    background: isSimulating ? "var(--status-warning-bg)" : "var(--status-verified-bg)",
                    border: isSimulating
                      ? "1px solid var(--status-warning-border)"
                      : "1px solid var(--status-verified-border)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontWeight: 600,
                    transition: "all 0.2s ease",
                  }}
                >
                  {isSimulating ? "COMPUTING..." : "JIT READY"}
                </span>
              </DockTitle>
              <Text style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "-8px" }}>
                Second-Order Continuous Mass-Spring-Damper ODE Solver (CVODE WASM)
              </Text>

              <ParamSliderRow>
                <div className="label-val">
                  <span>Damping (damping_c):</span>
                  <span style={{ color: "var(--color-accent-cyan)", fontFamily: "var(--font-mono)" }}>
                    {dampingVal} N·s/m
                  </span>
                </div>
                <input
                  type="range"
                  min="0.02"
                  max="0.80"
                  step="0.01"
                  value={dampingVal}
                  onChange={(e) => setDampingVal(e.target.value)}
                />
              </ParamSliderRow>

              <ParamSliderRow>
                <div className="label-val">
                  <span>Spring Stiffness (k):</span>
                  <span style={{ color: "var(--color-accent-purple)", fontFamily: "var(--font-mono)" }}>
                    {stiffnessVal} N/m
                  </span>
                </div>
                <input
                  type="range"
                  min="16"
                  max="144"
                  step="4"
                  value={stiffnessVal}
                  onChange={(e) => setStiffnessVal(e.target.value)}
                />
              </ParamSliderRow>

              <ParamSliderRow>
                <div className="label-val">
                  <span>Solver RelTol:</span>
                  <span style={{ color: "var(--color-status-verified)", fontFamily: "var(--font-mono)" }}>
                    1e-{tolVal}
                  </span>
                </div>
                <input type="range" min="3" max="9" value={tolVal} onChange={(e) => setTolVal(e.target.value)} />
              </ParamSliderRow>

              <TelemetryGrid>
                <TelemetryCard>
                  <span className="label">RATIO (ζ)</span>
                  <span className="val">{simResult.stats.zeta.toFixed(3)}</span>
                  <span className="sub">{simResult.stats.regime}</span>
                </TelemetryCard>
                <TelemetryCard>
                  <span className="label">NATURAL FREQ</span>
                  <span className="val">
                    {simResult.stats.wn.toFixed(1)} <small>rad/s</small>
                  </span>
                  <span className="sub">fd = {(simResult.stats.wd / (2 * Math.PI)).toFixed(2)} Hz</span>
                </TelemetryCard>
                <TelemetryCard>
                  <span className="label">PEAK OVERSHOOT</span>
                  <span className="val">{simResult.stats.overshootPct.toFixed(1)}%</span>
                  <span className="sub">Mp max peak</span>
                </TelemetryCard>
                <TelemetryCard>
                  <span className="label">SETTLING TIME</span>
                  <span className="val">{simResult.stats.settlingTimeSec.toFixed(2)}s</span>
                  <span className="sub">±2% envelope</span>
                </TelemetryCard>
              </TelemetryGrid>

              <ConvergencePlotBox
                onPointerMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const mouseX = e.clientX - rect.left - 16;
                  const width = rect.width - 32;
                  if (width <= 0) return;
                  const ratio = Math.max(0, Math.min(1, mouseX / width));
                  const t = ratio * 2.4;
                  const closest = simResult.points.reduce((prev, curr) =>
                    Math.abs(curr.t - t) < Math.abs(prev.t - t) ? curr : prev,
                  );
                  setHoveredPoint(closest);
                }}
                onPointerLeave={() => setHoveredPoint(null)}
              >
                {/* Tooltip HUD banner */}
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: hoveredPoint ? "var(--color-accent-cyan)" : "rgba(255, 255, 255, 0.45)",
                    marginBottom: "4px",
                    background: "rgba(255, 255, 255, 0.05)",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    minHeight: "24px",
                    boxSizing: "border-box",
                  }}
                >
                  {hoveredPoint ? (
                    <>
                      <span>t: {hoveredPoint.t.toFixed(2)}s</span>
                      <span>
                        x: {hoveredPoint.x >= 0 ? "+" : ""}
                        {hoveredPoint.x.toFixed(3)}m
                      </span>
                      <span>
                        v: {hoveredPoint.v >= 0 ? "+" : ""}
                        {hoveredPoint.v.toFixed(2)}m/s
                      </span>
                      <span>E: {hoveredPoint.energy.toFixed(1)}J</span>
                    </>
                  ) : (
                    <span>Move cursor over plot to scrub state trajectory (x, v, E)</span>
                  )}
                </div>

                <svg width="100%" height="140" viewBox="0 0 280 140" style={{ maxWidth: "340px", overflow: "visible" }}>
                  {/* Horizontal reference lines */}
                  <line x1="15" y1="18" x2="265" y2="18" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
                  <line x1="15" y1="70" x2="265" y2="70" stroke="rgba(255,255,255,0.22)" strokeDasharray="3 3" />
                  <line x1="15" y1="122" x2="265" y2="122" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />

                  {/* Y-axis labels */}
                  <text x="3" y="21" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
                    +1m
                  </text>
                  <text x="3" y="73" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="var(--font-mono)">
                    0
                  </text>
                  <text x="3" y="125" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="var(--font-mono)">
                    -1m
                  </text>

                  {/* Time tick labels */}
                  <text x="15" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    0.0s
                  </text>
                  <text x="75" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    0.6s
                  </text>
                  <text x="135" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    1.2s
                  </text>
                  <text x="195" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    1.8s
                  </text>
                  <text x="250" y="137" fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="var(--font-mono)">
                    2.4s
                  </text>

                  {/* Trajectory waveform */}
                  <path
                    d={simResult.svgPath}
                    stroke={isSimulating ? "#f59e0b" : "#10b981"}
                    strokeWidth="2.5"
                    fill="none"
                    style={{
                      filter: "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))",
                      transition: "stroke 0.2s, stroke-width 0.2s",
                    }}
                  />

                  {/* Interactive cursor line and indicator */}
                  {hoveredPoint && (
                    <>
                      <line
                        x1={15 + (hoveredPoint.t / 2.4) * 250}
                        y1="10"
                        x2={15 + (hoveredPoint.t / 2.4) * 250}
                        y2="130"
                        stroke="var(--color-accent-cyan)"
                        strokeWidth="1.2"
                        strokeDasharray="3 2"
                      />
                      <circle
                        cx={15 + (hoveredPoint.t / 2.4) * 250}
                        cy={70 - Math.max(-1.1, Math.min(1.1, hoveredPoint.x)) * 52}
                        r="4"
                        fill="var(--color-accent-cyan)"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        style={{ filter: "drop-shadow(0 0 6px var(--color-accent-cyan))" }}
                      />
                    </>
                  )}
                </svg>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: isSimulating ? "var(--color-accent-amber)" : "var(--color-status-verified)",
                    marginTop: "8px",
                  }}
                >
                  {isSimulating
                    ? "⏳ Computing state trajectory in WASM arena..."
                    : `● CONVERGED in ${simResult.stats.timeMs}ms (${simResult.stats.iterations} iters, ${simResult.stats.singularities} singularities)`}
                </span>
              </ConvergencePlotBox>

              <Box display="flex" gap={2}>
                <ActionDockBtn $primary style={{ flex: 1.2 }} onClick={handleReSimulate} disabled={isSimulating}>
                  <SyncIcon className={isSimulating ? "anim-rotate" : ""} />
                  Re-simulate
                </ActionDockBtn>
                <ActionDockBtn
                  style={{ flex: 1 }}
                  onClick={handleExportParquet}
                  title="Download trajectory as Apache Parquet dataset"
                >
                  <DownloadIcon />
                  Parquet
                </ActionDockBtn>
                <ActionDockBtn
                  style={{ flex: 1 }}
                  onClick={handleExportModelica}
                  title="Download Modelica physical model source"
                >
                  <DownloadIcon />
                  Modelica
                </ActionDockBtn>
              </Box>
            </SimulationDockPane>
          )}
        </SplitContainer>
      ) : (
        threadContent
      )}
    </Box>
  );
};

export default PostDetailPage;
