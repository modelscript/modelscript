// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileCodeIcon,
  FileDirectoryIcon,
  GitBranchIcon,
  KeyIcon,
  LockIcon,
  PackageIcon,
  RepoIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createApiToken,
  downloadUserDataArchiveJob,
  exportUserDataArchive,
  getActivityGitRepoStatus,
  getUserDataArchiveStatus,
  purgeActivityGitRepoCache,
  requestUserDataArchiveJob,
  type ActivityGitRepoStatus,
  type ArchiveJobInfo,
} from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { DetailSubtitle, Header, PrimaryButton, SecondaryButton } from "../settingsStyles";

export interface DataArchiveTabProps {
  onBack: () => void;
}

export const DataArchiveTab: React.FC<DataArchiveTabProps> = ({ onBack }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const [archiveJob, setArchiveJob] = useState<ArchiveJobInfo | null>(null);
  const [isSubmittingArchiveJob, setIsSubmittingArchiveJob] = useState(false);
  const [isDownloadingFinishedArchive, setIsDownloadingFinishedArchive] = useState(false);
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [repoStatus, setRepoStatus] = useState<ActivityGitRepoStatus | null>(null);
  const [isLoadingRepoStatus, setIsLoadingRepoStatus] = useState(false);
  const [isPurgingRepoCache, setIsPurgingRepoCache] = useState(false);
  const [isGeneratingGitToken, setIsGeneratingGitToken] = useState(false);
  const [generatedGitToken, setGeneratedGitToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const refreshRepoStatus = useCallback(async () => {
    setIsLoadingRepoStatus(true);
    try {
      const status = await getActivityGitRepoStatus();
      setRepoStatus(status);
    } catch {
      // Ignore status fetch error if offline
    } finally {
      setIsLoadingRepoStatus(false);
    }
  }, []);

  useEffect(() => {
    getUserDataArchiveStatus()
      .then((job) => {
        if (job) setArchiveJob(job);
      })
      .catch(() => {});
    refreshRepoStatus();
  }, [refreshRepoStatus]);

  // Polling effect while archive job is queued or processing
  useEffect(() => {
    if (!archiveJob || (archiveJob.status !== "queued" && archiveJob.status !== "processing")) return;

    const timer = setInterval(async () => {
      try {
        const updated = await getUserDataArchiveStatus(archiveJob.id);
        if (updated) {
          setArchiveJob(updated);
          if (updated.status === "completed") {
            setArchiveSuccess(
              `Your archive (${updated.format.toUpperCase()}) has been compiled and is ready for download!`,
            );
          } else if (updated.status === "failed") {
            setArchiveError(updated.error || "Archive compilation failed in worker pool.");
          }
        }
      } catch {}
    }, 2000);

    return () => clearInterval(timer);
  }, [archiveJob]);

  const handleCopyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const handleGenerateGitToken = async () => {
    setIsGeneratingGitToken(true);
    setArchiveError(null);
    try {
      const res = await createApiToken({
        name: `Activity Git Portability CLI (${new Date().toISOString().slice(0, 10)})`,
        scopes: ["repos:read"],
        expiresInDays: 90,
      });
      setGeneratedGitToken(res.token);
      setArchiveSuccess(
        "Generated a read-only Personal Access Token (scope: repos:read, expires in 90 days) for cloning your activity repository.",
      );
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to generate read-only Git token.");
    } finally {
      setIsGeneratingGitToken(false);
    }
  };

  const handlePurgeGitCache = async () => {
    setIsPurgingRepoCache(true);
    setArchiveError(null);
    setArchiveSuccess(null);
    try {
      const res = await purgeActivityGitRepoCache();
      setArchiveSuccess(res.message || "Ephemeral server-side activity Git cache purged.");
      await refreshRepoStatus();
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to purge activity Git repository cache.");
    } finally {
      setIsPurgingRepoCache(false);
    }
  };

  const handleRequestArchiveJob = async (format: "zip" | "json" = "zip") => {
    setIsSubmittingArchiveJob(true);
    setArchiveError(null);
    setArchiveSuccess(null);
    try {
      const job = await requestUserDataArchiveJob(format);
      setArchiveJob(job);
      setArchiveSuccess(
        job.status === "completed"
          ? "Your archive is ready for download!"
          : `Archive request queued (Position #${job.queuePosition || 1}). Processing asynchronously in worker queue...`,
      );
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to enqueue archive job. Please try again.");
    } finally {
      setIsSubmittingArchiveJob(false);
    }
  };

  const handleDownloadCompletedArchive = async () => {
    if (!archiveJob) return;
    setIsDownloadingFinishedArchive(true);
    setArchiveError(null);
    try {
      const blob = await downloadUserDataArchiveJob(archiveJob.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelscript-archive-${user?.username || "user"}.${archiveJob.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to download completed archive.");
    } finally {
      setIsDownloadingFinishedArchive(false);
    }
  };

  const handleDownloadArchive = async (format: "zip" | "json" = "zip") => {
    setIsDownloadingArchive(true);
    setArchiveError(null);
    setArchiveSuccess(null);
    try {
      const blob = await exportUserDataArchive(format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        format === "zip"
          ? `modelscript-archive-${user?.username || "user"}.zip`
          : `modelscript-data-${user?.username || "user"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setArchiveError(err.response?.data?.error || "Failed to download data archive.");
    } finally {
      setIsDownloadingArchive(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://modelscript.org";
  const username = user?.username || "me";
  const cloneUrl = `${origin}/git/${username}/activity.git`;
  const cloneCommand = `git clone ${cloneUrl}`;
  const hostWithProtocolRemoved = origin.replace(/^https?:\/\//, "");
  const protocolPrefix = origin.startsWith("http://") ? "http://" : "https://";
  const authenticatedCloneCommand = generatedGitToken
    ? `git clone ${protocolPrefix}${encodeURIComponent(username)}:${generatedGitToken}@${hostWithProtocolRemoved}/git/${username}/activity.git`
    : "";

  const formatTtl = (seconds: number | null | undefined) => {
    if (!seconds || seconds <= 0) return "Expired";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hrs > 0 ? `${hrs}h ${mins}m TTL` : `${mins}m TTL`;
  };

  const formatDate = (iso?: string | null): string => {
    if (!iso) return "—";
    const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z");
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  const isPollingJob = Boolean(archiveJob && (archiveJob.status === "queued" || archiveJob.status === "processing"));

  const handleRefreshJobStatus = async () => {
    try {
      const updated = await getUserDataArchiveStatus(archiveJob?.id);
      if (updated) {
        setArchiveJob(updated);
      }
    } catch {
      // Ignore refresh error
    }
  };

  return (
    <>
      <Header>
        <CircleIconButton className="subtab-back" onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Download Your Data Archive
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Request an archive of your {brandName} data under GDPR Article 20 (Right to Data Portability) and CCPA §
          1798.100, or clone your account activity as a read-only Git repository with incremental fast-forward updates.
        </DetailSubtitle>

        {archiveSuccess && (
          <Box
            mb={4}
            p={3}
            style={{
              background: "var(--color-success-subtle)",
              color: "var(--color-success-fg)",
              borderRadius: "8px",
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
            }}
          >
            <CheckCircleIcon size={20} style={{ marginTop: "2px", flexShrink: 0 }} />
            <Box>
              <Text fontWeight="bold" display="block" mb={1}>
                Success
              </Text>
              <Text fontSize="14px" display="block">
                {archiveSuccess}
              </Text>
            </Box>
          </Box>
        )}

        {archiveError && (
          <Box
            mb={4}
            p={3}
            style={{
              background: "var(--color-danger-subtle)",
              color: "var(--color-danger-fg)",
              borderRadius: "8px",
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
            }}
          >
            <AlertIcon size={20} style={{ marginTop: "2px", flexShrink: 0 }} />
            <Text fontSize="14px">{archiveError}</Text>
          </Box>
        )}

        {/* Personal Activity Git Vault Card */}
        <Box
          mb={4}
          p={4}
          style={{
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
          }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2} mb={2}>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <RepoIcon size={20} />
              <Text fontWeight="bold" fontSize="16px">
                Personal Activity Git Vault (<code>{username}/activity.git</code>)
              </Text>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "rgba(15, 118, 110, 0.14)",
                  color: "var(--ms-brand, #0f766e)",
                }}
              >
                <LockIcon size={11} /> Owner-Only • Read-Only
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: repoStatus?.cached ? "rgba(46, 160, 67, 0.15)" : "rgba(127, 140, 154, 0.15)",
                  color: repoStatus?.cached ? "var(--color-success-fg)" : "var(--color-text-muted)",
                }}
              >
                <GitBranchIcon size={11} />
                {repoStatus?.cached
                  ? `Warm Cache (${formatTtl(repoStatus.ttlRemainingSeconds)})`
                  : "On-Demand (24h Ephemeral Cache)"}
              </span>
            </Box>

            <Box display="flex" gap={2} flexWrap="wrap">
              <SecondaryButton
                type="button"
                onClick={() => navigate(repoStatus?.webRepoPath || `/@${username}/activity`)}
                style={{ padding: "5px 10px", fontSize: "12px" }}
              >
                <FileDirectoryIcon size={14} />
                Browse Vault
              </SecondaryButton>
              <SecondaryButton
                type="button"
                onClick={() => navigate(repoStatus?.webIdePath || `/@${username}/activity?ide=1`)}
                style={{ padding: "5px 10px", fontSize: "12px" }}
              >
                <CodeIcon size={14} />
                Open in Web IDE
              </SecondaryButton>
            </Box>
          </Box>

          <DetailSubtitle style={{ fontSize: "13.5px", lineHeight: "1.5", display: "block", marginBottom: "14px" }}>
            Clone your entire account history as a standard Git repository. Subsequent <code>git pull</code> commands
            fast-forward cleanly with new commits when you publish posts, libraries, or simulation studies, and record{" "}
            <code>git rm</code> commits when items are deleted. Ephemeral server cache auto-purges after 24 hours of
            inactivity (GDPR Art. 17).
          </DetailSubtitle>

          {repoStatus && (
            <Box
              display="flex"
              gap={3}
              flexWrap="wrap"
              mb={3}
              p={2}
              style={{
                background: "var(--color-canvas-default)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
                fontSize: "12.5px",
                color: "var(--color-text-muted)",
              }}
            >
              <span>
                Posts: <strong style={{ color: "var(--color-text-primary)" }}>{repoStatus.postCount}</strong>
              </span>
              <span>
                Libraries: <strong style={{ color: "var(--color-text-primary)" }}>{repoStatus.libraryCount}</strong>
              </span>
              <span>
                Studies/Scripts: <strong style={{ color: "var(--color-text-primary)" }}>{repoStatus.studyCount}</strong>
              </span>
              <span>
                Git Commits:{" "}
                <strong style={{ color: "var(--color-text-primary)" }}>
                  {repoStatus.cached ? repoStatus.commitCount : "Compiled on clone"}
                </strong>
              </span>
              {repoStatus.cached && repoStatus.sizeBytes > 0 && (
                <span>
                  Vault Size:{" "}
                  <strong style={{ color: "var(--color-text-primary)" }}>
                    {(repoStatus.sizeBytes / 1024).toFixed(1)} KB
                  </strong>
                </span>
              )}
              {repoStatus.fingerprint && (
                <span>
                  Fingerprint: <code>{repoStatus.fingerprint.slice(0, 12)}</code>
                </span>
              )}
            </Box>
          )}

          {/* Clone Command Bar */}
          <Box
            p={2}
            mb={3}
            style={{
              background: "var(--color-canvas-default)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "12.5px",
            }}
          >
            <code style={{ overflowX: "auto", whiteSpace: "nowrap", flex: 1 }}>{cloneCommand}</code>
            <SecondaryButton
              type="button"
              onClick={() => handleCopyText("clone", cloneCommand)}
              style={{ padding: "4px 10px", fontSize: "12px", flexShrink: 0 }}
            >
              {copiedKey === "clone" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              {copiedKey === "clone" ? "Copied" : "Copy"}
            </SecondaryButton>
          </Box>

          {generatedGitToken && (
            <Box
              p={3}
              mb={3}
              style={{
                background: "rgba(46, 160, 67, 0.08)",
                border: "1px solid var(--color-success-fg)",
                borderRadius: "8px",
              }}
            >
              <Text
                fontWeight="bold"
                fontSize="13px"
                display="block"
                mb={1}
                style={{ color: "var(--color-success-fg)" }}
              >
                One-Time Authenticated Clone Command (Save token now — shown only once):
              </Text>
              <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
                <code
                  style={{
                    fontSize: "12px",
                    overflowX: "auto",
                    whiteSpace: "nowrap",
                    flex: 1,
                    padding: "6px 8px",
                    background: "var(--color-canvas-default)",
                    borderRadius: "6px",
                  }}
                >
                  {authenticatedCloneCommand}
                </code>
                <SecondaryButton
                  type="button"
                  onClick={() => handleCopyText("auth-clone", authenticatedCloneCommand)}
                  style={{ padding: "4px 10px", fontSize: "12px", flexShrink: 0 }}
                >
                  {copiedKey === "auth-clone" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  {copiedKey === "auth-clone" ? "Copied" : "Copy Command"}
                </SecondaryButton>
              </Box>
            </Box>
          )}

          <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
            <SecondaryButton
              type="button"
              onClick={handleGenerateGitToken}
              disabled={isGeneratingGitToken}
              style={{ fontSize: "12.5px", padding: "6px 12px" }}
            >
              <KeyIcon size={14} />
              {isGeneratingGitToken ? "Generating Token..." : "Generate Read-Only Git Token (repos:read)"}
            </SecondaryButton>

            <SecondaryButton
              type="button"
              onClick={refreshRepoStatus}
              disabled={isLoadingRepoStatus}
              style={{ fontSize: "12.5px", padding: "6px 12px" }}
            >
              <SyncIcon size={14} />
              {isLoadingRepoStatus ? "Refreshing..." : "Refresh Vault Status"}
            </SecondaryButton>

            {repoStatus?.cached && (
              <SecondaryButton
                type="button"
                onClick={handlePurgeGitCache}
                disabled={isPurgingRepoCache}
                style={{
                  fontSize: "12.5px",
                  padding: "6px 12px",
                  color: "var(--color-danger-fg)",
                  borderColor: "var(--color-danger-fg)",
                }}
                title="Physically delete the warm bare Git repository cache from server disk (GDPR Art. 17)"
              >
                <TrashIcon size={14} />
                {isPurgingRepoCache ? "Purging..." : "Purge Server Git Cache"}
              </SecondaryButton>
            )}
          </Box>
        </Box>

        {/* What's in the Archive Card */}
        <Box
          mb={4}
          p={4}
          style={{
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
          }}
        >
          <Box display="flex" alignItems="center" gap={2} mb={2}>
            <PackageIcon size={20} />
            <Text fontWeight="bold" fontSize="16px">
              What's Included in Your Archive &amp; Activity Git Vault
            </Text>
          </Box>
          <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
            Similar to Twitter/X, your data is packaged with a self-contained local HTML viewer, Markdown timeline, and
            raw JSON/model files:
          </DetailSubtitle>

          <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
            <Box
              p={3}
              style={{
                background: "var(--color-canvas-default)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
              }}
            >
              <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                index.html &amp; TIMELINE.md
              </Text>
              <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Open <code>index.html</code> offline in any browser or read <code>TIMELINE.md</code> grouped by month
                with direct links to your posts, packages, and studies.
              </DetailSubtitle>
            </Box>

            <Box
              p={3}
              style={{
                background: "var(--color-canvas-default)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
              }}
            >
              <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                profile.json &amp; manifest.json
              </Text>
              <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Account credentials summary, public SSH keys, verification status, SHA-256 archive checksums, and export
                timestamps.
              </DetailSubtitle>
            </Box>

            <Box
              p={3}
              style={{
                background: "var(--color-canvas-default)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
              }}
            >
              <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                posts/, libraries/ &amp; scripts/
              </Text>
              <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Individual Markdown files for every post (<code>posts/post-*.md</code>), published package manifests,
                and simulation scripts (<code>scripts/study-*</code>).
              </DetailSubtitle>
            </Box>

            <Box
              p={3}
              style={{
                background: "var(--color-canvas-default)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
              }}
            >
              <Text fontWeight="bold" fontSize="14px" display="block" mb={1} color="var(--color-accent-fg)">
                billing.json &amp; compliance.json
              </Text>
              <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Transaction receipts, credit top-ups, compute consumption, and GDPR Art. 20 legal compliance
                certificates.
              </DetailSubtitle>
            </Box>
          </Box>
        </Box>

        {/* Active / In-Progress Job Card */}
        {archiveJob && (archiveJob.status === "queued" || archiveJob.status === "processing") && (
          <Box
            mb={4}
            p={4}
            style={{
              background: "rgba(139, 92, 246, 0.08)",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              borderRadius: "12px",
              display: "flex",
              gap: "12px",
              alignItems: "flex-start",
            }}
          >
            <Box style={{ marginTop: "4px", color: "var(--color-accent-cyan)" }}>
              <SyncIcon size={24} style={{ animation: "spin 1.5s linear infinite" }} />
            </Box>
            <Box style={{ flex: 1 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Text fontWeight="bold" fontSize="16px">
                  {archiveJob.status === "queued"
                    ? `Archive Queued (Position #${archiveJob.queuePosition || 1}${archiveJob.concurrency ? ` • Concurrency: ${archiveJob.concurrency}` : ""})`
                    : `Compiling Data Archive in Background Worker...`}
                </Text>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    backgroundColor: "rgba(6, 182, 212, 0.15)",
                    color: "var(--color-accent-cyan)",
                  }}
                >
                  {archiveJob.status}
                </span>
              </Box>
              <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "12px" }}>
                {archiveJob.status === "queued"
                  ? `Your archive request has been placed in the worker queue. It will begin compiling automatically once a worker slot opens up (pool concurrency limit: ${archiveJob.concurrency || 2} jobs to prevent server memory pressure).`
                  : `Background worker is compiling your models, posts, and compute ledger into a self-contained offline package (processing in concurrency-controlled worker pool of ${archiveJob.concurrency || 2}). You can stay on this page or leave and return anytime.`}
              </DetailSubtitle>
              <Box display="flex" gap={3} flexWrap="wrap" fontSize="12px" style={{ color: "var(--color-text-muted)" }}>
                <span>
                  Format: <strong>{archiveJob.format.toUpperCase()}</strong>
                </span>
                <span>
                  Job ID: <code style={{ fontSize: "11px" }}>{archiveJob.id}</code>
                </span>
                <span>
                  Concurrency Limit: <strong>{archiveJob.concurrency || 2} jobs</strong>
                </span>
                <span>Enqueued: {formatDate(archiveJob.createdAt)}</span>
              </Box>
            </Box>
          </Box>
        )}

        {/* Completed Ready for Download Card */}
        {archiveJob && archiveJob.status === "completed" && (
          <Box
            mb={4}
            p={4}
            style={{
              background: "rgba(46, 160, 67, 0.1)",
              border: "1px solid var(--color-success-fg)",
              borderRadius: "12px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2} mb={2} style={{ color: "var(--color-success-fg)" }}>
              <CheckCircleIcon size={22} />
              <Text fontWeight="bold" fontSize="17px">
                Archive Ready for Download
              </Text>
            </Box>
            <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
              Your {archiveJob.format.toUpperCase()} data archive was generated successfully on{" "}
              {formatDate(archiveJob.completedAt || archiveJob.createdAt)}
              {archiveJob.fileSizeBytes ? ` (${(archiveJob.fileSizeBytes / 1024).toFixed(1)} KB)` : ""}. Staged securely
              on our server for 24 hours.
            </DetailSubtitle>
            <Box display="flex" gap={3} flexWrap="wrap">
              <PrimaryButton
                type="button"
                onClick={handleDownloadCompletedArchive}
                disabled={isDownloadingFinishedArchive}
              >
                <DownloadIcon size={16} />
                {isDownloadingFinishedArchive
                  ? "Downloading..."
                  : `Download Ready Archive (.${archiveJob.format.toUpperCase()})`}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => setArchiveJob(null)}>
                Request New Archive
              </SecondaryButton>
            </Box>
          </Box>
        )}

        {/* Actions / Enqueue Options */}
        <Box
          p={4}
          style={{
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <Text fontWeight="bold" fontSize="16px">
            Request Archive (Asynchronous Worker Queue)
          </Text>
          <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5" }}>
            To guarantee system availability and prevent DoS memory spikes, archives are generated in a background
            worker pool with controlled concurrency. Select your format to queue a job:
          </DetailSubtitle>

          <Box display="flex" flexWrap="wrap" gap={3} mt={2}>
            <PrimaryButton
              type="button"
              onClick={() => handleRequestArchiveJob("zip")}
              disabled={isSubmittingArchiveJob || isPollingJob}
            >
              <DownloadIcon size={16} />
              {isSubmittingArchiveJob ? "Queueing..." : "Queue Complete Archive (.ZIP with HTML Viewer)"}
            </PrimaryButton>

            <SecondaryButton
              type="button"
              onClick={() => handleRequestArchiveJob("json")}
              disabled={isSubmittingArchiveJob || isPollingJob}
            >
              <FileCodeIcon size={16} />
              Queue Raw Data (.JSON)
            </SecondaryButton>

            {!isPollingJob && (
              <SecondaryButton type="button" onClick={() => void handleRefreshJobStatus()}>
                <SyncIcon size={14} />
                Refresh Job Status
              </SecondaryButton>
            )}

            <SecondaryButton
              type="button"
              onClick={() => handleDownloadArchive("zip")}
              disabled={isDownloadingArchive}
              style={{ fontSize: "12px", opacity: 0.8 }}
              title="Direct synchronous export for testing"
            >
              Direct Download (.ZIP)
            </SecondaryButton>
          </Box>
        </Box>
      </Box>
    </>
  );
};
