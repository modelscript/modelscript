// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  GitPullRequestIcon,
  HistoryIcon,
  LinkExternalIcon,
  LinkIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SyncIcon,
  VerifiedIcon,
  WorkflowIcon,
  XCircleFillIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import {
  Button,
  Dialog,
  FormControl,
  Heading,
  Label,
  SegmentedControl,
  Spinner,
  Text,
  TextInput,
  Textarea,
} from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import {
  type ArtifactViewerInfo,
  type ClassDetail,
  type ClassSummary,
  type ThreadAuditLogDto,
  type ThreadProposalDto,
  createThreadProposal,
  getThreadAuditLogs,
  getThreadProposals,
  reviewThreadProposal,
} from "../api";
import Box from "./Box";
import { CreateSemanticLinkModal } from "./CreateSemanticLinkModal";
import CadStepViewer from "./artifacts/CadStepViewer";

/* ─── Types ─── */

import {
  type DigitalThreadMetrics,
  type DigitalThreadTwin,
  type DomainType,
  computeDigitalThreadMetrics,
  extractDigitalThreadTwins,
} from "../util/digitalThread";

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

  // Custom user-created semantic links state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [customTwins, setCustomTwins] = useState<DigitalThreadTwin[]>([]);
  const [liveStreamConnected, setLiveStreamConnected] = useState(false);

  // Merge Request Governance & Regulatory Audit Trail State
  const [isGovernanceOpen, setIsGovernanceOpen] = useState(false);
  const [governanceTab, setGovernanceTab] = useState<"proposals" | "audit">("proposals");
  const [proposals, setProposals] = useState<ThreadProposalDto[]>([]);
  const [auditLogs, setAuditLogs] = useState<ThreadAuditLogDto[]>([]);
  const [auditVerification, setAuditVerification] = useState<{ valid: boolean; totalEntries: number } | null>(null);
  const [isLoadingGovernance, setIsLoadingGovernance] = useState(false);

  // Proposal Creation Modal State
  const [isProposeModalOpen, setIsProposeModalOpen] = useState(false);
  const [proposalTargetTwin, setProposalTargetTwin] = useState<DigitalThreadTwin | null>(null);
  const [propTitle, setPropTitle] = useState("");
  const [propDesc, setPropDesc] = useState("");
  const [propSafetyStandard, setPropSafetyStandard] = useState("ISO-26262");
  const [propValue, setPropValue] = useState("");
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);

  // Review Comment Dialog State
  const [reviewDialogProposal, setReviewDialogProposal] = useState<ThreadProposalDto | null>(null);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected" | "applied">("approved");
  const [reviewComment, setReviewComment] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Real-time collaborative digital thread synchronization via SSE
  useEffect(() => {
    let active = true;
    let evtSource: EventSource | null = null;

    try {
      evtSource = new EventSource("/api/v1/threads/stream");
      evtSource.addEventListener("init", () => {
        if (active) setLiveStreamConnected(true);
      });
      evtSource.addEventListener("thread_updated", (e) => {
        if (!active) return;
        try {
          const payload = JSON.parse(e.data);
          if (payload.status === "resolved") {
            setCustomTwins((prev) =>
              prev.map((t) =>
                t.id === payload.conflictId || t.name === payload.conflictId
                  ? {
                      ...t,
                      parity: {
                        ...t.parity,
                        status: "compatible",
                        deviationPercent: 0,
                      },
                    }
                  : t,
              ),
            );
          }
        } catch {
          // Ignore parse errors
        }
      });

      evtSource.addEventListener("proposal_created", (e) => {
        if (!active) return;
        try {
          const payload = JSON.parse(e.data);
          if (payload.proposal) {
            setProposals((prev) => [payload.proposal, ...prev.filter((p) => p.id !== payload.proposal.id)]);
          }
        } catch {
          // Ignore parse errors
        }
      });

      evtSource.addEventListener("proposal_reviewed", (e) => {
        if (!active) return;
        try {
          const payload = JSON.parse(e.data);
          if (payload.proposal) {
            setProposals((prev) => prev.map((p) => (p.id === payload.proposal.id ? payload.proposal : p)));
          }
        } catch {
          // Ignore parse errors
        }
      });

      evtSource.onerror = () => {
        if (active) setLiveStreamConnected(false);
      };
    } catch {
      // EventSource not supported in environment
    }

    return () => {
      active = false;
      if (evtSource) {
        evtSource.close();
      }
    };
  }, []);

  const loadGovernanceData = async () => {
    setIsLoadingGovernance(true);
    try {
      const [propsData, auditData] = await Promise.all([getThreadProposals(), getThreadAuditLogs()]);
      setProposals(propsData);
      setAuditLogs(auditData.auditLogs);
      setAuditVerification(auditData.verification);
    } catch {
      // Graceful fallback
    } finally {
      setIsLoadingGovernance(false);
    }
  };

  useEffect(() => {
    loadGovernanceData();
  }, []);

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposalTargetTwin || !propTitle.trim()) return;

    setIsSubmittingProposal(true);
    try {
      const newProp = await createThreadProposal({
        threadId: proposalTargetTwin.id,
        title: propTitle.trim(),
        description: propDesc.trim() || undefined,
        safetyStandard: propSafetyStandard,
        diffSummary: {
          twinName: proposalTargetTwin.name,
          source: proposalTargetTwin.source,
          target: proposalTargetTwin.target,
          proposedValue: propValue,
          parity: proposalTargetTwin.parity,
        },
      });
      setProposals((prev) => [newProp, ...prev]);
      setIsProposeModalOpen(false);
      setProposalTargetTwin(null);
    } catch (err) {
      console.error("Failed to create proposal:", err);
    } finally {
      setIsSubmittingProposal(false);
    }
  };

  const handleReviewProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewDialogProposal) return;

    setIsSubmittingReview(true);
    try {
      const updated = await reviewThreadProposal(reviewDialogProposal.id, {
        status: reviewAction,
        comment: reviewComment.trim() || undefined,
        safetyStandard: "ISO-26262",
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setReviewDialogProposal(null);
      setReviewComment("");
      loadGovernanceData();
    } catch (err) {
      console.error("Failed to review proposal:", err);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Synthesize digital thread twins
  const synthesizedTwins = useMemo(() => {
    return extractDigitalThreadTwins(packageName, packageVersion, classes, rootClass, artifactViewers);
  }, [packageName, packageVersion, classes, rootClass, artifactViewers]);

  const twins = useMemo(() => {
    return [...customTwins, ...synthesizedTwins];
  }, [customTwins, synthesizedTwins]);

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
  const compatibleCount = metrics.compatible;

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
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <FileCodeIcon size={12} /> Modelica ⟷ <WorkflowIcon size={12} /> SysML v2
            </span>
          </FilterPill>
          <FilterPill
            $active={domainFilter === "modelica-cad"}
            $color="#fbbf24"
            onClick={() => setDomainFilter("modelica-cad")}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <FileCodeIcon size={12} /> Modelica ⟷ <PackageIcon size={12} /> STEP CAD
            </span>
          </FilterPill>
          <FilterPill
            $active={domainFilter === "sysml-cad"}
            $color="#38bdf8"
            onClick={() => setDomainFilter("sysml-cad")}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <WorkflowIcon size={12} /> SysML v2 ⟷ <PackageIcon size={12} /> STEP CAD
            </span>
          </FilterPill>
        </FilterPillGroup>

        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          {liveStreamConnected && (
            <Label
              variant="accent"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                background: "rgba(31, 111, 235, 0.12)",
                border: "1px solid var(--color-accent-emphasis, #0969da)",
              }}
            >
              <ZapIcon size={13} fill="#3fb950" />
              Live Collaborative Thread Active
            </Label>
          )}

          <Button size="small" variant="primary" leadingVisual={PlusIcon} onClick={() => setIsCreateModalOpen(true)}>
            Create Semantic Link
          </Button>

          <Button
            size="small"
            variant="default"
            leadingVisual={ShieldCheckIcon}
            onClick={() => {
              setIsGovernanceOpen(true);
              loadGovernanceData();
            }}
          >
            Governance & Audit Trail
            {proposals.filter((p) => p.status === "open").length > 0 && (
              <Label variant="attention" sx={{ ml: 1, fontSize: 10 }}>
                {proposals.filter((p) => p.status === "open").length} open
              </Label>
            )}
          </Button>

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
                  {twin.source.domain === "modelica" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <FileCodeIcon size={12} /> Modelica Class / DAE
                    </span>
                  )}
                  {twin.source.domain === "sysml2" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <WorkflowIcon size={12} /> SysML v2 Definition
                    </span>
                  )}
                  {twin.source.domain === "cad" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <PackageIcon size={12} /> STEP CAD Assembly
                    </span>
                  )}
                  {twin.source.domain === "dataset" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <DatabaseIcon size={12} /> Calibration Dataset
                    </span>
                  )}
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
                  {twin.target.domain === "modelica" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <FileCodeIcon size={12} /> Modelica Counterpart
                    </span>
                  )}
                  {twin.target.domain === "sysml2" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <WorkflowIcon size={12} /> SysML v2 Architecture
                    </span>
                  )}
                  {twin.target.domain === "cad" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <PackageIcon size={12} /> STEP CAD 3D B-Rep
                    </span>
                  )}
                  {twin.target.domain === "dataset" && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <DatabaseIcon size={12} /> Benchmark Telemetry
                    </span>
                  )}
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

                <Button
                  size="small"
                  variant="default"
                  leadingVisual={GitPullRequestIcon}
                  onClick={() => {
                    setProposalTargetTwin(twin);
                    setPropTitle(`Reconcile ${twin.source.name} ↔ ${twin.target.name}`);
                    setPropDesc(
                      `Proposal to reconcile parameters between ${twin.source.domain} and ${twin.target.domain}. Current deviation: ${twin.parity.deviationPercent ?? 0}%.`,
                    );
                    setPropValue(String(twin.parity.sourceValue ?? ""));
                    setIsProposeModalOpen(true);
                  }}
                >
                  Propose Resolution
                </Button>
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

      {/* ── Create Semantic Link Dialog ── */}
      <CreateSemanticLinkModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={(newTwin) => {
          setCustomTwins((prev) => [newTwin, ...prev]);
          setIsCreateModalOpen(false);
        }}
        packageName={packageName}
        packageVersion={packageVersion}
        classes={classes}
        rootClass={rootClass}
        artifactViewers={artifactViewers}
      />

      {/* ── Propose Digital Twin Resolution (Merge Request) Modal ── */}
      {isProposeModalOpen && proposalTargetTwin && (
        <Dialog
          title="Propose Digital Twin Resolution (Merge Request)"
          onClose={() => {
            setIsProposeModalOpen(false);
            setProposalTargetTwin(null);
          }}
          style={{ width: "90vw", maxWidth: 640 }}
        >
          <form onSubmit={handleCreateProposal} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Box bg="var(--color-canvas-subtle)" p={3} borderRadius={8} border="1px solid var(--color-border-default)">
              <Text sx={{ fontSize: 13, fontWeight: 600 }}>
                {proposalTargetTwin.source.name} ({proposalTargetTwin.source.domain}) ⟷ {proposalTargetTwin.target.name}{" "}
                ({proposalTargetTwin.target.domain})
              </Text>
              <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)", display: "block", mt: 1 }}>
                Current Deviation: {proposalTargetTwin.parity.deviationPercent ?? 0}% • Physical Parity:{" "}
                {proposalTargetTwin.parity.status}
              </Text>
            </Box>

            <FormControl required>
              <FormControl.Label>Proposal Title</FormControl.Label>
              <TextInput
                block
                value={propTitle}
                onChange={(e) => setPropTitle(e.target.value)}
                placeholder="e.g. Align Bus Voltage to 24.0V"
              />
            </FormControl>

            <FormControl>
              <FormControl.Label>Proposed Target Value / Modification</FormControl.Label>
              <TextInput
                block
                value={propValue}
                onChange={(e) => setPropValue(e.target.value)}
                placeholder="e.g. 24.0"
              />
            </FormControl>

            <FormControl>
              <FormControl.Label>Safety Standard Compliance</FormControl.Label>
              <select
                value={propSafetyStandard}
                onChange={(e) => setPropSafetyStandard(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-subtle)",
                  color: "var(--color-fg-default)",
                  fontSize: 13,
                }}
              >
                <option value="ISO-26262">ISO 26262 (Road Vehicles - Functional Safety ASIL D)</option>
                <option value="DO-178C">DO-178C (Software Considerations in Airborne Systems DAL A)</option>
                <option value="IEC-61508">IEC 61508 (Functional Safety of E/E/PE Safety-Related Systems)</option>
              </select>
            </FormControl>

            <FormControl>
              <FormControl.Label>Engineering Rationale & Description</FormControl.Label>
              <Textarea
                block
                rows={3}
                value={propDesc}
                onChange={(e) => setPropDesc(e.target.value)}
                placeholder="State the engineering rationale for reconciling this digital twin parameter..."
              />
            </FormControl>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={3}>
              <Button
                variant="default"
                onClick={() => {
                  setIsProposeModalOpen(false);
                  setProposalTargetTwin(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={isSubmittingProposal || !propTitle.trim()}>
                {isSubmittingProposal ? "Submitting Proposal..." : "Submit Merge Proposal"}
              </Button>
            </Box>
          </form>
        </Dialog>
      )}

      {/* ── Governance & Regulatory Audit Trail Modal ── */}
      {isGovernanceOpen && (
        <Dialog
          title="Digital Twin Governance & Regulatory Audit Trail"
          onClose={() => setIsGovernanceOpen(false)}
          style={{
            width: "95vw",
            maxWidth: 960,
            maxHeight: "85vh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box display="flex" flexDirection="column" gap={3} sx={{ height: "100%", overflowY: "auto", pr: 1 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <SegmentedControl aria-label="Governance Views">
                <SegmentedControl.Button
                  selected={governanceTab === "proposals"}
                  onClick={() => setGovernanceTab("proposals")}
                >
                  <GitPullRequestIcon size={14} /> Merge Proposals ({proposals.length})
                </SegmentedControl.Button>
                <SegmentedControl.Button selected={governanceTab === "audit"} onClick={() => setGovernanceTab("audit")}>
                  <HistoryIcon size={14} /> Cryptographic Audit Trail ({auditLogs.length})
                </SegmentedControl.Button>
              </SegmentedControl>

              <Button size="small" onClick={loadGovernanceData} disabled={isLoadingGovernance}>
                <SyncIcon size={12} /> Refresh
              </Button>
            </Box>

            {isLoadingGovernance && (
              <Box display="flex" justifyContent="center" alignItems="center" p={4} gap={2}>
                <Spinner size="medium" />
                <Text sx={{ fontSize: 13, color: "var(--color-fg-muted)" }}>Loading governance records...</Text>
              </Box>
            )}

            {/* ── Tab: Proposals ── */}
            {governanceTab === "proposals" && !isLoadingGovernance && (
              <Box display="flex" flexDirection="column" gap={3}>
                {proposals.length === 0 ? (
                  <Box p={4} textAlign="center" color="var(--color-fg-muted)">
                    No merge proposals recorded. Use "Propose Resolution" on any twin to create one.
                  </Box>
                ) : (
                  proposals.map((prop) => (
                    <Box
                      key={prop.id}
                      p={3}
                      bg="var(--color-canvas-subtle)"
                      borderRadius={8}
                      border="1px solid var(--color-border-default)"
                      display="flex"
                      flexDirection="column"
                      gap={2}
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                        <Box display="flex" alignItems="center" gap={2}>
                          <GitPullRequestIcon
                            size={16}
                            style={{
                              color:
                                prop.status === "approved" || prop.status === "applied"
                                  ? "#3fb950"
                                  : prop.status === "rejected"
                                    ? "#f85149"
                                    : "#d29922",
                            }}
                          />
                          <Text sx={{ fontWeight: 600, fontSize: 14 }}>{prop.title}</Text>
                          <Label
                            variant={
                              prop.status === "applied"
                                ? "accent"
                                : prop.status === "approved"
                                  ? "success"
                                  : prop.status === "rejected"
                                    ? "danger"
                                    : "attention"
                            }
                          >
                            {prop.status.toUpperCase()}
                          </Label>
                        </Box>

                        <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                          Proposed by <strong>{prop.proposed_by}</strong> • {new Date(prop.created_at).toLocaleString()}
                        </Text>
                      </Box>

                      {prop.description && (
                        <Text sx={{ fontSize: 13, color: "var(--color-fg-default)" }}>{prop.description}</Text>
                      )}

                      {prop.review_comment && (
                        <Box
                          p={2}
                          bg="rgba(110, 118, 129, 0.1)"
                          borderRadius={6}
                          borderLeft="3px solid var(--color-accent-emphasis)"
                        >
                          <Text sx={{ fontSize: 12, fontStyle: "italic" }}>
                            Reviewer ({prop.resolved_by}): "{prop.review_comment}"
                          </Text>
                        </Box>
                      )}

                      {prop.status === "open" && (
                        <Box display="flex" gap={2} mt={1}>
                          <Button
                            size="small"
                            variant="primary"
                            leadingVisual={CheckIcon}
                            onClick={() => {
                              setReviewDialogProposal(prop);
                              setReviewAction("approved");
                              setReviewComment("Approved after functional safety review.");
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="small"
                            variant="default"
                            onClick={() => {
                              setReviewDialogProposal(prop);
                              setReviewAction("applied");
                              setReviewComment("Applied resolution into digital thread baseline.");
                            }}
                          >
                            Apply to Baseline
                          </Button>
                          <Button
                            size="small"
                            variant="danger"
                            leadingVisual={XIcon}
                            onClick={() => {
                              setReviewDialogProposal(prop);
                              setReviewAction("rejected");
                              setReviewComment("Rejected due to parameter constraint violation.");
                            }}
                          >
                            Reject
                          </Button>
                        </Box>
                      )}
                    </Box>
                  ))
                )}
              </Box>
            )}

            {/* ── Tab: Regulatory Audit Trail ── */}
            {governanceTab === "audit" && !isLoadingGovernance && (
              <Box display="flex" flexDirection="column" gap={3}>
                <Box
                  p={3}
                  bg="rgba(46, 160, 67, 0.1)"
                  border="1px solid rgba(46, 160, 67, 0.3)"
                  borderRadius={8}
                  display="flex"
                  alignItems="center"
                  gap={2}
                >
                  <VerifiedIcon size={18} fill="#3fb950" />
                  <div>
                    <Text
                      sx={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: auditVerification?.valid ? "#3fb950" : "#d29922",
                        display: "block",
                      }}
                    >
                      {auditVerification?.valid
                        ? `Cryptographic Hash Chain Verified (${auditVerification.totalEntries} block${auditVerification.totalEntries === 1 ? "" : "s"}, SHA-256)`
                        : "Cryptographic Hash Chain Active (SHA-256)"}
                    </Text>
                    <Text sx={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                      Every mutation in this digital thread is anchored in a 256-bit cryptographic Merkle chain in
                      compliance with ISO 26262 Part 8 and DO-178C qualification standards.
                    </Text>
                  </div>
                </Box>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                    background: "var(--color-canvas-subtle)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <thead>
                    <tr style={{ background: "rgba(110, 118, 129, 0.15)", textAlign: "left" }}>
                      <th style={{ padding: "8px 12px" }}>Timestamp</th>
                      <th style={{ padding: "8px 12px" }}>Action</th>
                      <th style={{ padding: "8px 12px" }}>Actor</th>
                      <th style={{ padding: "8px 12px" }}>Standard</th>
                      <th style={{ padding: "8px 12px" }}>SHA256 Checksum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                          {new Date(log.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <Label variant="secondary">{log.action}</Label>
                        </td>
                        <td style={{ padding: "8px 12px", fontWeight: 600 }}>{log.actor}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <Label variant="accent">{log.safety_standard || "ISO-26262"}</Label>
                        </td>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
                          {log.checksum.slice(0, 16)}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            )}
          </Box>
        </Dialog>
      )}

      {/* ── Review Comment Dialog ── */}
      {reviewDialogProposal && (
        <Dialog
          title={`Review Proposal: ${reviewDialogProposal.title}`}
          onClose={() => setReviewDialogProposal(null)}
          style={{ width: "90vw", maxWidth: 500 }}
        >
          <form onSubmit={handleReviewProposal} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Text sx={{ fontSize: 13 }}>
              Confirm setting proposal status to <strong>{reviewAction.toUpperCase()}</strong>:
            </Text>

            <FormControl>
              <FormControl.Label>Review Comment & Verification Notes</FormControl.Label>
              <Textarea
                block
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Add regulatory compliance notes (e.g. ISO 26262 Part 4 review completed)..."
              />
            </FormControl>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button variant="default" onClick={() => setReviewDialogProposal(null)}>
                Cancel
              </Button>
              <Button
                variant={reviewAction === "rejected" ? "danger" : "primary"}
                type="submit"
                disabled={isSubmittingReview}
              >
                {isSubmittingReview ? "Submitting..." : `Confirm ${reviewAction.toUpperCase()}`}
              </Button>
            </Box>
          </form>
        </Dialog>
      )}
    </ExplorerContainer>
  );
};

export default DigitalThreadExplorer;
