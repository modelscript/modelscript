// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeForwardKinematics,
  computeInverseDynamicsRnea,
  lintUrdfRobot,
  parseUrdf,
  renderUrdfSvg,
  urdfToModelica,
  urdfToSimpack,
  type UrdfDiagnostic,
  type UrdfRobot,
} from "@modelscript/urdf";
import { CheckCircleIcon, CopyIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import MultibodyViewport3D, { type MultibodyLink3D, type MultibodyNode3D } from "./MultibodyViewport3D";
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
    [key: string]: unknown;
  };
  artifactId?: string | number | undefined;
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "520px")};
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
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
  overflow: hidden;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`;

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Badge = styled.span<{ $variant?: "success" | "warning" | "error" | "info" }>`
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
          : "rgba(56, 139, 253, 0.15)"};
  color: ${(p) =>
    p.$variant === "success"
      ? "var(--color-success-fg, #3fb950)"
      : p.$variant === "warning"
        ? "var(--color-attention-fg, #d29922)"
        : p.$variant === "error"
          ? "var(--color-danger-fg, #f85149)"
          : "var(--color-accent-fg, #58a6ff)"};
  border: 1px solid
    ${(p) =>
      p.$variant === "success"
        ? "rgba(46, 160, 67, 0.3)"
        : p.$variant === "warning"
          ? "rgba(210, 153, 34, 0.3)"
          : p.$variant === "error"
            ? "rgba(248, 81, 73, 0.3)"
            : "rgba(56, 139, 253, 0.3)"};
`;

const ContentArea = styled.div<{ $padded?: boolean }>`
  flex: 1;
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
  gap: 12px;
  flex-wrap: wrap;
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

const UrdfViewer: React.FC<UrdfViewerProps> = ({ viewConfig, artifactId, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState<number>(0);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
  const [projectionMode, setProjectionMode] = useState<"urdf" | "modelica" | "simpack">("urdf");
  const [copied, setCopied] = useState<boolean>(false);

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

  const modelName =
    robot?.name || viewConfig.robotName || viewConfig.modelName || viewConfig.title || "URDF Robot Mechanism";

  // Calculate total mass and degrees of freedom
  const { totalMassKg, movableJoints } = useMemo(() => {
    if (!robot) return { totalMassKg: 0, movableJoints: 0 };
    let mass = 0;
    for (const link of robot.links.values()) {
      if (link.inertial?.mass) mass += link.inertial.mass;
    }
    let movable = 0;
    for (const joint of robot.joints.values()) {
      if (joint.type !== "fixed") movable++;
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

  // Forward Kinematics link poses
  const linkPoses = useMemo(() => {
    if (!robot) return new Map();
    try {
      const qMap = new Map(Object.entries(jointAngles));
      return computeForwardKinematics(robot, qMap);
    } catch {
      return new Map();
    }
  }, [robot, jointAngles]);

  // Inverse Dynamics RNEA gravity hold torques for current pose
  const rneaTorques = useMemo<Map<string, number>>(() => {
    if (!robot) return new Map();
    try {
      const q = new Map<string, number>();
      const qd = new Map<string, number>();
      const qdd = new Map<string, number>();
      for (const [jName, joint] of robot.joints) {
        if (joint.type === "fixed") continue;
        q.set(jName, jointAngles[jName] ?? 0.0);
        qd.set(jName, 0.0);
        qdd.set(jName, 0.0);
      }
      const res = computeInverseDynamicsRnea(robot, q, qd, qdd, 9.80665);
      return res.jointTorques;
    } catch {
      return new Map();
    }
  }, [robot, jointAngles]);

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
        color: isBase ? "#8b949e" : linkColors[colorIdx++ % linkColors.length],
        dimensions: link.inertial?.mass ? [0.15, 0.15, 0.15] : [0.1, 0.1, 0.1],
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

  // 2D SVG schematic diagram
  const svgMarkup = useMemo(() => {
    if (viewConfig.svg && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    if (robot && robot.links.size > 0) {
      try {
        const raw = renderUrdfSvg(robot);
        return sanitizeSvgMarkup(raw, { isFullScreen });
      } catch {
        return "";
      }
    }
    return "";
  }, [viewConfig.svg, robot, isFullScreen]);

  // Projected sources
  const projectedCode = useMemo(() => {
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
    return rawDeck;
  }, [robot, projectionMode, rawDeck]);

  const handleCopyCode = async () => {
    if (!projectedCode) return;
    await navigator.clipboard.writeText(projectedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "urdf" as any,
      code: rawDeck || `<robot name="${modelName}">\n</robot>\n`,
      title: modelName,
    });
    const fromArt = artifactId || viewConfig.artifactId ? `?fromArtifact=${artifactId || viewConfig.artifactId}` : "";
    navigate(`/sketch${fromArt}#m=${hash}`);
  };

  const codeLines = projectedCode ? projectedCode.split(/\r?\n/) : [];

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <Badge $variant="info">ROS URDF</Badge>
          {!isFullScreen && <Title title={modelName}>{modelName}</Title>}
          <Badge $variant="success">
            <span style={{ verticalAlign: "middle", marginRight: 4, display: "inline-flex" }}>
              <CheckCircleIcon size={12} />
            </span>
            {movableJoints} DOF
          </Badge>
          {totalMassKg > 0 && <Badge $variant="info">{totalMassKg.toFixed(2)} kg</Badge>}
          {errorCount > 0 ? (
            <Badge $variant="error">
              {errorCount} Error{errorCount > 1 ? "s" : ""}
            </Badge>
          ) : warningCount > 0 ? (
            <Badge $variant="warning">
              {warningCount} Warning{warningCount > 1 ? "s" : ""}
            </Badge>
          ) : (
            <Badge $variant="success">Clean</Badge>
          )}
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          <SegmentedControl size="small" aria-label="URDF Views">
            <SegmentedControl.Button selected={tabIndex === 0} onClick={() => setTabIndex(0)}>
              Kinematic Tree
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 1} onClick={() => setTabIndex(1)}>
              3D Pose
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 2} onClick={() => setTabIndex(2)}>
              Dynamics & Linter
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 3} onClick={() => setTabIndex(3)}>
              Source & Projections
            </SegmentedControl.Button>
          </SegmentedControl>
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={DraftingTriangleIcon}
              onClick={handleOpenPlayground}
              title="Open in Sketch"
            >
              Open in Sketch
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea $padded={tabIndex === 2 || tabIndex === 3 || (!svgMarkup && tabIndex === 0)}>
        {isLoading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="large" />
          </Box>
        ) : tabIndex === 0 ? (
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
        ) : tabIndex === 1 ? (
          <Box display="flex" flexDirection="column" height="100%">
            {robot && movableJoints > 0 && (
              <ControlsBar>
                <Text style={{ fontWeight: 600, color: "var(--color-fg-muted)" }}>Joint Angles:</Text>
                {Array.from(robot.joints.values())
                  .filter((j) => j.type !== "fixed")
                  .slice(0, 6)
                  .map((joint) => {
                    const minVal = joint.limits?.lower ?? -Math.PI;
                    const maxVal = joint.limits?.upper ?? Math.PI;
                    const curr = jointAngles[joint.name] ?? 0;
                    return (
                      <JointSliderWrapper key={joint.name}>
                        <Text style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>
                          {joint.name}
                        </Text>
                        <input
                          type="range"
                          min={minVal}
                          max={maxVal}
                          step={0.02}
                          value={curr}
                          onChange={(e) => {
                            const val = Number.parseFloat(e.target.value);
                            setJointAngles((prev) => ({ ...prev, [joint.name]: val }));
                          }}
                          style={{ width: "90px", cursor: "pointer" }}
                        />
                        <Text style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px", minWidth: "40px" }}>
                          {curr.toFixed(2)}
                        </Text>
                      </JointSliderWrapper>
                    );
                  })}
              </ControlsBar>
            )}
            <Box flex={1} p={2} position="relative">
              <MultibodyViewport3D
                nodes={nodes3D}
                links={links3D}
                height={isFullScreen ? "calc(100vh - 180px)" : "420px"}
              />
            </Box>
          </Box>
        ) : tabIndex === 2 ? (
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
                    open-tree kinematics.
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

            {/* RNEA Static Gravity Hold Torques */}
            {rneaTorques.size > 0 && (
              <Box>
                <Box mb={2} display="flex" alignItems="center" gap={2}>
                  <Text style={{ fontSize: "13px", fontWeight: 600 }}>
                    RNEA Gravity Hold Torques (Static Equilibrium)
                  </Text>
                  <Badge $variant="info">{rneaTorques.size} Actuators</Badge>
                </Box>
                <TableWrapper>
                  <StyledTable>
                    <thead>
                      <tr>
                        <th>Joint Name</th>
                        <th>Type</th>
                        <th>Current Angle [rad]</th>
                        <th>Hold Torque $\tau$ [N$\cdot$m]</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(rneaTorques.entries()).map(([jName, tau]) => {
                        const joint = robot?.joints.get(jName);
                        const currQ = jointAngles[jName] ?? 0;
                        return (
                          <tr key={jName}>
                            <td>
                              <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{jName}</strong>
                            </td>
                            <td>{joint?.type ?? "revolute"}</td>
                            <td>
                              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{currQ.toFixed(3)}</span>
                            </td>
                            <td>
                              <span
                                style={{
                                  fontFamily: "var(--font-mono, monospace)",
                                  fontWeight: 600,
                                  color: Math.abs(tau) > 0.01 ? "var(--color-accent-fg, #58a6ff)" : "inherit",
                                }}
                              >
                                {tau.toFixed(4)} N$\cdot$m
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
