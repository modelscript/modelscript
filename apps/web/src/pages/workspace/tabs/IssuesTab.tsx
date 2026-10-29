// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CommentIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  IssueReopenedIcon,
  PlusIcon,
  SearchIcon,
} from "@primer/octicons-react";
import { Avatar, Button, Dialog, Flash, Heading, Label, Spinner, Text, TextInput, Textarea } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useMemo, useState } from "react";
import type { GitlabIssue } from "../../../api";
import { addGitlabIssueComment, createGitlabIssue, getGitlabIssues, updateGitlabIssueState } from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { getAvatarUrl } from "../../../util/avatar";
import { CommitRow, MarkdownBody, StyledBox } from "../styles";
import { getRelativeTime } from "../utils";

export interface IssuesTabProps {
  projectId: string;
  provider: string;
}

const ISSUE_LABELS: { name: string; color: string }[] = [
  { name: "bug", color: "#cf222e" },
  { name: "enhancement", color: "#0969da" },
  { name: "dae-solver", color: "#0f766e" },
  { name: "fmi", color: "#8250df" },
  { name: "units", color: "#d97706" },
  { name: "documentation", color: "#059669" },
];

function getLabelColor(label: string): string {
  const found = ISSUE_LABELS.find((l) => l.name.toLowerCase() === label.toLowerCase());
  return found ? found.color : "#0f766e";
}

export const IssuesTab: React.FC<IssuesTabProps> = ({ projectId, provider }) => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [issues, setIssues] = useState<GitlabIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<"opened" | "closed">("opened");
  const [searchQuery, setSearchQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueBody, setNewIssueBody] = useState("");
  const [selectedNewLabels, setSelectedNewLabels] = useState<string[]>(["enhancement"]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedIssue, setSelectedIssue] = useState<GitlabIssue | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [isUpdatingIssue, setIsUpdatingIssue] = useState(false);

  const loadIssues = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getGitlabIssues(projectId, provider);
      setIssues(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load issues.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, provider]);

  const counts = useMemo(() => {
    let opened = 0;
    let closed = 0;
    for (const i of issues) {
      if (i.state === "closed") closed++;
      else opened++;
    }
    return { opened, closed };
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((i) => {
      const normalizedState = i.state === "closed" ? "closed" : "opened";
      if (normalizedState !== stateFilter) return false;
      if (labelFilter && !(i.labels || []).includes(labelFilter)) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        i.title.toLowerCase().includes(q) ||
        (i.description || "").toLowerCase().includes(q) ||
        i.author.username.toLowerCase().includes(q) ||
        (i.labels || []).some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [issues, stateFilter, labelFilter, searchQuery]);

  const handleCreateIssue = async () => {
    setCreateError(null);
    setIsSubmitting(true);
    try {
      const created = await createGitlabIssue(projectId, newIssueTitle, newIssueBody, provider, selectedNewLabels);
      setIsDialogOpen(false);
      setNewIssueTitle("");
      setNewIssueBody("");
      setSelectedNewLabels(["enhancement"]);
      setStateFilter("opened");
      await loadIssues();
      window.dispatchEvent(new CustomEvent("modelscript:repo-counts-changed"));
      showToast(`Created issue #${created.iid}`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create issue.";
      setCreateError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleIssueState = async (issue: GitlabIssue) => {
    const nextState = issue.state === "closed" ? "opened" : "closed";
    setIsUpdatingIssue(true);
    try {
      const updated = await updateGitlabIssueState(projectId, issue.iid, nextState, provider);
      if (updated) {
        setSelectedIssue(updated);
      } else {
        setSelectedIssue({ ...issue, state: nextState });
      }
      await loadIssues();
      window.dispatchEvent(new CustomEvent("modelscript:repo-counts-changed"));
      showToast(nextState === "closed" ? `Closed issue #${issue.iid}` : `Reopened issue #${issue.iid}`, "info");
    } finally {
      setIsUpdatingIssue(false);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIssue || !commentInput.trim()) return;
    setIsUpdatingIssue(true);
    try {
      const comment = await addGitlabIssueComment(
        projectId,
        selectedIssue.iid,
        commentInput.trim(),
        user?.username || "engineer",
      );
      const nextComments = [...(selectedIssue.comments || []), comment];
      setSelectedIssue({ ...selectedIssue, comments: nextComments });
      setCommentInput("");
      await loadIssues();
      showToast("Comment added", "success");
    } finally {
      setIsUpdatingIssue(false);
    }
  };

  const toggleNewLabel = (label: string) => {
    setSelectedNewLabels((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  };

  return (
    <Box>
      {/* Search & Action Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
        <Box display="flex" alignItems="center" gap={2} flex={1} style={{ minWidth: "240px" }}>
          <TextInput
            leadingVisual={SearchIcon}
            placeholder="Search issues by title, author, or label..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", maxWidth: "420px" }}
          />
        </Box>

        <Button
          variant="primary"
          leadingVisual={PlusIcon}
          onClick={() => {
            setCreateError(null);
            setIsDialogOpen(true);
          }}
        >
          New issue
        </Button>
      </Box>

      {/* Label Filter Bar */}
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={3}>
        <Text fontSize="12px" color="var(--color-fg-muted)" style={{ marginRight: "4px" }}>
          Labels:
        </Text>
        <button
          type="button"
          onClick={() => setLabelFilter(null)}
          style={{
            border: `1px solid ${labelFilter === null ? "var(--ms-brand, #0f766e)" : "var(--color-border-default)"}`,
            background: labelFilter === null ? "rgba(15, 118, 110, 0.12)" : "transparent",
            color: labelFilter === null ? "var(--ms-brand, #0f766e)" : "var(--color-fg-muted)",
            borderRadius: "9999px",
            padding: "2px 10px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          All
        </button>
        {ISSUE_LABELS.map((lbl) => (
          <button
            key={lbl.name}
            type="button"
            onClick={() => setLabelFilter((prev) => (prev === lbl.name ? null : lbl.name))}
            style={{
              border: `1px solid ${labelFilter === lbl.name ? lbl.color : "var(--color-border-default)"}`,
              background: labelFilter === lbl.name ? `${lbl.color}20` : "transparent",
              color: labelFilter === lbl.name ? lbl.color : "var(--color-fg-muted)",
              borderRadius: "9999px",
              padding: "2px 10px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: lbl.color,
                display: "inline-block",
              }}
            />
            {lbl.name}
          </button>
        ))}
      </Box>

      {loadError ? (
        <Flash variant="danger" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3 }}>
          <span>{loadError}</span>
          <Button size="small" onClick={loadIssues}>
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
                <IssueOpenedIcon size={16} />
                <span>{counts.opened} Open</span>
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
                <IssueClosedIcon size={16} />
                <span>{counts.closed} Closed</span>
              </button>
            </Box>
          </Box>

          {loading ? (
            <Box p={4} display="flex" justifyContent="center">
              <Spinner />
            </Box>
          ) : filteredIssues.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" p={8} textAlign="center">
              <IssueOpenedIcon size={32} fill="var(--color-fg-muted)" />
              <Heading as="h3" style={{ fontSize: "18px", marginTop: "14px", marginBottom: "6px" }}>
                {stateFilter === "closed" ? "No closed issues" : "No open issues matching your filters"}
              </Heading>
              <Text color="var(--color-fg-muted)" style={{ fontSize: "14px" }}>
                Issues track numerical solver bugs, model validation requests, and engineering milestones.
              </Text>
            </Box>
          ) : (
            <Box display="flex" flexDirection="column">
              {filteredIssues.map((issue) => {
                const isClosed = issue.state === "closed";
                const commentCount = (issue.comments || []).length;
                return (
                  <CommitRow key={issue.id} style={{ cursor: "pointer" }} onClick={() => setSelectedIssue(issue)}>
                    <Box display="flex" gap={3} alignItems="flex-start" flex={1}>
                      <div style={{ marginTop: "3px" }}>
                        {isClosed ? (
                          <IssueClosedIcon fill="var(--color-done-fg, #8250df)" />
                        ) : (
                          <IssueOpenedIcon fill="var(--color-success-fg)" />
                        )}
                      </div>
                      <Box display="flex" flexDirection="column" gap={1}>
                        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                          <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "15px" }}>
                            {issue.title}
                          </Text>
                          {(issue.labels || []).map((lbl) => {
                            const color = getLabelColor(lbl);
                            return (
                              <span
                                key={lbl}
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  padding: "1px 8px",
                                  borderRadius: "9999px",
                                  backgroundColor: `${color}18`,
                                  color,
                                  border: `1px solid ${color}40`,
                                }}
                              >
                                {lbl}
                              </span>
                            );
                          })}
                        </Box>
                        <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                          #{issue.iid} {isClosed ? "closed" : "opened"} {getRelativeTime(issue.created_at)} by{" "}
                          <strong>@{issue.author.username}</strong>
                        </Text>
                      </Box>
                    </Box>

                    {commentCount > 0 && (
                      <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)" fontSize="12px">
                        <CommentIcon size={14} />
                        <span>{commentCount}</span>
                      </Box>
                    )}
                  </CommitRow>
                );
              })}
            </Box>
          )}
        </StyledBox>
      )}

      {/* Issue Detail Modal */}
      {selectedIssue && (
        <Dialog
          onClose={() => setSelectedIssue(null)}
          title={`#${selectedIssue.iid} ${selectedIssue.title}`}
          width="xlarge"
        >
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <Label variant={selectedIssue.state === "closed" ? "done" : "success"}>
                  {selectedIssue.state === "closed" ? "Closed" : "Open"}
                </Label>
                <Text color="var(--color-fg-muted)" fontSize={1}>
                  opened {getRelativeTime(selectedIssue.created_at)} by{" "}
                  <strong>@{selectedIssue.author.username}</strong>
                </Text>
                {(selectedIssue.labels || []).map((lbl) => {
                  const color = getLabelColor(lbl);
                  return (
                    <span
                      key={lbl}
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "1px 8px",
                        borderRadius: "9999px",
                        backgroundColor: `${color}18`,
                        color,
                      }}
                    >
                      {lbl}
                    </span>
                  );
                })}
              </Box>
            </Box>

            <Box p={3} bg="var(--color-canvas-subtle)" borderRadius={2} border="1px solid var(--color-border-default)">
              <MarkdownBody
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    marked.parse(selectedIssue.description || "No description provided.") as string,
                  ),
                }}
              />
            </Box>

            {/* Comment Thread */}
            {(selectedIssue.comments || []).length > 0 && (
              <Box display="flex" flexDirection="column" gap={2}>
                <Text fontWeight="bold" fontSize="13px">
                  Comments ({(selectedIssue.comments || []).length})
                </Text>
                {(selectedIssue.comments || []).map((c) => (
                  <Box
                    key={c.id}
                    p={3}
                    borderRadius={2}
                    border="1px solid var(--color-border-default)"
                    bg="var(--color-canvas-default)"
                  >
                    <Box display="flex" alignItems="center" gap={2} mb={2}>
                      <Avatar src={getAvatarUrl(undefined, c.author)} size={20} />
                      <Text fontWeight="bold" fontSize="13px">
                        @{c.author}
                      </Text>
                      <Text color="var(--color-fg-muted)" fontSize="12px">
                        commented {getRelativeTime(c.created_at)}
                      </Text>
                    </Box>
                    <MarkdownBody
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(marked.parse(c.body) as string),
                      }}
                    />
                  </Box>
                ))}
              </Box>
            )}

            {/* Add Comment & State Action Form */}
            <form onSubmit={handleAddComment}>
              <Textarea
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="Add a comment or engineering diagnostic note (Markdown supported)..."
                block
                rows={3}
              />
              <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} mt={3} flexWrap="wrap">
                <Button
                  type="button"
                  leadingVisual={selectedIssue.state === "closed" ? IssueReopenedIcon : IssueClosedIcon}
                  onClick={() => handleToggleIssueState(selectedIssue)}
                  disabled={isUpdatingIssue}
                >
                  {selectedIssue.state === "closed" ? "Reopen issue" : "Close issue"}
                </Button>

                <Box display="flex" gap={2}>
                  <Button type="button" onClick={() => setSelectedIssue(null)}>
                    Done
                  </Button>
                  <Button type="submit" variant="primary" disabled={!commentInput.trim() || isUpdatingIssue}>
                    Comment
                  </Button>
                </Box>
              </Box>
            </form>
          </Box>
        </Dialog>
      )}

      {/* Create New Issue Modal */}
      {isDialogOpen && (
        <Dialog onClose={() => setIsDialogOpen(false)} title="Create New Issue" width="large">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            {createError && <Flash variant="danger">{createError}</Flash>}

            <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
              <Text fontSize="12px" color="var(--color-fg-muted)" style={{ marginRight: "4px" }}>
                Templates:
              </Text>
              {[
                {
                  label: "Solver / DAE Bug",
                  title: "Numerical convergence issue during initialization",
                  body: "## Summary\nDescribe the model equation or initialization failure.\n\n## Steps to Reproduce\n1. Flatten model\n2. Run DAE solver with tolerance `1e-6`\n",
                  tags: ["bug", "dae-solver"],
                },
                {
                  label: "New Model / Feature",
                  title: "Add parameterized component model",
                  body: "## Motivation\nDescribe the physical domain and equations to add.\n\n## Validation Reference\nReference analytical or benchmark trajectory.\n",
                  tags: ["enhancement"],
                },
                {
                  label: "FMI / Co-Simulation",
                  title: "FMU 2.0/3.0 causality or unit export check",
                  body: "## Description\nSpecify the `modelDescription.xml` port or unit definition affected.\n",
                  tags: ["fmi", "units"],
                },
              ].map((tpl) => (
                <Button
                  key={tpl.label}
                  type="button"
                  size="small"
                  onClick={() => {
                    setNewIssueTitle(tpl.title);
                    setNewIssueBody(tpl.body);
                    setSelectedNewLabels(tpl.tags);
                  }}
                >
                  {tpl.label}
                </Button>
              ))}
            </Box>

            <TextInput
              value={newIssueTitle}
              onChange={(e) => setNewIssueTitle(e.target.value)}
              placeholder="Title"
              block
            />

            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Text fontSize="12px" color="var(--color-fg-muted)" style={{ marginRight: "4px" }}>
                Labels:
              </Text>
              {ISSUE_LABELS.map((lbl) => {
                const active = selectedNewLabels.includes(lbl.name);
                return (
                  <button
                    key={lbl.name}
                    type="button"
                    onClick={() => toggleNewLabel(lbl.name)}
                    style={{
                      border: `1px solid ${active ? lbl.color : "var(--color-border-default)"}`,
                      background: active ? `${lbl.color}20` : "transparent",
                      color: active ? lbl.color : "var(--color-fg-muted)",
                      borderRadius: "9999px",
                      padding: "2px 10px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {lbl.name}
                  </button>
                );
              })}
            </Box>

            <Textarea
              value={newIssueBody}
              onChange={(e) => setNewIssueBody(e.target.value)}
              placeholder="Describe the engineering issue, equations, or reproduction steps (Markdown supported)..."
              block
              rows={6}
            />
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateIssue} disabled={!newIssueTitle.trim() || isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit new issue"}
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default IssuesTab;
