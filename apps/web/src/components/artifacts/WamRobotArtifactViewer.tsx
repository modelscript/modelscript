// SPDX-License-Identifier: AGPL-3.0-or-later

import { didChange, didOpen, simulate as simulateViaLsp } from "@modelscript/editor/workbench/util/lsp-bridge";
import {
  ModelicaSurrogateEmitter,
  trainWamResidual,
  type TrainedWamResidual,
  type WamTrainingDataset,
} from "@modelscript/simulate/wam";
import {
  computeForwardKinematics,
  computeRobotVisualAndCollisionPoses,
  interpolateJointTrajectory,
  parseUrdf,
  sanitizeUrdfModelicaIdent,
  simulationSeriesToUrdfTrajectory,
  urdfToHybridWamModelica,
  type UrdfTrajectoryData,
} from "@modelscript/urdf";
import { CopyIcon, PauseIcon, PlayIcon, SyncIcon, UploadIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import Box from "../Box";
import MultibodyViewport3D, { type MultibodyLink3D, type MultibodyNode3D } from "./MultibodyViewport3D";
import type { WamWorkerResponse } from "./wam/wamLab.worker";
import {
  DEFAULT_2DOF_ARM_URDF,
  generateDemoWamDataset,
  parseTelemetryLogToWamDataset,
  parseWamCsvDataset,
  simulateClosedLoopRobot,
  type RobotSimOutput,
} from "./wam/wamLabEngine";

export interface WamRobotArtifactViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    title?: string | undefined;
    urdfCode?: string | undefined;
    modelicaCode?: string | undefined;
    dataset?: WamTrainingDataset | undefined;
    preTrainedWam?: TrainedWamResidual | undefined;
    [key: string]: unknown;
  };
  artifactId?: string | number | undefined;
  isFullScreen?: boolean | undefined;
}

const Container = styled.div<{ $isFullScreen?: boolean | undefined }>`
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "540px")};
  background: var(--color-canvas-default, #0d1117);
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Toolbar = styled.div`
  min-height: 44px;
  padding: 6px 12px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.78));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const FooterBar = styled.div`
  min-height: 40px;
  padding: 6px 12px;
  border-top: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-subtle, #161b22);
  display: flex;
  align-items: center;
  gap: 10px;
`;

const CodeEditor = styled.textarea`
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 12px;
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-fg-default, #e6edf3);
`;

const Badge = styled.span<{ $tone?: "cyan" | "green" | "amber" }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid
    ${(p) =>
      p.$tone === "green"
        ? "rgba(63, 185, 80, 0.45)"
        : p.$tone === "amber"
          ? "rgba(210, 153, 34, 0.45)"
          : "rgba(56, 189, 248, 0.45)"};
  color: ${(p) => (p.$tone === "green" ? "var(--ms-success, #3fb950)" : p.$tone === "amber" ? "#d29922" : "#38bdf8")};
  background: ${(p) =>
    p.$tone === "green"
      ? "rgba(63, 185, 80, 0.12)"
      : p.$tone === "amber"
        ? "rgba(210, 153, 34, 0.12)"
        : "rgba(56, 189, 248, 0.12)"};
`;

const HudOverlay = styled.div`
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 240px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.84);
  border: 1px solid var(--color-border-default, #30363d);
  backdrop-filter: blur(8px);
  pointer-events: none;
`;

function buildSeriesPath(times: number[], values: number[], w: number, h: number, yMin: number, yMax: number): string {
  if (times.length < 2 || values.length < 2) return "";
  const t0 = times[0] ?? 0;
  const tSpan = Math.max((times[times.length - 1] ?? 1) - t0, 1e-6);
  const ySpan = Math.max(yMax - yMin, 1e-6);
  return times
    .map((t, i) => {
      const x = ((t - t0) / tSpan) * w;
      const y = h - (((values[i] ?? 0) - yMin) / ySpan) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function isWamCompatibleWithJoints(
  wam: TrainedWamResidual | undefined,
  jointNames: string[],
): wam is TrainedWamResidual {
  return Boolean(wam && wam.jointNames.length === jointNames.length && wam.outputDim === jointNames.length);
}

const WamRobotArtifactViewer: React.FC<WamRobotArtifactViewerProps> = ({
  viewConfig,
  artifactId,
  isFullScreen = false,
}) => {
  const [tab, setTab] = useState<number>(0); // 0: 3D Robot, 1: Train WAM, 2: Modelica

  const urdfSource =
    typeof viewConfig.urdfCode === "string" && viewConfig.urdfCode.trim() ? viewConfig.urdfCode : DEFAULT_2DOF_ARM_URDF;

  const robot = useMemo(() => {
    try {
      return parseUrdf(urdfSource);
    } catch {
      return parseUrdf(DEFAULT_2DOF_ARM_URDF);
    }
  }, [urdfSource]);

  const jointNames = useMemo(
    () =>
      Array.from(robot.joints.values())
        .filter((j) => j.type === "revolute" || j.type === "continuous" || j.type === "prismatic")
        .map((j) => j.name),
    [robot],
  );

  const validPreTrainedWam = isWamCompatibleWithJoints(viewConfig.preTrainedWam, jointNames)
    ? viewConfig.preTrainedWam
    : null;

  const [mode, setMode] = useState<"baseline" | "hybrid" | "modelica_wasm">(validPreTrainedWam ? "hybrid" : "baseline");
  const [dataset, setDataset] = useState<WamTrainingDataset>(() => viewConfig.dataset ?? generateDemoWamDataset(robot));
  const [trainedWam, setTrainedWam] = useState<TrainedWamResidual | null>(() => validPreTrainedWam);
  const [wamBlockCode, setWamBlockCode] = useState<string>(() =>
    validPreTrainedWam
      ? ModelicaSurrogateEmitter.emitWamResidualModelica(validPreTrainedWam, {
          modelName: "WamResidualBlock",
          omitWithin: true,
        })
      : "",
  );

  const [baselineSim, setBaselineSim] = useState<RobotSimOutput>(() => simulateClosedLoopRobot(robot, null));
  const [hybridSim, setHybridSim] = useState<RobotSimOutput | null>(() =>
    validPreTrainedWam ? simulateClosedLoopRobot(robot, validPreTrainedWam) : null,
  );
  const [modelicaWasmTraj, setModelicaWasmTraj] = useState<UrdfTrajectoryData | null>(null);
  const [modelicaSimStatus, setModelicaSimStatus] = useState<string | null>(null);
  const [isSimulatingModelica, setIsSimulatingModelica] = useState(false);

  const generatedModelicaSource = useMemo(
    () =>
      urdfToHybridWamModelica(robot, {
        wamBlockName: "WamResidualBlock",
        wamBlockCode: wamBlockCode || undefined,
        standaloneEquationModel: true,
      }),
    [robot, wamBlockCode],
  );

  const [editedModelica, setEditedModelica] = useState<string>(() =>
    typeof viewConfig.modelicaCode === "string" && viewConfig.modelicaCode.trim()
      ? viewConfig.modelicaCode
      : generatedModelicaSource,
  );
  const hasManualModelicaEditRef = useRef(false);

  // Sync state when viewConfig props change (new post/robot loaded)
  const prevUrdfRef = useRef(urdfSource);
  useEffect(() => {
    if (prevUrdfRef.current === urdfSource) return;
    prevUrdfRef.current = urdfSource;
    hasManualModelicaEditRef.current = false;
    setDataset(viewConfig.dataset ?? generateDemoWamDataset(robot));
    setBaselineSim(simulateClosedLoopRobot(robot, null));
    const nextWam = isWamCompatibleWithJoints(viewConfig.preTrainedWam, jointNames) ? viewConfig.preTrainedWam : null;
    setTrainedWam(nextWam);
    setHybridSim(nextWam ? simulateClosedLoopRobot(robot, nextWam) : null);
    setWamBlockCode(
      nextWam
        ? ModelicaSurrogateEmitter.emitWamResidualModelica(nextWam, {
            modelName: "WamResidualBlock",
            omitWithin: true,
          })
        : "",
    );
    setModelicaWasmTraj(null);
    setMode(nextWam ? "hybrid" : "baseline");
  }, [urdfSource, robot, jointNames, viewConfig.dataset, viewConfig.preTrainedWam]);

  useEffect(() => {
    if (!hasManualModelicaEditRef.current) {
      setEditedModelica(
        typeof viewConfig.modelicaCode === "string" && viewConfig.modelicaCode.trim() && !wamBlockCode
          ? viewConfig.modelicaCode
          : generatedModelicaSource,
      );
    }
  }, [generatedModelicaSource, wamBlockCode, viewConfig.modelicaCode]);

  const [isTraining, setIsTraining] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [lossPoints, setLossPoints] = useState<{ epoch: number; mseLoss: number }[]>([]);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [showGhostBaseline, setShowGhostBaseline] = useState(true);

  const workerRef = useRef<Worker | null>(null);
  const openedUriRef = useRef<string | null>(null);
  const lossBufferRef = useRef<{ epoch: number; mseLoss: number }[]>([]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const activeTrajectory: UrdfTrajectoryData =
    mode === "modelica_wasm" && modelicaWasmTraj
      ? modelicaWasmTraj
      : mode === "hybrid" && hybridSim
        ? hybridSim.trajectory
        : baselineSim.trajectory;

  const times = activeTrajectory.times;
  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? 6;

  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackTime, setPlaybackTime] = useState(tMin);
  const playbackTimeRef = useRef(tMin);
  const lastCommitRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let next = playbackTimeRef.current + dt;
      if (next > tMax) next = tMin;
      playbackTimeRef.current = next;

      // Throttle React commits to ~30 fps to prevent 3D scene re-render churn
      if (now - lastCommitRef.current >= 32) {
        lastCommitRef.current = now;
        setPlaybackTime(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, tMin, tMax]);

  const activeJointMap = useMemo(
    () => interpolateJointTrajectory(activeTrajectory, playbackTime),
    [activeTrajectory, playbackTime],
  );

  const buildRobotPoseGeometry = useCallback(
    (jointMap: Map<string, number>, linkColor: string) => {
      const poses = computeForwardKinematics(robot, jointMap);
      const visuals = computeRobotVisualAndCollisionPoses(robot, jointMap, poses).visuals;
      const nodes: MultibodyNode3D[] = [];
      const links: MultibodyLink3D[] = [];
      const colors = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff"];
      let cIdx = 0;

      for (const [name, link] of robot.links) {
        const pose = poses.get(name);
        const isBase = !pose?.parentName || name.includes("base") || name.includes("world");
        nodes.push({
          id: name,
          name,
          type: "body",
          position: pose ? pose.position : [0, 0, 0],
          rotationMatrix: pose?.rotation,
          color: isBase ? "#8b949e" : colors[cIdx++ % colors.length],
          dimensions: link.inertial?.mass ? [0.1, 0.1, 0.1] : [0.07, 0.07, 0.07],
        });
      }

      for (const [name, joint] of robot.joints) {
        const p1 = poses.get(joint.parentLink);
        const p2 = poses.get(joint.childLink);
        if (p1 && p2) {
          links.push({
            id: name,
            name,
            type: "joint",
            from: p1.position,
            to: p2.position,
            color: joint.type === "fixed" ? "#6e7681" : linkColor,
          });
        }
      }

      return { nodes, links, visuals };
    },
    [robot],
  );

  const {
    nodes: nodes3D,
    links: links3D,
    visuals: urdfVisuals3D,
  } = useMemo(
    () =>
      buildRobotPoseGeometry(
        activeJointMap,
        mode === "hybrid" && hybridSim
          ? "#3fb950"
          : mode === "modelica_wasm" && modelicaWasmTraj
            ? "#d29922"
            : "#58a6ff",
      ),
    [buildRobotPoseGeometry, activeJointMap, mode, hybridSim, modelicaWasmTraj],
  );

  const {
    nodes: ghostNodes3D,
    links: ghostLinks3D,
    visuals: ghostUrdfVisuals3D,
  } = useMemo(() => {
    if (!showGhostBaseline || mode === "baseline") {
      return { nodes: undefined, links: undefined, visuals: undefined };
    }
    const ghostJointMap = interpolateJointTrajectory(baselineSim.trajectory, playbackTime);
    const geom = buildRobotPoseGeometry(ghostJointMap, "#38bdf8");
    return {
      nodes: geom.nodes.map((n) => ({ ...n, color: "#38bdf8" })),
      links: geom.links,
      visuals: geom.visuals.map((v) => ({ ...v, color: "#38bdf8", opacity: 0.28 })),
    };
  }, [showGhostBaseline, mode, buildRobotPoseGeometry, baselineSim.trajectory, playbackTime]);

  const handleTrainWam = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    setIsTraining(true);
    setTrainError(null);
    lossBufferRef.current = [];
    setLossPoints([]);

    const finishSuccess = (
      trained: TrainedWamResidual,
      blockCode: string,
      baseSim: RobotSimOutput,
      hybSim: RobotSimOutput,
    ) => {
      hasManualModelicaEditRef.current = false;
      setTrainedWam(trained);
      setWamBlockCode(blockCode);
      setBaselineSim(baseSim);
      setHybridSim(hybSim);
      setMode("hybrid");
      setIsTraining(false);
    };

    try {
      const worker = new Worker(new URL("./wam/wamLab.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<WamWorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === "PROGRESS") {
          lossBufferRef.current.push({ epoch: msg.epoch, mseLoss: msg.mseLoss });
          setLossPoints([...lossBufferRef.current]);
        } else if (msg.type === "DONE") {
          finishSuccess(msg.trainedWam, msg.wamBlockCode, msg.baselineSim, msg.hybridSim);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        } else if (msg.type === "ERROR") {
          setTrainError(msg.message);
          setIsTraining(false);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        }
      };
      worker.onerror = () => {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        runMainThreadFallback();
      };
      worker.postMessage({
        type: "TRAIN_AND_SIMULATE",
        urdfCode: urdfSource,
        dataset,
        epochs: 220,
        hiddenLayers: [20, 20],
      });
    } catch {
      runMainThreadFallback();
    }

    function runMainThreadFallback() {
      try {
        const pts: { epoch: number; mseLoss: number }[] = [];
        const trained = trainWamResidual(dataset, {
          epochs: 220,
          hiddenLayers: [20, 20],
          learningRate: 0.02,
          progressInterval: 10,
          onProgress: (p) => pts.push({ epoch: p.epoch, mseLoss: p.mseLoss }),
        });
        setLossPoints(pts);
        const blockCode = ModelicaSurrogateEmitter.emitWamResidualModelica(trained, {
          modelName: "WamResidualBlock",
          omitWithin: true,
        });
        finishSuccess(
          trained,
          blockCode,
          simulateClosedLoopRobot(robot, null),
          simulateClosedLoopRobot(robot, trained),
        );
      } catch (err) {
        setTrainError(err instanceof Error ? err.message : String(err));
        setIsTraining(false);
      }
    }
  };

  const handleSimulateModelicaWasm = async () => {
    setIsSimulatingModelica(true);
    setModelicaSimStatus(null);
    const uri = `inmemory://wam-lab/${artifactId ?? "robot"}.mo`;
    const targetClassName = `${sanitizeUrdfModelicaIdent(robot.name)}_HybridWAM`;

    try {
      if (openedUriRef.current !== uri) {
        await didOpen(uri, editedModelica, "modelica");
        openedUriRef.current = uri;
      } else {
        await didChange(uri, editedModelica);
      }

      const res = await simulateViaLsp(uri, {
        className: targetClassName,
        stopTime: 6.0,
        stepSize: 0.02,
      });

      if (!res.success || !res.t || !res.y || !res.variables) {
        setModelicaSimStatus(res.error ?? "Modelica WASM simulation returned no trajectory.");
        setIsSimulatingModelica(false);
        return;
      }

      const usedIdents = new Set<string>();
      const jointSeries: Record<string, number[]> = {};
      for (const jName of jointNames) {
        const jn = sanitizeUrdfModelicaIdent(jName, usedIdents);
        const idx = res.variables.findIndex(
          (v) =>
            v === `${jn}_phi` || v === `${jn}.phi` || v === `${jn}.s` || v === `q_${jn}` || v === jName || v === jn,
        );
        if (idx >= 0) {
          jointSeries[jName] = res.y.map((row) => row[idx] ?? 0);
        }
      }

      if (Object.keys(jointSeries).length === 0) {
        setModelicaSimStatus(
          `Simulated ${res.t.length} steps, but no matching joint variables (${jointNames.join(", ")}) were found.`,
        );
        setIsSimulatingModelica(false);
        return;
      }

      setModelicaWasmTraj(simulationSeriesToUrdfTrajectory(res.t, jointSeries));
      setMode("modelica_wasm");
      setTab(0);
      setModelicaSimStatus(`Simulated ${res.t.length} steps via Modelica WASM DAE solver (${targetClassName}).`);
    } catch (err) {
      setModelicaSimStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSimulatingModelica(false);
    }
  };

  const handleDatasetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isBinaryTelemetry =
      lower.endsWith(".mcap") || lower.endsWith(".mf4") || lower.endsWith(".mdf4") || lower.endsWith(".mdf");

    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (isBinaryTelemetry) {
          const buf = reader.result as ArrayBuffer;
          setDataset(parseTelemetryLogToWamDataset(buf, file.name, jointNames));
        } else {
          const raw = String(reader.result ?? "");
          if (lower.endsWith(".json")) {
            const parsed = JSON.parse(raw) as WamTrainingDataset;
            if (!Array.isArray(parsed.times) || !Array.isArray(parsed.jointNames)) {
              throw new Error("JSON dataset must have times, jointNames, q, dq, u, tauResidual.");
            }
            setDataset(parsed);
          } else {
            setDataset(parseWamCsvDataset(raw, jointNames));
          }
        }
        setTrainError(null);
      } catch (err) {
        setTrainError(err instanceof Error ? err.message : String(err));
      }
    };
    if (isBinaryTelemetry) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const handleCopyViewConfig = () => {
    const payload = {
      view_type: "wam_robot_lab",
      view_config: {
        title: viewConfig.title ?? "Modelica + WAM Robot Lab",
        urdfCode: urdfSource,
        modelicaCode: editedModelica,
        ...(trainedWam ? { preTrainedWam: trainedWam } : {}),
      },
    };
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 1800);
  };

  const lossSvgPath = useMemo(() => {
    if (lossPoints.length < 2) return "";
    const w = 360;
    const h = 90;
    const maxL = Math.max(...lossPoints.map((p) => p.mseLoss), 1e-6);
    const minL = Math.min(...lossPoints.map((p) => p.mseLoss));
    const span = Math.max(maxL - minL, 1e-6);
    return lossPoints
      .map((p, i) => {
        const x = (i / (lossPoints.length - 1)) * w;
        const y = h - ((p.mseLoss - minL) / span) * (h - 10) - 5;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [lossPoints]);

  const primaryJoint = jointNames[0];
  const trackingOverlayPaths = useMemo(() => {
    if (!primaryJoint) return null;
    const baseVals = (baselineSim.trajectory.jointPositions as Record<string, number[]>)[primaryJoint] ?? [];
    const refVals = baselineSim.reference[primaryJoint] ?? [];
    const hybVals = hybridSim
      ? ((hybridSim.trajectory.jointPositions as Record<string, number[]>)[primaryJoint] ?? [])
      : [];
    const all = [...baseVals, ...refVals, ...hybVals];
    const yMin = Math.min(...all, -1);
    const yMax = Math.max(...all, 1);
    return {
      ref: buildSeriesPath(baselineSim.trajectory.times, refVals, 220, 64, yMin, yMax),
      base: buildSeriesPath(baselineSim.trajectory.times, baseVals, 220, 64, yMin, yMax),
      hybrid: hybVals.length ? buildSeriesPath(hybridSim!.trajectory.times, hybVals, 220, 64, yMin, yMax) : "",
    };
  }, [primaryJoint, baselineSim, hybridSim]);

  return (
    <Container $isFullScreen={isFullScreen}>
      <Toolbar>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Text sx={{ fontSize: 1, fontWeight: "bold", color: "fg.default" }}>
            {viewConfig.title ?? "Modelica + WAM Robot Lab"}
          </Text>
          <Badge $tone={mode === "hybrid" && hybridSim ? "green" : mode === "modelica_wasm" ? "amber" : "cyan"}>
            {mode === "modelica_wasm" && modelicaWasmTraj
              ? "Modelica WASM DAE"
              : mode === "hybrid" && hybridSim
                ? `Physics + WAM (RMSE ${hybridSim.trackingRmse.toFixed(3)} rad)`
                : `Physics Only (RMSE ${baselineSim.trackingRmse.toFixed(3)} rad)`}
          </Badge>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <SegmentedControl size="small" aria-label="WAM Lab View" onChange={(idx) => setTab(idx)}>
            <SegmentedControl.Button selected={tab === 0}>3D Robot</SegmentedControl.Button>
            <SegmentedControl.Button selected={tab === 1}>Train WAM</SegmentedControl.Button>
            <SegmentedControl.Button selected={tab === 2}>Modelica</SegmentedControl.Button>
          </SegmentedControl>

          <Button
            size="small"
            variant="primary"
            leadingVisual={SyncIcon}
            disabled={isTraining}
            onClick={handleTrainWam}
          >
            {isTraining ? "Training..." : trainedWam ? "Retrain WAM" : "Train WAM"}
          </Button>
        </Box>
      </Toolbar>

      <Box sx={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        {tab === 0 && (
          <>
            <MultibodyViewport3D
              nodes={nodes3D}
              links={links3D}
              urdfVisuals={urdfVisuals3D}
              ghostNodes={ghostNodes3D}
              ghostLinks={ghostLinks3D}
              ghostUrdfVisuals={ghostUrdfVisuals3D}
              ghostOpacity={0.28}
              isPlaying={isPlaying}
            />
            {trackingOverlayPaths && primaryJoint && (
              <HudOverlay>
                <Text sx={{ fontSize: 0, fontWeight: "bold", display: "block", mb: 1, color: "fg.default" }}>
                  {primaryJoint} Tracking
                </Text>
                <svg width="220" height="64" viewBox="0 0 220 64">
                  <path
                    d={trackingOverlayPaths.ref}
                    fill="none"
                    stroke="var(--ms-text-3, #8b949e)"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                  />
                  <path d={trackingOverlayPaths.base} fill="none" stroke="#58a6ff" strokeWidth="1.5" />
                  {trackingOverlayPaths.hybrid && (
                    <path
                      d={trackingOverlayPaths.hybrid}
                      fill="none"
                      stroke="var(--ms-success, #3fb950)"
                      strokeWidth="1.8"
                    />
                  )}
                </svg>
              </HudOverlay>
            )}
          </>
        )}

        {tab === 1 && (
          <Box sx={{ p: 3, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
            <Box
              sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}
            >
              <Box>
                <Text sx={{ fontSize: 2, fontWeight: "bold", display: "block" }}>In-Browser WAM Residual Training</Text>
                <Text sx={{ fontSize: 1, color: "fg.muted" }}>
                  Dataset: {dataset.times.length} samples across {dataset.jointNames.length} joints (
                  {dataset.jointNames.join(", ")})
                </Text>
              </Box>
              <Box sx={{ display: "flex", gap: 2 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.mcap,.mf4,.mdf4,.mdf"
                  style={{ display: "none" }}
                  onChange={handleDatasetUpload}
                />
                <Button size="small" leadingVisual={UploadIcon} onClick={() => fileInputRef.current?.click()}>
                  Upload CSV / MCAP / MDF4
                </Button>
                <Button size="small" onClick={() => setDataset(generateDemoWamDataset(robot))}>
                  Reset Demo Data
                </Button>
              </Box>
            </Box>

            {trainError && <Text sx={{ color: "danger.fg", fontSize: 1 }}>{trainError}</Text>}

            <Box
              sx={{
                p: 3,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "border.default",
                bg: "canvas.subtle",
              }}
            >
              <Text sx={{ fontSize: 1, fontWeight: "bold", display: "block", mb: 2 }}>
                Training Loss (Normalized MSE)
              </Text>
              {lossPoints.length > 1 ? (
                <svg width="100%" height="100" viewBox="0 0 360 90" preserveAspectRatio="none">
                  <path d={lossSvgPath} fill="none" stroke="#38bdf8" strokeWidth="2.2" />
                </svg>
              ) : (
                <Text sx={{ fontSize: 1, color: "fg.muted" }}>
                  Click &quot;Train WAM&quot; to fit the residual MLP in a browser Web Worker and emit a Modelica block.
                </Text>
              )}
            </Box>

            {trainedWam && (
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                <Badge $tone="green">R² = {trainedWam.rSquared.toFixed(4)}</Badge>
                <Badge $tone="cyan">Final MSE = {trainedWam.finalMse.toExponential(3)}</Badge>
                <Badge $tone="amber">
                  Baseline RMSE: {baselineSim.trackingRmse.toFixed(3)} → Hybrid: {hybridSim?.trackingRmse.toFixed(3)}{" "}
                  rad
                </Badge>
              </Box>
            )}
          </Box>
        )}

        {tab === 2 && (
          <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Box
              sx={{
                px: 3,
                py: 2,
                borderBottom: "1px solid",
                borderColor: "border.default",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Text sx={{ fontSize: 1, color: "fg.muted" }}>
                {modelicaSimStatus ?? "Editable Modelica + WAM source"}
              </Text>
              <Box sx={{ display: "flex", gap: 2 }}>
                <Button size="small" leadingVisual={CopyIcon} onClick={handleCopyViewConfig}>
                  {copiedConfig ? "Copied!" : "Copy Artifact JSON"}
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  disabled={isSimulatingModelica}
                  onClick={handleSimulateModelicaWasm}
                >
                  {isSimulatingModelica ? "Simulating..." : "Simulate Modelica (WASM)"}
                </Button>
              </Box>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <CodeEditor
                value={editedModelica}
                onChange={(e) => {
                  hasManualModelicaEditRef.current = true;
                  setEditedModelica(e.target.value);
                }}
                spellCheck={false}
              />
            </Box>
          </Box>
        )}
      </Box>

      <FooterBar>
        <Button size="small" leadingVisual={isPlaying ? PauseIcon : PlayIcon} onClick={() => setIsPlaying((p) => !p)}>
          {isPlaying ? "Pause" : "Play"}
        </Button>

        <input
          type="range"
          min={tMin}
          max={tMax}
          step={0.02}
          value={playbackTime}
          onChange={(e) => {
            setIsPlaying(false);
            const t = Number(e.target.value);
            playbackTimeRef.current = t;
            setPlaybackTime(t);
          }}
          style={{ flex: 1 }}
        />

        <Text sx={{ fontSize: 0, color: "fg.muted", minWidth: 64, textAlign: "right" }}>
          {playbackTime.toFixed(2)}s / {tMax.toFixed(1)}s
        </Text>

        {(hybridSim || modelicaWasmTraj) && (
          <>
            {mode !== "baseline" && (
              <Button
                size="small"
                variant={showGhostBaseline ? "primary" : "default"}
                onClick={() => setShowGhostBaseline((g) => !g)}
              >
                {showGhostBaseline ? "Ghost: On" : "Ghost: Off"}
              </Button>
            )}
            <SegmentedControl
              size="small"
              aria-label="Controller Mode"
              onChange={(idx) => {
                if (idx === 0) setMode("baseline");
                else if (idx === 1 && hybridSim) setMode("hybrid");
                else if (modelicaWasmTraj) setMode("modelica_wasm");
              }}
            >
              <SegmentedControl.Button selected={mode === "baseline"}>Physics</SegmentedControl.Button>
              {hybridSim && (
                <SegmentedControl.Button selected={mode === "hybrid"}>Physics + WAM</SegmentedControl.Button>
              )}
              {modelicaWasmTraj && (
                <SegmentedControl.Button selected={mode === "modelica_wasm"}>Modelica WASM</SegmentedControl.Button>
              )}
            </SegmentedControl>
          </>
        )}
      </FooterBar>
    </Container>
  );
};

export default WamRobotArtifactViewer;
