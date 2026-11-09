// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CheckIcon,
  CommentIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  LinkExternalIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import type { SpaceDetailResponse, SpaceIssueCommentRecord, SpaceIssueRecord } from "../../api/spaces.js";
import {
  addSpaceIssueComment,
  createSpaceIssue,
  getSpaceIssueDetail,
  syncSpaceJiraIssues,
  updateSpaceIssue,
} from "../../api/spaces.js";
import { useToast } from "../../components/ToastContext.js";

// ── Styled Components (Adhering to @primer/style & Spaces Cockpit) ───────────

const SpaceCockpitGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 1380px;
  margin: 0 auto;
`;

const MasterDetailGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
`;

const IssueSplitLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 24px;
  align-items: start;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const IssueTableRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  cursor: pointer;
  transition: background 0.12s ease;
  gap: 16px;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--ms-surface-hover, var(--color-canvas-subtle));
  }
`;

const IssueSectionCard = styled.section`
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
`;

const IssueSectionHeader = styled.div`
  padding: 12px 18px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

export interface SpaceIssuesTabProps {
  detail: SpaceDetailResponse | null;
  viewerState: {
    canWrite: boolean;
    canAdmin: boolean;
    role: string | null;
  };
  user: { id: number; username: string } | null;
  onIssueCreated?: (issue: SpaceIssueRecord, issues: SpaceIssueRecord[]) => void;
  onIssueUpdated?: (issue: SpaceIssueRecord, issues: SpaceIssueRecord[]) => void;
}

export const SpaceIssuesTab: React.FC<SpaceIssuesTabProps> = ({
  detail,
  viewerState,
  user: _user,
  onIssueCreated,
  onIssueUpdated,
}) => {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Navigation & View Mode state
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  // Issues list & filtering state
  const [issueStatusFilter, setIssueStatusFilter] = useState<"open" | "closed" | "all">("open");
  const [issueSeverityFilter, setIssueSeverityFilter] = useState<string>("all");
  const [issueSearchQuery, setIssueSearchQuery] = useState("");

  // Detailed issue with comments
  const [activeIssueDetail, setActiveIssueDetail] = useState<
    (SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] }) | null
  >(null);
  const [_loadingIssueDetail, setLoadingIssueDetail] = useState(false);

  // New Comment state
  const [commentInput, setCommentInput] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // New Issue Modal state
  const [showNewIssueModal, setShowNewIssueModal] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [newIssueSeverity, setNewIssueSeverity] = useState<SpaceIssueRecord["severity"]>("standard");
  const [newIssueModels, setNewIssueModels] = useState("docs/overview.md");
  const [newIssueLinkedPr, setNewIssueLinkedPr] = useState("");
  const [submittingNewIssue, setSubmittingNewIssue] = useState(false);

  // Jira Sync Modal state
  const savedJira = (detail?.space?.settings?.["jira"] as Record<string, unknown> | undefined) || {};
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState(
    String(savedJira["baseUrl"] ?? savedJira["jiraBaseUrl"] ?? "https://"),
  );
  const [jiraEmail, setJiraEmail] = useState(String(savedJira["email"] ?? ""));
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraJql, setJiraJql] = useState(String(savedJira["jql"] || "ORDER BY updated DESC"));
  const [jiraMaxResults, setJiraMaxResults] = useState(50);
  const [jiraCustomField, setJiraCustomField] = useState(String(savedJira["modelCustomField"] ?? ""));
  const [isSyncingJira, setIsSyncingJira] = useState(false);

  const issuesList = detail?.issues || [];
  const ecosList = detail?.ecos || [];

  // Metrics
  const totalIssues = issuesList.length;
  const openIssues = issuesList.filter((i) => i.status === "open").length;
  const closedIssues = issuesList.filter((i) => i.status === "closed").length;

  // Filtered Issues
  const filteredIssues = useMemo(() => {
    return issuesList.filter((issue) => {
      if (issueStatusFilter === "open" && issue.status !== "open") return false;
      if (issueStatusFilter === "closed" && issue.status !== "closed") return false;
      if (issueSeverityFilter !== "all" && issue.severity !== issueSeverityFilter) return false;
      if (issueSearchQuery.trim()) {
        const q = issueSearchQuery.toLowerCase().trim();
        if (q === "is:jira") return issue.external_source === "jira";
        const matchTitle = issue.title.toLowerCase().includes(q);
        const matchDesc = issue.description.toLowerCase().includes(q);
        const matchNumber = `#${issue.issue_number}` === q || `${issue.issue_number}` === q;
        const matchAuthor = (issue.author_username || "").toLowerCase().includes(q);
        const matchModels = issue.impacted_models.some((m) => m.toLowerCase().includes(q));
        const matchExternalKey = (issue.external_key || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchNumber && !matchAuthor && !matchModels && !matchExternalKey) {
          return false;
        }
      }
      return true;
    });
  }, [issuesList, issueStatusFilter, issueSeverityFilter, issueSearchQuery]);

  // Deep-linking: auto-select Issue from URL search params (?issue=1)
  useEffect(() => {
    const issueParam = searchParams.get("issue");
    if (issueParam) {
      const match = issuesList.find(
        (i) => i.id === issueParam || String(i.issue_number) === issueParam.replace(/^#/, ""),
      );
      if (match) {
        setSelectedIssueId(match.id);
        setViewMode("detail");
      }
    }
  }, [searchParams, issuesList]);

  // Load detailed issue with comments when selected
  useEffect(() => {
    if (!selectedIssueId || !detail) return;
    let isCurrent = true;
    setLoadingIssueDetail(true);

    getSpaceIssueDetail(detail.space.owner_namespace, detail.space.slug, selectedIssueId)
      .then((data) => {
        if (isCurrent) {
          setActiveIssueDetail(data);
          setLoadingIssueDetail(false);
        }
      })
      .catch((_err) => {
        if (isCurrent) {
          toast.error("Failed to load issue details");
          setLoadingIssueDetail(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [selectedIssueId, detail]);

  const handleSelectIssue = (issueId: string) => {
    setSelectedIssueId(issueId);
    setViewMode("detail");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("issue", issueId);
    setSearchParams(nextParams);
  };

  const handleBackToList = () => {
    setViewMode("list");
    setSelectedIssueId(null);
    setActiveIssueDetail(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("issue");
    setSearchParams(nextParams);
  };

  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIssueTitle.trim() || !detail) return;
    try {
      setSubmittingNewIssue(true);
      const models = newIssueModels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const linkedPrNum = newIssueLinkedPr.trim() ? Number(newIssueLinkedPr.trim().replace(/^#/, "")) : null;

      const res = await createSpaceIssue(detail.space.owner_namespace, detail.space.slug, {
        title: newIssueTitle.trim(),
        description: newIssueDesc.trim(),
        severity: newIssueSeverity,
        impactedModels: models,
        linkedPrNumber: linkedPrNum,
      });

      onIssueCreated?.(res.issue, res.issues);
      setShowNewIssueModal(false);
      setNewIssueTitle("");
      setNewIssueDesc("");
      setNewIssueLinkedPr("");
      toast.success(`Created Issue #${res.issue.issue_number}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to create issue");
    } finally {
      setSubmittingNewIssue(false);
    }
  };

  const handleSyncJira = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const effectiveBaseUrl = jiraBaseUrl.trim() || String(savedJira["baseUrl"] ?? savedJira["jiraBaseUrl"] ?? "");
    const effectiveToken = jiraApiToken.trim() || String(savedJira["apiToken"] ?? "");
    if (!effectiveBaseUrl || !effectiveToken) return;

    try {
      setIsSyncingJira(true);
      const res = await syncSpaceJiraIssues(detail.space.owner_namespace, detail.space.slug, {
        jiraBaseUrl: jiraBaseUrl.trim() || undefined,
        email: jiraEmail.trim() || undefined,
        apiToken: jiraApiToken.trim() || undefined,
        jql: jiraJql.trim() || undefined,
        maxResults: Number(jiraMaxResults) || 50,
        modelCustomField: jiraCustomField.trim() || undefined,
      });

      if (res.issues && res.issues.length > 0) {
        onIssueUpdated?.(res.issues[0]!, res.issues);
      }
      toast.success(`Synchronized ${res.synced} Jira tickets (${res.created} new, ${res.updated} updated)!`);
      setShowJiraModal(false);
    } catch (err: any) {
      const msg = err?.response?.data?.error || (err instanceof Error ? err.message : String(err));
      toast.error(`Jira synchronization failed: ${msg}`);
    } finally {
      setIsSyncingJira(false);
    }
  };

  const handleToggleIssueStatus = async () => {
    if (!activeIssueDetail || !detail) return;
    const newStatus = activeIssueDetail.status === "open" ? "closed" : "open";
    try {
      const res = await updateSpaceIssue(detail.space.owner_namespace, detail.space.slug, activeIssueDetail.id, {
        status: newStatus,
      });
      setActiveIssueDetail((prev) => (prev ? { ...prev, status: newStatus } : null));
      onIssueUpdated?.(res.issue, res.issues);
      toast.success(newStatus === "closed" ? "Issue closed" : "Issue reopened");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to update issue status");
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim() || !activeIssueDetail || !detail) return;
    try {
      setSubmittingComment(true);
      const res = await addSpaceIssueComment(
        detail.space.owner_namespace,
        detail.space.slug,
        activeIssueDetail.id,
        commentInput.trim(),
      );
      setActiveIssueDetail(res.issue);
      setCommentInput("");
      toast.success("Comment added");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  };

  const getSeverityBadge = (severity: SpaceIssueRecord["severity"]) => {
    switch (severity) {
      case "safety_critical":
        return {
          label: "Safety-Critical",
          sublabel: "ASIL-D",
          fg: "var(--color-danger-fg, #cf222e)",
          bg: "var(--color-danger-subtle, rgba(207, 34, 46, 0.1))",
          border: "var(--color-danger-muted, rgba(207, 34, 46, 0.25))",
          icon: "🛡️",
        };
      case "major":
        return {
          label: "Major Defect",
          sublabel: "Interface Impact",
          fg: "var(--color-attention-fg, #9a6700)",
          bg: "var(--color-attention-subtle, rgba(154, 103, 0, 0.1))",
          border: "var(--color-attention-muted, rgba(154, 103, 0, 0.25))",
          icon: "⚡",
        };
      case "minor":
        return {
          label: "Minor",
          sublabel: "Cosmetic / Docs",
          fg: "var(--color-fg-muted)",
          bg: "var(--color-canvas-subtle)",
          border: "var(--color-border-default)",
          icon: "🔹",
        };
      case "standard":
      default:
        return {
          label: "Standard Issue",
          sublabel: "Engineering Problem",
          fg: "var(--color-accent-fg, #0969da)",
          bg: "var(--color-accent-subtle, rgba(9, 105, 218, 0.1))",
          border: "var(--color-accent-muted, rgba(9, 105, 218, 0.25))",
          icon: "⚙️",
        };
    }
  };

  return (
    <div style={{ padding: "24px 32px", width: "100%", boxSizing: "border-box" }}>
      <SpaceCockpitGrid>
        {/* ═══════════════════════════════════════════════════════════════════════
            MODE 1: Full-Width Issues List (GitHub Native Style)
           ═══════════════════════════════════════════════════════════════════════ */}
        {viewMode === "list" && (
          <MasterDetailGrid>
            {/* Top Toolbar: Search Bar + New Issue Button */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "14px",
                marginBottom: "4px",
              }}
            >
              {/* Search Bar */}
              <div style={{ position: "relative", flex: "1 1 320px", maxWidth: "600px" }}>
                <SearchIcon
                  size={14}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--color-fg-muted)",
                  }}
                />
                <input
                  type="text"
                  placeholder="is:issue is:open Filter issues, models, labels..."
                  value={issueSearchQuery}
                  onChange={(e) => setIssueSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "6px 12px 6px 34px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>

              {/* Action Buttons: Sync Jira & New Issue */}
              {viewerState.canWrite && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setShowJiraModal(true)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    title="Pull and synchronize tickets from Atlassian Jira into this space"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#0052cc">
                      <path d="M11.53 2c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V2h-10.56zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V6.35H7.14zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V10.7H2.75z" />
                    </svg>
                    <span>Sync Jira</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowNewIssueModal(true)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 16px",
                      borderRadius: "6px",
                      border: "1px solid rgba(27, 31, 36, 0.15)",
                      background: "#1f883d",
                      color: "#ffffff",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 1px 0 rgba(27, 31, 36, 0.1)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <PlusIcon size={14} />
                    <span>New issue</span>
                  </button>
                </div>
              )}
            </div>

            {/* Single Unified GitHub-Style Issues Box */}
            <div
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "6px",
                overflow: "hidden",
                background: "var(--color-canvas-default)",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
              }}
            >
              {/* GitHub Table Header */}
              <div
                style={{
                  padding: "12px 18px",
                  background: "var(--color-canvas-subtle)",
                  borderBottom: "1px solid var(--color-border-default)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                {/* Left: Open / Closed Filters */}
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <button
                    type="button"
                    onClick={() => setIssueStatusFilter("open")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: issueStatusFilter === "open" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                      fontWeight: issueStatusFilter === "open" ? 600 : 400,
                      fontSize: "14px",
                    }}
                  >
                    <IssueOpenedIcon
                      size={16}
                      fill={issueStatusFilter === "open" ? "var(--color-fg-default)" : "var(--color-fg-muted)"}
                    />
                    <span>{openIssues} Open</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIssueStatusFilter("closed")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: issueStatusFilter === "closed" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                      fontWeight: issueStatusFilter === "closed" ? 600 : 400,
                      fontSize: "14px",
                    }}
                  >
                    <CheckIcon size={16} />
                    <span>{closedIssues} Closed</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIssueStatusFilter("all")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: issueStatusFilter === "all" ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                      fontWeight: issueStatusFilter === "all" ? 600 : 400,
                      fontSize: "14px",
                    }}
                  >
                    <span>{totalIssues} All</span>
                  </button>
                </div>

                {/* Right: Dropdown Filters */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <select
                    value={issueSeverityFilter}
                    onChange={(e) => setIssueSeverityFilter(e.target.value)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "12.5px",
                      cursor: "pointer",
                    }}
                  >
                    <option value="all">Severity</option>
                    <option value="safety_critical">🛡️ Safety-Critical (ASIL-D)</option>
                    <option value="major">⚡ Major Defect</option>
                    <option value="standard">Standard</option>
                    <option value="minor">Minor</option>
                  </select>
                </div>
              </div>

              {/* Table Body: Empty State or Issues Rows */}
              {filteredIssues.length === 0 ? (
                <div
                  style={{
                    padding: "64px 24px",
                    background: "var(--color-canvas-default)",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "14px",
                  }}
                >
                  <div
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "50%",
                      background: "var(--color-canvas-subtle)",
                      border: "1px solid var(--color-border-default)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-fg-muted)",
                    }}
                  >
                    <IssueOpenedIcon size={26} />
                  </div>
                  <div>
                    <h4
                      style={{ margin: "0 0 6px", fontSize: "17px", fontWeight: 600, color: "var(--color-fg-default)" }}
                    >
                      {totalIssues === 0 ? "No Issues Yet" : "No Matching Issues"}
                    </h4>
                    <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-fg-muted)", maxWidth: "480px" }}>
                      {totalIssues === 0
                        ? "Log physical engineering defects, requirement deviations, or feature requests."
                        : "No issues match the active filter or search term."}
                    </p>
                  </div>
                  {viewerState.canWrite && (
                    <button
                      type="button"
                      onClick={() => setShowNewIssueModal(true)}
                      style={{
                        marginTop: "8px",
                        padding: "8px 20px",
                        borderRadius: "6px",
                        border: "none",
                        background: "#1f883d",
                        color: "#fff",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Create First Issue
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {filteredIssues.map((issue) => {
                    const severityBadge = getSeverityBadge(issue.severity);
                    const isOpen = issue.status === "open";
                    const linkedPr = issue.linked_pr_number
                      ? ecosList.find((e) => e.eco_number === issue.linked_pr_number)
                      : null;

                    return (
                      <IssueTableRow
                        key={issue.id}
                        onClick={() => handleSelectIssue(issue.id)}
                        title={`Click to inspect Issue #${issue.issue_number}`}
                      >
                        {/* Left: State Icon + Title & Subtitle */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", minWidth: 0, flex: 1 }}>
                          <div style={{ marginTop: "3px", color: isOpen ? "#1a7f37" : "#8250df", display: "flex" }}>
                            {isOpen ? (
                              <IssueOpenedIcon size={16} fill="#1a7f37" />
                            ) : (
                              <IssueClosedIcon size={16} fill="#8250df" />
                            )}
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <strong style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                                {issue.title}
                              </strong>

                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "1px 7px",
                                  borderRadius: "2em",
                                  background: severityBadge.bg,
                                  color: severityBadge.fg,
                                  border: `1px solid ${severityBadge.border}`,
                                }}
                              >
                                {severityBadge.icon} {severityBadge.label}
                              </span>

                              {linkedPr && (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    fontFamily: "var(--font-mono)",
                                    padding: "1px 6px",
                                    borderRadius: "4px",
                                    background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.1))",
                                    color: "var(--color-accent-fg, #0969da)",
                                    border: "1px solid var(--color-accent-muted, rgba(9, 105, 218, 0.25))",
                                  }}
                                  title={`Linked to Pull Request #${linkedPr.eco_number}`}
                                >
                                  <GitPullRequestIcon size={12} />
                                  <span>#{linkedPr.eco_number}</span>
                                </span>
                              )}

                              {issue.external_source === "jira" && (
                                <a
                                  href={issue.external_url || undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    fontFamily: "var(--font-mono)",
                                    padding: "1px 7px",
                                    borderRadius: "4px",
                                    background: "rgba(0, 82, 204, 0.12)",
                                    color: "#0052cc",
                                    border: "1px solid rgba(0, 82, 204, 0.3)",
                                    textDecoration: "none",
                                  }}
                                  title={`Open ${issue.external_key || "ticket"} in Atlassian Jira`}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#0052cc">
                                    <path d="M11.53 2c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V2h-10.56zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V6.35H7.14zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V10.7H2.75z" />
                                  </svg>
                                  <span>{issue.external_key || "Jira"}</span>
                                  <LinkExternalIcon size={10} />
                                </a>
                              )}
                            </div>

                            <div
                              style={{
                                fontSize: "12.5px",
                                color: "var(--color-fg-muted)",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                flexWrap: "wrap",
                              }}
                            >
                              <span>
                                #{issue.issue_number} opened by <strong>@{issue.author_username || "engineer"}</strong>
                              </span>
                              {issue.impacted_models.length > 0 && (
                                <>
                                  <span>•</span>
                                  <span>
                                    {issue.impacted_models.length} impacted model
                                    {issue.impacted_models.length === 1 ? "" : "s"}
                                  </span>
                                </>
                              )}
                              {issue.closed_at && (
                                <>
                                  <span>•</span>
                                  <span style={{ color: "#8250df" }}>Closed</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Comments count */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            color: "var(--color-fg-muted)",
                            fontSize: "12px",
                          }}
                        >
                          <CommentIcon size={14} />
                          <span>{issue.comments?.length || 0}</span>
                        </div>
                      </IssueTableRow>
                    );
                  })}
                </div>
              )}
            </div>
          </MasterDetailGrid>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            MODE 2: Dedicated Issue Conversation Detail View
           ═══════════════════════════════════════════════════════════════════════ */}
        {viewMode === "detail" &&
          activeIssueDetail &&
          (() => {
            const isOpen = activeIssueDetail.status === "open";
            const severityBadge = getSeverityBadge(activeIssueDetail.severity);
            const linkedPr = activeIssueDetail.linked_pr_number
              ? ecosList.find((e) => e.eco_number === activeIssueDetail.linked_pr_number)
              : null;

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
                {/* Back button */}
                <div>
                  <button
                    type="button"
                    onClick={handleBackToList}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <ArrowLeftIcon size={14} />
                    <span>All Issues</span>
                  </button>
                </div>

                {/* Title & State Bar */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    paddingBottom: "18px",
                    borderBottom: "1px solid var(--color-border-default)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                    <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                      {activeIssueDetail.title}
                    </h1>
                    <span style={{ fontSize: "24px", fontWeight: 300, color: "var(--color-fg-muted)" }}>
                      #{activeIssueDetail.issue_number}
                    </span>
                  </div>

                  <div
                    style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "14px" }}
                  >
                    <span
                      style={{
                        padding: "4px 12px",
                        borderRadius: "2em",
                        fontSize: "13.5px",
                        fontWeight: 600,
                        background: isOpen ? "#1f883d" : "#8250df",
                        color: "#ffffff",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      {isOpen ? (
                        <IssueOpenedIcon size={14} fill="#ffffff" />
                      ) : (
                        <IssueClosedIcon size={14} fill="#ffffff" />
                      )}
                      <span>{isOpen ? "Open" : "Closed"}</span>
                    </span>

                    <span style={{ color: "var(--color-fg-muted)" }}>
                      <strong style={{ color: "var(--color-fg-default)" }}>
                        @{activeIssueDetail.author_username || "engineer"}
                      </strong>{" "}
                      opened this issue on {new Date(activeIssueDetail.created_at).toLocaleDateString()} •{" "}
                      {activeIssueDetail.comments?.length || 0} comments
                    </span>

                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "2em",
                        fontSize: "12px",
                        fontWeight: 600,
                        background: severityBadge.bg,
                        color: severityBadge.fg,
                        border: `1px solid ${severityBadge.border}`,
                      }}
                    >
                      {severityBadge.icon} {severityBadge.label}
                    </span>
                  </div>
                </div>

                {/* Jira External Sync HUD */}
                {activeIssueDetail.external_source === "jira" && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: "6px",
                      background: "rgba(0, 82, 204, 0.08)",
                      border: "1px solid rgba(0, 82, 204, 0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0052cc">
                        <path d="M11.53 2c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V2h-10.56zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V6.35H7.14zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V10.7H2.75z" />
                      </svg>
                      <span style={{ fontSize: "13.5px", color: "var(--color-fg-default)" }}>
                        Synchronized with Atlassian Jira ticket{" "}
                        <strong style={{ fontFamily: "var(--font-mono)", color: "#0052cc" }}>
                          {activeIssueDetail.external_key}
                        </strong>
                        {activeIssueDetail.external_updated_at && (
                          <span style={{ color: "var(--color-fg-muted)", fontSize: "12.5px" }}>
                            {" "}
                            • Last updated in Jira {new Date(activeIssueDetail.external_updated_at).toLocaleString()}
                          </span>
                        )}
                      </span>
                    </div>

                    {activeIssueDetail.external_url && (
                      <a
                        href={activeIssueDetail.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          color: "#0052cc",
                          textDecoration: "none",
                        }}
                      >
                        <span>Open in Jira</span>
                        <LinkExternalIcon size={12} />
                      </a>
                    )}
                  </div>
                )}

                {/* 2-Column Split: Conversation + Sidebar */}
                <IssueSplitLayout>
                  {/* Main Column */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
                    {/* Issue Description Card */}
                    <IssueSectionCard>
                      <IssueSectionHeader>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div
                            style={{
                              width: "28px",
                              height: "28px",
                              borderRadius: "50%",
                              background: "var(--color-accent-subtle, rgba(9, 105, 218, 0.15))",
                              color: "var(--color-accent-fg, #0969da)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "12px",
                              fontWeight: 700,
                            }}
                          >
                            {(activeIssueDetail.author_username || "e").slice(0, 1).toUpperCase()}
                          </div>
                          <span style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>
                            <strong>@{activeIssueDetail.author_username || "engineer"}</strong> commented
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-fg-muted)",
                            padding: "2px 8px",
                            borderRadius: "2em",
                            border: "1px solid var(--color-border-default)",
                          }}
                        >
                          Author
                        </span>
                      </IssueSectionHeader>

                      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div
                          style={{
                            fontSize: "14px",
                            color: "var(--color-fg-default)",
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {activeIssueDetail.description || "No description provided."}
                        </div>

                        {/* Impacted Domain Models */}
                        {activeIssueDetail.impacted_models.length > 0 && (
                          <div style={{ paddingTop: "14px", borderTop: "1px solid var(--color-border-default)" }}>
                            <div
                              style={{
                                fontSize: "11.5px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                color: "var(--color-fg-muted)",
                                marginBottom: "8px",
                              }}
                            >
                              Impacted Subsystems & Models ({activeIssueDetail.impacted_models.length})
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                              {activeIssueDetail.impacted_models.map((m) => (
                                <Link
                                  key={m}
                                  to={`/morsel?code=${encodeURIComponent(`// Modelica model: ${m}\nmodel InvestigatedModel\n  // Issue investigation\nend InvestigatedModel;\n`)}`}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "4px 10px",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    fontFamily: "var(--font-mono)",
                                    background: "var(--color-canvas-subtle)",
                                    border: "1px solid var(--color-border-default)",
                                    color: "var(--color-fg-default)",
                                    textDecoration: "none",
                                  }}
                                >
                                  <span>📦</span>
                                  <span>{m}</span>
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </IssueSectionCard>

                    {/* Linked Pull Request Card */}
                    {linkedPr && (
                      <IssueSectionCard>
                        <IssueSectionHeader>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <GitPullRequestIcon size={16} fill="var(--color-accent-fg, #0969da)" />
                            <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>
                              Linked Pull Request #{linkedPr.eco_number}
                            </strong>
                          </div>
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: "2em",
                              background: linkedPr.status === "merged" ? "#8250df" : "#1f883d",
                              color: "#fff",
                            }}
                          >
                            {linkedPr.status.toUpperCase()}
                          </span>
                        </IssueSectionHeader>
                        <div
                          style={{
                            padding: "16px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "14px",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: "14px", color: "var(--color-fg-default)" }}>
                              {linkedPr.title}
                            </strong>
                            <div style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginTop: "3px" }}>
                              branch <code style={{ fontFamily: "var(--font-mono)" }}>{linkedPr.source_branch}</code> •
                              DAE Simulation: <strong>{linkedPr.simulation_gate_status}</strong>
                            </div>
                          </div>
                          <Link
                            to={`?tab=pulls&eco=${linkedPr.id}`}
                            style={{
                              padding: "6px 14px",
                              borderRadius: "6px",
                              border: "1px solid var(--color-border-default)",
                              background: "var(--color-canvas-subtle)",
                              color: "var(--color-accent-fg, #0969da)",
                              fontSize: "12.5px",
                              fontWeight: 600,
                              textDecoration: "none",
                            }}
                          >
                            Inspect PR →
                          </Link>
                        </div>
                      </IssueSectionCard>
                    )}

                    {/* Comments Thread */}
                    {(activeIssueDetail.comments || []).map((c) => (
                      <IssueSectionCard key={c.id}>
                        <IssueSectionHeader>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                            @{c.username}
                          </span>
                          <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
                            {new Date(c.created_at).toLocaleString()}
                          </span>
                        </IssueSectionHeader>
                        <div
                          style={{
                            padding: "16px",
                            fontSize: "13.5px",
                            color: "var(--color-fg-default)",
                            lineHeight: 1.6,
                          }}
                        >
                          {c.content}
                        </div>
                      </IssueSectionCard>
                    ))}

                    {/* Comment Composer & Status Toggle */}
                    {viewerState.canWrite && (
                      <form
                        onSubmit={handleAddComment}
                        style={{
                          borderRadius: "6px",
                          border: "1px solid var(--color-border-default)",
                          background: "var(--color-canvas-default)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            padding: "10px 14px",
                            background: "var(--color-canvas-subtle)",
                            borderBottom: "1px solid var(--color-border-default)",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-fg-muted)",
                          }}
                        >
                          Leave a comment
                        </div>
                        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                          <textarea
                            rows={3}
                            placeholder="Leave a comment on this issue..."
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              padding: "10px 12px",
                              borderRadius: "6px",
                              border: "1px solid var(--color-border-default)",
                              background: "var(--color-canvas-subtle)",
                              color: "var(--color-fg-default)",
                              fontSize: "13px",
                              outline: "none",
                            }}
                          />

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <button
                              type="button"
                              onClick={handleToggleIssueStatus}
                              style={{
                                padding: "6px 14px",
                                borderRadius: "6px",
                                border: "1px solid var(--color-border-default)",
                                background: "var(--color-canvas-default)",
                                color: isOpen ? "var(--color-danger-fg, #cf222e)" : "var(--color-success-fg, #1a7f37)",
                                fontSize: "13px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {isOpen ? "Close issue" : "Reopen issue"}
                            </button>

                            <button
                              type="submit"
                              disabled={!commentInput.trim() || submittingComment}
                              style={{
                                padding: "6px 16px",
                                borderRadius: "6px",
                                border: "1px solid var(--color-border-default)",
                                background: commentInput.trim() ? "var(--color-canvas-default)" : "transparent",
                                color: commentInput.trim() ? "var(--color-fg-default)" : "var(--color-fg-muted)",
                                fontSize: "13px",
                                fontWeight: 600,
                                cursor: commentInput.trim() ? "pointer" : "not-allowed",
                              }}
                            >
                              Comment
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>

                  {/* Right Sidebar */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <IssueSectionCard>
                      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-fg-muted)",
                            display: "block",
                            marginBottom: "6px",
                          }}
                        >
                          Severity
                        </span>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: severityBadge.fg }}>
                          {severityBadge.icon} {severityBadge.label} ({severityBadge.sublabel})
                        </span>
                      </div>

                      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-fg-muted)",
                            display: "block",
                            marginBottom: "6px",
                          }}
                        >
                          Impacted Models
                        </span>
                        {activeIssueDetail.impacted_models.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {activeIssueDetail.impacted_models.map((m) => (
                              <span
                                key={m}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "12px",
                                  color: "var(--color-fg-default)",
                                }}
                              >
                                • {m}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>None specified</span>
                        )}
                      </div>

                      <div style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--color-fg-muted)",
                            display: "block",
                            marginBottom: "6px",
                          }}
                        >
                          Engineering Governance
                        </span>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--color-fg-muted)",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <span>• Problem Report (ECR)</span>
                          <span>• Traceable to SysML</span>
                          <span>• Verifiable by CVODE</span>
                        </div>
                      </div>
                    </IssueSectionCard>
                  </div>
                </IssueSplitLayout>
              </div>
            );
          })()}
      </SpaceCockpitGrid>

      {/* ── Modal: Create New Issue ── */}
      {showNewIssueModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(2px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "580px",
              background: "var(--color-canvas-default)",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              boxShadow: "0 16px 36px rgba(0, 0, 0, 0.35)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "var(--color-canvas-subtle)",
                borderBottom: "1px solid var(--color-border-default)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                New Issue / Problem Report
              </h3>
              <button
                type="button"
                onClick={() => setShowNewIssueModal(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-fg-muted)" }}
              >
                <XIcon size={16} />
              </button>
            </div>

            <form
              onSubmit={handleCreateIssue}
              style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "var(--color-fg-default)",
                    marginBottom: "6px",
                  }}
                >
                  Issue Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inverter DC-Link Bus Voltage Ripple Exceeds 2.5%"
                  value={newIssueTitle}
                  onChange={(e) => setNewIssueTitle(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "var(--color-fg-default)",
                    marginBottom: "6px",
                  }}
                >
                  Problem Description & Physical Telemetry
                </label>
                <textarea
                  rows={4}
                  placeholder="Describe observed physical anomalies, frequency deviations, or requirement violations..."
                  value={newIssueDesc}
                  onChange={(e) => setNewIssueDesc(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--color-fg-default)",
                      marginBottom: "6px",
                    }}
                  >
                    Severity
                  </label>
                  <select
                    value={newIssueSeverity}
                    onChange={(e) => setNewIssueSeverity(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                    }}
                  >
                    <option value="safety_critical">🛡️ Safety-Critical (ASIL-D)</option>
                    <option value="major">⚡ Major Defect</option>
                    <option value="standard">Standard Issue</option>
                    <option value="minor">Minor / Cosmetic</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--color-fg-default)",
                      marginBottom: "6px",
                    }}
                  >
                    Linked PR Number (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2 or #2"
                    value={newIssueLinkedPr}
                    onChange={(e) => setNewIssueLinkedPr(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "var(--color-fg-default)",
                    marginBottom: "6px",
                  }}
                >
                  Impacted Models (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. AetherDynamics.Power.Inverter, docs/overview.md"
                  value={newIssueModels}
                  onChange={(e) => setNewIssueModels(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setShowNewIssueModal(false)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "transparent",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNewIssue || !newIssueTitle.trim()}
                  style={{
                    padding: "7px 18px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#1f883d",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {submittingNewIssue ? "Creating..." : "Submit new issue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: Sync Atlassian Jira Tickets
         ═══════════════════════════════════════════════════════════════════════ */}
      {showJiraModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(2px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "580px",
              background: "var(--color-canvas-default)",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              boxShadow: "0 16px 36px rgba(0, 0, 0, 0.35)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                background: "var(--color-canvas-subtle)",
                borderBottom: "1px solid var(--color-border-default)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#0052cc">
                  <path d="M11.53 2c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V2h-10.56zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V6.35H7.14zm-4.39 4.35c0 2.4 1.97 4.35 4.39 4.35h1.78v1.74c0 2.4 1.97 4.35 4.39 4.35V10.7H2.75z" />
                </svg>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--color-fg-default)" }}>
                  Sync Atlassian Jira Tickets
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowJiraModal(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-fg-muted)" }}
              >
                <XIcon size={16} />
              </button>
            </div>

            <form
              onSubmit={handleSyncJira}
              style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "var(--color-fg-default)",
                    marginBottom: "6px",
                  }}
                >
                  Jira Base URL *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://your-company.atlassian.net"
                  value={jiraBaseUrl}
                  onChange={(e) => setJiraBaseUrl(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--color-fg-default)",
                      marginBottom: "6px",
                    }}
                  >
                    Email (for Jira Cloud)
                  </label>
                  <input
                    type="email"
                    placeholder="engineer@company.com"
                    value={jiraEmail}
                    onChange={(e) => setJiraEmail(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--color-fg-default)",
                      marginBottom: "6px",
                    }}
                  >
                    API Token or PAT *
                  </label>
                  <input
                    type="password"
                    placeholder={
                      savedJira["apiToken"]
                        ? "•••••••••••••••• (using saved token from Space Settings)"
                        : "Atlassian API token / PAT"
                    }
                    value={jiraApiToken}
                    onChange={(e) => setJiraApiToken(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "var(--color-fg-default)",
                    marginBottom: "6px",
                  }}
                >
                  JQL Filter Query
                </label>
                <input
                  type="text"
                  placeholder="e.g. project = 'AERO' AND status != 'Done' ORDER BY updated DESC"
                  value={jiraJql}
                  onChange={(e) => setJiraJql(e.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-subtle)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    fontFamily: "var(--font-mono)",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--color-fg-default)",
                      marginBottom: "6px",
                    }}
                  >
                    Max Tickets to Pull
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={jiraMaxResults}
                    onChange={(e) => setJiraMaxResults(Number(e.target.value) || 50)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: "var(--color-fg-default)",
                      marginBottom: "6px",
                    }}
                  >
                    Model Custom Field (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. customfield_10034"
                    value={jiraCustomField}
                    onChange={(e) => setJiraCustomField(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-canvas-subtle)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <p style={{ margin: 0, fontSize: "12px", color: "var(--color-fg-muted)" }}>
                Tip: The connector automatically detects model references in ticket summaries and descriptions (e.g.{" "}
                <code>model: Package.Class</code> or <code>@model:...</code>).
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => setShowJiraModal(false)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "transparent",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isSyncingJira ||
                    (!jiraBaseUrl.trim() && !savedJira["baseUrl"] && !savedJira["jiraBaseUrl"]) ||
                    (!jiraApiToken.trim() && !savedJira["apiToken"])
                  }
                  style={{
                    padding: "7px 18px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#0052cc",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {isSyncingJira ? <SyncIcon size={14} className="anim-rotate" /> : null}
                  <span>{isSyncingJira ? "Synchronizing..." : "Start Synchronization"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
