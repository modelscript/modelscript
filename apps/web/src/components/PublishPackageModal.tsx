// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CopyIcon,
  FileZipIcon,
  KeyIcon,
  PackageIcon,
  TerminalIcon,
  UploadIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Flash, FormControl, Label, Select, Spinner, Text, TextInput } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Link, useNavigate } from "react-router-dom";
import { publishPackageArchive } from "../api";
import { useAuth } from "../AuthContext";
import { inspectPackageZip, isValidSemver } from "../util/package-helpers";
import Box from "./Box";

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PublishPackageModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPackageName?: string | undefined;
  defaultVersion?: string | undefined;
  onPublished?: ((name: string, version: string) => void) | undefined;
}

export const PublishPackageModal: React.FC<PublishPackageModalProps> = ({
  isOpen,
  onClose,
  defaultPackageName = "",
  defaultVersion = "",
  onPublished,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"upload" | "cli">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractedFilesCount, setExtractedFilesCount] = useState<number>(0);
  const [hasManifest, setHasManifest] = useState<boolean>(false);
  const [contentHash, setContentHash] = useState<string>("");

  const [packageName, setPackageName] = useState(defaultPackageName);
  const [version, setVersion] = useState(defaultVersion || "1.0.0");
  const [tag, setTag] = useState("latest");
  const [description, setDescription] = useState("");
  const [license, setLicense] = useState("MIT");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifestWarning, setManifestWarning] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setManifestWarning(null);
      if (defaultPackageName) {
        setPackageName(defaultPackageName);
      } else if (user?.username) {
        setPackageName((prev) => prev || `@${user.username}/`);
      }
      if (defaultVersion) {
        setVersion(defaultVersion);
      }
    }
  }, [isOpen, defaultPackageName, defaultVersion, user?.username]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      setSelectedFile(file);
      setError(null);
      setManifestWarning(null);

      try {
        const buffer = await file.arrayBuffer();
        const sha256 = await computeSha256Hex(buffer);
        setContentHash(sha256);

        const meta = inspectPackageZip(new Uint8Array(buffer));
        setExtractedFilesCount(meta.files.length);
        setHasManifest(meta.hasManifest);

        if (meta.name && !defaultPackageName) {
          if (meta.name.startsWith("@") || user?.isAdmin) {
            setPackageName(meta.name);
          } else if (user?.username) {
            setPackageName(`@${user.username}/${meta.name}`);
          } else {
            setPackageName(meta.name);
          }
        }
        if (meta.version && !defaultVersion) {
          setVersion(meta.version);
        }
        if (meta.description) {
          setDescription(meta.description);
        }
        if (meta.license) {
          setLicense(meta.license);
        }

        if (!meta.hasManifest) {
          setManifestWarning(
            "Warning: No root package.json or package.mo detected in archive. The server requires at least one manifest file.",
          );
        }
      } catch (err) {
        console.error("Failed to inspect ZIP archive", err);
        setError("Could not read ZIP archive.");
      }
    },
    [defaultPackageName, defaultVersion, user],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
    maxFiles: 1,
  });

  if (!isOpen) return null;

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = packageName.trim();
    const trimmedVersion = version.trim();

    if (!selectedFile) {
      setError("Please select a .zip package archive to upload.");
      return;
    }
    if (!trimmedName || trimmedName.endsWith("/")) {
      setError("Please enter a valid package name (e.g., @username/my-package).");
      return;
    }
    if (!isValidSemver(trimmedVersion)) {
      setError("Version must be valid Semantic Versioning (e.g., 1.0.0 or 1.2.0-beta.1).");
      return;
    }

    setSubmitting(true);
    try {
      await publishPackageArchive({
        name: trimmedName,
        version: trimmedVersion,
        file: selectedFile,
        tag,
        description: description.trim() || undefined,
        license: license.trim() || undefined,
        contentHash: contentHash || undefined,
      });
      onPublished?.(trimmedName, trimmedVersion);
      onClose();
      navigate(`/packages/${trimmedName}/${trimmedVersion}`);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string | undefined } | undefined } | undefined;
        message?: string | undefined;
      };
      setError(axiosErr.response?.data?.error || axiosErr.message || "Failed to publish package.");
    } finally {
      setSubmitting(false);
    }
  };

  const registryOrigin = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
  const cliLoginCmd = `npm login --registry=${registryOrigin}/api/v1/registry`;
  const cliPublishCmd = `msx publish`;

  const copyCommand = (cmd: string, key: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <Dialog title="Publish Package Release" onClose={onClose} width="large">
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Mode Switcher */}
        <Box
          display="flex"
          gap={2}
          style={{
            borderBottom: "1px solid var(--color-border)",
            paddingBottom: 12,
          }}
        >
          <Button
            size="small"
            variant={mode === "upload" ? "primary" : "invisible"}
            leadingVisual={UploadIcon}
            onClick={() => setMode("upload")}
          >
            Upload Archive (.zip)
          </Button>
          <Button
            size="small"
            variant={mode === "cli" ? "primary" : "invisible"}
            leadingVisual={TerminalIcon}
            onClick={() => setMode("cli")}
          >
            CLI Publish (msx / npm)
          </Button>
        </Box>

        {mode === "upload" ? (
          <form onSubmit={handlePublish} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Dropzone */}
            <div
              {...getRootProps()}
              style={{
                border: `2px dashed ${
                  isDragActive
                    ? "var(--color-accent-cyan, #06b6d4)"
                    : selectedFile
                      ? "rgba(45, 164, 78, 0.6)"
                      : "var(--color-border)"
                }`,
                borderRadius: 10,
                padding: "20px",
                textAlign: "center",
                cursor: "pointer",
                background: isDragActive ? "rgba(6, 182, 212, 0.08)" : "var(--color-bg-card)",
                transition: "all 0.2s ease",
              }}
            >
              <input {...getInputProps()} data-testid="publish-zip-input" />
              {selectedFile ? (
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <FileZipIcon size={20} fill="var(--color-success-fg, #2da44e)" />
                    <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-heading)" }}>
                      {selectedFile.name}
                    </Text>
                    <Label variant="secondary" style={{ fontSize: 11 }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </Label>
                  </Box>
                  <Box display="flex" alignItems="center" gap={2} mt={1}>
                    <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                      {extractedFilesCount} file{extractedFilesCount === 1 ? "" : "s"} inspected
                    </Text>
                    {hasManifest && (
                      <Label variant="success" style={{ fontSize: 10 }}>
                        Manifest Detected
                      </Label>
                    )}
                  </Box>
                  {contentHash && (
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={1}
                      mt={1}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--color-text-muted)",
                      }}
                    >
                      <VerifiedIcon size={12} fill="var(--color-accent-cyan, #06b6d4)" />
                      <span>SHA-256: {contentHash.slice(0, 16)}…</span>
                    </Box>
                  )}
                </Box>
              ) : (
                <Box display="flex" flexDirection="column" alignItems="center" gap={1}>
                  <PackageIcon size={28} fill="var(--color-text-muted)" />
                  <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-heading)" }}>
                    Drag &amp; drop a package .zip archive here, or click to browse
                  </Text>
                  <Text style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    Must contain a root <code>package.mo</code> or <code>package.json</code> manifest (max 100 MB)
                  </Text>
                </Box>
              )}
            </div>

            <Box display="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <FormControl required>
                <FormControl.Label>Package Name</FormControl.Label>
                <TextInput
                  block
                  placeholder={user?.username ? `@${user.username}/my-library` : "@scope/my-library"}
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                />
                <FormControl.Caption>Scoped as @{user?.username || "scope"}/name</FormControl.Caption>
              </FormControl>

              <FormControl required>
                <FormControl.Label>Version (SemVer)</FormControl.Label>
                <TextInput block placeholder="1.0.0" value={version} onChange={(e) => setVersion(e.target.value)} />
              </FormControl>

              <FormControl>
                <FormControl.Label>Dist Tag</FormControl.Label>
                <Select value={tag} onChange={(e) => setTag(e.target.value)} block>
                  <Select.Option value="latest">latest</Select.Option>
                  <Select.Option value="next">next</Select.Option>
                  <Select.Option value="beta">beta</Select.Option>
                  <Select.Option value="rc">rc</Select.Option>
                </Select>
              </FormControl>
            </Box>

            <Box display="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <FormControl>
                <FormControl.Label>Description</FormControl.Label>
                <TextInput
                  block
                  placeholder="Brief summary of models, SysML architecture, or CAD components..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormControl>

              <FormControl>
                <FormControl.Label>SPDX License</FormControl.Label>
                <TextInput
                  block
                  placeholder="MIT, BSD-3-Clause, Apache-2.0..."
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                />
              </FormControl>
            </Box>

            {manifestWarning && <Flash variant="warning">{manifestWarning}</Flash>}
            {error && <Flash variant="danger">{error}</Flash>}

            <Box display="flex" justifyContent="flex-end" gap={2} mt={1}>
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting || !selectedFile}>
                {submitting ? <Spinner size="small" /> : "Publish Release"}
              </Button>
            </Box>
          </form>
        ) : (
          <Box display="flex" flexDirection="column" gap={3}>
            <Text style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              Publish directly from your local workspace or CI/CD pipeline using the ModelScript CLI (<code>msx</code>)
              or standard <code>npm</code> client.
            </Text>

            <Box>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                1. Authenticate with the Registry
              </Text>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                p={2}
                mt={1}
                style={{
                  background: "var(--color-pre-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-accent-cyan, #06b6d4)",
                }}
              >
                <code>{cliLoginCmd}</code>
                <Button
                  size="small"
                  variant="invisible"
                  onClick={() => copyCommand(cliLoginCmd, "login")}
                  aria-label="Copy login command"
                >
                  {copiedCmd === "login" ? <CheckCircleFillIcon size={14} /> : <CopyIcon size={14} />}
                </Button>
              </Box>
            </Box>

            <Box>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                2. Pack &amp; Publish from Your Project Directory
              </Text>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                p={2}
                mt={1}
                style={{
                  background: "var(--color-pre-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-accent-cyan, #06b6d4)",
                }}
              >
                <code>{cliPublishCmd}</code>
                <Button
                  size="small"
                  variant="invisible"
                  onClick={() => copyCommand(cliPublishCmd, "publish")}
                  aria-label="Copy publish command"
                >
                  {copiedCmd === "publish" ? <CheckCircleFillIcon size={14} /> : <CopyIcon size={14} />}
                </Button>
              </Box>
            </Box>

            <Box
              p={3}
              style={{
                borderRadius: 8,
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px solid rgba(139, 92, 246, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <KeyIcon size={16} fill="#a855f7" />
                <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                  Need a scoped automation token (<code>publish_package</code>) for GitHub Actions or CI?
                </Text>
              </Box>
              <Link
                to="/settings?tab=bots"
                onClick={onClose}
                style={{
                  color: "var(--color-accent-cyan, #06b6d4)",
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Manage Tokens →
              </Link>
            </Box>

            <Box display="flex" justifyContent="flex-end">
              <Button onClick={onClose}>Close</Button>
            </Box>
          </Box>
        )}
      </Box>
    </Dialog>
  );
};

export default PublishPackageModal;
