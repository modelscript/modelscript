// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  ClockIcon,
  CloudIcon,
  CpuIcon,
  DownloadIcon,
  FlameIcon,
  PlayIcon,
  ServerIcon,
  SyncIcon,
  XCircleIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  getCloudSimulationResultCsv,
  getCloudSimulationStatus,
  getComputeProfiles,
  getUserWallet,
  submitCloudSimulation,
  type CloudSimulationStatus,
  type ComputeProfileInfo,
  type UserWalletInfo,
} from "../api";
import Box from "./Box";

// ── Styled Components ───────────────────────────────────────────

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

const ModalCard = styled.div`
  background: var(--surface-overlay, rgba(14, 20, 36, 0.95));
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-glass);
  border-radius: 16px;
  width: 100%;
  max-width: 760px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 18px 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-hud, rgba(14, 20, 36, 0.85));
`;

const ModalBody = styled.div`
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const ProfileGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const ProfileCard = styled.div<{ $selected: boolean }>`
  border: 1px solid ${(props) => (props.$selected ? "var(--color-accent-purple)" : "var(--color-border)")};
  background: ${(props) => (props.$selected ? "rgba(139, 92, 246, 0.12)" : "rgba(255, 255, 255, 0.02)")};
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:hover {
    border-color: var(--color-accent-purple);
  }
`;

const StepItem = styled.div<{ $state: "waiting" | "active" | "done" | "error" }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: ${(props) =>
    props.$state === "active"
      ? "rgba(6, 182, 212, 0.12)"
      : props.$state === "done"
        ? "rgba(16, 185, 129, 0.12)"
        : props.$state === "error"
          ? "rgba(244, 63, 94, 0.12)"
          : "rgba(255, 255, 255, 0.02)"};
  border: 1px solid
    ${(props) =>
      props.$state === "active"
        ? "var(--color-accent-cyan)"
        : props.$state === "done"
          ? "var(--color-status-verified)"
          : props.$state === "error"
            ? "var(--color-error)"
            : "var(--color-border)"};
  font-size: 13px;
`;

const StatCard = styled.div`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  flex: 1;
  text-align: center;
`;

const TableWrap = styled.div`
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12px;

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    background: rgba(255, 255, 255, 0.05);
    position: sticky;
    top: 0;
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
  }

  td {
    padding: 4px 10px;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-muted);
    white-space: nowrap;
  }
`;

// ── Props ───────────────────────────────────────────────────────

interface CloudSimulationModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName?: string;
  fileContent?: string;
  libraryName?: string;
  libraryVersion?: string;
}

export const CloudSimulationModal: React.FC<CloudSimulationModalProps> = ({
  isOpen,
  onClose,
  fileName = "",
  fileContent = "",
  libraryName,
  libraryVersion,
}) => {
  // Infer model name from content or filename
  const initialModelName = useMemo(() => {
    if (fileContent) {
      const modelMatch = fileContent.match(/^\s*(?:model|class|block|package)\s+([a-zA-Z0-9_]+)/m);
      if (modelMatch?.[1]) return modelMatch[1];
    }
    if (fileName) {
      return fileName.replace(/\.[^/.]+$/, "");
    }
    return "Model";
  }, [fileContent, fileName]);

  const [modelName, setModelName] = useState(initialModelName);
  const [numberOfIntervals, setNumberOfIntervals] = useState<number>(500);
  const [selectedProfile, setSelectedProfile] = useState<string>("standard");

  const [profiles, setProfiles] = useState<ComputeProfileInfo[]>([]);
  const [wallet, setWallet] = useState<UserWalletInfo | null>(null);

  // Job lifecycle states
  const [phase, setPhase] = useState<"config" | "submitting" | "running" | "completed" | "failed">("config");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CloudSimulationStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Result data
  const [csvContent, setCsvContent] = useState<string | null>(null);

  // Sync initial model name when content changes
  useEffect(() => {
    setModelName(initialModelName);
  }, [initialModelName]);

  // Load profiles and wallet on open
  useEffect(() => {
    if (!isOpen) return;
    getComputeProfiles().then(setProfiles).catch(console.error);
    getUserWallet().then(setWallet).catch(console.error);
  }, [isOpen]);

  // Elapsed time counter
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (phase === "running" || phase === "submitting") {
      timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [phase]);

  // Status poller
  useEffect(() => {
    if (!jobId || phase !== "running") return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const status = await getCloudSimulationStatus(jobId);
        if (!active) return;
        setJobStatus(status);

        const s = String(status.status || "").toLowerCase();
        if (s === "completed" || s === "success") {
          setPhase("completed");
          // Fetch result CSV
          try {
            const csv = await getCloudSimulationResultCsv(jobId);
            setCsvContent(csv);
          } catch (e) {
            console.error("Failed to retrieve simulation CSV:", e);
          }
        } else if (s === "failed") {
          setPhase("failed");
          setErrorMessage(status.error || "Simulation run failed on cluster.");
        }
      } catch (err: unknown) {
        if (!active) return;
        setPhase("failed");
        setErrorMessage(err instanceof Error ? err.message : "Failed to poll job status.");
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId, phase]);

  // CSV parsing for preview
  const parsedCsv = useMemo(() => {
    if (!csvContent) return null;
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    const headers = lines[0].split(",").map((h) => h.replace(/^["']|["']$/g, "").trim());
    const rows = lines.slice(1, 11).map((row) => row.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim()));
    return {
      headers,
      rows,
      totalRows: lines.length - 1,
    };
  }, [csvContent]);

  if (!isOpen) return null;

  const currentProfile = profiles.find((p) => p.id === selectedProfile) || profiles[0];

  const handleLaunch = async () => {
    setPhase("submitting");
    setErrorMessage(null);
    setElapsedSeconds(0);
    setCsvContent(null);

    try {
      const res = await submitCloudSimulation({
        modelName: modelName.trim(),
        modelSource: fileContent || undefined,
        libraryName,
        libraryVersion,
        profile: selectedProfile,
        numberOfIntervals,
      });

      setJobId(res.jobId);
      setPhase("running");
    } catch (err: unknown) {
      setPhase("failed");
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string; error?: string } };
        message?: string;
      };
      const errData = axiosErr.response?.data;
      if (axiosErr.response?.status === 402) {
        setErrorMessage(
          `Insufficient Compute Credits: ${errData?.message || "Please top up your wallet to burst this workload."}`,
        );
      } else {
        setErrorMessage(errData?.error || axiosErr.message || "Cloud simulation submission failed.");
      }
    }
  };

  const handleDownloadCsv = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${modelName}_res.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <ModalHeader>
          <Box display="flex" alignItems="center" gap={2}>
            <CloudIcon size={20} fill="var(--color-accent-emphasis)" />
            <Text fontWeight="bold" fontSize="16px">
              Run on Cloud HPC
            </Text>
          </Box>
          <Box
            as="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-fg-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <XIcon size={18} />
          </Box>
        </ModalHeader>

        {/* Body */}
        <ModalBody>
          {phase === "config" && (
            <>
              {/* Model and Intervals */}
              <Box display="flex" gap={3}>
                <Box flex={2}>
                  <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                    Target Model Name
                  </Text>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border)",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "var(--color-text-primary)",
                      fontSize: "14px",
                    }}
                  />
                </Box>
                <Box flex={1}>
                  <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                    Intervals
                  </Text>
                  <input
                    type="number"
                    value={numberOfIntervals}
                    onChange={(e) => setNumberOfIntervals(Number(e.target.value))}
                    min={10}
                    max={100000}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border)",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "var(--color-text-primary)",
                      fontSize: "14px",
                    }}
                  />
                </Box>
              </Box>

              {/* Compute Profile Selector */}
              <Box>
                <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={2} display="block">
                  Select SLURM Compute Profile
                </Text>
                <ProfileGrid>
                  {profiles.map((p) => {
                    const isSelected = selectedProfile === p.id;
                    return (
                      <ProfileCard key={p.id} $selected={isSelected} onClick={() => setSelectedProfile(p.id)}>
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                          <Text fontWeight="bold" fontSize="13px">
                            {p.name}
                          </Text>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              color: isSelected ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
                            }}
                          >
                            {p.costCreditsPerHour} credits/hr
                          </span>
                        </Box>
                        <Text fontSize="12px" color="var(--color-fg-muted)">
                          {p.description}
                        </Text>
                        <Box display="flex" gap={2} mt={1} fontSize="11px" color="var(--color-fg-muted)">
                          <span>
                            <CpuIcon size={12} /> {p.cpus} vCPUs
                          </span>
                          <span>{Math.round(p.memoryMb / 1024)} GB RAM</span>
                          {p.gpus > 0 && (
                            <span style={{ color: "var(--color-attention-fg)" }}>
                              <ZapIcon size={12} /> {p.gpus}x {p.gpuType?.toUpperCase()}
                            </span>
                          )}
                        </Box>
                      </ProfileCard>
                    );
                  })}
                </ProfileGrid>
              </Box>

              {/* Wallet Summary */}
              {wallet && (
                <Box
                  p={3}
                  borderRadius="8px"
                  bg="rgba(255, 255, 255, 0.02)"
                  border="1px solid var(--color-border)"
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <FlameIcon size={16} fill="var(--color-accent-emphasis)" />
                    <Text fontSize="13px">
                      Wallet Credit Balance: <strong>{wallet.creditBalance.toFixed(2)} credits</strong>
                    </Text>
                  </Box>
                  <Text fontSize="12px" color="var(--color-fg-muted)">
                    Est. Minimum Cost: ~{(currentProfile?.costCreditsPerHour / 60 || 0.1).toFixed(2)} credits
                  </Text>
                </Box>
              )}
            </>
          )}

          {/* Submitting or Running Telemetry */}
          {(phase === "submitting" || phase === "running") && (
            <Box display="flex" flexDirection="column" gap={3}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box display="flex" alignItems="center" gap={2}>
                  <Spinner size="small" />
                  <Text fontWeight="bold" fontSize="14px">
                    {phase === "submitting" ? "Dispatching to HPC Cluster..." : "Executing OpenModelica Solver..."}
                  </Text>
                </Box>
                <Box display="flex" alignItems="center" gap={1} color="var(--color-fg-muted)" fontSize="13px">
                  <ClockIcon size={14} />
                  <span>{elapsedSeconds}s elapsed</span>
                </Box>
              </Box>

              <Box display="flex" flexDirection="column" gap={2}>
                <StepItem $state="done">
                  <CheckCircleIcon size={16} fill="var(--color-success-fg)" />
                  <span>Validated model syntax and solver specifications</span>
                </StepItem>
                <StepItem $state={phase === "submitting" ? "active" : "done"}>
                  {phase === "submitting" ? (
                    <Spinner size="small" />
                  ) : (
                    <CheckCircleIcon size={16} fill="var(--color-success-fg)" />
                  )}
                  <span>Allocated SLURM partition ({selectedProfile})</span>
                </StepItem>
                <StepItem $state={phase === "running" ? "active" : "waiting"}>
                  {phase === "running" ? <Spinner size="small" /> : <ServerIcon size={16} />}
                  <span>Running numerical integration ({numberOfIntervals} intervals)</span>
                </StepItem>
                <StepItem $state="waiting">
                  <DownloadIcon size={16} />
                  <span>Exporting time-series CSV trajectory</span>
                </StepItem>
              </Box>
            </Box>
          )}

          {/* Completed State */}
          {phase === "completed" && (
            <Box display="flex" flexDirection="column" gap={3}>
              <Box
                p={3}
                borderRadius="8px"
                bg="rgba(46, 160, 67, 0.1)"
                border="1px solid var(--color-success-fg)"
                display="flex"
                alignItems="center"
                gap={2}
              >
                <CheckCircleIcon size={20} fill="var(--color-success-fg)" />
                <Text fontWeight="bold" fontSize="14px" color="var(--color-success-fg)">
                  Simulation Succeeded
                </Text>
              </Box>

              {/* Accounting Stats */}
              {jobStatus?.usage && (
                <Box display="flex" gap={2}>
                  <StatCard>
                    <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                      CPU Runtime
                    </Text>
                    <Text fontSize="16px" fontWeight="bold">
                      {jobStatus.usage.cpuSeconds.toFixed(2)}s
                    </Text>
                  </StatCard>
                  <StatCard>
                    <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                      Cost Charged
                    </Text>
                    <Text fontSize="16px" fontWeight="bold">
                      {jobStatus.usage.costCredits.toFixed(4)} cr
                    </Text>
                  </StatCard>
                  <StatCard>
                    <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                      Exit Code
                    </Text>
                    <Text fontSize="16px" fontWeight="bold">
                      {jobStatus.usage.exitCode}
                    </Text>
                  </StatCard>
                </Box>
              )}

              {/* Data Table Preview */}
              {parsedCsv && (
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)">
                      Trajectory Preview ({parsedCsv.headers.length} variables, {parsedCsv.totalRows} time points)
                    </Text>
                    <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Showing first 10 rows</span>
                  </Box>
                  <TableWrap>
                    <table>
                      <thead>
                        <tr>
                          {parsedCsv.headers.map((h, i) => (
                            <th key={i}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedCsv.rows.map((row, rIdx) => (
                          <tr key={rIdx}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </Box>
              )}
            </Box>
          )}

          {/* Failed State */}
          {phase === "failed" && (
            <Box display="flex" flexDirection="column" gap={3}>
              <Box
                p={3}
                borderRadius="8px"
                bg="rgba(248, 81, 73, 0.1)"
                border="1px solid var(--color-danger-fg)"
                display="flex"
                alignItems="flex-start"
                gap={2}
              >
                <XCircleIcon size={20} fill="var(--color-danger-fg)" style={{ flexShrink: 0, marginTop: "2px" }} />
                <Box>
                  <Text fontWeight="bold" fontSize="14px" color="var(--color-danger-fg)" display="block">
                    Simulation Failed
                  </Text>
                  <Text fontSize="13px" color="var(--color-fg-muted)" style={{ whiteSpace: "pre-wrap" }}>
                    {errorMessage || "An unknown error occurred during execution."}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </ModalBody>

        {/* Footer */}
        <Box
          p={3}
          px={4}
          borderTop="1px solid var(--color-border)"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          bg="var(--surface-overlay, rgba(14, 20, 36, 0.95))"
        >
          {phase === "config" && (
            <>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleLaunch}
                disabled={!modelName.trim()}
                style={{
                  background: "var(--gradient-cta)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "9999px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 0 14px rgba(139, 92, 246, 0.35)",
                  opacity: !modelName.trim() ? 0.6 : 1,
                }}
              >
                <PlayIcon size={16} />
                Launch Simulation
              </button>
            </>
          )}

          {(phase === "submitting" || phase === "running") && (
            <>
              <Text fontSize="12px" color="var(--color-fg-muted)">
                Cluster Job ID: {jobId || "Assigning..."}
              </Text>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                Run in Background
              </button>
            </>
          )}

          {phase === "completed" && (
            <>
              <button
                onClick={() => setPhase("config")}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <SyncIcon size={14} />
                Run Again
              </button>
              <Box display="flex" gap={2}>
                <button
                  onClick={handleDownloadCsv}
                  disabled={!csvContent}
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "9999px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                    color: "var(--color-text-primary)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <DownloadIcon size={14} />
                  Download CSV
                </button>
                <button
                  onClick={onClose}
                  style={{
                    background: "var(--color-accent-emphasis)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </Box>
            </>
          )}

          {phase === "failed" && (
            <>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "var(--color-text-primary)",
                }}
              >
                Close
              </button>
              <button
                onClick={() => setPhase("config")}
                style={{
                  background: "var(--color-accent-emphasis)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "9999px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Adjust Settings & Retry
              </button>
            </>
          )}
        </Box>
      </ModalCard>
    </ModalOverlay>
  );
};

export default CloudSimulationModal;
