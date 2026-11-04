// SPDX-License-Identifier: AGPL-3.0-or-later

import { FileCodeIcon, GlobeIcon, LockIcon, RepoIcon, XIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import { createRepo } from "../../../api/social";
import { saveRepositoryFile } from "../../../api/vcs";
import { useAuth } from "../../../AuthContext";
import { useFocusTrap } from "../../../hooks/useFocusTrap";

export interface CreatePlaygroundRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTitle: string;
  currentCode: string;
  currentLangExt: string;
  onSuccess: (repoFullName: string) => void;
}

export const CreatePlaygroundRepoModal: React.FC<CreatePlaygroundRepoModalProps> = ({
  isOpen,
  onClose,
  currentTitle,
  currentCode,
  currentLangExt,
  onSuccess,
}) => {
  const { user } = useAuth();
  const defaultSlug =
    currentTitle
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "my-simulation-model";

  const [repoName, setRepoName] = useState(defaultSlug);
  const [description, setDescription] = useState(`Simulation model for ${currentTitle} built with ModelScript.`);
  const [branch, setBranch] = useState("main");
  const [isPrivate, setIsPrivate] = useState(false);
  const [commitCurrentModel, setCommitCurrentModel] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useFocusTrap(isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.username) {
      setError("You must be logged in to create a repository.");
      return;
    }

    const cleanSlug = repoName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    if (!cleanSlug) {
      setError("Please enter a valid repository name.");
      return;
    }

    const repoFullName = `${user.username}/${cleanSlug}`;
    setIsSubmitting(true);
    setError(null);

    try {
      await createRepo({
        provider: "local",
        repo_full_name: repoFullName,
        external_repo_id: repoFullName,
        default_branch: branch.trim() || "main",
        description: description.trim() || undefined,
        is_private: isPrivate ? 1 : 0,
      });

      if (commitCurrentModel) {
        const fileName = `${cleanSlug}${currentLangExt.startsWith(".") ? currentLangExt : `.${currentLangExt}`}`;
        try {
          await saveRepositoryFile(
            repoFullName,
            fileName,
            currentCode,
            `Initial model commit for ${currentTitle} via ModelScript Playground`,
            branch.trim() || "main",
            "local",
            user.username,
          );
        } catch (commitErr) {
          console.warn("Could not commit initial model file to repo:", commitErr);
        }
      }

      onSuccess(repoFullName);
      onClose();
    } catch (err: unknown) {
      console.error("Failed to create repository:", err);
      const errObj = err as { response?: { data?: { error?: string } }; message?: string } | undefined;
      const msg = errObj?.response?.data?.error || errObj?.message || "Failed to create repository.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-repo-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxWidth: "540px",
          backgroundColor: "var(--color-canvas-default, #0d1117)",
          border: "1px solid var(--color-border-default, #30363d)",
          borderRadius: "12px",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.56)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--color-fg-default, #e6edf3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border-default, #30363d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(180deg, var(--color-canvas-subtle, #161b22) 0%, transparent 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <RepoIcon size={18} style={{ color: "var(--color-accent-fg, #58a6ff)" }} />
            <div>
              <div id="create-repo-title" style={{ fontSize: "16px", fontWeight: 700 }}>
                Create Ansatz Repository
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)", marginTop: "2px" }}>
                Publish your model to a version-controlled repository on Ansatz
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-fg-muted, #8b949e)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
            aria-label="Close modal"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {error && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: "6px",
                backgroundColor: "rgba(248, 81, 73, 0.15)",
                border: "1px solid rgba(248, 81, 73, 0.4)",
                color: "#ff7b72",
                fontSize: "12px",
              }}
            >
              {error}
            </div>
          )}

          {/* Repo Name */}
          <div>
            <label
              htmlFor="repo-name"
              style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}
            >
              Repository Name
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "var(--color-canvas-subtle, #161b22)",
                border: "1px solid var(--color-border-default, #30363d)",
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  padding: "6px 10px",
                  fontSize: "13px",
                  color: "var(--color-fg-muted, #8b949e)",
                  borderRight: "1px solid var(--color-border-default, #30363d)",
                  backgroundColor: "rgba(255, 255, 255, 0.02)",
                }}
              >
                {user?.username || "user"} /
              </span>
              <input
                id="repo-name"
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="my-engineering-model"
                required
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "inherit",
                  fontSize: "13px",
                }}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="repo-desc"
              style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}
            >
              Description <span style={{ fontWeight: 400, color: "var(--color-fg-muted, #8b949e)" }}>(optional)</span>
            </label>
            <input
              id="repo-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of your model's domain and parameters"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "6px 10px",
                background: "var(--color-canvas-subtle, #161b22)",
                border: "1px solid var(--color-border-default, #30363d)",
                borderRadius: "6px",
                outline: "none",
                color: "inherit",
                fontSize: "13px",
              }}
            />
          </div>

          {/* Branch */}
          <div>
            <label
              htmlFor="repo-branch"
              style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}
            >
              Default Branch
            </label>
            <input
              id="repo-branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              style={{
                width: "140px",
                padding: "6px 10px",
                background: "var(--color-canvas-subtle, #161b22)",
                border: "1px solid var(--color-border-default, #30363d)",
                borderRadius: "6px",
                outline: "none",
                color: "inherit",
                fontSize: "13px",
              }}
            />
          </div>

          {/* Visibility Options */}
          <div style={{ display: "flex", gap: "12px" }}>
            <label
              style={{
                flex: 1,
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                padding: "10px",
                borderRadius: "6px",
                border: `1px solid ${!isPrivate ? "var(--color-accent-fg, #0969da)" : "var(--color-border-subtle, #21262d)"}`,
                backgroundColor: !isPrivate ? "rgba(9, 105, 218, 0.08)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="visibility"
                checked={!isPrivate}
                onChange={() => setIsPrivate(false)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  <GlobeIcon size={13} /> Public
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-fg-muted, #8b949e)", marginTop: 2 }}>
                  Anyone in the community can view and fork this model
                </div>
              </div>
            </label>

            <label
              style={{
                flex: 1,
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                padding: "10px",
                borderRadius: "6px",
                border: `1px solid ${isPrivate ? "var(--color-accent-fg, #0969da)" : "var(--color-border-subtle, #21262d)"}`,
                backgroundColor: isPrivate ? "rgba(9, 105, 218, 0.08)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="visibility"
                checked={isPrivate}
                onChange={() => setIsPrivate(true)}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  <LockIcon size={13} /> Private
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-fg-muted, #8b949e)", marginTop: 2 }}>
                  Only you and workspace collaborators can view
                </div>
              </div>
            </label>
          </div>

          {/* Commit Checkbox */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={commitCurrentModel}
              onChange={(e) => setCommitCurrentModel(e.target.checked)}
            />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <FileCodeIcon size={13} /> Commit current canvas model as initial file
            </span>
          </label>

          {/* Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
              marginTop: "8px",
              borderTop: "1px solid var(--color-border-default, #30363d)",
              paddingTop: "14px",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default, #30363d)",
                background: "transparent",
                color: "var(--color-fg-default, #e6edf3)",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "6px 16px",
                borderRadius: "6px",
                border: "1px solid var(--color-btn-primary-border, rgba(240, 246, 252, 0.1))",
                background: "var(--color-btn-primary-bg, #238636)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Creating…" : "Create Repository"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
