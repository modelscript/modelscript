// SPDX-License-Identifier: AGPL-3.0-or-later

import { ActionList, Button, Dialog, Flash, Heading, Text, TextInput } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GitlabProject } from "../../../api";
import Box from "../../../components/Box";
import { StyledBox } from "../styles";

export interface SettingsTabProps {
  repo: GitlabProject;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ repo }) => {
  const [repoName, setRepoName] = useState(repo.name);
  const [saved, setSaved] = useState(false);
  const [visibility, setVisibility] = useState(repo.visibility || "public");
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const navigate = useNavigate();

  const handleRename = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleToggleVisibility = () => {
    setVisibility((prev) => (prev === "public" ? "private" : "public"));
    setShowVisibilityModal(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleDelete = () => {
    if (deleteConfirmText.toLowerCase() !== repo.name.toLowerCase()) return;
    setShowDeleteModal(false);
    navigate("/repos");
  };

  return (
    <Box display="grid" style={{ gridTemplateColumns: "250px 1fr", gap: "32px" }}>
      <Box>
        <ActionList>
          <ActionList.Item selected>General</ActionList.Item>
          <ActionList.Item>Access</ActionList.Item>
          <ActionList.Item>Branches</ActionList.Item>
          <ActionList.Item>Tags</ActionList.Item>
          <ActionList.Item>Webhooks</ActionList.Item>
          <ActionList.Item>Pages</ActionList.Item>
        </ActionList>
      </Box>
      <Box display="flex" flexDirection="column" gap={5}>
        <Box>
          <Heading
            as="h2"
            style={{
              fontSize: "24px",
              borderBottom: "1px solid var(--color-border-default)",
              paddingBottom: "8px",
              marginBottom: "16px",
            }}
          >
            General
          </Heading>

          {saved && (
            <Flash variant="success" style={{ marginBottom: "16px" }}>
              Settings successfully saved.
            </Flash>
          )}

          <Box display="flex" flexDirection="column" gap={4}>
            <Box>
              <Text as="label" style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                Repository name
              </Text>
              <Box display="flex" gap={2}>
                <TextInput value={repoName} onChange={(e) => setRepoName(e.target.value)} block />
                <Button variant="primary" onClick={handleRename}>
                  Rename
                </Button>
              </Box>
            </Box>
            <Box style={{ borderTop: "1px solid var(--color-border-default)", paddingTop: "16px" }}>
              <Text as="label" style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                Social preview
              </Text>
              <Box
                bg="var(--color-canvas-subtle)"
                p={4}
                borderRadius={2}
                style={{ border: "1px solid var(--color-border-default)" }}
                display="flex"
                justifyContent="center"
                alignItems="center"
              >
                <Text color="var(--color-fg-muted)">
                  Upload an image to customize your repository's social media preview.
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>

        <Box>
          <Heading
            as="h2"
            style={{
              fontSize: "24px",
              color: "var(--color-danger-fg)",
              borderBottom: "1px solid var(--color-danger-muted)",
              paddingBottom: "8px",
              marginBottom: "16px",
            }}
          >
            Danger Zone
          </Heading>
          <StyledBox style={{ borderColor: "var(--color-danger-muted)" }}>
            <Box
              p={3}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              style={{ borderBottom: "1px solid var(--color-danger-muted)" }}
            >
              <Box>
                <Text style={{ fontWeight: "bold", display: "block" }}>Change repository visibility</Text>
                <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                  This repository is currently <strong>{visibility}</strong>.
                </Text>
              </Box>
              <Button variant="danger" onClick={() => setShowVisibilityModal(true)}>
                Change visibility
              </Button>
            </Box>
            <Box p={3} display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <Text style={{ fontWeight: "bold", display: "block" }}>Delete this repository</Text>
                <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                  Once you delete a repository, there is no going back. Please be certain.
                </Text>
              </Box>
              <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
                Delete this repository
              </Button>
            </Box>
          </StyledBox>
        </Box>
      </Box>

      {showVisibilityModal && (
        <Dialog onClose={() => setShowVisibilityModal(false)} title="Change Repository Visibility">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text>
              Are you sure you want to change the visibility of this repository to{" "}
              <strong>{visibility === "public" ? "private" : "public"}</strong>?
            </Text>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setShowVisibilityModal(false)}>Cancel</Button>
              <Button variant="danger" onClick={handleToggleVisibility}>
                Confirm Change
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}

      {showDeleteModal && (
        <Dialog onClose={() => setShowDeleteModal(false)} title="Delete Repository">
          <Box p={3} display="flex" flexDirection="column" gap={3}>
            <Text color="var(--color-danger-fg)">
              This action <strong>cannot</strong> be undone. This will permanently delete the{" "}
              <strong>{repo.name}</strong> repository.
            </Text>
            <Text fontSize={1}>
              Please type <strong>{repo.name}</strong> to confirm:
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={repo.name}
              block
            />
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <Button onClick={() => setShowDeleteModal(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={deleteConfirmText.toLowerCase() !== repo.name.toLowerCase()}
              >
                I understand the consequences, delete this repository
              </Button>
            </Box>
          </Box>
        </Dialog>
      )}
    </Box>
  );
};

export default SettingsTab;
