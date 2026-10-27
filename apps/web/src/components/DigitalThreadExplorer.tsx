// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  type DigitalThreadMetrics,
  type DigitalThreadTwin,
  type DomainType,
  computeDigitalThreadMetrics,
  extractDigitalThreadTwins,
} from "../util/digitalThread";
import { CreateSemanticLinkModal } from "./CreateSemanticLinkModal";
import CadStepViewer from "./artifacts/CadStepViewer";
import { DigitalThreadExplorerViewer } from "./artifacts/DigitalThreadExplorerViewer";
import {
  DigitalThreadControlsBar,
  DigitalThreadMetricsGrid,
  ExplorerContainer,
  ThreadGovernanceModal,
  ThreadProposalModal,
  ThreadReviewModal,
} from "./digital-thread";

export interface DigitalThreadExplorerProps {
  packageName: string;
  packageVersion?: string | undefined;
  version?: string | undefined;
  files?: (string | { path: string; type?: string | undefined; displayName?: string | undefined })[] | undefined;
  onNavigateToFile?: ((filePath: string) => void) | undefined;
  classes?: ClassSummary[] | undefined;
  rootClass?: ClassDetail | null | undefined;
  artifactViewers?: ArtifactViewerInfo[] | undefined;
  onNavigateToArtifact?: ((artifactPath: string) => void) | undefined;
  onNavigateToClass?: ((className: string) => void) | undefined;
}

export type { DigitalThreadMetrics, DigitalThreadTwin, DomainType };

export const DigitalThreadExplorer: React.FC<DigitalThreadExplorerProps> = ({
  packageName,
  packageVersion,
  version,
  files = [],
  onNavigateToFile,
  classes = [],
  rootClass = null,
  artifactViewers = [],
  onNavigateToArtifact,
  onNavigateToClass,
}) => {
  const navigate = useNavigate();
  const resolvedVersion = packageVersion ?? version ?? "1.0.0";

  const resolvedArtifactViewers = useMemo<ArtifactViewerInfo[]>(() => {
    if (artifactViewers.length > 0) return artifactViewers;
    if (!files || files.length === 0) return [];
    return files.map((f, idx) => {
      const filePath = typeof f === "string" ? f : f.path;
      const ext = filePath.split(".").pop()?.toLowerCase() || "";
      const fileType =
        typeof f === "object" && f.type
          ? f.type
          : ext === "step" || ext === "stp"
            ? "cad"
            : ext === "sysml" || ext === "kerml"
              ? "sysml2"
              : ext === "csv"
                ? "dataset"
                : "artifact";
      return {
        id: idx + 1,
        path: filePath,
        type: fileType,
        displayName: (typeof f === "object" && f.displayName) || filePath.split("/").pop() || filePath,
      } as ArtifactViewerInfo;
    });
  }, [artifactViewers, files]);

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

    if (typeof EventSource !== "undefined") {
      try {
        evtSource = new EventSource("/api/v1/threads/stream");
        evtSource.addEventListener("init", () => {
          if (active) setLiveStreamConnected(true);
        });
        evtSource.addEventListener("thread_updated", (e) => {
          if (!active) return;
          try {
            const payload = JSON.parse((e as MessageEvent).data);
            if (payload.status === "resolved") {
              setCustomTwins((prev) =>
                prev.map((t) =>
                  t.id === payload.conflictId ||
                  t.source.name === payload.conflictId ||
                  t.target.name === payload.conflictId
                    ? {
                        ...t,
                        parity: {
                          ...t.parity,
                          status: "compatible",
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
            const payload = JSON.parse((e as MessageEvent).data);
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
            const payload = JSON.parse((e as MessageEvent).data);
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
    void loadGovernanceData();
  }, []);

  const handleCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposalTargetTwin || !propTitle.trim()) return;

    setIsSubmittingProposal(true);
    try {
      const newProp = await createThreadProposal({
        threadId: proposalTargetTwin.id,
        title: propTitle.trim(),
        ...(propDesc.trim() ? { description: propDesc.trim() } : {}),
        safetyStandard: propSafetyStandard,
        diffSummary: {
          twinName: `${proposalTargetTwin.source.name} ↔ ${proposalTargetTwin.target.name}`,
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
        ...(reviewComment.trim() ? { comment: reviewComment.trim() } : {}),
        safetyStandard: "ISO-26262",
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setReviewDialogProposal(null);
      setReviewComment("");
      void loadGovernanceData();
    } catch (err) {
      console.error("Failed to review proposal:", err);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Synthesize digital thread twins
  const synthesizedTwins = useMemo(() => {
    return extractDigitalThreadTwins(packageName, resolvedVersion, classes, rootClass, resolvedArtifactViewers);
  }, [packageName, resolvedVersion, classes, rootClass, resolvedArtifactViewers]);

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
      navigate(`/packages/${packageName}/${resolvedVersion}/classes/${className}`);
    }
  };

  const handleJumpToArtifact = (artifactPath: string) => {
    if (onNavigateToArtifact) {
      onNavigateToArtifact(artifactPath);
    } else if (onNavigateToFile) {
      onNavigateToFile(artifactPath);
    }
  };

  return (
    <ExplorerContainer>
      {/* ── Summary Metrics Grid ── */}
      <DigitalThreadMetricsGrid metrics={metrics} />

      {/* ── Filter Controls & Search ── */}
      <DigitalThreadControlsBar
        domainFilter={domainFilter}
        onDomainFilterChange={setDomainFilter}
        twinsCount={twins.length}
        liveStreamConnected={liveStreamConnected}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        onOpenGovernance={() => {
          setIsGovernanceOpen(true);
          void loadGovernanceData();
        }}
        openProposalsCount={proposals.filter((p) => p.status === "open").length}
        parityFilter={parityFilter}
        onParityFilterChange={setParityFilter}
        compatibleCount={compatibleCount}
        incompatibleCount={twins.length - compatibleCount}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      {/* ── Unified Twin Cards & Hypergraph View via DigitalThreadExplorerViewer ── */}
      <DigitalThreadExplorerViewer
        twins={filteredTwins}
        onJumpToClass={handleJumpToClass}
        onJumpToArtifact={handleJumpToArtifact}
        onLaunchCad={handleLaunchCad}
        onNodeSelected={(node) => {
          if (node.uri) {
            handleJumpToArtifact(node.uri);
          } else if (node.domain === "modelica") {
            handleJumpToClass(node.name);
          }
        }}
        onProposeResolution={(targetTwin) => {
          const parityExtra = targetTwin.parity as DigitalThreadTwin["parity"] & {
            deviationPercent?: number | undefined;
            sourceValue?: string | number | undefined;
          };
          setProposalTargetTwin(targetTwin);
          setPropTitle(`Reconcile ${targetTwin.source.name} ↔ ${targetTwin.target.name}`);
          setPropDesc(
            `Proposal to reconcile parameters between ${targetTwin.source.domain} and ${targetTwin.target.domain}. Current deviation: ${parityExtra.deviationPercent ?? 0}%.`,
          );
          setPropValue(String(parityExtra.sourceValue ?? ""));
          setIsProposeModalOpen(true);
        }}
      />

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
        packageVersion={resolvedVersion}
        classes={classes}
        rootClass={rootClass}
        artifactViewers={resolvedArtifactViewers}
      />

      {/* ── Propose Digital Twin Resolution (Merge Request) Modal ── */}
      <ThreadProposalModal
        isOpen={isProposeModalOpen}
        onClose={() => {
          setIsProposeModalOpen(false);
          setProposalTargetTwin(null);
        }}
        twin={proposalTargetTwin}
        title={propTitle}
        onTitleChange={setPropTitle}
        description={propDesc}
        onDescriptionChange={setPropDesc}
        safetyStandard={propSafetyStandard}
        onSafetyStandardChange={setPropSafetyStandard}
        value={propValue}
        onValueChange={setPropValue}
        isSubmitting={isSubmittingProposal}
        onSubmit={handleCreateProposal}
      />

      {/* ── Governance & Regulatory Audit Trail Modal ── */}
      <ThreadGovernanceModal
        isOpen={isGovernanceOpen}
        onClose={() => setIsGovernanceOpen(false)}
        governanceTab={governanceTab}
        onTabChange={setGovernanceTab}
        proposals={proposals}
        auditLogs={auditLogs}
        auditVerification={auditVerification}
        isLoadingGovernance={isLoadingGovernance}
        onRefresh={loadGovernanceData}
        onOpenReview={(prop, action, comment) => {
          setReviewDialogProposal(prop);
          setReviewAction(action);
          setReviewComment(comment);
        }}
      />

      {/* ── Review Comment Dialog ── */}
      <ThreadReviewModal
        proposal={reviewDialogProposal}
        action={reviewAction}
        comment={reviewComment}
        onCommentChange={setReviewComment}
        onClose={() => setReviewDialogProposal(null)}
        isSubmitting={isSubmittingReview}
        onSubmit={handleReviewProposal}
      />
    </ExplorerContainer>
  );
};

export default DigitalThreadExplorer;
