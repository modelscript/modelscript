// SPDX-License-Identifier: AGPL-3.0-or-later

import { ActionList, Button, Dialog, Flash, Heading, Label, Text, TextInput } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createRepoWebhook,
  deleteRepo,
  deleteRepoWebhook,
  getRepoWebhooks,
  updateRepo,
  type GitlabProject,
} from "../../../api";
import Box from "../../../components/Box";
import { StyledBox } from "../styles";

export interface SettingsTabProps {
  repo: GitlabProject;
}

type SettingsSection = "general" | "access" | "branches" | "tags" | "webhooks" | "pages";

interface CollaboratorEntry {
  username: string;
  role: "Maintainer" | "Contributor" | "Viewer";
}

interface RepoWebhook {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  createdAt?: string;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ repo }) => {
  const storageKey = `modelscript:repo-settings:${repo.id}`;
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [repoName, setRepoName] = useState(repo.name);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState(repo.visibility || "public");
  const [socialPreviewUrl, setSocialPreviewUrl] = useState<string | null>((repo as any).socialPreviewUrl || null);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  // Access state
  const [collaborators, setCollaborators] = useState<CollaboratorEntry[]>([
    { username: repo.namespace?.path || "owner", role: "Maintainer" },
  ]);
  const [newCollaborator, setNewCollaborator] = useState("");
  const [newCollaboratorRole, setNewCollaboratorRole] = useState<CollaboratorEntry["role"]>("Contributor");

  // Branches state
  const [defaultBranch, setDefaultBranch] = useState(repo.default_branch || "main");
  const [requirePrReview, setRequirePrReview] = useState(true);
  const [requireStatusChecks, setRequireStatusChecks] = useState(true);

  // Tags state
  const [tagPattern, setTagPattern] = useState("v*.*.*");
  const [requireSignedTags, setRequireSignedTags] = useState(true);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<RepoWebhook[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState("push,merge_request,simulation");

  // Pages state
  const [pagesBranch, setPagesBranch] = useState(repo.default_branch || "main");
  const [pagesEnabled, setPagesEnabled] = useState(Boolean((repo as any).pagesEnabled));

  const showSuccess = (msg = "Settings successfully saved.") => {
    setSaveError(null);
    setSavedMessage(msg);
    setTimeout(() => setSavedMessage(null), 3500);
  };

  const persistLocalSettings = (patch: Record<string, any>) => {
    try {
      const raw = localStorage.getItem(storageKey);
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem(storageKey, JSON.stringify({ ...prev, ...patch }));
    } catch {
      // Ignore storage quota errors
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.name) setRepoName(parsed.name);
        if (parsed.visibility) setVisibility(parsed.visibility);
        if (parsed.socialPreviewUrl !== undefined) setSocialPreviewUrl(parsed.socialPreviewUrl);
        if (parsed.defaultBranch) setDefaultBranch(parsed.defaultBranch);
        if (Array.isArray(parsed.collaborators)) setCollaborators(parsed.collaborators);
        if (Array.isArray(parsed.webhooks)) setWebhooks(parsed.webhooks);
      }
    } catch {
      // Ignore malformed local state
    }
  }, [storageKey]);

  useEffect(() => {
    if (activeSection !== "webhooks") return;
    getRepoWebhooks(repo.id)
      .then((res) => {
        if (Array.isArray(res?.webhooks)) {
          setWebhooks(res.webhooks);
        }
      })
      .catch(() => {
        // Keep local fallback webhooks
      });
  }, [activeSection, repo.id]);

  const saveRepoUpdates = async (updates: Record<string, any>, successText?: string) => {
    setSaveError(null);
    try {
      await updateRepo(repo.id, updates);
      persistLocalSettings(updates);
      showSuccess(successText);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || err?.message || "Failed to update repository settings.");
    }
  };

  const handleRename = async () => {
    const trimmed = repoName.trim();
    if (!trimmed) return;
    await saveRepoUpdates({ name: trimmed }, `Repository renamed to '${trimmed}'.`);
  };

  const handleSocialPreviewUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      setSocialPreviewUrl(dataUrl);
      await saveRepoUpdates({ socialPreviewUrl: dataUrl }, "Social preview image updated.");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveSocialPreview = async () => {
    setSocialPreviewUrl(null);
    await saveRepoUpdates({ socialPreviewUrl: null }, "Social preview image removed.");
  };

  const handleToggleVisibility = async () => {
    const nextVis = visibility === "public" ? "private" : "public";
    setVisibility(nextVis);
    setShowVisibilityModal(false);
    await saveRepoUpdates({ visibility: nextVis }, `Repository visibility changed to ${nextVis}.`);
  };

  const handleDelete = async () => {
    if (deleteConfirmText.toLowerCase() !== repo.name.toLowerCase()) return;
    setShowDeleteModal(false);
    setSaveError(null);
    try {
      await deleteRepo(repo.id);
      navigate("/repos");
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || err?.message || "Failed to delete repository.");
    }
  };

  const handleAddCollaborator = async () => {
    const trimmed = newCollaborator.trim();
    if (!trimmed) return;
    const next = [
      ...collaborators.filter((c) => c.username !== trimmed),
      { username: trimmed, role: newCollaboratorRole },
    ];
    setCollaborators(next);
    setNewCollaborator("");
    await saveRepoUpdates({ collaborators: next }, `Added ${trimmed} as ${newCollaboratorRole}.`);
  };

  const handleAddWebhook = async () => {
    const trimmedUrl = newWebhookUrl.trim();
    if (!trimmedUrl) return;
    const events = newWebhookEvents
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSaveError(null);
    try {
      const created = await createRepoWebhook(repo.id, { url: trimmedUrl, events, active: true });
      const hook: RepoWebhook = created?.webhook || {
        id: Date.now(),
        url: trimmedUrl,
        events,
        active: true,
      };
      const next = [...webhooks, hook];
      setWebhooks(next);
      persistLocalSettings({ webhooks: next });
      setNewWebhookUrl("");
      showSuccess("Webhook registered.");
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || err?.message || "Failed to register webhook.");
    }
  };

  const handleDeleteWebhook = async (webhookId: number) => {
    setSaveError(null);
    try {
      await deleteRepoWebhook(repo.id, webhookId);
      const next = webhooks.filter((w) => w.id !== webhookId);
      setWebhooks(next);
      persistLocalSettings({ webhooks: next });
      showSuccess("Webhook removed.");
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || err?.message || "Failed to remove webhook.");
    }
  };

  const publishedDocsUrl =
    typeof (repo as any).pagesUrl === "string" && (repo as any).pagesUrl.trim().length > 0
      ? (repo as any).pagesUrl.trim()
      : null;

  return (
    <Box display="grid" style={{ gridTemplateColumns: "250px 1fr", gap: "32px" }}>
      <Box>
        <ActionList>
          <ActionList.Item selected={activeSection === "general"} onClick={() => setActiveSection("general")}>
            General
          </ActionList.Item>
          <ActionList.Item selected={activeSection === "access"} onClick={() => setActiveSection("access")}>
            Access
          </ActionList.Item>
          <ActionList.Item selected={activeSection === "branches"} onClick={() => setActiveSection("branches")}>
            Branches
          </ActionList.Item>
          <ActionList.Item selected={activeSection === "tags"} onClick={() => setActiveSection("tags")}>
            Tags
          </ActionList.Item>
          <ActionList.Item selected={activeSection === "webhooks"} onClick={() => setActiveSection("webhooks")}>
            Webhooks
          </ActionList.Item>
          <ActionList.Item selected={activeSection === "pages"} onClick={() => setActiveSection("pages")}>
            Pages
          </ActionList.Item>
        </ActionList>
      </Box>

      <Box display="flex" flexDirection="column" gap={5}>
        {savedMessage && (
          <Flash variant="success" style={{ marginBottom: "8px" }}>
            {savedMessage}
          </Flash>
        )}
        {saveError && (
          <Flash variant="danger" style={{ marginBottom: "8px" }}>
            {saveError}
          </Flash>
        )}

        {activeSection === "general" && (
          <>
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
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleSocialPreviewUpload}
                  />
                  <Box
                    bg="var(--color-canvas-subtle)"
                    p={4}
                    borderRadius={2}
                    style={{ border: "1px solid var(--color-border-default)" }}
                    display="flex"
                    flexDirection="column"
                    justifyContent="center"
                    alignItems="center"
                    gap={3}
                  >
                    {socialPreviewUrl ? (
                      <img
                        src={socialPreviewUrl}
                        alt="Repository social preview"
                        style={{ maxWidth: "360px", maxHeight: "180px", borderRadius: 6, objectFit: "cover" }}
                      />
                    ) : (
                      <Text color="var(--color-fg-muted)">
                        Upload an image to customize your repository's social media preview.
                      </Text>
                    )}
                    <Box display="flex" gap={2}>
                      <Button size="small" onClick={() => fileInputRef.current?.click()}>
                        Upload image...
                      </Button>
                      {socialPreviewUrl && (
                        <Button size="small" variant="danger" onClick={handleRemoveSocialPreview}>
                          Remove
                        </Button>
                      )}
                    </Box>
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
          </>
        )}

        {activeSection === "access" && (
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
              Collaborators &amp; Access
            </Heading>
            <Box display="flex" gap={2} mb={3} alignItems="center">
              <TextInput
                placeholder="Add collaborator by username..."
                value={newCollaborator}
                onChange={(e) => setNewCollaborator(e.target.value)}
                block
              />
              <select
                value={newCollaboratorRole}
                onChange={(e) => setNewCollaboratorRole(e.target.value as CollaboratorEntry["role"])}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                }}
              >
                <option value="Maintainer">Maintainer</option>
                <option value="Contributor">Contributor</option>
                <option value="Viewer">Viewer</option>
              </select>
              <Button variant="primary" onClick={handleAddCollaborator}>
                Add Collaborator
              </Button>
            </Box>
            <StyledBox>
              {collaborators.map((c, idx) => (
                <Box
                  key={c.username}
                  p={3}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  style={{
                    borderBottom: idx < collaborators.length - 1 ? "1px solid var(--color-border-muted)" : undefined,
                  }}
                >
                  <Text style={{ fontWeight: "bold" }}>@{c.username}</Text>
                  <Label variant="accent">{c.role}</Label>
                </Box>
              ))}
            </StyledBox>
          </Box>
        )}

        {activeSection === "branches" && (
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
              Branches
            </Heading>
            <Box display="flex" flexDirection="column" gap={3}>
              <Box>
                <Text as="label" style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                  Default branch
                </Text>
                <Box display="flex" gap={2}>
                  <TextInput value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} />
                  <Button
                    variant="primary"
                    onClick={() =>
                      saveRepoUpdates(
                        { default_branch: defaultBranch, defaultBranch },
                        `Default branch set to '${defaultBranch}'.`,
                      )
                    }
                  >
                    Update Default Branch
                  </Button>
                </Box>
              </Box>
              <StyledBox p={3}>
                <Text style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                  Branch Protection Rules ({defaultBranch})
                </Text>
                <Box display="flex" flexDirection="column" gap={2}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={requirePrReview}
                      onChange={(e) => {
                        setRequirePrReview(e.target.checked);
                        saveRepoUpdates({ requirePrReview: e.target.checked });
                      }}
                    />
                    <Text>Require a pull request review before merging</Text>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={requireStatusChecks}
                      onChange={(e) => {
                        setRequireStatusChecks(e.target.checked);
                        saveRepoUpdates({ requireStatusChecks: e.target.checked });
                      }}
                    />
                    <Text>Require ModelScript compiler &amp; simulation status checks to pass</Text>
                  </label>
                </Box>
              </StyledBox>
            </Box>
          </Box>
        )}

        {activeSection === "tags" && (
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
              Protected Release Tags
            </Heading>
            <Box display="flex" flexDirection="column" gap={3}>
              <Box>
                <Text as="label" style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
                  Protected tag pattern
                </Text>
                <Box display="flex" gap={2}>
                  <TextInput value={tagPattern} onChange={(e) => setTagPattern(e.target.value)} />
                  <Button
                    variant="primary"
                    onClick={() => saveRepoUpdates({ tagPattern }, `Protected tag rule '${tagPattern}' saved.`)}
                  >
                    Save Rule
                  </Button>
                </Box>
              </Box>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={requireSignedTags}
                  onChange={(e) => {
                    setRequireSignedTags(e.target.checked);
                    saveRepoUpdates({ requireSignedTags: e.target.checked });
                  }}
                />
                <Text>Require cryptographic signature verification on release tags</Text>
              </label>
            </Box>
          </Box>
        )}

        {activeSection === "webhooks" && (
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
              Webhooks
            </Heading>
            <Box display="flex" flexDirection="column" gap={3}>
              <StyledBox p={3}>
                <Text style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>Add webhook</Text>
                <Box display="flex" flexDirection="column" gap={2}>
                  <TextInput
                    placeholder="https://example.com/webhooks/modelscript"
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                    block
                  />
                  <TextInput
                    placeholder="Events (comma-separated: push,merge_request,simulation)"
                    value={newWebhookEvents}
                    onChange={(e) => setNewWebhookEvents(e.target.value)}
                    block
                  />
                  <Box>
                    <Button variant="primary" onClick={handleAddWebhook}>
                      Add webhook
                    </Button>
                  </Box>
                </Box>
              </StyledBox>

              <StyledBox>
                {webhooks.length === 0 ? (
                  <Box p={3}>
                    <Text color="var(--color-fg-muted)">No webhooks configured for this repository yet.</Text>
                  </Box>
                ) : (
                  webhooks.map((hook, idx) => (
                    <Box
                      key={hook.id}
                      p={3}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      style={{
                        borderBottom: idx < webhooks.length - 1 ? "1px solid var(--color-border-muted)" : undefined,
                      }}
                    >
                      <Box>
                        <Text style={{ fontWeight: "bold", display: "block" }}>{hook.url}</Text>
                        <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                          Events: {(hook.events || []).join(", ")}
                        </Text>
                      </Box>
                      <Button size="small" variant="danger" onClick={() => handleDeleteWebhook(hook.id)}>
                        Delete
                      </Button>
                    </Box>
                  ))
                )}
              </StyledBox>
            </Box>
          </Box>
        )}

        {activeSection === "pages" && (
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
              ModelScript Package Documentation Pages
            </Heading>
            <StyledBox p={3}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box>
                  <Text style={{ fontWeight: "bold", display: "block" }}>Documentation site status</Text>
                  <Text color="var(--color-fg-muted)" style={{ fontSize: "12px" }}>
                    {publishedDocsUrl && pagesEnabled ? (
                      <>
                        Your package documentation is published from branch <strong>{pagesBranch}</strong>:{" "}
                        <a href={publishedDocsUrl} target="_blank" rel="noreferrer">
                          {publishedDocsUrl}
                        </a>
                      </>
                    ) : (
                      <>
                        Documentation site is not published. Source branch: <strong>{pagesBranch}</strong>.
                      </>
                    )}
                  </Text>
                </Box>
                <Label variant={publishedDocsUrl && pagesEnabled ? "success" : "secondary"}>
                  {publishedDocsUrl && pagesEnabled ? "Published" : "Disabled"}
                </Label>
              </Box>
              <Box display="flex" gap={2} alignItems="center">
                <TextInput value={pagesBranch} onChange={(e) => setPagesBranch(e.target.value)} />
                <Button
                  variant="primary"
                  onClick={() =>
                    saveRepoUpdates(
                      { pagesBranch, pagesEnabled },
                      `Documentation source branch updated to '${pagesBranch}'.`,
                    )
                  }
                >
                  Save Pages Config
                </Button>
                <Button
                  onClick={() => {
                    const next = !pagesEnabled;
                    setPagesEnabled(next);
                    saveRepoUpdates(
                      { pagesEnabled: next },
                      next ? "Pages publishing enabled." : "Pages publishing paused.",
                    );
                  }}
                >
                  {pagesEnabled ? "Disable Pages" : "Enable Pages"}
                </Button>
              </Box>
            </StyledBox>
          </Box>
        )}
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
