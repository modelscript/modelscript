// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CodeIcon,
  CpuIcon,
  LinkExternalIcon,
  LinkIcon,
  SearchIcon,
  SyncIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Heading, Label, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import type { ArtifactViewerInfo, ClassDetail, ClassSummary } from "../api";
import Box from "./Box";
import CadStepViewer from "./artifacts/CadStepViewer";

/* ─── Types ─── */

import {
  type DigitalThreadMetrics,
  type DigitalThreadTwin,
  type DomainType,
  checkUnitParity,
  computeDigitalThreadMetrics,
  extractDigitalThreadTwins,
} from "../util/digitalThread";

export { checkUnitParity, computeDigitalThreadMetrics, extractDigitalThreadTwins };
export type { DigitalThreadMetrics, DigitalThreadTwin, DomainType };

export interface DigitalThreadExplorerProps {
  packageName: string;
  packageVersion: string;
  classes?: ClassSummary[];
  rootClass?: ClassDetail | null;
  artifactViewers?: ArtifactViewerInfo[];
  onNavigateToArtifact?: (artifactPath: string) => void;
  onNavigateToClass?: (className: string) => void;
}

/* ─── Animations & Styles ─── */

const threadFlow = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

const ExplorerContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
`;

const MetricCard = styled.div`
  background: var(--color-canvas-subtle, rgba(22, 27, 34, 0.7));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-accent-emphasis, #0969da);
    transform: translateY(-1px);
  }
`;

const MetricValue = styled.div`
  font-size: 26px;
  font-weight: 700;
  color: var(--color-fg-default, #c9d1d9);
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MetricLabel = styled.div`
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-fg-muted, #8b949e);
`;

const ControlsBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const FilterPillGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const FilterPill = styled.button<{ $active: boolean; $color?: string }>`
  border: 1px solid
    ${(props) =>
      props.$active ? props.$color || "var(--color-accent-emphasis, #0969da)" : "var(--color-border-default, #30363d)"};
  background: ${(props) =>
    props.$active
      ? props.$color
        ? `${props.$color}25`
        : "var(--color-accent-subtle, rgba(56, 139, 253, 0.15))"
      : "var(--color-canvas-subtle, #161b22)"};
  color: ${(props) => (props.$active ? "var(--color-fg-default, #f0f6fc)" : "var(--color-fg-muted, #8b949e)")};
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? 600 : 400)};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &:hover {
    border-color: ${(props) => props.$color || "var(--color-accent-emphasis, #0969da)"};
    color: var(--color-fg-default, #f0f6fc);
  }
`;

const TwinCard = styled.div`
  background: var(--color-canvas-subtle, rgba(22, 27, 34, 0.8));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 14px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    border-color: rgba(6, 182, 212, 0.5);
    box-shadow:
      0 8px 24px -4px rgba(0, 0, 0, 0.4),
      0 0 16px rgba(6, 182, 212, 0.15);
  }
`;

const TwinHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const ThreadVisualizer = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--color-canvas-default, #0d1117);
  border-radius: 10px;
  border: 1px solid var(--color-border-subtle, #21262d);

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 12px;
  }
`;

const NodeBox = styled.div<{ $domain: DomainType }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const DomainTag = styled.div<{ $domain: DomainType }>`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${(props) => {
    switch (props.$domain) {
      case "modelica":
        return "#38bdf8"; // cyan-sky
      case "sysml2":
        return "#a855f7"; // purple
      case "cad":
        return "#fbbf24"; // amber
      case "dataset":
        return "#34d399"; // emerald
      default:
        return "var(--color-fg-muted, #8b949e)";
    }
  }};
`;

const NodeTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--color-fg-default, #c9d1d9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
`;

const NodeSub = styled.div`
  font-size: 12px;
  color: var(--color-fg-muted, #8b949e);
  display: flex;
  align-items: center;
  gap: 6px;
`;

const ConnectorLine = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  position: relative;
  padding: 0 8px;

  &::before {
    content: "";
    height: 2px;
    width: 60px;
    background: linear-gradient(90deg, #38bdf8, #a855f7, #fbbf24);
    background-size: 200% 200%;
    animation: ${threadFlow} 3s ease infinite;
    border-radius: 2px;
  }

  @media (max-width: 768px) {
    &::before {
      width: 2px;
      height: 24px;
    }
  }
`;

const ParityChip = styled.div<{ $status: "compatible" | "warning" | "incompatible" }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid
    ${(props) => {
      switch (props.$status) {
        case "compatible":
          return "rgba(46, 160, 67, 0.4)";
        case "warning":
          return "rgba(217, 119, 6, 0.4)";
        case "incompatible":
          return "rgba(248, 81, 73, 0.4)";
      }
    }};
  background: ${(props) => {
    switch (props.$status) {
      case "compatible":
        return "rgba(46, 160, 67, 0.12)";
      case "warning":
        return "rgba(217, 119, 6, 0.12)";
      case "incompatible":
        return "rgba(248, 81, 73, 0.12)";
    }
  }};
  color: ${(props) => {
    switch (props.$status) {
      case "compatible":
        return "#3fb950";
      case "warning":
        return "#d29922";
      case "incompatible":
        return "#f85149";
    }
  }};
`;

const ActionsRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-subtle, #21262d);
`;

/* ─── Main Digital Thread Component ─── */

export const DigitalThreadExplorer: React.FC<DigitalThreadExplorerProps> = ({
  packageName,
  packageVersion,
  classes = [],
  rootClass = null,
  artifactViewers = [],
  onNavigateToArtifact,
  onNavigateToClass,
}) => {
  const navigate = useNavigate();

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [parityFilter, setParityFilter] = useState<"all" | "compatible" | "incompatible">("all");

  // CAD 3D preview modal state
  const [activeCadPreview, setActiveCadPreview] = useState<{ url: string; title: string } | null>(null);

  // Synthesize digital thread twins
  const twins = useMemo(() => {
    return extractDigitalThreadTwins(packageName, packageVersion, classes, rootClass, artifactViewers);
  }, [packageName, packageVersion, classes, rootClass, artifactViewers]);

  // Filtered twins
  const filteredTwins = useMemo(() => {
    return twins.filter((twin) => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSource =
          twin.source.name.toLowerCase().includes(q) || (twin.source.variable || "").toLowerCase().includes(q);
        const matchTarget =
          twin.target.name.toLowerCase().includes(q) || (twin.target.attribute || "").toLowerCase().includes(q);
        const matchUnit =
          (twin.parity.sourceUnit || "").toLowerCase().includes(q) ||
          (twin.parity.targetUnit || "").toLowerCase().includes(q);
        if (!matchSource && !matchTarget && !matchUnit) return false;
      }

      // Domain filter
      if (domainFilter === "modelica-sysml") {
        if (
          !(
            (twin.source.domain === "modelica" && twin.target.domain === "sysml2") ||
            (twin.source.domain === "sysml2" && twin.target.domain === "modelica")
          )
        ) {
          return false;
        }
      } else if (domainFilter === "modelica-cad") {
        if (
          !(
            (twin.source.domain === "modelica" && twin.target.domain === "cad") ||
            (twin.source.domain === "cad" && twin.target.domain === "modelica")
          )
        ) {
          return false;
        }
      } else if (domainFilter === "sysml-cad") {
        if (
          !(
            (twin.source.domain === "sysml2" && twin.target.domain === "cad") ||
            (twin.source.domain === "cad" && twin.target.domain === "sysml2")
          )
        ) {
          return false;
        }
      }

      // Parity filter
      if (parityFilter === "compatible" && twin.parity.status !== "compatible") return false;
      if (parityFilter === "incompatible" && twin.parity.status === "compatible") return false;

      return true;
    });
  }, [twins, searchQuery, domainFilter, parityFilter]);

  // Statistics
  const metrics = useMemo(() => computeDigitalThreadMetrics(twins), [twins]);

  const handleLaunchCad = (url: string, title: string) => {
    setActiveCadPreview({ url, title });
  };

  const handleJumpToClass = (className: string) => {
    if (onNavigateToClass) {
      onNavigateToClass(className);
    } else {
      navigate(`/packages/${packageName}/${packageVersion}/classes/${className}`);
    }
  };

  const handleJumpToArtifact = (artifactPath: string) => {
    if (onNavigateToArtifact) {
      onNavigateToArtifact(artifactPath);
    }
  };

  return (
    <ExplorerContainer>
      {/* ── Summary Metrics Grid ── */}
      <MetricsGrid>
        <MetricCard>
          <MetricLabel>Total Digital Thread Twins</MetricLabel>
          <MetricValue>
            <SyncIcon size={24} fill="#06b6d4" />
            {metrics.total}
          </MetricValue>
        </MetricCard>

        <MetricCard>
          <MetricLabel>Physical Quantity Parity</MetricLabel>
          <MetricValue style={{ color: "#3fb950" }}>
            <CheckCircleFillIcon size={24} fill="#3fb950" />
            {`${metrics.parityRate}%`}
          </MetricValue>
        </MetricCard>

        <MetricCard>
          <MetricLabel>CAD 3D Bindings</MetricLabel>
          <MetricValue style={{ color: "#fbbf24" }}>
            <CpuIcon size={24} fill="#fbbf24" />
            {metrics.cadBindings}
          </MetricValue>
        </MetricCard>

        <MetricCard>
          <MetricLabel>SysML v2 Alignments</MetricLabel>
          <MetricValue style={{ color: "#a855f7" }}>
            <CodeIcon size={24} fill="#a855f7" />
            {metrics.sysmlAlignments}
          </MetricValue>
        </MetricCard>
      </MetricsGrid>

      {/* ── Filter Controls & Search ── */}
      <ControlsBar>
        <FilterPillGroup>
          <FilterPill $active={domainFilter === "all"} onClick={() => setDomainFilter("all")}>
            All Domains ({twins.length})
          </FilterPill>
          <FilterPill
            $active={domainFilter === "modelica-sysml"}
            $color="#a855f7"
            onClick={() => setDomainFilter("modelica-sysml")}
          >
            ⚡ Modelica ⟷ 📐 SysML v2
          </FilterPill>
          <FilterPill
            $active={domainFilter === "modelica-cad"}
            $color="#fbbf24"
            onClick={() => setDomainFilter("modelica-cad")}
          >
            ⚡ Modelica ⟷ 🧊 STEP CAD
          </FilterPill>
          <FilterPill
            $active={domainFilter === "sysml-cad"}
            $color="#38bdf8"
            onClick={() => setDomainFilter("sysml-cad")}
          >
            📐 SysML v2 ⟷ 🧊 STEP CAD
          </FilterPill>
        </FilterPillGroup>

        <Box display="flex" gap={2} alignItems="center">
          <FilterPillGroup>
            <FilterPill $active={parityFilter === "all"} onClick={() => setParityFilter("all")}>
              All Parity
            </FilterPill>
            <FilterPill
              $active={parityFilter === "compatible"}
              $color="#3fb950"
              onClick={() => setParityFilter("compatible")}
            >
              ✔ Verified ({compatibleCount})
            </FilterPill>
            {twins.length - compatibleCount > 0 && (
              <FilterPill
                $active={parityFilter === "incompatible"}
                $color="#f85149"
                onClick={() => setParityFilter("incompatible")}
              >
                ✖ Issues ({twins.length - compatibleCount})
              </FilterPill>
            )}
          </FilterPillGroup>

          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Search twins or units..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            style={{ minWidth: 220 }}
          />
        </Box>
      </ControlsBar>

      {/* ── Twin Cards List ── */}
      {filteredTwins.length > 0 ? (
        filteredTwins.map((twin) => (
          <TwinCard key={twin.id}>
            <TwinHeader>
              <Box display="flex" alignItems="center" gap={2}>
                <Label variant="accent" style={{ fontSize: 11, textTransform: "uppercase" }}>
                  {twin.relationship}
                </Label>
                <Text style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg-default)" }}>
                  {twin.source.variable ? `${twin.source.name}.${twin.source.variable}` : twin.source.name}
                </Text>
              </Box>

              <ParityChip $status={twin.parity.status} title={twin.parity.message}>
                {twin.parity.status === "compatible" ? (
                  <CheckCircleFillIcon size={14} fill="#3fb950" />
                ) : (
                  <XCircleFillIcon size={14} fill="#f85149" />
                )}
                <span>{twin.parity.message}</span>
              </ParityChip>
            </TwinHeader>

            {/* Visualizer Thread Line */}
            <ThreadVisualizer>
              <NodeBox $domain={twin.source.domain}>
                <DomainTag $domain={twin.source.domain}>
                  {twin.source.domain === "modelica" && "⚡ Modelica Class / DAE"}
                  {twin.source.domain === "sysml2" && "📐 SysML v2 Definition"}
                  {twin.source.domain === "cad" && "🧊 STEP CAD Assembly"}
                  {twin.source.domain === "dataset" && "📊 Calibration Dataset"}
                </DomainTag>
                <NodeTitle title={twin.source.name}>{twin.source.name}</NodeTitle>
                <NodeSub>
                  <span>Kind: {twin.source.kind}</span>
                  {twin.source.unit && (
                    <Label variant="secondary" style={{ fontSize: 10, fontFamily: "monospace" }}>
                      unit: {twin.source.unit}
                    </Label>
                  )}
                </NodeSub>
              </NodeBox>

              <ConnectorLine>
                <LinkIcon size={14} fill="var(--color-fg-muted)" />
              </ConnectorLine>

              <NodeBox $domain={twin.target.domain}>
                <DomainTag $domain={twin.target.domain}>
                  {twin.target.domain === "modelica" && "⚡ Modelica Counterpart"}
                  {twin.target.domain === "sysml2" && "📐 SysML v2 Architecture"}
                  {twin.target.domain === "cad" && "🧊 STEP CAD 3D B-Rep"}
                  {twin.target.domain === "dataset" && "📊 Benchmark Telemetry"}
                </DomainTag>
                <NodeTitle title={twin.target.name}>{twin.target.name}</NodeTitle>
                <NodeSub>
                  <span>Kind: {twin.target.kind}</span>
                  {twin.target.unit && (
                    <Label variant="secondary" style={{ fontSize: 10, fontFamily: "monospace" }}>
                      unit: {twin.target.unit}
                    </Label>
                  )}
                </NodeSub>
              </NodeBox>
            </ThreadVisualizer>

            {/* 1-Click Cross-Domain Action Triggers */}
            <ActionsRow>
              <Box display="flex" gap={2} flexWrap="wrap">
                {twin.source.domain === "modelica" && (
                  <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={CodeIcon}
                    onClick={() => handleJumpToClass(twin.source.name.split(".").pop() || twin.source.name)}
                  >
                    View Modelica Code
                  </Button>
                )}

                {twin.target.domain === "sysml2" && (
                  <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={LinkExternalIcon}
                    onClick={() => handleJumpToArtifact(twin.target.resourcePath || "sysml/chassis.sysml")}
                  >
                    Open SysML Architecture
                  </Button>
                )}

                {(twin.target.domain === "cad" || twin.source.domain === "cad") && (
                  <Button
                    size="small"
                    variant="primary"
                    leadingVisual={CpuIcon}
                    onClick={() =>
                      handleLaunchCad(twin.cadViewerConfig?.url || twin.target.resourcePath || "", twin.target.name)
                    }
                  >
                    Launch 3D CAD Viewer
                  </Button>
                )}
              </Box>

              <Text style={{ fontSize: 12, color: "var(--color-fg-muted)", fontFamily: "monospace" }}>
                Cross-Domain Salsa Binding Active
              </Text>
            </ActionsRow>
          </TwinCard>
        ))
      ) : (
        <MetricCard style={{ padding: 40, textAlign: "center", alignItems: "center" }}>
          <SyncIcon size={36} fill="var(--color-fg-muted)" />
          <Heading as="h4" style={{ fontSize: 16, marginTop: 8 }}>
            No Matching Digital Thread Twins
          </Heading>
          <Text style={{ fontSize: 13, color: "var(--color-fg-muted)" }}>
            Try adjusting search keywords or domain filters to inspect cross-language twin bindings.
          </Text>
        </MetricCard>
      )}

      {/* ── 3D CAD Preview Dialog ── */}
      {activeCadPreview && (
        <Dialog
          title={`3D CAD Model: ${activeCadPreview.title}`}
          onClose={() => setActiveCadPreview(null)}
          style={{ width: "90vw", maxWidth: 1000, height: "80vh", maxHeight: 720 }}
        >
          <div style={{ width: "100%", height: "calc(100% - 20px)", minHeight: 480 }}>
            <CadStepViewer viewConfig={{ url: activeCadPreview.url }} isFullScreen={false} />
          </div>
        </Dialog>
      )}
    </ExplorerContainer>
  );
};

export default DigitalThreadExplorer;
