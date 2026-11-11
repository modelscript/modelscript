// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Verification3DOverlayPayload } from "@modelscript/cad";
import {
  computeForwardKinematics,
  computeInverseDynamicsRnea,
  computeLiveDigitalTwinTelemetry,
  computeRobotVisualAndCollisionPoses,
  generateDefaultKinematicDemoTrajectory,
  generateToolpathTrace,
  interpolateJointTrajectory,
  lintUrdfRobot,
  parseUrdf,
  renderUrdfSvg,
  urdfToModelica,
  urdfToSimpack,
  urdfToUsd,
  type DigitalTwinEnvironmentAsset,
  type DigitalTwinProgramStep,
  type DigitalTwinToolpathTrace,
  type UrdfDiagnostic,
  type UrdfRobot,
  type UrdfTrajectoryData,
} from "@modelscript/urdf";
import { CheckCircleIcon, CopyIcon, PauseIcon, PlayIcon, SyncIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import MultibodyViewport3D, {
  type MultibodyLink3D,
  type MultibodyNode3D,
  type ViewportCameraPreset,
} from "./MultibodyViewport3D";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface UrdfViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    robotName?: string | undefined;
    standalone?: boolean | undefined;
    trajectory?: UrdfTrajectoryData | undefined;
    programSteps?: DigitalTwinProgramStep[] | undefined;
    environment?: DigitalTwinEnvironmentAsset[] | undefined;
    toolpaths?: DigitalTwinToolpathTrace[] | undefined;
    verificationOverlay?: Verification3DOverlayPayload | undefined;
    [key: string]: unknown;
  };
  artifactId?: string | number | undefined;
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 40px;
  min-height: 40px;
  flex-shrink: 0;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  gap: 8px;
  z-index: 10;
  overflow: hidden;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`;

const Title = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-fg-default);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Badge = styled.span<{ $variant?: "success" | "warning" | "error" | "info" | "purple" }>`
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 12px;
  white-space: nowrap;
  flex-shrink: 0;
  background: ${(p) =>
    p.$variant === "success"
      ? "rgba(46, 160, 67, 0.15)"
      : p.$variant === "warning"
        ? "rgba(210, 153, 34, 0.15)"
        : p.$variant === "error"
          ? "rgba(248, 81, 73, 0.15)"
          : p.$variant === "purple"
            ? "rgba(163, 113, 247, 0.15)"
            : "rgba(56, 139, 253, 0.15)"};
  color: ${(p) =>
    p.$variant === "success"
      ? "var(--color-success-fg, #3fb950)"
      : p.$variant === "warning"
        ? "var(--color-attention-fg, #d29922)"
        : p.$variant === "error"
          ? "var(--color-danger-fg, #f85149)"
          : p.$variant === "purple"
            ? "#bc8cff"
            : "var(--color-accent-fg, #58a6ff)"};
  border: 1px solid
    ${(p) =>
      p.$variant === "success"
        ? "rgba(46, 160, 67, 0.3)"
        : p.$variant === "warning"
          ? "rgba(210, 153, 34, 0.3)"
          : p.$variant === "error"
            ? "rgba(248, 81, 73, 0.3)"
            : p.$variant === "purple"
              ? "rgba(163, 113, 247, 0.3)"
              : "rgba(56, 139, 253, 0.3)"};
`;

const ContentArea = styled.div<{ $padded?: boolean }>`
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: ${(p) => (p.$padded ? "auto" : "hidden")};
  padding: ${(p) => (p.$padded ? "14px" : "0")};
  display: flex;
  flex-direction: column;
  background: var(--color-canvas-subtle);
`;

const ControlsBar = styled.div`
  background: var(--color-canvas-default);
  border-bottom: 1px solid var(--color-border-default);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  max-height: 96px;
  overflow-y: auto;
  font-size: 12px;
`;

const JointSliderWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-default);
  padding: 4px 8px;
  border-radius: 6px;
`;

const TableWrapper = styled.div`
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: var(--color-canvas-default);
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;

  th,
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border-muted);
  }

  th {
    background: var(--color-canvas-subtle);
    font-weight: 600;
    color: var(--color-fg-muted);
  }

  tr:last-child td {
    border-bottom: none;
  }
`;

const TwinContainer = styled.div`
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
`;

const StepsSidebar = styled.div<{ $isFullScreen?: boolean }>`
  width: ${(p) => (p.$isFullScreen ? "280px" : "228px")};
  min-width: ${(p) => (p.$isFullScreen ? "250px" : "216px")};
  max-width: 320px;
  background: var(--color-canvas-subtle);
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 5;
`;

const LiveStateSection = styled.div`
  padding: 8px 10px;
  background: var(--color-canvas-default);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
`;

const SectionHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-fg-muted);
`;

const MetricTilesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
`;

const MetricTile = styled.div`
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-muted);
  border-radius: 6px;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const MetricTileLabel = styled.span`
  font-size: 9px;
  color: var(--color-fg-muted);
  font-weight: 600;
`;

const MetricTileValue = styled.span<{ $tone?: "default" | "warn" | "danger" | "pass" }>`
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  color: ${(p) =>
    p.$tone === "danger"
      ? "var(--color-danger-fg, #f85149)"
      : p.$tone === "warn"
        ? "var(--color-attention-fg, #d29922)"
        : p.$tone === "pass"
          ? "var(--color-success-fg, #3fb950)"
          : "var(--color-fg-default)"};
`;

const MetricTileSub = styled.span`
  font-size: 9px;
  color: var(--color-fg-subtle, #6e7681);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StepsHeader = styled.div`
  padding: 6px 10px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-fg-muted);
  border-bottom: 1px solid var(--color-border-muted);
  background: var(--color-canvas-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
`;

const StepsListScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const StepItem = styled.div<{ $isActive: boolean }>`
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border-muted);
  cursor: pointer;
  transition: background 0.15s ease;
  background: ${(p) => (p.$isActive ? "rgba(56, 139, 253, 0.14)" : "transparent")};
  border-left: 3px solid ${(p) => (p.$isActive ? "var(--color-accent-fg, #58a6ff)" : "transparent")};

  &:hover {
    background: ${(p) =>
      p.$isActive ? "rgba(56, 139, 253, 0.2)" : "var(--color-canvas-inset, rgba(255,255,255,0.04))"};
  }
`;

const TwinViewportWrapper = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  height: 100%;
`;

const TelemetryOverlay = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  max-width: calc(100% - 116px);
  z-index: 10;
  background: rgba(13, 17, 23, 0.82);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(48, 54, 61, 0.85);
  border-radius: 999px;
  padding: 4px 11px;
  display: flex;
  align-items: center;
  gap: 7px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
`;

const ViewportControlsOverlay = styled.div`
  position: absolute;
  bottom: 52px;
  right: 10px;
  z-index: 10;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
`;

const CameraPillGroup = styled.div`
  display: flex;
  align-items: center;
  background: rgba(13, 17, 23, 0.84);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(48, 54, 61, 0.85);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
`;

const MiniPillButton = styled.button<{ $active?: boolean }>`
  border: none;
  background: ${(p) => (p.$active ? "var(--color-accent-emphasis, #1f6feb)" : "transparent")};
  color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-muted, #8b949e)")};
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    color: ${(p) => (p.$active ? "#ffffff" : "var(--color-fg-default, #e6edf3)")};
    background: ${(p) => (p.$active ? "var(--color-accent-emphasis, #1f6feb)" : "rgba(255, 255, 255, 0.08)")};
  }
`;

const TimelineScrubber = styled.div`
  height: 44px;
  min-height: 44px;
  flex-shrink: 0;
  background: var(--color-canvas-default);
  border-top: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 8px;
  z-index: 10;
`;

const SegmentedTimelineTrack = styled.div`
  position: relative;
  flex: 1;
  min-width: 60px;
  height: 18px;
  display: flex;
  align-items: center;
  cursor: pointer;
`;

const SegmentedBarContainer = styled.div`
  width: 100%;
  height: 7px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  background: var(--color-canvas-subtle);
  border: 1px solid var(--color-border-muted);
`;

const HiddenRangeInput = styled.input`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  margin: 0;
`;

const PlayheadMarker = styled.div<{ $percent: number }>`
  position: absolute;
  left: ${(p) => `${Math.max(0, Math.min(100, p.$percent))}%`};
  top: 1px;
  bottom: 1px;
  width: 3px;
  background: #22c55e;
  border-radius: 2px;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.8);
  transform: translateX(-50%);
  pointer-events: none;
`;

function machineBadgeVariant(machine?: string): "info" | "error" | "purple" | "success" {
  if (!machine) return "info";
  const m = machine.toUpperCase();
  if (m.includes("CNC") || m.includes("GANTRY")) return "error";
  if (m.includes("MIX") || m.includes("STIR")) return "purple";
  return "info";
}

function stepSegmentColor(step: DigitalTwinProgramStep): string {
  if (step.color) return step.color;
  const m = (step.machine || "").toUpperCase();
  if (m.includes("CNC") || m.includes("GANTRY")) return "#ef4444";
  if (m.includes("MIX")) return "#a855f7";
  if (step.label.toLowerCase().includes("grip") || step.label.toLowerCase().includes("release")) {
    return "#22c55e";
  }
  return "#3b82f6";
}

const UrdfViewer: React.FC<UrdfViewerProps> = ({ viewConfig, artifactId, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState<number>(0);
  const [twinControlMode, setTwinControlMode] = useState<"program" | "manual">("program");
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
  const [projectionMode, setProjectionMode] = useState<"urdf" | "modelica" | "simpack" | "usd">("urdf");
  const [copied, setCopied] = useState<boolean>(false);

  // Viewport layer & camera controls
  const [cameraPreset, setCameraPreset] = useState<ViewportCameraPreset>("iso");
  const [cameraPresetTrigger, setCameraPresetTrigger] = useState<number>(0);
  const [showPaths, setShowPaths] = useState<boolean>(false);
  const [showColliders, setShowColliders] = useState<boolean>(false);
  const [showFrames, setShowFrames] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [machineFilter, setMachineFilter] = useState<string>("ALL");

  useEffect(() => {
    if (!viewConfig.code && viewConfig.url) {
      setIsLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl)
        .then((res) => (res.ok ? res.text() : ""))
        .then((text) => setFetchedCode(text))
        .catch(() => setFetchedCode(null))
        .finally(() => setIsLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const rawDeck = viewConfig.code || fetchedCode || "";
  const robot = useMemo<UrdfRobot | null>(() => {
    if (!rawDeck.trim()) return null;
    try {
      return parseUrdf(rawDeck);
    } catch {
      return null;
    }
  }, [rawDeck]);

  useEffect(() => {
    if (!isLoading && robot) {
      (window as any).__ARTIFACT_READY = true;
    }
  }, [isLoading, robot]);

  const modelName =
    viewConfig.modelName || robot?.name || viewConfig.robotName || viewConfig.title || "URDF Robot Mechanism";

  // Calculate total mass and degrees of freedom
  const { totalMassKg, movableJoints } = useMemo(() => {
    if (!robot) return { totalMassKg: 0, movableJoints: 0 };
    let mass = 0;
    for (const link of robot.links.values()) {
      if (link.inertial?.mass) mass += link.inertial.mass;
    }
    let movable = 0;
    for (const joint of robot.joints.values()) {
      if (joint.type !== "fixed" && !joint.mimic) movable++;
    }
    return {
      totalMassKg: mass,
      movableJoints: movable,
      totalLinks: robot.links.size,
    };
  }, [robot]);

  // Pre-flight static diagnostics
  const diagnostics = useMemo<UrdfDiagnostic[]>(() => {
    if (!robot) return [];
    try {
      return lintUrdfRobot(robot);
    } catch {
      return [];
    }
  }, [robot]);

  const hasExplicitTrajectory = Boolean(
    viewConfig.trajectory && Array.isArray(viewConfig.trajectory.times) && viewConfig.trajectory.times.length > 0,
  );

  // For standalone URDF models with movable joints and no explicit trajectory,
  // synthesize a smooth 16s kinematic workspace demo trajectory so every URDF
  // model supports 3D animation, timeline scrubbing, and live RNEA dynamics.
  const synthesizedDemo = useMemo(() => {
    if (hasExplicitTrajectory || !robot || movableJoints === 0) return null;
    try {
      return generateDefaultKinematicDemoTrajectory(robot);
    } catch {
      return null;
    }
  }, [hasExplicitTrajectory, robot, movableJoints]);

  const effectiveTrajectory = viewConfig.trajectory ?? synthesizedDemo?.trajectory;
  const effectiveProgramSteps =
    viewConfig.programSteps && viewConfig.programSteps.length > 0
      ? viewConfig.programSteps
      : (synthesizedDemo?.programSteps ?? []);

  const hasTrajectory = Boolean(
    effectiveTrajectory && Array.isArray(effectiveTrajectory.times) && effectiveTrajectory.times.length > 0,
  );

  const activeView = hasTrajectory
    ? tabIndex === 0
      ? "twin"
      : tabIndex === 1
        ? "tree"
        : tabIndex === 2
          ? "pose"
          : tabIndex === 3
            ? "dynamics"
            : "source"
    : tabIndex === 0
      ? "tree"
      : tabIndex === 1
        ? "pose"
        : tabIndex === 2
          ? "dynamics"
          : "source";

  const tMin = hasTrajectory && effectiveTrajectory ? (effectiveTrajectory.times[0] ?? 0) : 0;
  const tMax =
    hasTrajectory && effectiveTrajectory ? (effectiveTrajectory.times[effectiveTrajectory.times.length - 1] ?? 10) : 10;

  const [isPlaying, setIsPlaying] = useState<boolean>(hasTrajectory);
  const [playbackTime, setPlaybackTime] = useState<number>(tMin);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(tMax > 60 ? 5.0 : 1.0);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastCommitRef = useRef<number>(0);
  const playbackTimeRef = useRef<number>(tMin);

  useEffect(() => {
    playbackTimeRef.current = playbackTime;
  }, [playbackTime]);

  useEffect(() => {
    if (hasTrajectory && effectiveTrajectory) {
      // Start at an interesting mid-cycle point and autoplay immediately
      const defaultStart = effectiveTrajectory.times.length > 4 ? (effectiveTrajectory.times[2] ?? 0) : 0;
      playbackTimeRef.current = defaultStart;
      setPlaybackTime(defaultStart);
      setPlaybackSpeed(tMax > 60 ? 5.0 : 1.0);
      setIsPlaying(true);
    }
  }, [hasTrajectory, effectiveTrajectory, tMax]);

  useEffect(() => {
    if (!isPlaying || activeView !== "twin") {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const startNow = performance.now();
    lastTimeRef.current = startNow;
    lastCommitRef.current = startNow;

    const loop = (now: number) => {
      const dt = ((now - lastTimeRef.current) / 1000) * playbackSpeed;
      lastTimeRef.current = now;

      let next = playbackTimeRef.current + dt;
      if (next >= tMax) {
        if (isLooping) {
          next = tMin;
          playbackTimeRef.current = next;
          lastCommitRef.current = now;
          setPlaybackTime(next);
        } else {
          playbackTimeRef.current = tMax;
          setPlaybackTime(tMax);
          setIsPlaying(false);
          return;
        }
      } else {
        playbackTimeRef.current = next;
        if (now - lastCommitRef.current >= 50) {
          lastCommitRef.current = now;
          setPlaybackTime(next);
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, activeView, playbackSpeed, isLooping, tMin, tMax]);

  // Active joint coordinate map q(t)
  const activeJointMap = useMemo<Map<string, number>>(() => {
    const manualEntries = Object.entries(jointAngles);
    if (activeView === "twin" && twinControlMode === "program" && effectiveTrajectory) {
      return interpolateJointTrajectory(effectiveTrajectory, playbackTime);
    }
    if (manualEntries.length === 0 && twinControlMode === "program" && effectiveTrajectory) {
      return interpolateJointTrajectory(effectiveTrajectory, playbackTime);
    }
    return new Map(manualEntries);
  }, [activeView, twinControlMode, effectiveTrajectory, playbackTime, jointAngles]);

  // Forward Kinematics link poses
  const linkPoses = useMemo(() => {
    if (!robot) return new Map();
    try {
      return computeForwardKinematics(robot, activeJointMap);
    } catch {
      return new Map();
    }
  }, [robot, activeJointMap]);

  // World-space 3D visual and collision poses for realistic CAD rendering
  const { urdfVisuals, urdfCollisions } = useMemo(() => {
    if (!robot || linkPoses.size === 0) return { urdfVisuals: [], urdfCollisions: [] };
    try {
      const res = computeRobotVisualAndCollisionPoses(robot, linkPoses);
      return { urdfVisuals: res.visuals, urdfCollisions: res.collisions };
    } catch {
      return { urdfVisuals: [], urdfCollisions: [] };
    }
  }, [robot, linkPoses]);

  // Live Digital Twin Telemetry (Joint speed, Gripper opening / TCP speed, Clearance mm)
  const liveTelemetry = useMemo(() => {
    if (!robot) {
      return {
        jointVelocitiesRadPerSec: new Map<string, number>(),
        maxJointSpeedDegPerSec: 0,
        rmsJointSpeedDegPerSec: 0,
        gripperOpeningMm: 80,
        gripperStateLabel: "Open" as const,
        hasGripper: false,
        tcpSpeedMmPerSec: 0,
        clearance: {
          minDistanceMm: 100,
          nearestLinkName: "base_link",
          nearestObstacleName: "Ground Plane (z=0)",
          fromPoint: [0, 0, 0.2] as [number, number, number],
          toPoint: [0, 0, 0] as [number, number, number],
        },
      };
    }
    return computeLiveDigitalTwinTelemetry(
      robot,
      twinControlMode === "program" ? effectiveTrajectory : undefined,
      playbackTime,
      activeJointMap,
      linkPoses,
      viewConfig.environment,
    );
  }, [robot, twinControlMode, effectiveTrajectory, playbackTime, activeJointMap, linkPoses, viewConfig.environment]);

  // Inverse Dynamics RNEA gravity hold torques for current pose
  const rneaTorques = useMemo<Map<string, number>>(() => {
    if (!robot) return new Map();
    try {
      const q = new Map<string, number>();
      const qd = new Map<string, number>();
      const qdd = new Map<string, number>();
      for (const [jName, joint] of robot.joints) {
        if (joint.type === "fixed") continue;
        q.set(jName, activeJointMap.get(jName) ?? 0.0);
        qd.set(jName, liveTelemetry.jointVelocitiesRadPerSec.get(jName) ?? 0.0);
        qdd.set(jName, 0.0);
      }
      const res = computeInverseDynamicsRnea(robot, q, qd, qdd, 9.80665);
      return res.jointTorques;
    } catch {
      return new Map();
    }
  }, [robot, activeJointMap, liveTelemetry.jointVelocitiesRadPerSec]);

  // 3D Viewport nodes & links
  const { nodes3D, links3D } = useMemo(() => {
    if (!robot) return { nodes3D: [], links3D: [] };
    const nodes: MultibodyNode3D[] = [];
    const links: MultibodyLink3D[] = [];

    const linkColors = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#79c0ff"];
    let colorIdx = 0;

    for (const [name, link] of robot.links) {
      const pose = linkPoses.get(name);
      const pos: [number, number, number] = pose ? pose.position : [0, 0, 0];
      const isBase = !pose?.parentName || name.includes("base") || name.includes("world");
      nodes.push({
        id: name,
        name,
        type: "body",
        position: pos,
        rotationMatrix: pose?.rotation,
        color: isBase ? "#8b949e" : linkColors[colorIdx++ % linkColors.length],
        dimensions: link.inertial?.mass ? [0.12, 0.12, 0.12] : [0.08, 0.08, 0.08],
      });
    }

    for (const [name, joint] of robot.joints) {
      const parentPose = linkPoses.get(joint.parentLink);
      const childPose = linkPoses.get(joint.childLink);
      if (parentPose && childPose) {
        links.push({
          id: name,
          name,
          type: "joint",
          from: parentPose.position,
          to: childPose.position,
          color: joint.type === "fixed" ? "#6e7681" : "#58a6ff",
        });
      }
    }

    return { nodes3D: nodes, links3D: links };
  }, [robot, linkPoses]);

  // Primary and multi-machine 3D toolpath traces
  const allToolpaths = useMemo<DigitalTwinToolpathTrace[]>(() => {
    if (viewConfig.toolpaths && viewConfig.toolpaths.length > 0) {
      return viewConfig.toolpaths;
    }
    if (hasTrajectory && robot && effectiveTrajectory) {
      const traces: DigitalTwinToolpathTrace[] = [];
      try {
        traces.push(generateToolpathTrace(robot, effectiveTrajectory, undefined, 110, "#38bdf8"));
        if (robot.links.has("pipette_nozzle_link")) {
          traces.push(generateToolpathTrace(robot, effectiveTrajectory, "pipette_nozzle_link", 90, "#f43f5e"));
        }
      } catch {
        // ignore
      }
      return traces;
    }
    return [];
  }, [viewConfig.toolpaths, hasTrajectory, robot, effectiveTrajectory]);

  const toolpathTrace = allToolpaths[0];

  const activeStep = useMemo(() => {
    if (!effectiveProgramSteps || effectiveProgramSteps.length === 0) return null;
    return (
      effectiveProgramSteps.find(
        (s: DigitalTwinProgramStep) => playbackTime >= s.startTime && playbackTime <= s.endTime,
      ) ||
      effectiveProgramSteps[0] ||
      null
    );
  }, [effectiveProgramSteps, playbackTime]);

  const filteredProgramSteps = useMemo(() => {
    const steps = effectiveProgramSteps || [];
    if (machineFilter === "ALL") return steps;
    return steps.filter((s) => (s.machine || "").toUpperCase() === machineFilter);
  }, [effectiveProgramSteps, machineFilter]);

  const availableMachines = useMemo(() => {
    const set = new Set<string>();
    for (const s of effectiveProgramSteps || []) {
      if (s.machine) set.add(s.machine.toUpperCase());
    }
    return Array.from(set);
  }, [effectiveProgramSteps]);

  const tcpPosition = useMemo<[number, number, number] | null>(() => {
    if (!robot || linkPoses.size === 0) return null;
    const toolpathLink = toolpathTrace?.linkName;
    if (toolpathLink && linkPoses.has(toolpathLink)) {
      return linkPoses.get(toolpathLink)!.position;
    }
    const lastNode = nodes3D[nodes3D.length - 1];
    return lastNode ? lastNode.position : null;
  }, [robot, linkPoses, toolpathTrace, nodes3D]);

  // 2D SVG schematic diagram for the Kinematic Tree tab (lazy-rendered when tree tab is active)
  const svgMarkup = useMemo(() => {
    if (activeView !== "tree") return "";
    if (robot && robot.links.size > 0) {
      try {
        const raw = renderUrdfSvg(robot);
        return sanitizeSvgMarkup(raw, { isFullScreen });
      } catch {
        // fall through to viewConfig.svg
      }
    }
    if (viewConfig.svg && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    return "";
  }, [activeView, viewConfig.svg, robot, isFullScreen]);

  // Projected sources (lazy-rendered when source tab is active)
  const projectedCode = useMemo(() => {
    if (activeView !== "source") return "";
    if (!robot) return "";
    if (projectionMode === "modelica") {
      try {
        return urdfToModelica(robot);
      } catch (err) {
        return `// Modelica projection error: ${String(err)}`;
      }
    }
    if (projectionMode === "simpack") {
      try {
        return JSON.stringify(urdfToSimpack(robot), null, 2);
      } catch (err) {
        return `// SIMPACK projection error: ${String(err)}`;
      }
    }
    if (projectionMode === "usd") {
      try {
        return urdfToUsd(robot, viewConfig.trajectory ? { trajectory: viewConfig.trajectory } : {});
      } catch (err) {
        return `# OpenUSD projection error: ${String(err)}`;
      }
    }
    return rawDeck;
  }, [activeView, robot, projectionMode, rawDeck, viewConfig.trajectory]);

  const handleCopyCode = async () => {
    if (!projectedCode) return;
    try {
      await navigator.clipboard.writeText(projectedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error when permission is denied
    }
  };

  const handleOpenPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "urdf" as any,
      code: rawDeck || `<robot name="${modelName}">\n</robot>\n`,
      title: modelName,
    });
    const fromArt = artifactId || viewConfig.artifactId ? `?fromArtifact=${artifactId || viewConfig.artifactId}` : "";
    navigate(`/morsel${fromArt}#m=${hash}`);
  };

  const triggerCameraPreset = (preset: ViewportCameraPreset) => {
    setCameraPreset(preset);
    setCameraPresetTrigger((c) => c + 1);
  };

  const codeLines = useMemo(
    () => (activeView === "source" && projectedCode ? projectedCode.split(/\r?\n/) : []),
    [activeView, projectedCode],
  );

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const cyclePercent = Math.round(((playbackTime - tMin) / Math.max(1e-6, tMax - tMin)) * 100);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <Badge $variant="info">{hasTrajectory ? "DIGITAL TWIN" : "ROS URDF"}</Badge>
          {!isFullScreen && <Title title={modelName}>{modelName}</Title>}
          <Badge $variant="success">
            <span style={{ verticalAlign: "middle", marginRight: 4, display: "inline-flex" }}>
              <CheckCircleIcon size={12} />
            </span>
            {movableJoints} DOF
          </Badge>
          {isFullScreen && totalMassKg > 0 && <Badge $variant="info">{totalMassKg.toFixed(1)} kg</Badge>}
          {errorCount > 0 ? (
            <Badge $variant="error">
              {errorCount} Error{errorCount > 1 ? "s" : ""}
            </Badge>
          ) : warningCount > 0 ? (
            <Badge $variant="warning">
              {warningCount} Warning{warningCount > 1 ? "s" : ""}
            </Badge>
          ) : (
            isFullScreen && <Badge $variant="success">Clean</Badge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          {hasTrajectory && activeView === "twin" && (
            <CameraPillGroup style={{ background: "var(--color-canvas-default)", boxShadow: "none" }}>
              <MiniPillButton
                $active={twinControlMode === "program"}
                onClick={() => setTwinControlMode("program")}
                title="Automated multi-machine recipe playback"
              >
                Program
              </MiniPillButton>
              <MiniPillButton
                $active={twinControlMode === "manual"}
                onClick={() => {
                  if (twinControlMode === "program" && effectiveTrajectory) {
                    const currentQ = interpolateJointTrajectory(effectiveTrajectory, playbackTime);
                    const nextAngles: Record<string, number> = {};
                    for (const [k, v] of currentQ) nextAngles[k] = v;
                    setJointAngles(nextAngles);
                  }
                  setIsPlaying(false);
                  setTwinControlMode("manual");
                }}
                title="Interactive manual joint jogging & inverse dynamics"
              >
                Manual
              </MiniPillButton>
            </CameraPillGroup>
          )}

          <SegmentedControl size="small" aria-label="URDF Views">
            {hasTrajectory && (
              <SegmentedControl.Button selected={tabIndex === 0} onClick={() => setTabIndex(0)}>
                Digital Twin
              </SegmentedControl.Button>
            )}
            <SegmentedControl.Button
              selected={hasTrajectory ? tabIndex === 1 : tabIndex === 0}
              onClick={() => setTabIndex(hasTrajectory ? 1 : 0)}
            >
              {isFullScreen ? "Kinematic Tree" : "Tree"}
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={hasTrajectory ? tabIndex === 2 : tabIndex === 1}
              onClick={() => setTabIndex(hasTrajectory ? 2 : 1)}
            >
              3D Pose
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={hasTrajectory ? tabIndex === 3 : tabIndex === 2}
              onClick={() => setTabIndex(hasTrajectory ? 3 : 2)}
            >
              {isFullScreen ? "Dynamics & Linter" : "Dynamics"}
            </SegmentedControl.Button>
            <SegmentedControl.Button
              selected={hasTrajectory ? tabIndex === 4 : tabIndex === 3}
              onClick={() => setTabIndex(hasTrajectory ? 4 : 3)}
            >
              {isFullScreen ? "Source & Projections" : "Source"}
            </SegmentedControl.Button>
          </SegmentedControl>
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={DraftingTriangleIcon}
              onClick={handleOpenPlayground}
              title="Open in Morsel"
            >
              Morsel
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea
        $padded={activeView === "dynamics" || activeView === "source" || (!svgMarkup && activeView === "tree")}
      >
        {isLoading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="large" />
          </Box>
        ) : activeView === "twin" ? (
          <TwinContainer>
            <StepsSidebar $isFullScreen={isFullScreen}>
              {/* LIVE STATE HUD Card (Joint velocity, Gripper mm / TCP speed, Clearance mm) */}
              <LiveStateSection>
                <SectionHeaderRow>
                  <span>LIVE STATE</span>
                  <Box display="flex" alignItems="center" gap={1}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontWeight: 600,
                        textTransform: "none",
                      }}
                    >
                      {twinControlMode === "program" ? `${cyclePercent}%` : "Manual"}
                    </span>
                    <button
                      onClick={() => {
                        setTwinControlMode("program");
                        setIsPlaying((p) => !p);
                      }}
                      title={isPlaying ? "Pause Digital Twin animation" : "Play Digital Twin animation"}
                      style={{
                        border: "1px solid rgba(56, 139, 253, 0.35)",
                        background: isPlaying ? "rgba(46, 160, 67, 0.18)" : "var(--color-accent-emphasis, #1f6feb)",
                        color: isPlaying ? "var(--color-success-fg, #3fb950)" : "#ffffff",
                        fontSize: "9px",
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: "999px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      {isPlaying ? "⏸ Playing" : "▶ Play"}
                    </button>
                  </Box>
                </SectionHeaderRow>
                <MetricTilesGrid>
                  <MetricTile>
                    <MetricTileLabel>{availableMachines.includes("UR") ? "UR" : "Peak ω"}</MetricTileLabel>
                    <MetricTileValue>
                      {liveTelemetry.maxJointSpeedDegPerSec.toFixed(1)}
                      <span style={{ fontSize: "9px", fontWeight: 400, marginLeft: 1 }}>°/s</span>
                    </MetricTileValue>
                    <MetricTileSub>
                      {liveTelemetry.maxJointSpeedDegPerSec > 0.5 ? "Moving" : "Stationary"}
                    </MetricTileSub>
                  </MetricTile>

                  <MetricTile>
                    <MetricTileLabel>{liveTelemetry.hasGripper !== false ? "Gripper" : "TCP Vel"}</MetricTileLabel>
                    <MetricTileValue>
                      {liveTelemetry.hasGripper !== false
                        ? liveTelemetry.gripperOpeningMm
                        : (liveTelemetry.tcpSpeedMmPerSec ?? 0)}
                      <span style={{ fontSize: "9px", fontWeight: 400, marginLeft: 1 }}>
                        {liveTelemetry.hasGripper !== false ? "mm" : "mm/s"}
                      </span>
                    </MetricTileValue>
                    <MetricTileSub>
                      {liveTelemetry.hasGripper !== false ? liveTelemetry.gripperStateLabel : "End-effector"}
                    </MetricTileSub>
                  </MetricTile>

                  <MetricTile>
                    <MetricTileLabel>Clearance</MetricTileLabel>
                    <MetricTileValue
                      $tone={
                        liveTelemetry.clearance.minDistanceMm < 25
                          ? "danger"
                          : liveTelemetry.clearance.minDistanceMm < 45
                            ? "warn"
                            : "pass"
                      }
                    >
                      {liveTelemetry.clearance.minDistanceMm}
                      <span style={{ fontSize: "9px", fontWeight: 400, marginLeft: 1 }}>mm</span>
                    </MetricTileValue>
                    <MetricTileSub title={liveTelemetry.clearance.nearestObstacleName}>
                      {liveTelemetry.clearance.nearestObstacleName}
                    </MetricTileSub>
                  </MetricTile>
                </MetricTilesGrid>
              </LiveStateSection>

              {/* PROGRAM STEPS or MANUAL JOINT JOGGERS */}
              {twinControlMode === "program" ? (
                <>
                  <StepsHeader>
                    <span>Program Steps ({effectiveProgramSteps.length})</span>
                    {availableMachines.length > 1 && (
                      <Box display="flex" gap={1}>
                        {["ALL", ...availableMachines].map((m) => (
                          <button
                            key={m}
                            onClick={() => setMachineFilter(m)}
                            style={{
                              border: "none",
                              background: machineFilter === m ? "rgba(56, 139, 253, 0.2)" : "transparent",
                              color: machineFilter === m ? "var(--color-accent-fg, #58a6ff)" : "var(--color-fg-muted)",
                              fontSize: "9px",
                              fontWeight: 700,
                              padding: "1px 4px",
                              borderRadius: "3px",
                              cursor: "pointer",
                            }}
                          >
                            {m}
                          </button>
                        ))}
                      </Box>
                    )}
                  </StepsHeader>
                  <StepsListScroll>
                    {filteredProgramSteps.map((step) => {
                      const isActive = activeStep?.id === step.id;
                      const durationSec = Math.max(0, step.endTime - step.startTime);
                      return (
                        <StepItem
                          key={step.id}
                          $isActive={isActive}
                          onClick={() => {
                            const targetT = step.startTime + 0.05;
                            playbackTimeRef.current = targetT;
                            setPlaybackTime(targetT);
                          }}
                        >
                          <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                            <Box display="flex" alignItems="center" gap={1}>
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: "10px",
                                  fontFamily: "var(--font-mono, monospace)",
                                  color: "var(--color-fg-muted)",
                                }}
                              >
                                {step.id}
                              </span>
                              {step.machine && (
                                <Badge
                                  $variant={machineBadgeVariant(step.machine)}
                                  style={{ fontSize: "9px", padding: "1px 5px" }}
                                >
                                  {step.machine}
                                </Badge>
                              )}
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: "50%",
                                  background: stepSegmentColor(step),
                                  display: "inline-block",
                                }}
                              />
                            </Box>
                            <span
                              style={{
                                fontSize: "10px",
                                color: "var(--color-fg-muted)",
                                fontFamily: "var(--font-mono, monospace)",
                              }}
                            >
                              {durationSec.toFixed(1)} s
                            </span>
                          </Box>
                          <div
                            style={{
                              fontSize: "11px",
                              fontWeight: isActive ? 600 : 400,
                              color: "var(--color-fg-default)",
                            }}
                          >
                            {step.label}
                          </div>
                          {isActive && step.description && (
                            <div
                              style={{
                                fontSize: "10px",
                                color: "var(--color-fg-muted)",
                                marginTop: 2,
                              }}
                            >
                              {step.description}
                            </div>
                          )}
                        </StepItem>
                      );
                    })}
                  </StepsListScroll>
                </>
              ) : (
                <>
                  <StepsHeader>
                    <span>Manual Joint Actuators</span>
                    <button
                      onClick={() => setJointAngles({})}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "var(--color-accent-fg, #58a6ff)",
                        fontSize: "10px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Zero All
                    </button>
                  </StepsHeader>
                  <StepsListScroll style={{ padding: "8px 10px", gap: "8px" }}>
                    {robot &&
                      Array.from(robot.joints.values())
                        .filter((j) => j.type !== "fixed" && !j.mimic)
                        .map((joint) => {
                          const minVal = joint.limits?.lower ?? (joint.type === "prismatic" ? -0.25 : -Math.PI);
                          const maxVal = joint.limits?.upper ?? (joint.type === "prismatic" ? 0.25 : Math.PI);
                          const curr = activeJointMap.get(joint.name) ?? 0;
                          const tau = rneaTorques.get(joint.name) ?? 0;
                          const isPrismatic = joint.type === "prismatic";
                          return (
                            <div
                              key={joint.name}
                              style={{
                                background: "var(--color-canvas-default)",
                                border: "1px solid var(--color-border-muted)",
                                borderRadius: 6,
                                padding: "6px 8px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              <Box display="flex" justifyContent="space-between" alignItems="center">
                                <span
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    fontFamily: "var(--font-mono, monospace)",
                                  }}
                                >
                                  {joint.name}
                                </span>
                                <span
                                  style={{
                                    fontSize: "10px",
                                    fontFamily: "var(--font-mono, monospace)",
                                    color: "var(--color-accent-fg, #58a6ff)",
                                  }}
                                >
                                  {isPrismatic
                                    ? `${(curr * 1000).toFixed(0)} mm`
                                    : `${((curr * 180) / Math.PI).toFixed(1)}°`}
                                </span>
                              </Box>
                              <input
                                type="range"
                                min={minVal}
                                max={maxVal}
                                step={(maxVal - minVal) / 200}
                                value={curr}
                                onChange={(e) => {
                                  const val = Number.parseFloat(e.target.value);
                                  setJointAngles((prev) => ({ ...prev, [joint.name]: val }));
                                }}
                                style={{ width: "100%", cursor: "pointer" }}
                              />
                              <Box display="flex" justifyContent="space-between" alignItems="center">
                                <span style={{ fontSize: "9px", color: "var(--color-fg-muted)" }}>{joint.type}</span>
                                <span
                                  style={{
                                    fontSize: "9px",
                                    fontFamily: "var(--font-mono, monospace)",
                                    color: "var(--color-fg-muted)",
                                  }}
                                >
                                  τ = {tau.toFixed(2)} N·m
                                </span>
                              </Box>
                            </div>
                          );
                        })}
                  </StepsListScroll>
                </>
              )}
            </StepsSidebar>

            <TwinViewportWrapper>
              {/* Compact Single-Line Top-Left Status Pill */}
              <TelemetryOverlay>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: isPlaying ? "#22c55e" : "#38bdf8",
                    boxShadow: isPlaying ? "0 0 6px #22c55e" : "none",
                    flexShrink: 0,
                  }}
                />
                {twinControlMode === "program" && activeStep ? (
                  <>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      #{activeStep.id}
                    </span>
                    {activeStep.machine && (
                      <Badge
                        $variant={machineBadgeVariant(activeStep.machine)}
                        style={{ fontSize: "9px", padding: "0px 5px" }}
                      >
                        {activeStep.machine}
                      </Badge>
                    )}
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--color-fg-default)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {activeStep.label}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                    Manual Jog · {movableJoints} Axes
                  </span>
                )}
                {isFullScreen && tcpPosition && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "10px",
                      color: "var(--color-accent-fg, #58a6ff)",
                      marginLeft: 4,
                    }}
                  >
                    TCP: [{tcpPosition[0].toFixed(2)}, {tcpPosition[1].toFixed(2)}, {tcpPosition[2].toFixed(2)}]m
                  </span>
                )}
              </TelemetryOverlay>

              {/* Bottom-Right Floating Camera & Layer Pill Bar (never overlaps top-right Sleep 3D button) */}
              <ViewportControlsOverlay>
                <CameraPillGroup>
                  {(
                    (isFullScreen
                      ? ["iso", "front", "side", "top", "focus", "fit"]
                      : ["iso", "front", "top", "fit"]) as ViewportCameraPreset[]
                  ).map((preset) => (
                    <MiniPillButton
                      key={preset}
                      $active={cameraPreset === preset}
                      onClick={() => triggerCameraPreset(preset)}
                    >
                      {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </MiniPillButton>
                  ))}
                </CameraPillGroup>
                <CameraPillGroup>
                  <MiniPillButton
                    $active={showPaths}
                    onClick={() => setShowPaths((v) => !v)}
                    title="Toggle 3D Cartesian toolpath ribbons"
                  >
                    Paths
                  </MiniPillButton>
                  <MiniPillButton
                    $active={showColliders}
                    onClick={() => setShowColliders((v) => !v)}
                    title="Toggle collision primitives & minimum clearance vector"
                  >
                    Colliders
                  </MiniPillButton>
                  {isFullScreen && (
                    <>
                      <MiniPillButton
                        $active={showFrames}
                        onClick={() => setShowFrames((v) => !v)}
                        title="Toggle link coordinate frames"
                      >
                        Frames
                      </MiniPillButton>
                      <MiniPillButton
                        $active={showGrid}
                        onClick={() => setShowGrid((v) => !v)}
                        title="Toggle reference floor grid"
                      >
                        Grid
                      </MiniPillButton>
                    </>
                  )}
                </CameraPillGroup>
              </ViewportControlsOverlay>

              <Box flex={1} minHeight={0} position="relative" height="100%">
                <MultibodyViewport3D
                  nodes={nodes3D}
                  links={links3D}
                  urdfVisuals={urdfVisuals}
                  urdfCollisions={urdfCollisions}
                  environment={viewConfig.environment || []}
                  toolpath={toolpathTrace}
                  toolpaths={allToolpaths}
                  clearance={liveTelemetry.clearance}
                  verificationOverlay={viewConfig.verificationOverlay}
                  tcpPosition={tcpPosition}
                  gripperOpeningMm={liveTelemetry.hasGripper !== false ? liveTelemetry.gripperOpeningMm : undefined}
                  isFullScreen={isFullScreen}
                  showPaths={showPaths}
                  showColliders={showColliders}
                  showFrames={showFrames}
                  showGrid={showGrid}
                  cameraPreset={cameraPreset}
                  cameraPresetTrigger={cameraPresetTrigger}
                  height="100%"
                />
              </Box>

              <TimelineScrubber>
                <Button
                  size="small"
                  leadingVisual={isPlaying ? PauseIcon : PlayIcon}
                  onClick={() => {
                    setTwinControlMode("program");
                    setIsPlaying(!isPlaying);
                  }}
                  variant={isPlaying ? "default" : "primary"}
                >
                  {isPlaying ? "Pause" : "Play"}
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setIsPlaying(false);
                    playbackTimeRef.current = tMin;
                    setPlaybackTime(tMin);
                  }}
                  title="Reset timeline to start (0.0s)"
                >
                  0
                </Button>

                {/* Color-coded multi-segment timeline track */}
                <SegmentedTimelineTrack>
                  <SegmentedBarContainer>
                    {effectiveProgramSteps.length > 0 ? (
                      effectiveProgramSteps.map((step) => {
                        const span = Math.max(0.1, step.endTime - step.startTime);
                        const widthPct = (span / Math.max(1, tMax - tMin)) * 100;
                        return (
                          <div
                            key={step.id}
                            style={{
                              width: `${widthPct}%`,
                              height: "100%",
                              background: stepSegmentColor(step),
                              opacity: activeStep?.id === step.id ? 1 : 0.68,
                              borderRight: "1px solid rgba(13, 17, 23, 0.5)",
                            }}
                          />
                        );
                      })
                    ) : (
                      <div
                        style={{
                          width: `${cyclePercent}%`,
                          height: "100%",
                          background: "var(--color-accent-fg, #58a6ff)",
                        }}
                      />
                    )}
                  </SegmentedBarContainer>
                  <PlayheadMarker $percent={cyclePercent} />
                  <HiddenRangeInput
                    type="range"
                    min={tMin}
                    max={tMax}
                    step={(tMax - tMin) / 1000}
                    value={playbackTime}
                    onChange={(e) => {
                      const nextT = parseFloat(e.target.value);
                      playbackTimeRef.current = nextT;
                      setTwinControlMode("program");
                      setPlaybackTime(nextT);
                    }}
                  />
                </SegmentedTimelineTrack>

                <Text
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "10px",
                    whiteSpace: "nowrap",
                    minWidth: "78px",
                    textAlign: "right",
                  }}
                >
                  {playbackTime.toFixed(1)}/{tMax.toFixed(0)}s
                </Text>

                <CameraPillGroup style={{ background: "var(--color-canvas-subtle)", boxShadow: "none" }}>
                  {(isFullScreen ? [0.5, 1, 2, 5, 10] : [1, 5, 10]).map((spd) => (
                    <MiniPillButton key={spd} $active={playbackSpeed === spd} onClick={() => setPlaybackSpeed(spd)}>
                      {spd}x
                    </MiniPillButton>
                  ))}
                </CameraPillGroup>

                <Button
                  size="small"
                  leadingVisual={SyncIcon}
                  onClick={() => setIsLooping(!isLooping)}
                  variant={isLooping ? "primary" : "invisible"}
                  title={isLooping ? "Loop enabled" : "Loop disabled"}
                >
                  {isFullScreen ? "Loop" : ""}
                </Button>
              </TimelineScrubber>
            </TwinViewportWrapper>
          </TwinContainer>
        ) : activeView === "tree" ? (
          svgMarkup ? (
            <InteractiveSvgStage svgMarkup={svgMarkup} isFullScreen={isFullScreen} />
          ) : (
            <Box
              p={4}
              bg="var(--color-canvas-default)"
              border="1px solid var(--color-border-default)"
              borderRadius="6px"
              textAlign="center"
            >
              <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                No URDF kinematic diagram elements found. Switch to Source & Projections to inspect the model.
              </Text>
            </Box>
          )
        ) : activeView === "pose" ? (
          <Box display="flex" flexDirection="column" height="100%">
            {robot && movableJoints > 0 && (
              <ControlsBar>
                <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Joint Angles:</Text>
                {Array.from(robot.joints.values())
                  .filter((j) => j.type !== "fixed" && !j.mimic)
                  .map((joint) => {
                    const minVal = joint.limits?.lower ?? (joint.type === "prismatic" ? -0.25 : -Math.PI);
                    const maxVal = joint.limits?.upper ?? (joint.type === "prismatic" ? 0.25 : Math.PI);
                    const curr = jointAngles[joint.name] ?? activeJointMap.get(joint.name) ?? 0;
                    return (
                      <JointSliderWrapper key={joint.name}>
                        <Text style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>
                          {joint.name}
                        </Text>
                        <input
                          type="range"
                          min={minVal}
                          max={maxVal}
                          step={(maxVal - minVal) / 150}
                          value={curr}
                          onChange={(e) => {
                            const val = Number.parseFloat(e.target.value);
                            setJointAngles((prev) => ({
                              ...Object.fromEntries(activeJointMap),
                              ...prev,
                              [joint.name]: val,
                            }));
                          }}
                          style={{ width: "84px", cursor: "pointer" }}
                        />
                        <Text style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px", minWidth: "38px" }}>
                          {curr.toFixed(2)}
                        </Text>
                      </JointSliderWrapper>
                    );
                  })}
              </ControlsBar>
            )}
            <Box flex={1} minHeight={0} p={2} position="relative">
              <MultibodyViewport3D
                nodes={nodes3D}
                links={links3D}
                urdfVisuals={urdfVisuals}
                urdfCollisions={urdfCollisions}
                environment={viewConfig.environment || []}
                toolpath={toolpathTrace}
                toolpaths={allToolpaths}
                verificationOverlay={viewConfig.verificationOverlay}
                gripperOpeningMm={liveTelemetry.hasGripper !== false ? liveTelemetry.gripperOpeningMm : undefined}
                isFullScreen={isFullScreen}
                showPaths={showPaths}
                showColliders={showColliders}
                showFrames={showFrames}
                height="100%"
              />
            </Box>
          </Box>
        ) : activeView === "dynamics" ? (
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Linter Verification Section */}
            <Box>
              <Box mb={2} display="flex" alignItems="center" gap={2}>
                <Text style={{ fontSize: "13px", fontWeight: 600 }}>Pre-Flight Robotics Verification</Text>
                <Badge $variant={diagnostics.length === 0 ? "success" : errorCount > 0 ? "error" : "warning"}>
                  {diagnostics.length} Diagnostic{diagnostics.length === 1 ? "" : "s"}
                </Badge>
              </Box>

              {diagnostics.length === 0 ? (
                <Box
                  p={3}
                  bg="var(--color-canvas-default)"
                  border="1px solid var(--color-border-default)"
                  borderRadius="6px"
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <span style={{ color: "var(--color-success-fg, #3fb950)" }}>
                    <CheckCircleIcon size={16} />
                  </span>
                  <Text style={{ fontSize: "12px", color: "var(--color-fg-default)" }}>
                    All links have valid positive-definite inertia tensors satisfying triangle inequalities, with clean
                    open-tree kinematics and collision hulls.
                  </Text>
                </Box>
              ) : (
                <TableWrapper>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Severity</th>
                        <th>Location</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.map((d, i) => (
                        <tr key={i}>
                          <td>
                            <code style={{ fontSize: "11px" }}>{d.code}</code>
                          </td>
                          <td>
                            <Badge $variant={d.severity === "error" ? "error" : "warning"}>
                              {d.severity.toUpperCase()}
                            </Badge>
                          </td>
                          <td>
                            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>
                              L{d.range.startLine}:{d.range.startColumn}
                            </span>
                          </td>
                          <td>{d.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </StyledTable>
                </TableWrapper>
              )}
            </Box>

            {/* RNEA Inverse Dynamics Joint Torques */}
            {rneaTorques.size > 0 && (
              <Box>
                <Box mb={2} display="flex" alignItems="center" gap={2}>
                  <Text style={{ fontSize: "13px", fontWeight: 600 }}>
                    Featherstone RNEA Inverse Dynamics Actuation Torques
                  </Text>
                  <Badge $variant="info">{rneaTorques.size} Actuators</Badge>
                </Box>
                <TableWrapper>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>Joint Name</th>
                        <th>Type</th>
                        <th>Coordinate</th>
                        <th>Velocity</th>
                        <th>Actuation Effort τ / F</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(rneaTorques.entries()).map(([jName, tau]) => {
                        const joint = robot?.joints.get(jName);
                        const currQ = activeJointMap.get(jName) ?? 0;
                        const currQd = liveTelemetry.jointVelocitiesRadPerSec.get(jName) ?? 0;
                        const isPrismatic = joint?.type === "prismatic";
                        return (
                          <tr key={jName}>
                            <td>
                              <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{jName}</strong>
                            </td>
                            <td>{joint?.type ?? "revolute"}</td>
                            <td>
                              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                                {isPrismatic ? `${(currQ * 1000).toFixed(1)} mm` : `${currQ.toFixed(3)} rad`}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                                {isPrismatic ? `${(currQd * 1000).toFixed(1)} mm/s` : `${currQd.toFixed(3)} rad/s`}
                              </span>
                            </td>
                            <td>
                              <span
                                style={{
                                  fontFamily: "var(--font-mono, monospace)",
                                  fontWeight: 600,
                                  color: Math.abs(tau) > 0.01 ? "var(--color-accent-fg, #58a6ff)" : "inherit",
                                }}
                              >
                                {tau.toFixed(4)} {isPrismatic ? "N" : "N·m"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </StyledTable>
                </TableWrapper>
              </Box>
            )}
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap={2} height="100%">
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
              <Box display="flex" alignItems="center" gap={2}>
                <SegmentedControl size="small" aria-label="Projection Format">
                  <SegmentedControl.Button
                    selected={projectionMode === "urdf"}
                    onClick={() => setProjectionMode("urdf")}
                  >
                    URDF XML
                  </SegmentedControl.Button>
                  <SegmentedControl.Button selected={projectionMode === "usd"} onClick={() => setProjectionMode("usd")}>
                    OpenUSD (.usda)
                  </SegmentedControl.Button>
                  <SegmentedControl.Button
                    selected={projectionMode === "modelica"}
                    onClick={() => setProjectionMode("modelica")}
                  >
                    Modelica MultiBody
                  </SegmentedControl.Button>
                  <SegmentedControl.Button
                    selected={projectionMode === "simpack"}
                    onClick={() => setProjectionMode("simpack")}
                  >
                    SIMPACK JSON
                  </SegmentedControl.Button>
                </SegmentedControl>
              </Box>
              <Button
                size="small"
                leadingVisual={copied ? CheckCircleIcon : CopyIcon}
                onClick={handleCopyCode}
                title="Copy code"
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </Box>

            <Box
              py={2}
              bg="var(--color-canvas-default, #0d1117)"
              border="1px solid var(--color-border-default, #30363d)"
              borderRadius="6px"
              overflow="auto"
              flex={1}
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
            >
              {codeLines.length > 0 ? (
                codeLines.map((line, idx) => (
                  <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                    <span
                      style={{
                        userSelect: "none",
                        width: "36px",
                        minWidth: "36px",
                        textAlign: "right",
                        paddingRight: "12px",
                        color: "var(--color-fg-subtle)",
                        fontSize: "11px",
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                      {highlightPolyglotLine(line, projectionMode === "modelica" ? "modelica" : "urdf")}
                    </span>
                  </div>
                ))
              ) : (
                <Box p={3} color="var(--color-fg-muted)">
                  $ No content loaded.
                </Box>
              )}
            </Box>
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default UrdfViewer;
