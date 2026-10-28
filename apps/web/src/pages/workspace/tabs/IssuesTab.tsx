// SPDX-License-Identifier: AGPL-3.0-or-later

import { IssueOpenedIcon } from "@primer/octicons-react";
import { Button, Dialog, Flash, Heading, Label, Spinner, Text, TextInput, Textarea } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useState } from "react";
import type { GitlabIssue } from "../../../api";
import { createGitlabIssue, getGitlabIssues } from "../../../api";
import Box from "../../../components/Box";
import { CommitRow, MarkdownBody, StyledBox } from "../styles";
import { getRelativeTime } from "../utils";

export interface IssuesTabProps {
  projectId: string;
  provider: string;
}

export const IssuesTab: React.FC<IssuesTabProps> = ({ projectId, provider }) => {
  const [issues, setIssues] = useState<GitlabIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueBody, setNewIssueBody] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<GitlabIssue | null>(null);

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

  const handleCreateIssue = async () => {
    setCreateError(null);
    setIsSubmitting(true);
    try {
      await createGitlabIssue(projectId, newIssueTitle, newIssueBody, provider);
      setIsDialogOpen(false);
      setNewIssueTitle("");
      setNewIssueBody("");
      loadIssues();
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || err?.message || "Failed to create issue.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Issues
        </Heading>
        <Button
          variant="primary"
          onClick={() => {
            setCreateError(null);
            setIsDialogOpen(true);
          }}
        >
          New issue
        </Button>
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
            gap={2}
          >
            <IssueOpenedIcon />
            <Text style={{ fontWeight: "bold" }}>{issues.length} Open</Text>
          </Box>

          {loading ? (
            <Box p={4} display="flex" justifyContent="center">
              <Spinner />
            </Box>
          ) : issues.length === 0 ? (
            <Box display="flex" flexDirection="column" alignItems="center" p={8} textAlign="center">
              <IssueOpenedIcon size={32} fill="var(--color-fg-muted)" />
              <Heading as="h3" style={{ fontSize: "20px", marginTop: "16px", marginBottom: "8px" }}>
                Welcome to issues!
              </Heading>
              <Text color="var(--color-fg-muted)">
                Issues are used to track todos, bugs, feature requests, and more.
              </Text>
            </Box>
          ) : (
            <Box display="flex" flexDirection="column">
              {issues.map((issue) => (
                <CommitRow key={issue.id} style={{ cursor: "pointer" }} onClick={() => setSelectedIssue(issue)}>
                  <Box display="flex" gap={3}>
                    <div style={{ marginTop: "4px" }}>
                      <IssueOpenedIcon fill="var(--color-success-fg)" />
                    </div>
                    <Box display="flex" flexDirection="column">
                      <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "16px" }}>
                        {issue.title}
                      </Text>
                      <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                        #{issue.iid} opened {getRelativeTime(issue.created_at)} by {issue.author.username}
                      </Text>
                    </Box>
                  </Box>
                </CommitRow>
              ))}
            </Box>
          )}
        </StyledBox>
      )}

      {selectedIssue && (
        <Dialog onClose={() => setSelectedIssue(null)} title={`#${selectedIssue.iid} ${selectedIssue.title}`}>
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Box display="flex" alignItems="center" gap={2}>
              <Label variant={selectedIssue.state === "opened" ? "success" : "secondary"}>
                {selectedIssue.state === "opened" ? "Open" : "Closed"}
              </Label>
              <Text color="var(--color-fg-muted)" fontSize={1}>
                opened {getRelativeTime(selectedIssue.created_at)} by <strong>@{selectedIssue.author.username}</strong>
              </Text>
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
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setSelectedIssue(null)}>Close</Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {isDialogOpen && (
        <Dialog onClose={() => setIsDialogOpen(false)} title="Create New Issue">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            {createError && <Flash variant="danger">{createError}</Flash>}
            <TextInput
              value={newIssueTitle}
              onChange={(e) => setNewIssueTitle(e.target.value)}
              placeholder="Title"
              block
            />
            <Textarea
              value={newIssueBody}
              onChange={(e) => setNewIssueBody(e.target.value)}
              placeholder="Leave a comment"
              block
              rows={5}
            />
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateIssue} disabled={!newIssueTitle || isSubmitting}>
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
