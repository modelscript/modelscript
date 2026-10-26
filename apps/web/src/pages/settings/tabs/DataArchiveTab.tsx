// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  DownloadIcon,
  FileCodeIcon,
  PackageIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import {
  downloadUserDataArchiveJob,
  exportUserDataArchive,
  getUserDataArchiveStatus,
  requestUserDataArchiveJob,
  type ArchiveJobInfo,
} from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { DetailSubtitle, Header, PrimaryButton, SecondaryButton } from "../settingsStyles";

export interface DataArchiveTabProps {
  onBack: () => void;
}

export const DataArchiveTab: React.FC<DataArchiveTabProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [archiveJob, setArchiveJob] = useState<ArchiveJobInfo | null>(null);
  const [isSubmittingArchiveJob, setIsSubmittingArchiveJob] = useState(false);
  const [isDownloadingFinishedArchive, setIsDownloadingFinishedArchive] = useState(false);
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    getUserDataArchiveStatus()
      .then((job) => {
        if (job) setArchiveJob(job);
      })
      .catch(() => {});
  }, []);

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

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Download Your Data Archive
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Request an archive of your ModelScript data under GDPR Article 20 (Right to Data Portability) and CCPA §
          1798.100. Your archive is compiled directly in real-time.
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
                Download Complete!
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
              What's Included in Your Archive
            </Text>
          </Box>
          <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
            Similar to Twitter/X, your data is packaged with both a self-contained local viewer and raw JSON files:
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
                index.html (Local Viewer)
              </Text>
              <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Open in any browser offline. View your profile, social posts, models, compute billing ledger, and
                security logs with search &amp; dark mode.
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
                posts.json &amp; libraries.json
              </Text>
              <DetailSubtitle style={{ fontSize: "12px", lineHeight: "1.4" }}>
                Authored social posts, comments, models, packages, and simulation scripts.
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
              <SyncIcon size={24} style={{ animation: "rotate 1.5s linear infinite" }} />
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
                <span>Enqueued: {new Date(archiveJob.createdAt).toLocaleTimeString()}</span>
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
              {new Date(archiveJob.completedAt || "").toLocaleString()}
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
              disabled={
                isSubmittingArchiveJob ||
                (archiveJob !== null && (archiveJob.status === "queued" || archiveJob.status === "processing"))
              }
            >
              <DownloadIcon size={16} />
              {isSubmittingArchiveJob ? "Queueing..." : "Queue Complete Archive (.ZIP with HTML Viewer)"}
            </PrimaryButton>

            <SecondaryButton
              type="button"
              onClick={() => handleRequestArchiveJob("json")}
              disabled={
                isSubmittingArchiveJob ||
                (archiveJob !== null && (archiveJob.status === "queued" || archiveJob.status === "processing"))
              }
            >
              <FileCodeIcon size={16} />
              Queue Raw Data (.JSON)
            </SecondaryButton>

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
