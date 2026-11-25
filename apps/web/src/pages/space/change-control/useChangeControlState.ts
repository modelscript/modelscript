// SPDX-License-Identifier: AGPL-3.0-or-later

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSpaceEco,
  getSpaceEcoBlastRadius,
  getSpaceEcoBom,
  getSpaceEcoDiff,
  getSpaceEcoSimulation,
  mergeSpaceEco,
  reviewSpaceEco,
  simulateSpaceEco,
  type SpaceEcoBomResult,
  type SpaceEcoDiffResult,
  type SpaceEcoImpactResult,
  type SpaceEcoMergeResult,
  type SpaceEcoSimulationResult,
} from "../../../api";
import { useToast } from "../../../components/ToastContext";
import { getApiErrorMessage } from "../../../util/error";
import type { SemanticDiffItem } from "../../../util/semantic-diff-engine";
import type {
  ChangeControlViewMode,
  DiffStudioMode,
  EcoMetricsSummary,
  EcoSeverity,
  EcoStatusFilter,
  SigningDecision,
  SpaceChangeControlTabProps,
  TimelineComment,
} from "./types";

export function useChangeControlState({
  detail,
  viewerState,
  user,
  onEcoCreated,
  onEcoReviewed,
}: SpaceChangeControlTabProps) {
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const ownerNamespace = detail.space.owner_namespace;
  const spaceSlug = detail.space.slug;

  // ── Navigation & View Mode State ──────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ChangeControlViewMode>("list");
  const [selectedEcoId, setSelectedEcoId] = useState<string | null>(null);

  // Search & Filter state
  const [ecoSearchQuery, setEcoSearchQuery] = useState("");
  const [ecoStatusFilter, setEcoStatusFilter] = useState<EcoStatusFilter>("all");
  const [ecoSeverityFilter, setEcoSeverityFilter] = useState<string>("all");
  const [ecoGateFilter, setEcoGateFilter] = useState<string>("all");

  // Section highlight / jump link state
  const [activeSection, setActiveSection] = useState<string>("rationale");

  // Phase 2: Diff state
  const [diffResult, setDiffResult] = useState<SpaceEcoDiffResult | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [selectedDiffFileIndex, setSelectedDiffFileIndex] = useState(0);
  const [diffSideBySide, setDiffSideBySide] = useState(true);
  const [diffStudioMode, setDiffStudioMode] = useState<DiffStudioMode>("studio");
  const [focusedSemanticEdit, setFocusedSemanticEdit] = useState<SemanticDiffItem | null>(null);

  // Phase 2: Simulation state
  const [simResult, setSimResult] = useState<SpaceEcoSimulationResult | null>(null);
  const [loadingSim, setLoadingSim] = useState(false);
  const [reverifyingSim, setReverifyingSim] = useState(false);

  // Phase 2: Blast radius / Impact state
  const [impactResult, setImpactResult] = useState<SpaceEcoImpactResult | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  // Phase 3: Declarative BOM Redline state
  const [bomResult, setBomResult] = useState<SpaceEcoBomResult | null>(null);
  const [loadingBom, setLoadingBom] = useState(false);

  // Discussion & Comments state
  const [commentInput, setCommentInput] = useState("");
  const [timelineComments, setTimelineComments] = useState<TimelineComment[]>([]);

  // Phase 3: 21 CFR Part 11 Electronic Signature Modal state
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signingDecision, setSigningDecision] = useState<SigningDecision>("approved");
  const [signingRole, setSigningRole] = useState(
    viewerState.role === "lead_engineer"
      ? "Lead Systems Architect"
      : viewerState.role === "approver"
        ? "Chief Engineer / Release Authority"
        : "Lead Systems Architect",
  );
  const [signingIntent, setSigningIntent] = useState(
    "I verify that simulation results satisfy ISO 26262 ASIL-D safety margins.",
  );
  const [signingPassword, setSigningPassword] = useState("");
  const [signingComment, setSigningComment] = useState("");
  const [submittingSignature, setSubmittingSignature] = useState(false);

  // Phase 3: Merge Release state
  const [mergingEco, setMergingEco] = useState(false);
  const [mergeResult, setMergeResult] = useState<SpaceEcoMergeResult | null>(null);

  // Form state for proposing new Change Request (ECO)
  const [showNewEcoForm, setShowNewEcoForm] = useState(false);
  const [newEcoTitle, setNewEcoTitle] = useState("");
  const [newEcoDesc, setNewEcoDesc] = useState("");
  const [newEcoSeverity, setNewEcoSeverity] = useState<EcoSeverity>("standard");
  const [newEcoModels, setNewEcoModels] = useState("docs/overview.md");
  const [newEcoSourceBranch, setNewEcoSourceBranch] = useState("");
  const [newEcoTargetBranch, setNewEcoTargetBranch] = useState("main");

  // Metrics calculations
  const ecos = detail?.ecos;
  const metrics = useMemo<EcoMetricsSummary>(() => {
    const list = ecos || [];
    const totalEcos = list.length;
    const openEcos = list.filter((e) => e.status === "open").length;
    const approvedEcos = list.filter((e) => e.status === "approved" || e.status === "merged").length;
    const passedGates = list.filter((e) => e.simulation_gate_status === "passed").length;
    const gatePassRate = totalEcos > 0 ? Math.round((passedGates / totalEcos) * 100) : 100;
    const totalApprovals = list.reduce((acc, e) => acc + (e.approvals?.length || 0), 0);
    return { totalEcos, openEcos, approvedEcos, passedGates, gatePassRate, totalApprovals };
  }, [ecos]);

  // Filtered Change Requests list
  const filteredEcos = useMemo(() => {
    return (ecos || []).filter((eco) => {
      if (ecoStatusFilter === "open" && eco.status !== "open") return false;
      if (ecoStatusFilter === "in_review" && eco.status !== "in_review") return false;
      if (ecoStatusFilter === "approved" && eco.status !== "approved" && eco.status !== "merged") return false;
      if (ecoSeverityFilter !== "all" && eco.severity !== ecoSeverityFilter) return false;
      if (ecoGateFilter !== "all" && eco.simulation_gate_status !== ecoGateFilter) return false;
      if (ecoSearchQuery.trim()) {
        const q = ecoSearchQuery.toLowerCase().trim();
        const matchTitle = eco.title.toLowerCase().includes(q);
        const matchDesc = eco.description.toLowerCase().includes(q);
        const matchNumber =
          `eco-${eco.eco_number}`.toLowerCase().includes(q) || `${eco.eco_number}` === q || `#${eco.eco_number}` === q;
        const matchBranch = eco.source_branch.toLowerCase().includes(q) || eco.target_branch.toLowerCase().includes(q);
        const matchModels = eco.impacted_models.some((m) => m.toLowerCase().includes(q));
        const matchAuthor = (eco.author_username || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchNumber && !matchBranch && !matchModels && !matchAuthor) {
          return false;
        }
      }
      return true;
    });
  }, [ecos, ecoStatusFilter, ecoSeverityFilter, ecoGateFilter, ecoSearchQuery]);

  // Active Change Request resolution
  const activeEco = useMemo(() => {
    if (selectedEcoId) {
      const found = (ecos || []).find((e) => e.id === selectedEcoId);
      if (found) return found;
    }
    return filteredEcos[0] || null;
  }, [ecos, filteredEcos, selectedEcoId]);

  const activeEcoId = activeEco?.id ?? null;

  // Deep-linking: auto-select Change Request from URL search params (?id=eco-3, ?eco=eco-3, ?cr=3)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const targetParam = params.get("id") || params.get("eco") || params.get("cr");
      if (targetParam && detail?.ecos) {
        const found = detail.ecos.find(
          (e) => e.id === targetParam || `eco-${e.eco_number}` === targetParam || `${e.eco_number}` === targetParam,
        );
        if (found) {
          setSelectedEcoId(found.id);
          setViewMode("detail");
        }
      }
    } catch (err: unknown) {
      console.debug("Deep-link ECO search param parsing skipped:", err);
    }
  }, [detail?.ecos]);

  // Select a Change Request and switch to Detail View
  const handleSelectEco = useCallback((ecoId: string) => {
    setSelectedEcoId(ecoId);
    setViewMode("detail");
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("id", ecoId);
      window.history.replaceState({}, "", url.toString());
    } catch (err: unknown) {
      console.debug("Unable to update URL search params for selected ECO:", err);
    }
  }, []);

  // Back to Change Requests List
  const handleBackToList = useCallback(() => {
    setViewMode("list");
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("id");
      url.searchParams.delete("eco");
      url.searchParams.delete("cr");
      window.history.replaceState({}, "", url.toString());
    } catch (err: unknown) {
      console.debug("Unable to clear URL search params on list return:", err);
    }
  }, []);

  // Jump to specific stacked box
  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // ── Parallel Data Loading for All Stacked Boxes ──
  // Load Diff when activeEco changes in detail mode
  useEffect(() => {
    if (viewMode !== "detail" || !activeEcoId) return;
    let isCancelled = false;
    setLoadingDiff(true);
    getSpaceEcoDiff(ownerNamespace, spaceSlug, activeEcoId)
      .then((res) => {
        if (!isCancelled) {
          setDiffResult(res);
          setSelectedDiffFileIndex(0);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          toastRef.current.error(getApiErrorMessage(err, "Failed to load model diff"));
        }
      })
      .finally(() => {
        if (!isCancelled) setLoadingDiff(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [viewMode, activeEcoId, ownerNamespace, spaceSlug]);

  // Load Simulation Trajectories when activeEco changes in detail mode
  useEffect(() => {
    if (viewMode !== "detail" || !activeEcoId) return;
    let isCancelled = false;
    setLoadingSim(true);
    getSpaceEcoSimulation(ownerNamespace, spaceSlug, activeEcoId)
      .then((res) => {
        if (!isCancelled) {
          setSimResult(res);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          toastRef.current.error(getApiErrorMessage(err, "Failed to load simulation trajectory"));
        }
      })
      .finally(() => {
        if (!isCancelled) setLoadingSim(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [viewMode, activeEcoId, ownerNamespace, spaceSlug]);

  // Load Blast Radius when activeEco changes in detail mode
  useEffect(() => {
    if (viewMode !== "detail" || !activeEcoId) return;
    let isCancelled = false;
    setLoadingImpact(true);
    getSpaceEcoBlastRadius(ownerNamespace, spaceSlug, activeEcoId)
      .then((res) => {
        if (!isCancelled) {
          setImpactResult(res);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          console.debug("Blast radius endpoint unavailable, falling back to defaults:", err);
        }
      })
      .finally(() => {
        if (!isCancelled) setLoadingImpact(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [viewMode, activeEcoId, ownerNamespace, spaceSlug]);

  // Load Declarative BOM Redline when activeEco changes in detail mode
  useEffect(() => {
    if (viewMode !== "detail" || !activeEcoId) return;
    let isCancelled = false;
    setLoadingBom(true);
    getSpaceEcoBom(ownerNamespace, spaceSlug, activeEcoId)
      .then((res) => {
        if (!isCancelled) {
          setBomResult(res);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          toastRef.current.error(getApiErrorMessage(err, "Failed to load BOM redline"));
        }
      })
      .finally(() => {
        if (!isCancelled) setLoadingBom(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [viewMode, activeEcoId, ownerNamespace, spaceSlug]);

  // Re-verify simulation gate on demand
  const handleReverifySimulation = useCallback(async () => {
    if (!activeEcoId) return;
    try {
      setReverifyingSim(true);
      const res = await simulateSpaceEco(ownerNamespace, spaceSlug, activeEcoId);
      setSimResult(res.simulation);
      onEcoReviewed?.(res.eco, res.ecos);
      toastRef.current.success(
        `Simulation Checks: PASSED (Max Rel Error: ${res.simulation.maxRelError.toFixed(5)} within ±5% tolerance)`,
      );
    } catch (err: unknown) {
      toastRef.current.error(getApiErrorMessage(err, "Simulation re-verification failed"));
    } finally {
      setReverifyingSim(false);
    }
  }, [activeEcoId, ownerNamespace, spaceSlug, onEcoReviewed]);

  const handleCreateEco = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!detail || !newEcoTitle.trim()) return;
      try {
        const res = await createSpaceEco(ownerNamespace, spaceSlug, {
          title: newEcoTitle.trim(),
          description: newEcoDesc.trim(),
          severity: newEcoSeverity,
          sourceBranch: newEcoSourceBranch.trim() || undefined,
          targetBranch: newEcoTargetBranch.trim() || undefined,
          impactedModels: newEcoModels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        onEcoCreated?.(res.eco, res.ecos);
        setSelectedEcoId(res.eco.id);
        setViewMode("detail");
        setShowNewEcoForm(false);
        setNewEcoTitle("");
        setNewEcoDesc("");
        setNewEcoSourceBranch("");
        setNewEcoTargetBranch("main");
        toastRef.current.success(`Created Change Request #${res.eco.eco_number} [ECO-${res.eco.eco_number}]`);
      } catch (err: unknown) {
        toastRef.current.error(getApiErrorMessage(err, "Failed to create Change Request"));
      }
    },
    [
      detail,
      newEcoTitle,
      newEcoDesc,
      newEcoSeverity,
      newEcoSourceBranch,
      newEcoTargetBranch,
      newEcoModels,
      ownerNamespace,
      spaceSlug,
      onEcoCreated,
    ],
  );

  const handleOpenSignatureModal = useCallback((decision: SigningDecision) => {
    setSigningDecision(decision);
    setShowSignatureModal(true);
  }, []);

  const handleExecuteSignature = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!detail || !activeEcoId) return;
      try {
        setSubmittingSignature(true);
        const res = await reviewSpaceEco(ownerNamespace, spaceSlug, activeEcoId, {
          decision: signingDecision,
          role: signingRole,
          intent: signingIntent,
          password: signingPassword.trim() || undefined,
          comment: signingComment.trim() || undefined,
        });
        onEcoReviewed?.(res.eco, res.ecos);
        setShowSignatureModal(false);
        setSigningPassword("");
        setSigningComment("");
        toastRef.current.success(
          `Recorded 21 CFR Part 11 ${signingDecision.toUpperCase()} signature (${signingRole}) on Change Request #${res.eco.eco_number}`,
        );
      } catch (err: unknown) {
        toastRef.current.error(getApiErrorMessage(err, "Failed to record electronic signature"));
      } finally {
        setSubmittingSignature(false);
      }
    },
    [
      detail,
      activeEcoId,
      ownerNamespace,
      spaceSlug,
      signingDecision,
      signingRole,
      signingIntent,
      signingPassword,
      signingComment,
      onEcoReviewed,
    ],
  );

  const handleMergeEco = useCallback(async () => {
    if (!activeEcoId || !detail) return;
    try {
      setMergingEco(true);
      const res = await mergeSpaceEco(ownerNamespace, spaceSlug, activeEcoId);
      setMergeResult(res);
      onEcoReviewed?.(res.eco, res.ecos);
      toastRef.current.success(`🎉 Merged Change Request #${res.eco.eco_number}! Tagged release ${res.releaseTag}`);
    } catch (err: unknown) {
      toastRef.current.error(getApiErrorMessage(err, "Failed to merge Change Request"));
    } finally {
      setMergingEco(false);
    }
  }, [activeEcoId, detail, ownerNamespace, spaceSlug, onEcoReviewed]);

  const handleAddComment = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!commentInput.trim()) return;
      const newComment: TimelineComment = {
        id: `c_${Date.now()}`,
        username: user?.username || "engineer",
        role: viewerState.role || "Reviewer",
        text: commentInput.trim(),
        createdAt: new Date().toISOString(),
      };
      setTimelineComments((prev) => [...prev, newComment]);
      setCommentInput("");
      toastRef.current.success("Added review note to discussion timeline");
    },
    [commentInput, user?.username, viewerState.role],
  );

  const activeDiffFile = diffResult?.files[selectedDiffFileIndex] || null;

  return {
    toast,
    viewMode,
    ecoSearchQuery,
    setEcoSearchQuery,
    ecoStatusFilter,
    setEcoStatusFilter,
    ecoSeverityFilter,
    setEcoSeverityFilter,
    ecoGateFilter,
    setEcoGateFilter,
    activeSection,
    scrollToSection,
    diffResult,
    setDiffResult,
    loadingDiff,
    selectedDiffFileIndex,
    setSelectedDiffFileIndex,
    diffSideBySide,
    setDiffSideBySide,
    diffStudioMode,
    setDiffStudioMode,
    focusedSemanticEdit,
    setFocusedSemanticEdit,
    activeDiffFile,
    simResult,
    loadingSim,
    reverifyingSim,
    impactResult,
    loadingImpact,
    bomResult,
    loadingBom,
    commentInput,
    setCommentInput,
    timelineComments,
    showSignatureModal,
    setShowSignatureModal,
    signingDecision,
    setSigningDecision,
    signingRole,
    setSigningRole,
    signingIntent,
    setSigningIntent,
    signingPassword,
    setSigningPassword,
    signingComment,
    setSigningComment,
    submittingSignature,
    mergingEco,
    mergeResult,
    showNewEcoForm,
    setShowNewEcoForm,
    newEcoTitle,
    setNewEcoTitle,
    newEcoDesc,
    setNewEcoDesc,
    newEcoSeverity,
    setNewEcoSeverity,
    newEcoModels,
    setNewEcoModels,
    newEcoSourceBranch,
    setNewEcoSourceBranch,
    newEcoTargetBranch,
    setNewEcoTargetBranch,
    metrics,
    filteredEcos,
    activeEco,
    handleSelectEco,
    handleBackToList,
    handleReverifySimulation,
    handleCreateEco,
    handleOpenSignatureModal,
    handleExecuteSignature,
    handleMergeEco,
    handleAddComment,
  };
}
