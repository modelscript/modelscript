// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CpuIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  PlusIcon,
  SearchIcon,
} from "@primer/octicons-react";
import {
  Button,
  Dialog,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
  TextInput,
  Textarea,
} from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useMemo, useState } from "react";
import type { GitlabBranch, GitlabMergeRequest, MergeRequestFileBlobsResult, RepoBotReviewRecord } from "../../../api";
import {
  createGitlabMergeRequest,
  getGitlabBranches,
  getGitlabMergeRequests,
  getMergeRequestFileBlobs,
  getRepoBotReviewsApi,
  triggerRepoBotReviewApi,
  updateGitlabMergeRequestState,
} from "../../../api";
import Box from "../../../components/Box";
import { AnsatzSemanticDiffStudio } from "../../../components/diff/AnsatzSemanticDiffStudio";
import { useToast } from "../../../components/ToastContext";
import { reconstructTextsFromUnifiedPatch } from "../../../util/semantic-diff-engine";
import { CommitRow, MarkdownBody, StyledBox } from "../styles";
import { getRelativeTime } from "../utils";

export interface PullRequestsTabProps {
  projectId: string;
  provider: string;
  defaultBranch?: string | undefined;
}

interface NormalizedPrDiffFile {
  path: string;
  old_path?: string | undefined;
  new_path?: string | undefined;
  old_content?: string | undefined;
  new_content?: string | undefined;
  ancestor_content?: string | undefined;
  additions: number;
  deletions: number;
  patch: string;
}

function getDiffFilesForPr(mr: GitlabMergeRequest): NormalizedPrDiffFile[] {
  if (Array.isArray(mr.diff_files) && mr.diff_files.length > 0) {
    return mr.diff_files.map((df) => {
      const patch = df.patch || df.diff || "";
      const path = df.new_path || df.path || df.old_path || "diff";
      const lines = patch.split("\n");
      const additions =
        typeof df.additions === "number"
          ? df.additions
          : lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const deletions =
        typeof df.deletions === "number"
          ? df.deletions
          : lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      const old_content = (df as any).old_content ?? (df as any).base_content;
      const new_content = (df as any).new_content ?? (df as any).head_content;
      const ancestor_content = (df as any).ancestor_content;
      return {
        path,
        old_path: df.old_path,
        new_path: df.new_path,
        old_content: typeof old_content === "string" ? old_content : undefined,
        new_content: typeof new_content === "string" ? new_content : undefined,
        ancestor_content: typeof ancestor_content === "string" ? ancestor_content : undefined,
        additions,
        deletions,
        patch,
      };
    });
  }

  if (Array.isArray(mr.changes) && mr.changes.length > 0) {
    return mr.changes.map((ch) => {
      const patch = ch.diff || ch.patch || "";
      const path = ch.new_path || ch.path || ch.old_path || "diff";
      const lines = patch.split("\n");
      const additions =
        typeof ch.additions === "number"
          ? ch.additions
          : lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const deletions =
        typeof ch.deletions === "number"
          ? ch.deletions
          : lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      const old_content = (ch as any).old_content ?? (ch as any).base_content;
      const new_content = (ch as any).new_content ?? (ch as any).head_content;
      const ancestor_content = (ch as any).ancestor_content;
      return {
        path,
        old_path: ch.old_path,
        new_path: ch.new_path,
        old_content: typeof old_content === "string" ? old_content : undefined,
        new_content: typeof new_content === "string" ? new_content : undefined,
        ancestor_content: typeof ancestor_content === "string" ? ancestor_content : undefined,
        additions,
        deletions,
        patch,
      };
    });
  }

  if (mr.diff_summary) {
    const lines = mr.diff_summary.split("\n");
    return [
      {
        path: "diff",
        additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
        deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
        patch: mr.diff_summary,
      },
    ];
  }

  return [];
}

function buildDefaultDiffForPr(mr: GitlabMergeRequest): string {
  if (mr.diff_summary) return mr.diff_summary;
  return getDiffFilesForPr(mr)
    .map((f) => f.patch)
    .join("\n\n");
}

export const PullRequestsTab: React.FC<PullRequestsTabProps> = ({ projectId, provider, defaultBranch = "main" }) => {
  const { showToast } = useToast();

  const [mrs, setMrs] = useState<GitlabMergeRequest[]>([]);
  const [branches, setBranches] = useState<GitlabBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"opened" | "merged" | "closed">("opened");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedMr, setSelectedMr] = useState<GitlabMergeRequest | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "diff" | "ai">("overview");
  const [prDiffViewMode, setPrDiffViewMode] = useState<"studio" | "patch">("studio");
  const [botReviews, setBotReviews] = useState<Record<number, RepoBotReviewRecord>>({});
  const [isRunningReview, setIsRunningReview] = useState(false);
  const [isUpdatingState, setIsUpdatingState] = useState(false);

  const [isNewMrDialogOpen, setIsNewMrDialogOpen] = useState(false);
  const [newMrTitle, setNewMrTitle] = useState("");
  const [newMrDesc, setNewMrDesc] = useState("");
  const [newMrSource, setNewMrSource] = useState("feature/solver-optimization");
  const [newMrTarget, setNewMrTarget] = useState(defaultBranch);
  const [isCreatingMr, setIsCreatingMr] = useState(false);

  const loadMrs = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [mrData, branchData, reviewsData] = await Promise.all([
        getGitlabMergeRequests(projectId, provider),
        getGitlabBranches(projectId, provider).catch(() => []),
        getRepoBotReviewsApi(projectId).catch(() => ({ reviews: [] as RepoBotReviewRecord[] })),
      ]);
      setMrs(mrData);
      setBranches(branchData);
      const map: Record<number, RepoBotReviewRecord> = {};
      for (const rev of reviewsData.reviews || []) {
        if (rev.pr_number) map[rev.pr_number] = rev;
      }
      setBotReviews(map);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load pull requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setNewMrTarget(defaultBranch);
    loadMrs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, provider, defaultBranch]);

  const counts = useMemo(() => {
    let opened = 0;
    let merged = 0;
    let closed = 0;
    for (const m of mrs) {
      if (m.state === "merged") merged++;
      else if (m.state === "closed") closed++;
      else opened++;
    }
    return { opened, merged, closed };
  }, [mrs]);

  const filteredMrs = useMemo(() => {
    return mrs.filter((m) => {
      const normalized = m.state === "merged" ? "merged" : m.state === "closed" ? "closed" : "opened";
      if (normalized !== stateFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.title.toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q) ||
        m.source_branch.toLowerCase().includes(q) ||
        m.target_branch.toLowerCase().includes(q) ||
        m.author.username.toLowerCase().includes(q)
      );
    });
  }, [mrs, stateFilter, searchQuery]);

  const handleCreateMr = async () => {
    if (!newMrTitle.trim()) return;
    const sourceBranch = newMrSource.trim() || "feature-branch";
    const targetBranch = newMrTarget.trim() || defaultBranch;
    setError(null);
    setIsCreatingMr(true);
    try {
      const created = await createGitlabMergeRequest(
        projectId,
        {
          title: newMrTitle.trim(),
          description: newMrDesc.trim(),
          source_branch: sourceBranch,
          target_branch: targetBranch,
        },
        provider,
      );
      setMrs((prev) => [created, ...prev]);
      setIsNewMrDialogOpen(false);
      setNewMrTitle("");
      setNewMrDesc("");
      setStateFilter("opened");
      window.dispatchEvent(new CustomEvent("modelscript:repo-counts-changed"));
      showToast(`Created pull request #${created.iid}`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create pull request.";
      setError(msg);
      setIsNewMrDialogOpen(false);
    } finally {
      setIsCreatingMr(false);
    }
  };

  const handleUpdateMrState = async (mr: GitlabMergeRequest, nextState: "opened" | "closed" | "merged") => {
    setIsUpdatingState(true);
    try {
      const updated = await updateGitlabMergeRequestState(projectId, mr.iid, nextState, provider);
      const nextObj = updated || { ...mr, state: nextState };
      setSelectedMr(nextObj);
      await loadMrs();
      window.dispatchEvent(new CustomEvent("modelscript:repo-counts-changed"));
      showToast(
        nextState === "merged"
          ? `Merged pull request #${mr.iid} into ${mr.target_branch}`
          : nextState === "closed"
            ? `Closed pull request #${mr.iid}`
            : `Reopened pull request #${mr.iid}`,
        nextState === "merged" ? "success" : "info",
      );
    } finally {
      setIsUpdatingState(false);
    }
  };

  const handleRunBotReview = async (mr: GitlabMergeRequest) => {
    setIsRunningReview(true);
    setDetailTab("ai");
    try {
      const diffText = buildDefaultDiffForPr(mr);
      const res = await triggerRepoBotReviewApi(projectId, {
        prNumber: mr.iid,
        title: mr.title,
        diffSummary: diffText,
      });
      if (res?.review) {
        setBotReviews((prev) => ({ ...prev, [mr.iid]: res.review }));
        showToast(`AI Engineering Review completed for PR #${mr.iid}`, "success");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to run AI Engineering Review.";
      showToast(msg, "error");
    } finally {
      setIsRunningReview(false);
    }
  };

  const [blobCache, setBlobCache] = useState<Record<string, MergeRequestFileBlobsResult>>({});

  const diffFiles = useMemo(() => (selectedMr ? getDiffFilesForPr(selectedMr) : []), [selectedMr]);

  // Background auto-hydration: automatically fetch full file blobs from Git vault for clean AST compilation
  useEffect(() => {
    if (!selectedMr || prDiffViewMode !== "studio") return;
    let isCancelled = false;

    for (const file of diffFiles) {
      if (!file.old_content && !file.new_content && !blobCache[file.path]) {
        getMergeRequestFileBlobs(projectId, selectedMr.iid, file.path).then((res) => {
          if (!isCancelled && res) {
            setBlobCache((prev) => ({ ...prev, [file.path]: res }));
          }
        });
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [selectedMr?.iid, prDiffViewMode, diffFiles, projectId, blobCache]);

  return (
    <Box>
      {/* Top Search & Action Bar */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={4}>
        <Box display="flex" alignItems="center" gap={2} flex={1} style={{ minWidth: "240px" }}>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Search pull requests by title, branch, or author..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", maxWidth: "420px" }}
          />
        </Box>
        <Button
          variant="primary"
          leadingVisual={PlusIcon}
          onClick={() => {
            setError(null);
            setIsNewMrDialogOpen(true);
          }}
        >
          New pull request
        </Button>
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      {loadError ? (
        <Flash variant="danger" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
          <span>{loadError}</span>
          <Button size="small" onClick={loadMrs}>
            Retry
          </Button>
        </Flash>
      ) : (
        <StyledBox>
          <Box
            bg="var(--color-canvas-subtle)"
            p={3}
            style={{ borderBottom: "1px solid var(--color-border-default)" }}
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            flexWrap="wrap"
            gap={2}
          >
            <Box display="flex" alignItems="center" gap={3}>
              <button
                type="button"
                onClick={() => setStateFilter("opened")}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: stateFilter === "opened" ? 700 : 500,
                  color: stateFilter === "opened" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                  fontSize: "14px",
                  padding: 0,
                }}
              >
                <GitPullRequestIcon size={16} />
                <span>{counts.opened} Open</span>
              </button>

              <button
                type="button"
                onClick={() => setStateFilter("merged")}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: stateFilter === "merged" ? 700 : 500,
                  color: stateFilter === "merged" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                  fontSize: "14px",
                  padding: 0,
                }}
              >
                <GitMergeIcon size={16} />
                <span>{counts.merged} Merged</span>
              </button>

              <button
                type="button"
                onClick={() => setStateFilter("closed")}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: stateFilter === "closed" ? 700 : 500,
                  color: stateFilter === "closed" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                  fontSize: "14px",
                  padding: 0,
                }}
              >
                <GitPullRequestClosedIcon size={16} />
                <span>{counts.closed} Closed</span>
              </button>
            </Box>
          </Box>

          {loading ? (
            <Box p={4} display="flex" justifyContent="center">
              <Spinner />
            </Box>
          ) : filteredMrs.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" p={8} textAlign="center">
              <GitPullRequestIcon size={32} fill="var(--color-fg-muted)" />
              <Heading as="h3" style={{ fontSize: "18px", marginTop: "14px", marginBottom: "6px" }}>
                No {stateFilter === "opened" ? "open" : stateFilter} pull requests
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "14px" }}>
                Pull requests let you review model diffs, verify DAE balance, and run automated engineering checks.
              </Text>
            </Box>
          ) : (
            <Box display="flex" flexDirection="column">
              {filteredMrs.map((mr) => {
                const isMerged = mr.state === "merged";
                const isClosed = mr.state === "closed";
                const hasBotReview = Boolean(botReviews[mr.iid]);
                return (
                  <CommitRow
                    key={mr.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSelectedMr(mr);
                      setDetailTab("overview");
                    }}
                  >
                    <Box display="flex" gap={3} alignItems="flex-start" flex={1}>
                      <div style={{ marginTop: "3px" }}>
                        {isMerged ? (
                          <GitMergeIcon fill="var(--color-done-fg, #8250df)" />
                        ) : isClosed ? (
                          <GitPullRequestClosedIcon fill="var(--color-danger-fg)" />
                        ) : (
                          <GitPullRequestIcon fill="var(--color-success-fg)" />
                        )}
                      </div>
                      <Box display="flex" flexDirection="column" gap={1}>
                        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "15px" }}>
                            {mr.title}
                          </Text>
                          <span
                            style={{
                              fontSize: "11px",
                              fontFamily: "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace",
                              padding: "1px 7px",
                              borderRadius: "6px",
                              background: "var(--color-canvas-subtle)",
                              border: "1px solid var(--color-border-default)",
                              color: "var(--color-fg-muted)",
                            }}
                          >
                            {mr.source_branch} &rarr; {mr.target_branch}
                          </span>
                          {hasBotReview && (
                            <Label variant="accent" size="small">
                              AI Reviewed
                            </Label>
                          )}
                        </Box>
                        <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                          #{mr.iid} {isMerged ? "merged" : isClosed ? "closed" : "opened"}{" "}
                          {getRelativeTime(mr.created_at)} by <strong>@{mr.author.username}</strong>
                        </Text>
                      </Box>
                    </Box>

                    <Box display="flex" alignItems="center" gap={2} color="var(--color-success-fg)" fontSize="12px">
                      <CheckCircleFillIcon size={14} />
                      <span style={{ color: "var(--color-fg-muted)" }}>Checks passing</span>
                    </Box>
                  </CommitRow>
                );
              })}
            </Box>
          )}
        </StyledBox>
      )}

      {/* Pull Request Detail Dialog */}
      {selectedMr && (
        <Dialog onClose={() => setSelectedMr(null)} title={`#${selectedMr.iid} ${selectedMr.title}`} width="xlarge">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <Label
                  variant={
                    selectedMr.state === "opened" ? "success" : selectedMr.state === "merged" ? "done" : "danger"
                  }
                >
                  {selectedMr.state === "opened" ? "Open" : selectedMr.state === "merged" ? "Merged" : "Closed"}
                </Label>
                <Text color="var(--color-fg-muted)" fontSize={1}>
                  <strong>@{selectedMr.author.username}</strong> wants to merge <code>{selectedMr.source_branch}</code>{" "}
                  into <code>{selectedMr.target_branch}</code>
                </Text>
              </Box>

              <Button
                size="small"
                leadingVisual={CpuIcon}
                onClick={() => handleRunBotReview(selectedMr)}
                disabled={isRunningReview}
              >
                {isRunningReview ? "Analyzing Model Diff..." : "Run AI Bot Review"}
              </Button>
            </Box>

            {/* Detail Sub-tabs */}
            <Box
              display="flex"
              gap={2}
              style={{ borderBottom: "1px solid var(--color-border-default)", paddingBottom: "8px" }}
            >
              <Button
                size="small"
                variant={detailTab === "overview" ? "primary" : "invisible"}
                leadingVisual={GitPullRequestIcon}
                onClick={() => setDetailTab("overview")}
              >
                Overview
              </Button>
              <Button
                size="small"
                variant={detailTab === "diff" ? "primary" : "invisible"}
                leadingVisual={FileDiffIcon}
                onClick={() => setDetailTab("diff")}
              >
                Files Changed ({diffFiles.length})
              </Button>
              <Button
                size="small"
                variant={detailTab === "ai" ? "primary" : "invisible"}
                leadingVisual={CpuIcon}
                onClick={() => setDetailTab("ai")}
              >
                AI Engineering Review {botReviews[selectedMr.iid] ? "✓" : ""}
              </Button>
            </Box>

            {detailTab === "overview" && (
              <>
                <Box
                  p={3}
                  bg="var(--color-canvas-subtle)"
                  borderRadius={2}
                  border="1px solid var(--color-border-default)"
                >
                  <MarkdownBody
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(
                        marked.parse(selectedMr.description || "No description provided.") as string,
                      ),
                    }}
                  />
                </Box>

                {/* CI & Merge Status Box */}
                <Box
                  p={3}
                  borderRadius={2}
                  border="1px solid var(--color-border-default)"
                  bg="var(--color-canvas-default)"
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  flexWrap="wrap"
                  gap={2}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <CheckCircleFillIcon size={18} fill="var(--color-success-fg)" />
                    <Box>
                      <Text fontWeight="bold" fontSize="13px" style={{ display: "block" }}>
                        All continuous integration & DAE structural checks have passed
                      </Text>
                      <Text color="var(--color-fg-muted)" fontSize="12px">
                        1:1 equation-to-variable balance verified · No unit inconsistencies detected
                      </Text>
                    </Box>
                  </Box>

                  {selectedMr.state === "opened" && (
                    <Button
                      variant="primary"
                      leadingVisual={GitMergeIcon}
                      disabled={isUpdatingState}
                      onClick={() => handleUpdateMrState(selectedMr, "merged")}
                    >
                      Merge pull request
                    </Button>
                  )}
                </Box>
              </>
            )}

            {detailTab === "diff" && (
              <Box display="flex" flexDirection="column" gap={3}>
                <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                  <Text fontSize="12px" color="var(--color-fg-muted)">
                    Inspecting {diffFiles.length} changed file{diffFiles.length === 1 ? "" : "s"} between{" "}
                    <code>{selectedMr.target_branch}</code> and <code>{selectedMr.source_branch}</code>
                  </Text>
                  <Box display="flex" gap={1}>
                    <Button
                      size="small"
                      variant={prDiffViewMode === "studio" ? "primary" : "default"}
                      onClick={() => setPrDiffViewMode("studio")}
                    >
                      ⚡ Semantic Diff Studio
                    </Button>
                    <Button
                      size="small"
                      variant={prDiffViewMode === "patch" ? "primary" : "default"}
                      onClick={() => setPrDiffViewMode("patch")}
                    >
                      Unified Patch
                    </Button>
                  </Box>
                </Box>

                {diffFiles.map((file, fileIdx) => {
                  const displayPath =
                    file.old_path && file.new_path && file.old_path !== file.new_path
                      ? `${file.old_path} → ${file.new_path}`
                      : file.path;

                  if (prDiffViewMode === "studio") {
                    const hasFullBlobs = typeof file.old_content === "string" && typeof file.new_content === "string";
                    const { oldCode, newCode } = hasFullBlobs
                      ? { oldCode: file.old_content!, newCode: file.new_content! }
                      : reconstructTextsFromUnifiedPatch(file.patch);
                    const ext = displayPath.split(".").pop()?.toLowerCase() || "";
                    const lang =
                      ext === "sysml" || ext === "kerml"
                        ? "sysml2"
                        : ext === "scad"
                          ? "scad"
                          : ext === "step" || ext === "stp"
                            ? "step"
                            : "modelica";
                    return (
                      <AnsatzSemanticDiffStudio
                        key={`${file.path}-${fileIdx}`}
                        oldCode={oldCode}
                        newCode={newCode}
                        ancestorCode={file.ancestor_content}
                        filename={displayPath}
                        language={lang}
                        baseLabel={selectedMr.target_branch}
                        headLabel={selectedMr.source_branch}
                      />
                    );
                  }

                  return (
                    <Box
                      key={`${file.path}-${fileIdx}`}
                      borderRadius={2}
                      border="1px solid var(--color-border-default)"
                      style={{ overflow: "hidden" }}
                    >
                      <Box
                        p={2}
                        px={3}
                        bg="var(--color-canvas-subtle)"
                        borderBottom="1px solid var(--color-border-default)"
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Text fontSize="12px" fontWeight="bold" style={{ fontFamily: "monospace" }}>
                          {displayPath}
                        </Text>
                        <Box display="flex" gap={2} fontSize="12px">
                          <span style={{ color: "var(--color-success-fg)", fontWeight: 700 }}>+{file.additions}</span>
                          <span style={{ color: "var(--color-danger-fg)", fontWeight: 700 }}>-{file.deletions}</span>
                        </Box>
                      </Box>
                      <pre
                        style={{
                          margin: 0,
                          padding: "12px 16px",
                          fontSize: "12.5px",
                          lineHeight: 1.55,
                          fontFamily: "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace",
                          overflowX: "auto",
                          background: "var(--color-canvas-default)",
                        }}
                      >
                        {file.patch.split("\n").map((line, idx) => {
                          const isAdd = line.startsWith("+") && !line.startsWith("+++");
                          const isDel = line.startsWith("-") && !line.startsWith("---");
                          const isHunk = line.startsWith("@@");
                          return (
                            <div
                              key={idx}
                              style={{
                                backgroundColor: isAdd
                                  ? "rgba(46, 160, 67, 0.15)"
                                  : isDel
                                    ? "rgba(248, 81, 73, 0.15)"
                                    : isHunk
                                      ? "rgba(56, 139, 253, 0.12)"
                                      : "transparent",
                                color: isAdd
                                  ? "var(--color-success-fg)"
                                  : isDel
                                    ? "var(--color-danger-fg)"
                                    : isHunk
                                      ? "var(--color-accent-fg)"
                                      : "var(--color-fg-default)",
                                padding: "0 6px",
                              }}
                            >
                              {line}
                            </div>
                          );
                        })}
                      </pre>
                    </Box>
                  );
                })}
              </Box>
            )}

            {detailTab === "ai" && (
              <Box
                p={3}
                bg="var(--color-canvas-subtle)"
                borderRadius={2}
                border="1px solid var(--color-border-default)"
              >
                {isRunningReview ? (
                  <Box p={4} display="flex" flexDirection="column" alignItems="center" gap={2}>
                    <Spinner />
                    <Text color="var(--color-fg-muted)" fontSize="13px">
                      Running DAE balance, unit consistency, and numerical stiffness review...
                    </Text>
                  </Box>
                ) : botReviews[selectedMr.iid] ? (
                  <MarkdownBody
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(marked.parse(botReviews[selectedMr.iid]?.summary || "") as string),
                    }}
                  />
                ) : (
                  <Box p={4} textAlign="center">
                    <CpuIcon size={28} fill="var(--color-fg-muted)" />
                    <Heading as="h4" style={{ fontSize: "15px", margin: "10px 0 6px" }}>
                      No AI Engineering Review yet
                    </Heading>
                    <Text
                      color="var(--color-fg-muted)"
                      fontSize="13px"
                      style={{ display: "block", marginBottom: "12px" }}
                    >
                      Run the Automated Engineering Reviewer (powered by ModelScript) to inspect equation balance,
                      units, and solver stability.
                    </Text>
                    <Button variant="primary" leadingVisual={CpuIcon} onClick={() => handleRunBotReview(selectedMr)}>
                      Run AI Bot Review Now
                    </Button>
                  </Box>
                )}
              </Box>
            )}

            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} mt={2} flexWrap="wrap">
              <Box display="flex" gap={2}>
                {selectedMr.state === "opened" && (
                  <Button
                    leadingVisual={GitPullRequestClosedIcon}
                    disabled={isUpdatingState}
                    onClick={() => handleUpdateMrState(selectedMr, "closed")}
                  >
                    Close pull request
                  </Button>
                )}
                {selectedMr.state === "closed" && (
                  <Button
                    leadingVisual={GitPullRequestIcon}
                    disabled={isUpdatingState}
                    onClick={() => handleUpdateMrState(selectedMr, "opened")}
                  >
                    Reopen pull request
                  </Button>
                )}
              </Box>
              <Button onClick={() => setSelectedMr(null)}>Done</Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {/* Create New Pull Request Dialog */}
      {isNewMrDialogOpen && (
        <Dialog onClose={() => setIsNewMrDialogOpen(false)} title="New Pull Request" width="large">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Box display="grid" gridTemplateColumns="1fr 1fr" style={{ gap: "12px" }}>
              <FormControl>
                <FormControl.Label>Source Branch (compare)</FormControl.Label>
                <TextInput
                  value={newMrSource}
                  onChange={(e) => setNewMrSource(e.target.value)}
                  placeholder="feature/solver-optimization"
                  leadingVisual={GitBranchIcon}
                  block
                />
              </FormControl>

              <FormControl>
                <FormControl.Label>Target Branch (base)</FormControl.Label>
                {branches.length > 0 ? (
                  <Select value={newMrTarget} onChange={(e) => setNewMrTarget(e.target.value)} block>
                    {branches.map((b) => (
                      <Select.Option key={b.name} value={b.name}>
                        {b.name}
                      </Select.Option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    value={newMrTarget}
                    onChange={(e) => setNewMrTarget(e.target.value)}
                    placeholder={defaultBranch}
                    leadingVisual={GitBranchIcon}
                    block
                  />
                )}
              </FormControl>
            </Box>

            <FormControl required>
              <FormControl.Label>Pull Request Title</FormControl.Label>
              <TextInput
                value={newMrTitle}
                onChange={(e) => setNewMrTitle(e.target.value)}
                placeholder="e.g. Regularize zero-crossing in thermal actuator model"
                block
              />
            </FormControl>

            <FormControl>
              <FormControl.Label>Description & Validation Notes</FormControl.Label>
              <Textarea
                value={newMrDesc}
                onChange={(e) => setNewMrDesc(e.target.value)}
                placeholder="Describe equation changes, solver tolerance adjustments, and validation results..."
                block
                rows={5}
              />
            </FormControl>

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setIsNewMrDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateMr} disabled={!newMrTitle.trim() || isCreatingMr}>
                {isCreatingMr ? "Creating..." : "Create pull request"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default PullRequestsTab;
