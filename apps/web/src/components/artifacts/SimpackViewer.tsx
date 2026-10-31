// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderKinematicDiagramSvg, type KinematicBodyLike, type KinematicJointLike } from "@modelscript/diagram";
import { CheckCircleIcon, PlayIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import MultibodyViewport3D, { type MultibodyLink3D, type MultibodyNode3D } from "./MultibodyViewport3D";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface SimpackViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    bodies?:
      | { name: string; mass?: number; position?: [number, number, number]; cg?: [number, number, number] }[]
      | undefined;
    joints?: { name: string; type?: string; from?: string; to?: string }[] | undefined;
    forces?: { name: string; type?: string; from?: string; to?: string }[] | undefined;
    bodyCount?: number | undefined;
    markerCount?: number | undefined;
    jointCount?: number | undefined;
    forceCount?: number | undefined;
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
  height: 40px;
  min-height: 40px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
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
  padding: 14px;
  background: var(--color-canvas-subtle, #161b22);
`;

const MetricGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
`;

const MetricCard = styled.div`
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const MetricLabel = styled.span`
  font-size: 10.5px;
  color: var(--color-fg-muted, #8b949e);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const MetricValue = styled.span`
  font-size: 16px;
  font-weight: 600;
  color: var(--color-fg-default, #e6edf3);
`;

function parseSimpackClient(deck: string) {
  const bodies: { name: string; mass: number; position?: [number, number, number] }[] = [];
  const joints: { name: string; type: string; from: string; to: string }[] = [];
  const forces: { name: string; type: string; from: string; to: string }[] = [];

  for (const bm of deck.matchAll(/<body\b[^>]*name=["']([^"']+)["'][^>]*>/gi)) {
    const tag = bm[0] || "";
    const name = bm[1]!;
    const mMatch = tag.match(/\bmass=["']([0-9.eE+-]+)["']/i);
    bodies.push({ name, mass: mMatch?.[1] ? Number.parseFloat(mMatch[1]) : 100 });
  }
  for (const bm of deck.matchAll(/^\s*(?:\$body|body)\s+([A-Za-z0-9_.-]+)(?:\s+mass\s*=\s*([0-9.eE+-]+))?/gim)) {
    const name = bm[1]!;
    if (!bodies.some((b) => b.name === name)) {
      bodies.push({ name, mass: bm[2] ? Number.parseFloat(bm[2]) : 100 });
    }
  }

  for (const jm of deck.matchAll(/<joint\b[^>]*name=["']([^"']+)["'][^>]*>/gi)) {
    const tag = jm[0] || "";
    const name = jm[1]!;
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1] || "revolute";
    const from = tag.match(/\b(?:from|body1)=["']([^"']+)["']/i)?.[1] || "Ground";
    const to = tag.match(/\b(?:to|body2)=["']([^"']+)["']/i)?.[1] || bodies[0]?.name || "Body_1";
    joints.push({ name, type, from, to });
  }
  for (const jm of deck.matchAll(
    /^\s*(?:\$joint|joint)\s+([A-Za-z0-9_.-]+)(?:\s+([A-Za-z0-9_.-]+))?\s+([A-Za-z0-9_.-]+)\s*(?:->|,|\s+)\s*([A-Za-z0-9_.-]+)/gim,
  )) {
    const name = jm[1]!;
    if (!joints.some((j) => j.name === name)) {
      joints.push({
        name,
        type: jm[2] || "revolute",
        from: jm[3] || "Ground",
        to: jm[4] || bodies[0]?.name || "Body_1",
      });
    }
  }

  for (const fm of deck.matchAll(/<force\b[^>]*name=["']([^"']+)["'][^>]*>/gi)) {
    const tag = fm[0] || "";
    const name = fm[1]!;
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1] || "spring_damper";
    const from = tag.match(/\b(?:from|body1)=["']([^"']+)["']/i)?.[1] || bodies[0]?.name || "Ground";
    const to = tag.match(/\b(?:to|body2)=["']([^"']+)["']/i)?.[1] || bodies[1]?.name || "Body_1";
    forces.push({ name, type, from, to });
  }

  return { bodies, joints, forces };
}

const SimpackViewer: React.FC<SimpackViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState<number>(0);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

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
  const modelName = viewConfig.modelName || viewConfig.title || "SIMPACK Multibody Assembly";

  const parsed = useMemo(() => parseSimpackClient(rawDeck), [rawDeck]);
  const resolvedBodies = viewConfig.bodies?.length ? viewConfig.bodies : parsed.bodies;
  const resolvedJoints = viewConfig.joints?.length ? viewConfig.joints : parsed.joints;
  const resolvedForces = viewConfig.forces?.length ? viewConfig.forces : parsed.forces;

  const bodyCount = useMemo(() => {
    if (typeof viewConfig.bodyCount === "number") return viewConfig.bodyCount;
    return resolvedBodies.length;
  }, [viewConfig.bodyCount, resolvedBodies.length]);

  const jointCount = useMemo(() => {
    if (typeof viewConfig.jointCount === "number") return viewConfig.jointCount;
    return resolvedJoints.length;
  }, [viewConfig.jointCount, resolvedJoints.length]);

  const forceCount = useMemo(() => {
    if (typeof viewConfig.forceCount === "number") return viewConfig.forceCount;
    return resolvedForces.length;
  }, [viewConfig.forceCount, resolvedForces.length]);

  const mobilityDof = viewConfig.calculatedMobility;
  const isOverconstrained = viewConfig.isOverconstrained ?? (mobilityDof !== undefined ? mobilityDof < 0 : false);

  const svgMarkup = useMemo(() => {
    if (viewConfig.svg && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    if (resolvedBodies.length > 0) {
      try {
        const kinBodies: KinematicBodyLike[] = [
          { id: "Ground", name: "Inertial Ground", isGround: true },
          ...resolvedBodies.map((b) => ({
            id: b.name,
            name: b.name,
            mass: b.mass ?? 100,
          })),
        ];
        const kinJoints: KinematicJointLike[] = [
          ...resolvedJoints.map((j, i) => ({
            id: j.name || `J_${i + 1}`,
            name: j.name || `Joint ${i + 1}`,
            type: (j.type as any) || "revolute",
            body1: j.from || "Ground",
            body2: j.to || resolvedBodies[i % resolvedBodies.length]!.name,
          })),
          ...resolvedForces.map((f, i) => ({
            id: f.name || `F_${i + 1}`,
            name: f.name || `Force ${i + 1}`,
            type: "spring_damper" as const,
            body1: f.from || "Ground",
            body2: f.to || resolvedBodies[i % resolvedBodies.length]!.name,
          })),
        ];
        if (kinJoints.length === 0 && resolvedBodies.length > 0) {
          resolvedBodies.forEach((b, idx) => {
            kinJoints.push({
              id: `J_${idx + 1}`,
              name: `J_${idx + 1}`,
              type: "revolute",
              body1: idx === 0 ? "Ground" : resolvedBodies[idx - 1]!.name,
              body2: b.name,
            });
          });
        }
        const built = renderKinematicDiagramSvg(
          {
            name: modelName,
            dialect: "SIMPACK",
            bodies: kinBodies,
            joints: kinJoints,
          },
          { isDark: true },
        );
        return sanitizeSvgMarkup(built, { isFullScreen });
      } catch {
        return "";
      }
    }
    return "";
  }, [viewConfig.svg, resolvedBodies, resolvedJoints, resolvedForces, modelName, isFullScreen]);

  const { nodes3D, links3D } = useMemo(() => {
    const nodes: MultibodyNode3D[] = [];
    const links: MultibodyLink3D[] = [];
    const posMap = new Map<string, [number, number, number]>();

    resolvedBodies.forEach((b, idx) => {
      const rawCoords = (b as any).position || (b as any).cg;
      const coords: [number, number, number] =
        Array.isArray(rawCoords) && rawCoords.length === 3
          ? rawCoords
          : [idx * 1.6 - (resolvedBodies.length - 1) * 0.8, (idx % 2) * 0.6, 0.8 + (idx % 3) * 0.4];
      posMap.set(b.name, coords);
      nodes.push({
        id: b.name,
        name: b.name,
        type: "body",
        position: coords,
      });
    });

    resolvedJoints.forEach((j, idx) => {
      const p1 = posMap.get(j.from || "") || (idx > 0 ? posMap.get(resolvedBodies[idx - 1]?.name || "") : [0, 0, 0]);
      const p2 =
        posMap.get(j.to || "") || posMap.get(resolvedBodies[idx % Math.max(1, resolvedBodies.length)]?.name || "");
      if (p1 && p2) {
        links.push({
          id: j.name || `joint_${idx + 1}`,
          name: j.name || `Joint ${idx + 1}`,
          type: "joint",
          from: p1,
          to: p2,
        });
      }
    });

    return { nodes3D: nodes, links3D: links };
  }, [resolvedBodies, resolvedJoints]);

  const handleOpenPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "simpack" as any,
      code: rawDeck || `$ ${modelName}\n`,
      title: modelName,
    });
    const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
    navigate(`/playground${fromArtifact}#m=${hash}`);
  };

  const codeLines = rawDeck ? rawDeck.split(/\r?\n/) : [];

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          {!isFullScreen && <Title title={modelName}>{modelName}</Title>}
          <Badge $variant="info">SIMPACK MBS</Badge>
          {mobilityDof !== undefined && !isOverconstrained && (
            <Badge $variant="success">
              <span style={{ verticalAlign: "middle", marginRight: 4, display: "inline-flex" }}>
                <CheckCircleIcon size={12} />
              </span>
              {mobilityDof} DOF KINEMATIC
            </Badge>
          )}
          {isOverconstrained && <Badge $variant="warning">OVERCONSTRAINED (M &lt; 0)</Badge>}
        </HeaderLeft>
        <Box display="flex" alignItems="center" gap={2}>
          <SegmentedControl size="small" aria-label="SIMPACK Views">
            <SegmentedControl.Button selected={tabIndex === 0} onClick={() => setTabIndex(0)}>
              Mechanism
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 1} onClick={() => setTabIndex(1)}>
              3D View
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={tabIndex === 2} onClick={() => setTabIndex(2)}>
              Model Source
            </SegmentedControl.Button>
          </SegmentedControl>
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={handleOpenPlayground}
              title="Open in Playground"
            >
              Open in Playground
            </Button>
          )}
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
                <MetricLabel>Force Elements</MetricLabel>
                <MetricValue>{forceCount}</MetricValue>
              </MetricCard>
              <MetricCard>
                <MetricLabel>Calculated Mobility</MetricLabel>
                <MetricValue>{mobilityDof !== undefined ? `${mobilityDof} DOF` : "—"}</MetricValue>
              </MetricCard>
            </MetricGrid>

            {svgMarkup ? (
              <InteractiveSvgStage svgMarkup={svgMarkup} isFullScreen={isFullScreen} minHeight="240px" />
            ) : (
              <Box
                p={4}
                bg="var(--color-canvas-default, #0d1117)"
                border="1px solid var(--color-border-default, #30363d)"
                borderRadius="6px"
                textAlign="center"
              >
                <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                  No SIMPACK kinematic diagram elements found. Switch to Model Source to inspect the file.
                </Text>
              </Box>
            )}
          </div>
        ) : tabIndex === 1 ? (
          <div>
            <Box mb={2} display="flex" justifyContent="space-between" alignItems="center">
              <Text style={{ fontSize: "12px", fontWeight: "bold" }}>3D Multibody Mechanism Viewport</Text>
              <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                {nodes3D.length} bodies/markers • {links3D.length} joints
              </Text>
            </Box>
            <MultibodyViewport3D
              nodes={nodes3D}
              links={links3D}
              height={isFullScreen ? "calc(100vh - 140px)" : "320px"}
            />
          </div>
        ) : (
          <Box
            py={2}
            bg="var(--color-canvas-default, #0d1117)"
            border="1px solid var(--color-border-default, #30363d)"
            borderRadius="6px"
            overflow="auto"
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
                    {highlightPolyglotLine(line, "simpack")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={3} color="var(--color-fg-muted)">
                $ No SIMPACK model content loaded.
              </Box>
            )}
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default SimpackViewer;
