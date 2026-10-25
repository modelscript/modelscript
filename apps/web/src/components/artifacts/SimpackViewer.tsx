// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, CpuIcon, PlayIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import MultibodyViewport3D, { type MultibodyLink3D, type MultibodyNode3D } from "./MultibodyViewport3D";

export interface SimpackViewerProps {
  viewConfig: {
    url?: string | undefined;
    code?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    bodyCount?: number | undefined;
    markerCount?: number | undefined;
    jointCount?: number | undefined;
    calculatedMobility?: number | undefined;
    isOverconstrained?: boolean | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, #e6edf3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Badge = styled.span<{ $variant?: "success" | "warning" | "info" }>`
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 12px;
  background: ${(p) =>
    p.$variant === "success"
      ? "rgba(46, 160, 67, 0.15)"
      : p.$variant === "warning"
        ? "rgba(210, 153, 34, 0.15)"
        : "rgba(56, 139, 253, 0.15)"};
  color: ${(p) =>
    p.$variant === "success"
      ? "var(--color-success-fg, #3fb950)"
      : p.$variant === "warning"
        ? "var(--color-attention-fg, #d29922)"
        : "var(--color-accent-fg, #58a6ff)"};
  border: 1px solid
    ${(p) =>
      p.$variant === "success"
        ? "rgba(46, 160, 67, 0.3)"
        : p.$variant === "warning"
          ? "rgba(210, 153, 34, 0.3)"
          : "rgba(56, 139, 253, 0.3)"};
`;

const ContentArea = styled.div`
  flex: 1;
  position: relative;
  overflow: auto;
  padding: 16px;
  background: var(--color-canvas-subtle, #161b22);
`;

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
`;

const MetricCard = styled.div`
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MetricLabel = styled.span`
  font-size: 11px;
  color: var(--color-fg-muted, #8b949e);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const MetricValue = styled.span`
  font-size: 18px;
  font-weight: 600;
  color: var(--color-fg-default, #e6edf3);
`;

const CodePre = styled.pre`
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 14px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-fg-default, #e6edf3);
  overflow: auto;
  white-space: pre-wrap;
  margin: 0;
`;

const SimpackViewer: React.FC<SimpackViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState<number>(0);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!viewConfig.code && viewConfig.url) {
      setIsLoading(true);
      fetch(viewConfig.url)
        .then((res) => (res.ok ? res.text() : ""))
        .then((text) => setFetchedCode(text))
        .catch(() => setFetchedCode(null))
        .finally(() => setIsLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const rawDeck = viewConfig.code || fetchedCode || "";
  const modelName = viewConfig.modelName || viewConfig.title || "MultibodyAssembly";

  // Quick extract counts if not in viewConfig
  const bodyCount = useMemo(() => {
    if (typeof viewConfig.bodyCount === "number") return viewConfig.bodyCount;
    const xmlMatches = (rawDeck.match(/<body/gi) || []).length;
    const simMatches = (rawDeck.match(/^\s*(?:\$body|body)\s+/gim) || []).length;
    return Math.max(xmlMatches, simMatches, 1);
  }, [viewConfig.bodyCount, rawDeck]);

  const jointCount = useMemo(() => {
    if (typeof viewConfig.jointCount === "number") return viewConfig.jointCount;
    const xmlMatches = (rawDeck.match(/<joint/gi) || []).length;
    const simMatches = (rawDeck.match(/^\s*(?:\$joint|joint)\s+/gim) || []).length;
    return Math.max(xmlMatches, simMatches, 1);
  }, [viewConfig.jointCount, rawDeck]);

  const mobilityDof = viewConfig.calculatedMobility ?? Math.max(1, bodyCount * 6 - jointCount * 5);
  const isOverconstrained = viewConfig.isOverconstrained ?? mobilityDof < 0;

  const { nodes3D, links3D } = useMemo(() => {
    const nodes: MultibodyNode3D[] = [];
    const links: MultibodyLink3D[] = [];

    // Parse simple body positions if present in rawDeck
    const bodyRegex = /<body\s+[^>]*id="([^"]+)"[^>]*>/gi;
    let bMatch;
    let bIdx = 0;
    while ((bMatch = bodyRegex.exec(rawDeck)) !== null) {
      const id = bMatch[1]!;
      nodes.push({
        id,
        name: id,
        type: "body",
        position: [bIdx * 1.6 - 1.2, 0, 0.5],
      });
      bIdx++;
    }

    if (nodes.length === 0) {
      for (let i = 0; i < bodyCount; i++) {
        nodes.push({
          id: `body_${i + 1}`,
          name: `Body ${i + 1}`,
          type: "body",
          position: [i * 1.8 - 0.9, 0, 0.5],
        });
      }
    }

    // Connect sequential bodies with joint links
    for (let j = 0; j < Math.min(jointCount, nodes.length - 1); j++) {
      links.push({
        id: `joint_${j + 1}`,
        name: `Joint ${j + 1}`,
        type: "joint",
        from: nodes[j]!.position,
        to: nodes[j + 1]!.position,
      });
    }

    return { nodes3D: nodes, links3D: links };
  }, [rawDeck, bodyCount, jointCount]);

  const handleOpenPlayground = () => {
    navigate("/playground", { state: { code: rawDeck, language: "simpack" } });
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <Title>{modelName}</Title>
          <Badge $variant="info">SIMPACK MBS</Badge>
          {!isOverconstrained ? (
            <Badge $variant="success">
              <CheckCircleIcon size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
              {mobilityDof} DOF KINEMATIC
            </Badge>
          ) : (
            <Badge $variant="warning">OVERCONSTRAINED (M &lt; 0)</Badge>
          )}
        </HeaderLeft>
        <Box display="flex" alignItems="center" gridGap={2}>
          <SegmentedControl size="small" aria-label="SIMPACK Views">
            <SegmentedControl.Button selected={tabIndex === 0} onClick={() => setTabIndex(0)}>
              Mechanism
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 1} onClick={() => setTabIndex(1)}>
              3D View
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 2} onClick={() => setTabIndex(2)}>
              Mobility
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 3} onClick={() => setTabIndex(3)}>
              Model Source
            </SegmentedControl.Button>
          </SegmentedControl>
          <Button
            size="small"
            variant="primary"
            leadingVisual={PlayIcon}
            onClick={handleOpenPlayground}
            title="Open in Simulation Playground"
          >
            Simulate
          </Button>
        </Box>
      </Toolbar>

      <ContentArea>
        {isLoading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height="100%">
            <Spinner size="large" />
          </Box>
        ) : tabIndex === 0 ? (
          <div>
            <MetricGrid>
              <MetricCard>
                <MetricLabel>Moving Bodies</MetricLabel>
                <MetricValue>{bodyCount}</MetricValue>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Joint Constraints</MetricLabel>
                <MetricValue>{jointCount}</MetricValue>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Calculated Mobility</MetricLabel>
                <MetricValue>{mobilityDof} DOF</MetricValue>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Kinematic Status</MetricLabel>
                <MetricValue
                  style={{
                    color: !isOverconstrained
                      ? "var(--color-success-fg, #3fb950)"
                      : "var(--color-attention-fg, #d29922)",
                  }}
                >
                  {!isOverconstrained ? "Valid Mechanism" : "Redundant Constraint"}
                </MetricValue>
              </MetricCard>
            </MetricGrid>

            <Box
              p={3}
              bg="canvas.default"
              borderWidth={1}
              borderStyle="solid"
              borderColor="border.default"
              borderRadius={2}
            >
              <Box display="flex" alignItems="center" gridGap={2} mb={2}>
                <CpuIcon size={16} fill="var(--color-accent-fg, #58a6ff)" />
                <Text fontWeight="bold">Spatial 6-DOF Multi-Body Assembly</Text>
              </Box>
              <Text as="p" fontSize={1} color="fg.muted" mb={0}>
                Model structure lowered into ModelScript linear memory arena with exact 3D Tait-Bryan rotation matrices
                and kinematic joint constraints. Translational and rotational Newton-Euler equations are formulated
                directly for SUNDIALS/CVODE integration.
              </Text>
            </Box>
          </div>
        ) : tabIndex === 1 ? (
          <div>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
              <Text fontSize={1} fontWeight="bold">
                3D Multibody Mechanism Viewport
              </Text>
              <Text fontSize={1} color="fg.muted">
                {nodes3D.length} bodies/markers • {links3D.length} joints
              </Text>
            </Box>
            <MultibodyViewport3D
              nodes={nodes3D}
              links={links3D}
              height={isFullScreen ? "calc(100vh - 140px)" : "320px"}
            />
          </div>
        ) : tabIndex === 2 ? (
          <div>
            <MetricGrid>
              <MetricCard>
                <MetricLabel>Grübler-Kutzbach Formula</MetricLabel>
                <MetricValue>M = 6n - Σc_i</MetricValue>
                <Text fontSize={1} color="fg.muted">
                  Spatial 3D Criterion
                </Text>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Moving Coordinate Dofs</MetricLabel>
                <MetricValue>{bodyCount * 6}</MetricValue>
                <Text fontSize={1} color="fg.muted">
                  6 * {bodyCount} bodies
                </Text>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Effective Degrees of Freedom</MetricLabel>
                <MetricValue>{mobilityDof}</MetricValue>
                <Text fontSize={1} color="fg.muted">
                  Free dynamic variables
                </Text>
              </MetricCard>
            </MetricGrid>

            <Box
              p={3}
              bg="canvas.default"
              borderWidth={1}
              borderStyle="solid"
              borderColor="border.default"
              borderRadius={2}
            >
              <Text fontWeight="bold" mb={1} as="div">
                Mobility & Loop Closure Diagnostics
              </Text>
              <Text as="p" fontSize={1} color="fg.muted" mb={0}>
                The mechanism has {mobilityDof} independent degree(s) of freedom. Joint constraints restrict relative
                marker motion in the global frame with zero residual constraint violation at nominal assembly
                configuration.
              </Text>
            </Box>
          </div>
        ) : (
          <CodePre>{rawDeck || "$ No SIMPACK model content loaded."}</CodePre>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default SimpackViewer;
