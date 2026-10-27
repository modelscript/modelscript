// SPDX-License-Identifier: AGPL-3.0-or-later

import { GitPullRequestIcon } from "@primer/octicons-react";
import { Button, Dialog, Flash, Heading, Label, Spinner, Text, TextInput, Textarea } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useEffect, useState } from "react";
import type { GitlabMergeRequest } from "../../../api";
import { createGitlabMergeRequest, getGitlabMergeRequests } from "../../../api";
import Box from "../../../components/Box";
import { CommitRow, MarkdownBody, StyledBox } from "../styles";
import { getRelativeTime } from "../utils";

export interface PullRequestsTabProps {
  projectId: string;
  provider: string;
  defaultBranch?: string | undefined;
}

export const PullRequestsTab: React.FC<PullRequestsTabProps> = ({ projectId, provider, defaultBranch = "main" }) => {
  const [mrs, setMrs] = useState<GitlabMergeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMr, setSelectedMr] = useState<GitlabMergeRequest | null>(null);
  const [isNewMrDialogOpen, setIsNewMrDialogOpen] = useState(false);
  const [newMrTitle, setNewMrTitle] = useState("");
  const [newMrDesc, setNewMrDesc] = useState("");
  const [newMrSource, setNewMrSource] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await getGitlabMergeRequests(projectId, provider);
        setMrs(data);
      } catch {
        // ignore
      }
      setLoading(false);
    }
    load();
  }, [projectId, provider]);

  const handleCreateMr = async () => {
    if (!newMrTitle) return;
    const sourceBranch = newMrSource || "feature-branch";
    setError(null);
    try {
      const created = await createGitlabMergeRequest(
        projectId,
        {
          title: newMrTitle,
          description: newMrDesc,
          source_branch: sourceBranch,
          target_branch: defaultBranch,
        },
        provider,
      );
      setMrs([created, ...mrs]);
      setIsNewMrDialogOpen(false);
      setNewMrTitle("");
      setNewMrDesc("");
      setNewMrSource("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create pull request.";
      setError(msg);
      setIsNewMrDialogOpen(false);
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Heading as="h2" style={{ fontSize: "20px" }}>
          Pull Requests
        </Heading>
        <Button variant="primary" onClick={() => setIsNewMrDialogOpen(true)}>
          New pull request
        </Button>
      </Box>

      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error}
        </Flash>
      )}

      <StyledBox>
        <Box
          bg="var(--color-canvas-subtle)"
          p={3}
          style={{ borderBottom: "1px solid var(--color-border-default)" }}
          display="flex"
          alignItems="center"
          gap={2}
        >
          <GitPullRequestIcon />
          <Text style={{ fontWeight: "bold" }}>{mrs.length} Open</Text>
        </Box>

        {loading ? (
          <Box p={4} display="flex" justifyContent="center">
            <Spinner />
          </Box>
        ) : mrs.length === 0 ? (
          <Box display="flex" flexDirection="column" alignItems="center" p={8} textAlign="center">
            <GitPullRequestIcon size={32} fill="var(--color-fg-muted)" />
            <Heading as="h3" style={{ fontSize: "20px", marginTop: "16px", marginBottom: "8px" }}>
              Welcome to pull requests!
            </Heading>
            <Text color="var(--color-fg-muted)">Pull requests help you collaborate on code with other people.</Text>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column">
            {mrs.map((mr) => (
              <CommitRow key={mr.id} style={{ cursor: "pointer" }} onClick={() => setSelectedMr(mr)}>
                <Box display="flex" gap={3}>
                  <div style={{ marginTop: "4px" }}>
                    <GitPullRequestIcon fill="var(--color-success-fg)" />
                  </div>
                  <Box display="flex" flexDirection="column">
                    <Text style={{ fontWeight: "bold", color: "var(--color-fg-default)", fontSize: "16px" }}>
                      {mr.title}
                    </Text>
                    <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                      #{mr.iid} opened {getRelativeTime(mr.created_at)} by {mr.author.username}
                    </Text>
                  </Box>
                </Box>
              </CommitRow>
            ))}
          </Box>
        )}
      </StyledBox>

      {selectedMr && (
        <Dialog onClose={() => setSelectedMr(null)} title={`#${selectedMr.iid} ${selectedMr.title}`}>
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Box display="flex" alignItems="center" gap={2}>
              <Label variant={selectedMr.state === "opened" ? "success" : "secondary"}>
                {selectedMr.state === "opened" ? "Open" : "Merged"}
              </Label>
              <Text color="var(--color-fg-muted)" fontSize={1}>
                {selectedMr.source_branch} &rarr; {selectedMr.target_branch} by{" "}
                <strong>@{selectedMr.author.username}</strong>
              </Text>
            </Box>
            <Box p={3} bg="var(--color-canvas-subtle)" borderRadius={2} border="1px solid var(--color-border-default)">
              <MarkdownBody
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    marked.parse(selectedMr.description || "No description provided.") as string,
                  ),
                }}
              />
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setSelectedMr(null)}>Close</Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {isNewMrDialogOpen && (
        <Dialog onClose={() => setIsNewMrDialogOpen(false)} title="New Pull Request">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <TextInput value={newMrTitle} onChange={(e) => setNewMrTitle(e.target.value)} placeholder="Title" block />
            <TextInput
              value={newMrSource}
              onChange={(e) => setNewMrSource(e.target.value)}
              placeholder="Source Branch (e.g. feature-branch)"
              block
            />
            <Textarea
              value={newMrDesc}
              onChange={(e) => setNewMrDesc(e.target.value)}
              placeholder="Describe your pull request..."
              block
              rows={4}
            />
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setIsNewMrDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreateMr} disabled={!newMrTitle}>
                Create pull request
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default PullRequestsTab;
